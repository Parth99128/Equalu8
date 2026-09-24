#!/usr/bin/env python3
"""
CLI script for PDF/DOCX ingestion - called from Node.js handler.
Extracts text, tables, and visual content (diagrams/charts via vision model),
chunks via rag_engine, outputs JSON.
"""
import sys
import os
import json
import io
import base64
import warnings

# Suppress deprecation warnings BEFORE any library imports so they
# don't contaminate stdout (which must be pure JSON for the Node handler).
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

# Load .env for standalone/CLI use (server.js already injects env when it
# spawns us, but direct runs — ssh, cron, local tests — need this).
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except Exception:
    pass

# Add rag_engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from chunking import chunk_text
from stem_normalize import normalize_text, normalize_table_cell, classify_chunk, detect_chemistry
from chem_validate import canonicalize, find_smiles, HAS_RDKIT
from free_llm import describe_image_bytes as _free_describe_image
from free_llm import generate as _free_generate

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

try:
    import docx
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

# Prefer 'pymupdf' (new import name, no deprecation warning).
# Fall back to 'fitz' (old name, prints a warning to stdout on newer versions).
# Redirect stdout during import so any warning print can't contaminate JSON output.
HAS_PYMUPDF = False
fitz = None

for _mod_name in ("pymupdf", "fitz"):
    try:
        _saved_stdout = sys.stdout
        sys.stdout = io.StringIO()
        fitz = __import__(_mod_name)
        sys.stdout = _saved_stdout
        HAS_PYMUPDF = True
        break
    except ImportError:
        sys.stdout = _saved_stdout
        continue

try:
    import pytesseract
    from PIL import Image
    HAS_TESSERACT = True
    # Set Tesseract path for Windows
    if os.name == 'nt':
        tesseract_paths = [
            r'C:\Program Files\Tesseract-OCR\tesseract.exe',
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            r'C:\Users\Parth\AppData\Local\Programs\Tesseract-OCR\tesseract.exe',
        ]
        for path in tesseract_paths:
            if os.path.exists(path):
                pytesseract.pytesseract.tesseract_cmd = path
                print(f"Tesseract found at: {path}", file=sys.stderr)
                break
        else:
            print("WARNING: Tesseract executable not found in standard locations", file=sys.stderr)
except ImportError:
    HAS_TESSERACT = False

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


def describe_image_with_vision(image_bytes: bytes, mime_type: str = "image/png") -> str:
    """
    Free image description: Ollama vision (offline, no key) -> Gemini vision
    free-tier (if key) -> '' (skip). Never requires a paid key; never raises.
    """
    try:
        return _free_describe_image(image_bytes, mime_type) or ""
    except Exception as e:
        print(f"Vision model error: {e}", file=sys.stderr)
        return ""


_HEAVY_LATEX_MODEL = None


def _ingest_env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


def _fast_ingest() -> bool:
    return (os.getenv("FAST_INGEST", "0").strip().lower() in ("1", "true", "yes"))


def _structures_enabled() -> bool:
    return (os.getenv("CHEM_STRUCTURES", "1").strip().lower() not in ("0", "false", "no"))


def _propose_structure(description: str, page_num: int, max_molecules: int = 4) -> str:
    """Turn a chemical figure description into a validated [STRUCTURE] block.

    Pipeline: vision description -> free LLM proposes SMILES+IUPAC (UP TO
    max_molecules, one per line — classification figures show several) ->
    RDKit gate per candidate (validity + canonical form + formula). Only
    RDKit-validated structures are stored; anything else keeps the plain
    text description. Without RDKit installed this is a no-op.
    Returns "" when no valid structure could be established.
    """
    if not description or not detect_chemistry(description):
        return ""
    if not HAS_RDKIT:
        print("CHEM_STRUCTURES skipped: RDKit not installed (pip install rdkit for structure support)", file=sys.stderr)
        return ""
    try:
        prompt = (
            "You are a chemistry assistant. Given the figure description below from a textbook, "
            f"list EVERY distinctly labeled molecule shown (e.g. in a classification figure cover "
            f"benzene AND aniline AND naphthalene AND tropone — omit none), UP TO {max_molecules}. "
            "Reply with one block per molecule:\n"
            "SMILES: <valid SMILES string>\n"
            "Name: <IUPAC or common name as labeled>\n"
            "Cover each labeled structure exactly once. If no identifiable molecule is described, reply exactly: NONE\n\n"
            f"Description: {description[:1200]}"
        )
        raw = _free_generate(prompt, max_tokens=600)
        if not raw or "NONE" in (raw.split("\n")[0].upper()):
            return ""
        # Split reply into per-molecule blocks on SMILES: lines.
        smiles_lines = [ln.strip() for ln in raw.split("\n") if ln.strip().lower().startswith("smiles:")]
        name_by_idx: dict[int, str] = {}
        idx = -1
        for line in raw.split("\n"):
            if line.strip().lower().startswith("smiles:"):
                idx += 1
            elif line.strip().lower().startswith("name:") and idx >= 0 and idx not in name_by_idx:
                name_by_idx[idx] = line.split(":", 1)[1].strip()[:120]
        entries = []
        seen = set()
        for i, ln in enumerate(smiles_lines[:max_molecules]):
            for cand in find_smiles(ln):
                canon, info = canonicalize(cand)
                if canon and info.get("validated") and canon not in seen:
                    seen.add(canon)
                    entry = f"SMILES: {canon}"
                    if name_by_idx.get(i):
                        entry += f"\nName: {name_by_idx[i]}"
                    if info.get("formula"):
                        entry += f"\nFormula: {info['formula']}"
                    entries.append(entry)
                    break
        if not entries:
            print(f"SMILES proposal failed RDKit gate on page {page_num}", file=sys.stderr)
            return ""
        body = "\n\n".join(entries)
        return (f"[STRUCTURE — Page {page_num}]\n{body}\n"
                f"Description: {normalize_text(description)}\n[/STRUCTURE]\n")
    except Exception as e:
        print(f"Structure proposal error on page {page_num}: {e}", file=sys.stderr)
        return ""


def _valid_image(image_bytes: bytes) -> bool:
    """Pre-validate so pix2tex/OpenCV never crash on empty/corrupt images."""
    if not image_bytes or len(image_bytes) < 2000:
        return False
    try:
        from PIL import Image as _PILImage
        img = _PILImage.open(io.BytesIO(image_bytes))
        img.verify()
        return True
    except Exception:
        return False


def _try_heavy_math_ocr(image_bytes: bytes, timeout_s: int = 60) -> str:
    """Optional heavy LaTeX OCR (pix2tex). Used only when installed; else ''.

    Install for best integral/vector/equation accuracy (free, ~1GB torch model):
        pip install pix2tex  (then weights download once on first use)
    Skips images unlikely to be equations (huge photos/diagrams) and enforces
    a timeout so one bad figure can't stall ingestion on CPU laptops.
    """
    global _HEAVY_LATEX_MODEL
    if _HEAVY_LATEX_MODEL is False:
        return ""
    # Production kill-switch (4GB VM): INGEST_HEAVY_OCR=0 disables pix2tex
    # entirely (torch + model are RAM-heavy). Default on when installed.
    if os.getenv("INGEST_HEAVY_OCR", "1").strip().lower() in ("0", "false", "no"):
        return ""
    # Skip images unlikely to be equations: huge photos/diagrams waste minutes
    # on CPU for zero LaTeX. Equation renders are typically small-wide strips.
    max_bytes = _ingest_env_int("INGEST_MAX_HEAVY_BYTES", 150000)
    if len(image_bytes) > max_bytes:
        return ""
    if not _valid_image(image_bytes):
        return ""
    try:
        from concurrent.futures import ThreadPoolExecutor

        from PIL import Image as _PILImage
        from pix2tex.cli import LatexOCR
        if _HEAVY_LATEX_MODEL is None:
            _HEAVY_LATEX_MODEL = LatexOCR()

        def _infer():
            img = _PILImage.open(io.BytesIO(image_bytes))
            if img.mode != "RGB":
                img = img.convert("RGB")
            return (_HEAVY_LATEX_MODEL(img) or "").strip()

        with ThreadPoolExecutor(max_workers=1) as ex:
            latex = ex.submit(_infer).result(timeout=timeout_s)
        return f"$${latex}$$" if latex else ""
    except ImportError:
        _HEAVY_LATEX_MODEL = False
        return ""
    except Exception as e:
        print(f"Heavy math OCR skipped: {e}", file=sys.stderr)
        return ""


def _pymupdf_layout_text(page) -> str:
    """Layout-aware text with sub/superscript reconstruction (free, no key).

    - Sorts blocks into reading order; detects two-column pages via x-gap.
    - Reconstructs H2SO4/x^2 style runs from span baseline shifts (PyMuPDF
      rawdict origin/size) so chemistry + math survive as H_2SO_4 / x^2.
    Falls back to page.get_text() on any error.
    """
    try:
        raw = page.get_dict() if hasattr(page, "get_dict") else page.get_text("rawdict")
        blocks = raw.get("blocks", []) if isinstance(raw, dict) else []
        lines_out = []
        for b in blocks:
            if b.get("type", 0) != 0:
                continue
            for line in b.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                base_size = max((s.get("size", 0) for s in spans), default=0)
                base_y = spans[0].get("origin", [0, 0])[1]
                parts = []
                for s in spans:
                    t = s.get("text", "")
                    if not t:
                        continue
                    size = s.get("size", base_size)
                    y = s.get("origin", [0, base_y])[1]
                    dy = base_y - y  # >0 means raised (superscript)
                    if base_size and size < base_size * 0.82:
                        if dy > 1.0:
                            parts.append("^" + t)
                        elif dy < -1.0:
                            parts.append("_" + t)
                        else:
                            parts.append(t)
                    else:
                        # inline size-normal run that is all digits right after a letter:
                        # keep as-is; stem_normalize handles spacing later.
                        parts.append(t)
                line_text = "".join(parts)
                # join word fragments split across spans ("orga" + "nic")
                line_text = line_text.replace("  ", " ")
                if line_text.strip():
                    lines_out.append((b.get("bbox", [0, 0, 0, 0])[0],
                                      line.get("bbox", [0, 0, 0, 0])[1],
                                      line_text))
        if not lines_out:
            return page.get_text()
        # Two-column detection: wide x-spread with a clear middle gap.
        xs = [x for x, _, _ in lines_out]
        page_w = page.rect.width if hasattr(page, "rect") else (max(xs) or 1)
        left = [l for l in lines_out if l[0] < page_w * 0.48]
        right = [l for l in lines_out if l[0] >= page_w * 0.52]
        middle = [l for l in lines_out if page_w * 0.48 <= l[0] < page_w * 0.52]
        if len(left) > 3 and len(right) > 3:
            left.sort(key=lambda l: l[1])
            right.sort(key=lambda l: l[1])
            middle.sort(key=lambda l: l[1])
            ordered = [t for _, _, t in left + middle + right]
        else:
            lines_out.sort(key=lambda l: (round(l[1] / 4) * 4, l[0]))
            ordered = [t for _, _, t in lines_out]
        return "\n".join(ordered)
    except Exception:
        try:
            return page.get_text()
        except Exception:
            return ""


def _page_damage(text: str) -> tuple:
    """Damage score for extractor selection: (cids, pua_junk, real_words)."""
    import re as _re
    if not text:
        return (10 ** 9, 0, 0)
    cids = text.count("(cid:")
    pua = len(_re.findall(r"[\ue002-\uf8ff]", text))
    words = len(_re.findall(r"[A-Za-z]{3,}", text))
    return (cids, pua, words)


def _pick_page_text(t_plum: str, t_mupdf: str) -> str:
    """Per-page extractor auto-switch.

    Some PDFs (custom CID subset fonts, e.g. kech202) extract as thousands of
    `(cid:NN)` placeholders under pdfplumber while PyMuPDF resolves the
    embedded ToUnicode maps perfectly — or vice versa. Score both, keep the
    undamaged one; tie-break by real-word count. Both are fast C-level ops.
    """
    cp, pp, wp = _page_damage(t_plum)
    cm, pm, wm = _page_damage(t_mupdf)
    dp, dm = cp + pp, cm + pm
    if dp == 0 and dm == 0:
        # Neither damaged: prefer the richer extraction.
        return t_plum if wp >= wm else t_mupdf
    if dp < dm:
        return t_plum
    if dm < dp:
        return t_mupdf
    return t_plum if wp >= wm else t_mupdf


def _vector_figure_rects(page, min_paths: int = 8, pad: int = 8):
    """Cluster vector drawings into figure regions (for line-art molecules).

    NCERT figures (benzene rings, apparatus) are often vector paths, not
    embedded images — invisible to get_images(). Grid-bucketed union-find
    groups nearby paths, then:
      - drops rule-lines (extreme aspect) and page-furniture mega-clusters,
      - ranks survivors by STROKE DENSITY (paths/sqrt(area)): molecules are
        dense knots of short arcs; table borders/rules are sparse long lines.
    Returns densest-first. Biggest-first ordering would prefer furniture.

    NOTE: currently superseded by the caption-anchored pass (curve-outlined
    textbook text defeats density ranking); kept for pure-vector PDFs.
    """
    try:
        drawings = page.get_drawings()
    except Exception:
        return []
    if len(drawings) < min_paths:
        return []
    try:
        page_rect = page.rect
        page_area = page_rect.width * page_rect.height
    except Exception:
        return []
    rects = []
    for d in drawings:
        try:
            r = d.get("rect")
            if r is None:
                continue
            r = fitz.Rect(r)
            if r.width < 3 or r.height < 3:
                continue
            if r.width > page_rect.width * 0.9 and r.height > page_rect.height * 0.9:
                continue  # full-page background
            rects.append(r)
        except Exception:
            continue
    if len(rects) < min_paths:
        return []
    # Grid buckets (24px, tight) so separate molecules don't chain together.
    cell = 24.0
    prox = 6.0
    buckets: dict = {}
    for i, r in enumerate(rects):
        for gx in range(int(r.x0 // cell) - 1, int(r.x1 // cell) + 2):
            for gy in range(int(r.y0 // cell) - 1, int(r.y1 // cell) + 2):
                buckets.setdefault((gx, gy), []).append(i)
    parent = list(range(len(rects)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for members in buckets.values():
        if len(members) < 2:
            continue
        for k in range(len(members)):
            ri = rects[members[k]]
            ei = fitz.Rect(ri.x0 - prox, ri.y0 - prox, ri.x1 + prox, ri.y1 + prox)
            for m2 in range(k + 1, len(members)):
                j = members[m2]
                if find(members[k]) != find(j) and ei.intersects(rects[j]):
                    parent[find(members[k])] = find(j)
    groups: dict = {}
    for i, r in enumerate(rects):
        groups.setdefault(find(i), []).append(r)
    scored = []
    for g in groups.values():
        if len(g) < min_paths:
            continue
        u = g[0]
        for r in g[1:]:
            u = u | r
        u.x0 = max(0, u.x0 - pad)
        u.y0 = max(0, u.y0 - pad)
        u.x1 = min(page_rect.width, u.x1 + pad)
        u.y1 = min(page_rect.height, u.y1 + pad)
        if u.width < 40 or u.height < 40:
            continue
        ar = u.width / max(1.0, u.height)
        if ar > 8 or ar < 0.125:
            continue  # rule line / underline
        if (u.width * u.height) > page_area * 0.30:
            continue  # merged mega-cluster (page furniture)
        density = len(g) / max(1.0, (u.width * u.height) ** 0.5)
        scored.append((density, u))
    scored.sort(key=lambda t: -t[0])
    return [u for _, u in scored]


def _caption_figure_rects(page, max_per_page: int = 2):
    """Find figure regions via caption anchors ("Fig. 8.9", "Figure 3").

    Textbook line-art (benzene rings, apparatus) is often vector paths or
    page-scan fragments invisible to get_images(), and drawing-clustering
    drowns in curve-outlined text. Captions are reliable anchors: NCERT puts
    the figure ABOVE its caption, so expand upward. Returns [Rect].
    """
    try:
        hits = page.search_for("Fig.") + page.search_for("Figure")
    except Exception:
        return []
    rects = []
    seen = set()
    for inst in hits:
        try:
            key = (round(inst.x0 / 20), round(inst.y0 / 20))
            if key in seen:
                continue
            seen.add(key)
            # Wide column band: the figure above is usually much wider than
            # the caption text itself. Caption words give context, not bounds.
            r = fitz.Rect(
                30,
                max(0, inst.y0 - 330),
                page.rect.width - 30,
                min(page.rect.height, inst.y1 + 40),
            )
            if r.width > 60 and r.height > 80:
                rects.append(r)
            if len(rects) >= max_per_page:
                break
        except Exception:
            continue
    return rects


# Molecule + category names marking figure-label lines. Classification figures
# ("Benzene  Aniline  Naphthalene", lone "Tropone", "Non-benzenoid compound")
# carry structures directly adjacent; molecule labels are often pure vector
# outlines, but these caption-ish text lines survive in the word layer.
_MOLECULE_LABELS = frozenset({
    "methane", "ethane", "ethene", "ethyne", "propane", "butane",
    "benzene", "toluene", "aniline", "phenol", "naphthalene", "tropone",
    "cyclohexane", "cyclopentane", "cyclopropane", "hexane", "pentane",
    "acetylene", "ethylene", "formaldehyde", "acetaldehyde", "acetone",
    "ethanol", "methanol", "acetic", "benzoic", "benzenoid", "non-benzenoid",
})


def _label_row_figure_rects(page, max_per_page: int = 2):
    """Find figure-label LINES (short lines naming molecules/categories).

    A line with <=3 words where any word is a molecule/category name marks a
    figure ("Benzene Aniline Naphthalene" row, lone "Tropone",
    "Non-benzenoid compound" heading). Body prose lines are long and never
    qualify. Structures sit adjacent — expand generously both ways.
    Returns rects covering the figure + its labels.
    """
    try:
        # get_text("words") preserves original case (Title-case labels vs
        # lowercase prose) — search_for() case behavior varies by version.
        try:
            words = page.get_text("words") or []
        except Exception:
            words = []
        # Group words into lines by y-band.
        lines: dict = {}
        for x0, y0, x1, y1, word, *_ in words:
            clean = word.strip(".,;:()[]\"'").strip()
            if not clean:
                continue
            band = round((y0 + y1) / 2 / 5) * 5
            lines.setdefault(band, []).append((x0, x1, clean))
    except Exception:
        return []
    if not lines:
        return []
    rects = []
    for band in sorted(lines):
        items = lines[band]
        if len(items) > 3:
            continue  # prose line, not a label line
        if not any(w.lower() in _MOLECULE_LABELS for _, _, w in items):
            continue
        try:
            x0 = min(x for x, _, _ in items) - 30
            x1 = max(x for _, x, _ in items) + 30
            y = band
            r = fitz.Rect(
                max(0, x0),
                max(0, y - 280),
                min(page.rect.width, x1 + 120),
                min(page.rect.height, y + 120),
            )
            if r.width > 80 and r.height > 100:
                # dedupe near-identical rects
                if not any(abs(r.x0 - q.x0) < 30 and abs(r.y0 - q.y0) < 40 for q in rects):
                    rects.append(r)
            if len(rects) >= max_per_page:
                break
        except Exception:
            continue
    return rects


def table_to_markdown(table: list) -> str:
    """Convert a pdfplumber table (list of rows) to Markdown format.

    Cells are STEM-normalized so integrals, vectors, and chemical formulas
    inside tables survive (H2SO4, ∫, →, etc.).
    """
    if not table or not table[0]:
        return ""
    # Clean + STEM-normalize cells
    rows = []
    for row in table:
        cleaned = [normalize_table_cell(cell or "") if cell else "" for cell in row]
        rows.append(cleaned)
    # Drop ghost tables (borders with no content) — they pollute chunks.
    if not any(c for row in rows for c in row):
        return ""

    # Build markdown table
    lines = []
    # Header
    header = rows[0]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * len(header)) + " |")
    # Data rows
    for row in rows[1:]:
        # Pad row to match header length
        while len(row) < len(header):
            row.append("")
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def extract_text_from_pdf(filepath: str) -> str:
    """
    STEM-robust free extraction:
      Pass 1: per-page dual extraction (pdfplumber AND PyMuPDF race, winner
              kept — CID-damaged output auto-rejected) + tables.
      Pass 1b: targeted OCR ONLY for pages where both extractors failed.
      Pass 2: free vision (Ollama vision -> Gemini free-tier -> skip) for
              diagrams/chemical structures. Optional heavy LaTeX OCR
              (pix2tex) auto-used when installed.
      Pass 3: Tesseract OCR fallback (math-friendly config) for scanned pages.
    No paid key is ever required.
    """
    text_parts = []
    tables_found = 0
    images_described = 0
    math_regions_latex = 0

    # ── Pass 1: per-page dual extraction — pdfplumber AND PyMuPDF race,
    # winner kept per page. Custom CID subset fonts (kech202-style) yield
    # thousands of `(cid:NN)` placeholders under one extractor while the
    # other resolves the embedded ToUnicode maps — damage scoring rejects
    # the garbage side automatically. Tables still via pdfplumber. ──
    mug_doc = None
    if HAS_PYMUPDF:
        try:
            mug_doc = fitz.open(filepath)
        except Exception as e:
            print(f"PyMuPDF open error: {e}", file=sys.stderr)
    damaged_pages: list[int] = []
    if HAS_PDFPLUMBER:
        try:
            with pdfplumber.open(filepath) as pdf:
                for page_num, page in enumerate(pdf.pages):
                    # Extract regular text from BOTH engines (raw, for scoring)
                    t_plum = page.extract_text() or ""
                    t_mu = ""
                    if mug_doc is not None and page_num < len(mug_doc):
                        try:
                            t_mu = _pymupdf_layout_text(mug_doc[page_num])
                        except Exception:
                            t_mu = ""
                    winner = _pick_page_text(t_plum, t_mu)
                    # Track pages where even the winner is damaged/thin for OCR.
                    dc, dp, wp = _page_damage(winner)
                    if (dc + dp > 50 or len(winner.strip()) < 40) and mug_doc is not None:
                        damaged_pages.append(page_num)
                    # STEM-normalize: chemistry case, unicode math,
                    # hyphenation, ligatures, CID/PUA junk strip
                    t = normalize_text(winner)
                    if t:
                        text_parts.append(t)

                    # Extract tables (cells already STEM-normalized)
                    try:
                        tables = page.extract_tables()
                        for table in tables:
                            if table and len(table) > 1:
                                md = table_to_markdown(table)
                                if md:
                                    text_parts.append(f"\n[TABLE]\n{md}\n[/TABLE]\n")
                                    tables_found += 1
                    except Exception as te:
                        print(f"Table extraction error on page {page_num + 1}: {te}", file=sys.stderr)

            if text_parts:
                print(f"Pass 1: per-page best-extractor text + {tables_found} tables ({len(damaged_pages)} damaged pages flagged)", file=sys.stderr)
                # Don't return yet — we still want to check for diagrams/charts
        except Exception as e:
            print(f"pdfplumber error: {e}", file=sys.stderr)
        finally:
            try:
                if mug_doc is not None:
                    mug_doc.close()
            except Exception:
                pass

    # ── Pass 1b: targeted OCR — ONLY pages where both text extractors failed
    # (CID-damaged or image-only pages). Bounded by INGEST_MAX_OCR_PAGES so a
    # bad scan can't stall ingestion. Skipped under FAST_INGEST.
    if damaged_pages and HAS_PYMUPDF and HAS_TESSERACT and not _fast_ingest():
        max_ocr_pages = _ingest_env_int("INGEST_MAX_OCR_PAGES", 10)
        todo = damaged_pages[:max_ocr_pages]
        if len(damaged_pages) > max_ocr_pages:
            print(f"OCR budget: {len(damaged_pages)} damaged pages, OCRing first {max_ocr_pages}", file=sys.stderr)
        try:
            _odoc = fitz.open(filepath)
            ocr_config = "--psm 6 -c preserve_interword_spaces=1"
            try:
                if "eng" in pytesseract.get_languages():
                    ocr_config += " -l eng"
            except Exception:
                pass
            for page_num in todo:
                try:
                    pix = _odoc[page_num].get_pixmap(dpi=300)
                    img_data = pix.tobytes("png")
                    image = Image.open(io.BytesIO(img_data))
                    if image.mode != "RGB":
                        image = image.convert("RGB")
                    ocr_text = normalize_text(pytesseract.image_to_string(image, config=ocr_config))
                    # Keep OCR only if it is genuinely cleaner than the winner.
                    odc, odp, owp = _page_damage(ocr_text)
                    if ocr_text.strip() and (odc + odp < 50) and owp > 20:
                        text_parts.append(ocr_text)
                        print(f"Page {page_num + 1}: OCR rescued ({len(ocr_text)} chars)", file=sys.stderr)
                    else:
                        print(f"Page {page_num + 1}: OCR no better, kept text-layer output", file=sys.stderr)
                except Exception as oe:
                    print(f"Page {page_num + 1} OCR error: {oe}", file=sys.stderr)
            _odoc.close()
        except Exception as e:
            print(f"Targeted OCR error: {e}", file=sys.stderr)

    # ── Pass 2: PyMuPDF — layout text (if thin) + free vision for images ──
    if HAS_PYMUPDF:
        try:
            doc = fitz.open(filepath)

            # If pdfplumber got little (formula-heavy pages often extract thin),
            # add layout-aware PyMuPDF text with sub/superscript reconstruction.
            current_len = sum(len(t) for t in text_parts)
            if current_len < 500:
                for page in doc:
                    t = normalize_text(_pymupdf_layout_text(page))
                    if t and len(t) > 40:
                        text_parts.append(t)

            # ── Free vision: describe diagrams / chemical structures / charts ──
            # BUDGETED: on CPU laptops each image costs ~10s (pix2tex) + ~45s
            # (moondream). So: biggest images first, hard cap on count, skip
            # tiny glyphs. FAST_INGEST=1 skips vision entirely (text+tables only).
            max_vision = _ingest_env_int("INGEST_MAX_VISION_IMAGES", 8)
            min_bytes = _ingest_env_int("INGEST_MIN_IMAGE_BYTES", 15000)
            heavy_timeout = _ingest_env_int("INGEST_HEAVY_TIMEOUT", 60)
            max_structures = _ingest_env_int("INGEST_MAX_STRUCTURES", 4)
            structures_found = 0
            skip_vision = _fast_ingest()
            if skip_vision:
                print("FAST_INGEST=1 — skipping vision + heavy OCR (text+tables only)", file=sys.stderr)

            if not skip_vision:
                # Collect candidates across the whole doc, biggest first.
                candidates = []
                for page_num, page in enumerate(doc):
                    try:
                        for img_info in page.get_images(full=True):
                            xref = img_info[0]
                            try:
                                base_image = doc.extract_image(xref)
                                image_bytes = base_image["image"]
                                if len(image_bytes) < min_bytes:
                                    continue
                                mime = base_image.get("ext", "png")
                                mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "bmp": "image/bmp", "tiff": "image/tiff"}
                                candidates.append((len(image_bytes), page_num,
                                                   image_bytes, mime_map.get(mime, "image/png")))
                            except Exception:
                                continue
                    except Exception:
                        continue
                candidates.sort(key=lambda c: c[0], reverse=True)
                # Reserve half the vision budget for the vector-figure pass
                # below: raster size-sort favors photos, but line-art molecules
                # (usually small) are pedagogically denser.
                emb_cap = max_vision - (max_vision // 2)
                if len(candidates) > emb_cap:
                    print(f"Vision budget: {len(candidates)} embedded figures found, describing largest {emb_cap} ({max_vision - emb_cap} slots reserved for vector line-art)", file=sys.stderr)
                    candidates = candidates[:emb_cap]

                for size, page_num, image_bytes, mime_type in candidates:
                    try:
                        print(f"Figure {images_described + math_regions_latex + 1}/{len(candidates)}: page {page_num + 1} ({size} bytes)...", file=sys.stderr)
                        # Optional heavy LaTeX OCR first (best for equations);
                        # falls back to free vision description.
                        latex = _try_heavy_math_ocr(image_bytes, timeout_s=heavy_timeout)
                        if latex:
                            text_parts.append(
                                f"\n[FORMULA — Page {page_num + 1}]\n{latex}\n[/FORMULA]\n")
                            math_regions_latex += 1
                            continue

                        print(f"Describing image on page {page_num + 1} ({len(image_bytes)} bytes) via free vision...", file=sys.stderr)
                        description = describe_image_with_vision(image_bytes, mime_type)
                        if description:
                            # Chemical figures: propose RDKit-validated SMILES.
                            if (_structures_enabled() and structures_found < max_structures
                                    and detect_chemistry(description)):
                                block = _propose_structure(description, page_num + 1)
                                if block:
                                    text_parts.append(f"\n{block}")
                                    structures_found += 1
                                    images_described += 1
                                    continue
                            text_parts.append(f"\n[VISUAL CONTENT — Page {page_num + 1}]\n{normalize_text(description)}\n[/VISUAL CONTENT]\n")
                            images_described += 1
                    except Exception as ve:
                        print(f"Vision extraction error on page {page_num + 1}: {ve}", file=sys.stderr)

                # ── Caption-anchored figure pass: textbook line-art (benzene rings,
                # apparatus) is often vector paths or scan fragments invisible to
                # get_images(), and drawing-clustering drowns in curve-outlined
                # text. "Fig. 8.x" captions are reliable anchors — the figure sits
                # ABOVE its caption. Render each caption region, describe via free
                # vision. Shares the vision budget.
                max_caption_figs = _ingest_env_int("INGEST_MAX_CAPTION_FIGS", 6)
                if (images_described + math_regions_latex) < max_vision:
                    try:
                        cap_count = 0
                        for page_num, page in enumerate(doc):
                            if (images_described + math_regions_latex) >= max_vision:
                                break
                            if cap_count >= max_caption_figs:
                                break
                            try:
                                rects = _caption_figure_rects(page)
                            except Exception:
                                rects = []
                            for rect in rects:
                                if (images_described + math_regions_latex) >= max_vision:
                                    break
                                if cap_count >= max_caption_figs:
                                    break
                                try:
                                    cap_count += 1
                                    pix = page.get_pixmap(dpi=150, clip=rect)
                                    img_data = pix.tobytes("png")
                                    if len(img_data) < min_bytes:
                                        continue
                                    print(f"Caption figure {cap_count}/{max_caption_figs} on page {page_num + 1} ({int(rect.width)}x{int(rect.height)}pt) via free vision...", file=sys.stderr)
                                    description = describe_image_with_vision(img_data, "image/png")
                                    if not description:
                                        continue
                                    if (_structures_enabled() and structures_found < max_structures
                                            and detect_chemistry(description)):
                                        block = _propose_structure(description, page_num + 1)
                                        if block:
                                            text_parts.append(f"\n{block}")
                                            structures_found += 1
                                            images_described += 1
                                            continue
                                    text_parts.append(f"\n[VISUAL CONTENT — Page {page_num + 1}]\n{normalize_text(description)}\n[/VISUAL CONTENT]\n")
                                    images_described += 1
                                except Exception as ve:
                                    print(f"Caption figure error on page {page_num + 1}: {ve}", file=sys.stderr)
                    except Exception as e:
                        print(f"Caption figure pass error: {e}", file=sys.stderr)

                # ── Molecule-label-row pass: uncaptioned classification figures
                # (benzene/aniline/naphthalene/tropone rows). Structures sit
                # ABOVE their label row. Shares the vision budget.
                max_label_figs = _ingest_env_int("INGEST_MAX_LABEL_FIGS", 4)
                if (images_described + math_regions_latex) < max_vision:
                    try:
                        lab_count = 0
                        for page_num, page in enumerate(doc):
                            if (images_described + math_regions_latex) >= max_vision:
                                break
                            if lab_count >= max_label_figs:
                                break
                            try:
                                rects = _label_row_figure_rects(page)
                            except Exception:
                                rects = []
                            for rect in rects:
                                if (images_described + math_regions_latex) >= max_vision:
                                    break
                                if lab_count >= max_label_figs:
                                    break
                                try:
                                    lab_count += 1
                                    pix = page.get_pixmap(dpi=150, clip=rect)
                                    img_data = pix.tobytes("png")
                                    if len(img_data) < min_bytes:
                                        continue
                                    print(f"Label-row figure {lab_count}/{max_label_figs} on page {page_num + 1} ({int(rect.width)}x{int(rect.height)}pt) via free vision...", file=sys.stderr)
                                    description = describe_image_with_vision(img_data, "image/png")
                                    if not description:
                                        continue
                                    if (_structures_enabled() and structures_found < max_structures
                                            and detect_chemistry(description)):
                                        block = _propose_structure(description, page_num + 1)
                                        if block:
                                            text_parts.append(f"\n{block}")
                                            structures_found += 1
                                            images_described += 1
                                            continue
                                    text_parts.append(f"\n[VISUAL CONTENT — Page {page_num + 1}]\n{normalize_text(description)}\n[/VISUAL CONTENT]\n")
                                    images_described += 1
                                except Exception as ve:
                                    print(f"Label-row figure error on page {page_num + 1}: {ve}", file=sys.stderr)
                    except Exception as e:
                        print(f"Label-row figure pass error: {e}", file=sys.stderr)

                # Rendered-page fallback: only for diagram-heavy pages with almost
                # no text AND only while vision budget remains.
                if not skip_vision and (images_described + math_regions_latex) < max_vision:
                    for page_num, page in enumerate(doc):
                        if (images_described + math_regions_latex) >= max_vision:
                            break
                        try:
                            page_text = page.get_text().strip()
                        except Exception:
                            page_text = ""
                        try:
                            has_imgs = bool(page.get_images(full=True))
                        except Exception:
                            has_imgs = True
                        if len(page_text) < 100 and not has_imgs:
                            try:
                                pix = page.get_pixmap(dpi=150)
                                img_data = pix.tobytes("png")
                                if len(img_data) > min_bytes:
                                    latex = _try_heavy_math_ocr(img_data, timeout_s=heavy_timeout)
                                    if latex:
                                        text_parts.append(
                                            f"\n[FORMULA — Page {page_num + 1}]\n{latex}\n[/FORMULA]\n")
                                        math_regions_latex += 1
                                    else:
                                        print(f"Page {page_num + 1} has little text — rendering for free vision...", file=sys.stderr)
                                        description = describe_image_with_vision(img_data, "image/png")
                                        if description:
                                            if (_structures_enabled() and structures_found < max_structures
                                                    and detect_chemistry(description)):
                                                block = _propose_structure(description, page_num + 1)
                                                if block:
                                                    text_parts.append(f"\n{block}")
                                                    structures_found += 1
                                                    images_described += 1
                                                    continue
                                            text_parts.append(f"\n[VISUAL CONTENT — Page {page_num + 1}]\n{normalize_text(description)}\n[/VISUAL CONTENT]\n")
                                            images_described += 1
                            except Exception as ve:
                                print(f"Page render vision error: {ve}", file=sys.stderr)

            doc.close()

            if text_parts:
                print(f"PyMuPDF: {images_described} images described (free), {math_regions_latex} LaTeX regions, {structures_found} validated structures", file=sys.stderr)
                if images_described > 0 or math_regions_latex > 0 or not text_parts:
                    pass  # Continue to OCR if needed
                else:
                    return "\n\n".join(text_parts)
        except Exception as e:
            print(f"PyMuPDF error: {e}", file=sys.stderr)

    # ── Pass 3: OCR fallback for scanned/image-based PDFs ──
    # Run OCR if we have very little meaningful text (likely a scanned PDF).
    # Math-friendly Tesseract config preserves formula spacing; every result
    # is STEM-normalized so H2SO4 / integrals / vectors survive.
    total_text_len = sum(len(t) for t in text_parts)
    if total_text_len < 100 and HAS_PYMUPDF and HAS_TESSERACT:
        try:
            print(f"Little text extracted ({total_text_len} chars) — attempting OCR with Tesseract...", file=sys.stderr)
            doc = fitz.open(filepath)
            ocr_text_parts = []
            # Higher DPI for sub/superscript legibility; PSM 6 = uniform text block.
            ocr_config = "--psm 6 -c preserve_interword_spaces=1"
            try:
                langs = pytesseract.get_languages()
                if "eng" in langs:
                    ocr_config += " -l eng"
            except Exception:
                pass

            for page_num, page in enumerate(doc):
                # First try embedded images on this page
                images = page.get_images()
                page_ocr_text = ""

                for img in images:
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image['image']
                    image = Image.open(io.BytesIO(image_bytes))
                    if image.mode != 'RGB':
                        image = image.convert('RGB')
                    # Optional heavy LaTeX OCR for equation images
                    latex = _try_heavy_math_ocr(image_bytes)
                    if latex:
                        page_ocr_text += latex + "\n"
                        math_regions_latex += 1
                        continue
                    text = pytesseract.image_to_string(image, config=ocr_config)
                    text = normalize_text(text)
                    if text.strip():
                        page_ocr_text += text + "\n"

                # If no text from embedded images, render page as image and OCR
                if not page_ocr_text.strip():
                    pix = page.get_pixmap(dpi=300)
                    img_data = pix.tobytes("png")
                    image = Image.open(io.BytesIO(img_data))
                    if image.mode != 'RGB':
                        image = image.convert('RGB')
                    text = pytesseract.image_to_string(image, config=ocr_config)
                    text = normalize_text(text)
                    if text.strip():
                        page_ocr_text += text + "\n"

                if page_ocr_text.strip():
                    ocr_text_parts.append(page_ocr_text)
                    print(f"Page {page_num + 1} OCR text length: {len(page_ocr_text)}", file=sys.stderr)

            doc.close()

            # If OCR got meaningful text, use it instead
            ocr_total = sum(len(t) for t in ocr_text_parts)
            if ocr_total > total_text_len:
                print(f"OCR extracted {ocr_total} chars (vs {total_text_len} from pdfplumber) — using OCR result", file=sys.stderr)
                text_parts = ocr_text_parts
            else:
                print(f"OCR extracted {ocr_total} chars — keeping original extraction", file=sys.stderr)

        except Exception as e:
            print(f"OCR error: {e}", file=sys.stderr)

    return "\n\n".join(text_parts) if text_parts else ""

def extract_text_from_docx(filepath: str) -> str:
    """Extract text and tables from DOCX using python-docx (STEM-normalized)."""
    if not HAS_DOCX:
        raise RuntimeError("python-docx not installed")
    doc = docx.Document(filepath)
    text_parts = []

    # Extract paragraphs (Word stores equations as OMML text — normalize survivors)
    for p in doc.paragraphs:
        if p.text.strip():
            text_parts.append(normalize_text(p.text))

    # Extract tables
    for table in doc.tables:
        rows = []
        for row in table.rows:
            cells = [normalize_table_cell(cell.text) for cell in row.cells]
            rows.append(cells)
        if rows:
            md = table_to_markdown(rows)
            if md:
                text_parts.append(f"\n[TABLE]\n{md}\n[/TABLE]\n")

    return "\n".join(text_parts)

def extract_text(filepath: str, filename: str) -> str:
    """Extract text based on file extension."""
    ext = filename.lower().split('.')[-1]
    if ext == 'pdf':
        return extract_text_from_pdf(filepath)
    elif ext in ('docx', 'doc'):
        return extract_text_from_docx(filepath)
    elif ext in ('txt', 'md'):
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    else:
        raise ValueError(f"Unsupported file type: {ext}")

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python ingest_cli.py <filepath> <filename>"}))
        sys.stdout.flush()
        sys.exit(1)
    
    filepath = sys.argv[1]
    filename = sys.argv[2]
    
    try:
        # Extract text (STEM-normalized; tables as markdown, formulas as
        # [FORMULA]$$latex$$, visuals via free vision — no paid key required)
        text = extract_text(filepath, filename)
        if isinstance(text, str):
            # TXT/MD inputs bypass PDF normalization — normalize once here.
            text = normalize_text(text)
        if not text or len(text.strip()) < 50:
            print(json.dumps({"error": "Could not extract meaningful text from file. The file may be a scanned/image PDF without OCR support, or the document may be empty."}))
            sys.stdout.flush()
            sys.exit(1)

        # Chunk using rag_engine
        title = filename.rsplit('.', 1)[0]
        chunks = chunk_text(text, title=title)

        # Count extracted content types
        table_count = text.count("[TABLE]")
        visual_count = text.count("[VISUAL CONTENT")
        formula_count = text.count("[FORMULA]")
        structure_count = text.count("[STRUCTURE")
        math_chunks = sum(1 for c in chunks if c.get("has_math"))
        chem_chunks = sum(1 for c in chunks if c.get("has_chemistry"))

        # Output result
        result = {
            "title": title,
            "content": text,
            "chunks": chunks,
            "extraction_stats": {
                "tables": table_count,
                "visuals": visual_count,
                "formulas": formula_count,
                "structures": structure_count,
                "math_chunks": math_chunks,
                "chemistry_chunks": chem_chunks,
                "total_chunks": len(chunks)
            }
        }
        print(json.dumps(result))
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.stdout.flush()
        sys.exit(1)

if __name__ == '__main__':
    main()
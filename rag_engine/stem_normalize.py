"""
STEM normalization — free, lightweight (stdlib only, no torch).

Problems fixed (organic chemistry, vectors, calculus):
  - Unicode sub/superscripts (H₂SO₄, x², ∫, ∂) mangled or dropped.
  - Small-caps headings from NCERT-style PDFs ("PrinciPles", "carBOn").
  - Ligatures (ﬁ, ﬂ), line-hyphenation ("orga-\\nnic"), collapsed spaces in formulas.
  - Vectors (a⃗, bold), calculus (d/dx, ∫..dx, lim), reaction arrows (->, ⇌).
  - Tables with formulas losing alignment.

All functions are pure + fast and safe to run on every page/cell.
Optional heavy models (pix2tex/Nougat/Docling) are auto-used by ingest_cli
only when installed — this module never requires them.
"""

import re

try:
    from wordlist import WORDS as _WORDS
except ImportError:  # package-style import (rag_engine.stem_normalize)
    try:
        from .wordlist import WORDS as _WORDS
    except ImportError:  # wordlist missing — bigram gate still works
        _WORDS = frozenset()

# ── Ligatures ──────────────────────────────────────────────────────────────
_LIGATURES = {
    "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl",
    "ﬅ": "st", "ﬆ": "st", "–": "-", "—": "-", "―": "-",
    "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...",
}

# ── Unicode subscript / superscript → LaTeX-ish plain form ─────────────────
_SUP = {
    "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4",
    "⁵": "^5", "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9",
    "⁺": "^+", "⁻": "^-", "⁼": "^=", "⁽": "^(", "⁾": "^)",
    "ᵃ": "^a", "ᵇ": "^b", "ᶜ": "^c", "ᵈ": "^d", "ᵉ": "^e",
    "ⁿ": "^n", "ⁱ": "^i", "ˣ": "^x", "ʸ": "^y",
}
_SUB = {
    "₀": "_0", "₁": "_1", "₂": "_2", "₃": "_3", "₄": "_4",
    "₅": "_5", "₆": "_6", "₇": "_7", "₈": "_8", "₉": "_9",
    "₊": "_+", "₋": "_-", "₌": "_=", "₍": "_(", "₎": "_)",
    "ₐ": "_a", "ₑ": "_e", "ₕ": "_h", "ᵢ": "_i", "ⱼ": "_j",
    "ₖ": "_k", "ₗ": "_l", "ₘ": "_m", "ₙ": "_n", "ₒ": "_o",
    "ₚ": "_p", "ᵣ": "_r", "ₛ": "_s", "ₜ": "_t", "ₓ": "_x",
}

_MATH_WORDS = {
    "vec", "dot", "cross", "grad", "div", "curl", "lim", "log", "ln",
    "sin", "cos", "tan", "sec", "csc", "cot", "sinh", "cosh",
    "det", "trace", "rank", "span", "ker", "eigen",
}

_REACTION_ARROWS = ["<=>", "⇌", "⇋", "↔", "→", "←", "⟶", "=>", "->", "<-"]
# Prime marks MUST be included: NCERT uses y′ y″ y′′′ for derivatives.
_MATH_SYMBOLS = set("∫∬∭∮∂∇√∛∑∏∞≈≠≤≥±∓×÷⋅∘∙∠⊥∥∴∵∈∉⊂⊃∪∩∧∨¬⇒⇔→←↔↑↓Δδθλμπσφψωαβγ′″‴⁄")
_MULTI_ELEMENTS = {
    "He", "Li", "Be", "Ne", "Na", "Mg", "Al", "Si", "Cl", "Ar", "Ca",
    "Fe", "Cu", "Zn", "Ag", "Au", "Hg", "Pb", "Br", "Mn", "Cr", "Ni",
    "Co", "Pt", "Pd",
}
_CHEM_ELEMENTS = {
    "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al",
    "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Fe", "Cu", "Zn", "Ag", "Au",
    "Hg", "Pb", "Br", "I", "Mn", "Cr", "Ni", "Co", "Pt", "Pd", "U", "W",
}

# NCERT textbook chrome: running heads, "Reprint YYYY-YY" footers, page numbers.
# Stripped so they never pollute chunks or questions. Conservative on purpose.
_HEADER_LINE_RE = re.compile(
    r"^(?:Reprint \d{4}-\d{2}|[A-Z][A-Z .,&\-()]{3,}\s+\d{1,4}|\d{1,4}\s+[A-Z][A-Z .,&\-()]{3,}|\d+\s+MATHEMATICS|MATHEMATICS\s+\d+|\d{1,4})$"
)

# A line that is a fragment of display math split across lines by the PDF
# extractor: e.g. "dy", "dx", "x2", "dv", "+", "=" — short, symbol-dense.
_FRAGMENT_LINE_RE = re.compile(
    r"^[A-Za-z0-9′″‴∫∂√λπθμσφψωαβγΔ+\-−*=()|\[\]/^_.',:;!?\s]{1,8}$"
)


def _replace_many(text: str, mapping: dict) -> str:
    for k, v in mapping.items():
        if k in text:
            text = text.replace(k, v)
    return text


def fix_ligatures(text: str) -> str:
    return _replace_many(text, _LIGATURES)


def fix_hyphenation(text: str) -> str:
    # "orga-\n nic" / "ben-\nzene" -> "organic" / "benzene" (word-internal hyphen)
    text = re.sub(r"(\w)-\n\s*(\w)", r"\1\2", text)
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    return text


def _looks_like_smallcaps_mangle(word: str) -> bool:
    # "PrinciPles", "carBOn", "sOme", "tetraValence" — words with stray capitals,
    # but NOT chemical formulas ("NaCl", "CH3") which are element-symbol runs.
    if len(word) < 4 or any(ch.isdigit() for ch in word):
        return False
    if word.isupper() or word.islower():
        return False
    if re.fullmatch(r"(?:[A-Z][a-z]?\d*)+", word):
        return False
    # chemical-ish: e.g. "NaCl", "CH3COOH" already excluded by digit/short rule;
    # two-letter element pairs like "Co" are short so excluded too.
    inner_caps = sum(1 for c in word[1:] if c.isupper())
    return inner_caps >= 1 and inner_caps <= 3


def _caesar_unshift(word: str) -> str:
    return "".join(
        chr((ord(c) - 65 - 3) % 26 + 65) if "A" <= c <= "Z" else c
        for c in word
    )


_COMMON_BIGRAMS = frozenset({
    "TH", "HE", "IN", "ER", "AN", "EN", "TI", "TE", "AT", "ST", "ON",
    "ND", "TO", "ED", "NG", "AL", "IT", "AS", "OU", "CH", "SH", "AR",
    "RE", "OR", "ES", "OF", "IS", "RY", "LY", "WA", "AY",
})

# Frequent short words (uppercased): the Caesar gate consults this BEFORE the
# bigram test, so 2–3 letter words ("AND", "THE", "BE", "ABLE", "NAME") decode
# reliably while genuine acronyms ("OF"→"LC", "DNA"→"AKX", "NMR"→"KJO",
# "FIG"→"CFA") never appear here and stay untouched.
_COMMON_WORDS = frozenset({
    "OF", "TO", "IN", "ON", "AT", "AS", "IS", "IT", "OR", "AN", "IF",
    "SO", "NO", "UP", "DO", "GO", "WE", "US", "AM", "BE", "ARE",
    "THE", "AND", "FOR", "BUT", "NOT", "YOU", "ALL", "ANY", "CAN",
    "HAD", "HER", "WAS", "ONE", "OUR", "OUT", "HAS", "HAVE", "THIS",
    "THAT", "WITH", "FROM", "THEY", "THEM", "THEN", "THAN", "WHEN",
    "WHAT", "WHERE", "WHICH", "WHILE", "WHOSE", "YOUR", "BEEN",
    "BEING", "WERE", "WILL", "WOULD", "COULD", "SHOULD", "SHALL",
    "MAY", "MIGHT", "MUST", "JUST", "LIKE", "OVER", "UNDER", "MORE",
    "MOST", "OTHER", "SOME", "SUCH", "ONLY", "VERY", "EACH", "ALSO",
    "INTO", "AFTER", "BEFORE", "BECAUSE", "ABLE", "NAME", "WAYS",
    "DAY", "SAY", "WAY", "IUPAC",
})


# Wordlist for de-gluing words fused by subset fonts ("Learnthe",
# "Methodgof", "Percentageof"). Whole tokens found here are NEVER split
# (protects "together", "other", "within", "another", "mother").
_SPLIT_WORDS = _COMMON_WORDS | frozenset({
    "TOGETHER", "OTHER", "WITHIN", "WITHOUT", "ANOTHER", "MOTHER",
    "FATHER", "BOTHER", "THEREBY", "THEREFORE", "THEREOF", "THEREIN",
    "WHEREBY", "HEREBY", "HEREIN", "WHEREIN", "WHENEVER", "WHEREVER",
    "HOWEVER", "MOREOVER", "UNDERGO", "WHEREAS", "WHEREUPON",
    "LEARN", "METHOD", "NITROGEN", "HALOGEN", "COMBUSTION",
    "CARBON", "HYDROGEN", "OXYGEN", "ORGANIC", "COMPOUND", "REACTION",
    "MECHANISM", "SOLUTION", "MIXTURE", "PERCENTAGE", "ESTIMATION",
    "THEORY", "ENERGY", "MATTER", "ELECTRON", "PROTON", "NEUTRON",
    "ACID", "BASE", "SALT", "METAL", "GAS", "LIQUID", "SOLID",
    "GENERAL", "BASIC", "STRUCTURE", "SHAPES", "TYPES", "SYSTEM",
    "STUDY", "STUDYING", "UNIT", "CHAPTER", "SECTION", "FIGURE",
    "TABLE", "EXAMPLE", "PROBLEM", "RESULT", "VALUE", "ONTO",
    "GAVE", "GIVEN", "USING", "USED", "FORMED", "CALLED", "KNOWN",
    "CANNOT",
})

_FUNC_SUFFIX = ("THE", "AND", "OF", "TO", "IN", "ON", "FOR")

# Single letters sometimes emitted for inter-word spaces by subset fonts
# ("Methodgof" = "Method of", "Justoand" = "Just and").
_GLUE_CHARS = ("g", "o")


def _split_once(token: str, depth: int = 0):
    """Split one glued token, or return None. Strict dictionary guard."""
    up = token.upper()
    # Length floor lives on the regex in deglue_words (>=6); recursion into
    # short fragments ("Bein" -> "Be in") must NOT be length-blocked.
    if up in _SPLIT_WORDS or depth > 2:
        return None
    low = up.lower()
    # Try every split point: right side must be [glue-char +] function word,
    # left side a known word or itself splittable (handles "Beinthe").
    for i in range(2, len(token) - 1):
        left, right = token[:i], token[i:]
        r = right[1:] if right[:1].lower() in _GLUE_CHARS and len(right) > 2 else right
        if r.upper() not in _FUNC_SUFFIX and r.upper() not in _COMMON_WORDS:
            continue
        if left.upper() in _SPLIT_WORDS:
            return left + " " + r
        sub = _split_once(left, depth + 1)
        if sub:
            return sub + " " + right
    return None


def deglue_words(text: str) -> str:
    """Split font-fused words to fixpoint (<=3 passes). Conservative: a token
    splits only against the dictionary; anything uncertain is left intact."""
    def _pass(t: str) -> str:
        return re.sub(
            r"[A-Za-z]{6,}",
            lambda m: _split_once(m.group(0)) or m.group(0),
            t,
        )

    for _ in range(3):
        nxt = _pass(text)
        if nxt == text:
            break
        text = nxt
    return text


def fix_caesar_fonts(text: str) -> str:
    """Decode Caesar-shifted (+3, A–Z only) custom font encodings.

    Some NCERT PDFs embed subset fonts whose uppercase glyphs are mapped +3
    ("VWXG\\LQJ" = "STUDYING", "WHWUDYDOHQFH" = "TETRAVALENCE") while
    lowercase/digits are normal. A run decodes ONLY if the shifted result is
    a known English word (shipped wordlist — primary gate) or contains a
    common English bigram (fallback). This kills double-decodes: plain
    "STUDYING" shifts to "PQRAVFKD" (in neither), while genuine acronyms
    ("IUPAC"->"FRMXZ", "NMR"->"KJO", "DNA"->"AKX", "CARBON"->"ZXMYLK")
    never qualify under either gate.
    The lone backslash inside these runs is the font's glyph for "Y"
    ("VWXG\\LQJ" = "STUDYING", "V\\VWHP" = "SYSTEM").
    """
    out: list[str] = []
    last = 0
    for m in re.finditer(r"[A-Z\\]{2,}", text):
        raw = m.group(0)
        rep = raw
        # Unshift letters first (backslash passes through), THEN map the
        # font's backslash glyph to Y — never shift the inserted Y itself.
        dec = _caesar_unshift(raw).replace("\\", "Y")
        if len(raw.replace("\\", "")) >= 2:
            bigrams = {dec[i:i + 2] for i in range(len(dec) - 1)}
            # "IOU" (VARIOUS, OBVIOUS, PREVIOUS) is a legitimate trigraph —
            # exempt it from the vowel/consonant-blob guard.
            blob_test = dec.replace("IOU", "IX")
            if (dec in _COMMON_WORDS or dec in _WORDS
                    or (bigrams & _COMMON_BIGRAMS
                        and re.search(r"[AEIOUY]", dec)
                        and not re.search(r"[AEIOU]{3}|[^AEIOU]{6}", blob_test))):
                # Case: mid-word fragment ("aIWHU") -> lower; word-start -> Title.
                if m.start() > 0 and text[m.start() - 1].islower():
                    rep = dec.lower()
                else:
                    rep = dec[0] + dec[1:].lower()
        out.append(text[last:m.start()])
        out.append(rep)
        last = m.end()
    out.append(text[last:])
    return "".join(out)


def strip_control_chars(text: str) -> str:
    # Drop non-printable control chars leaked by custom fonts (keep \n and \t).
    # Includes C1 controls (\x80–\x9f) that render as boxes.
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", text)


def fix_bracket_x(text: str) -> str:
    """kech202-style fonts remap glyphs around x/y ("H[Plain" = "Explain",
    lone "E\\" = "By" since backslash is the font's Y glyph).

    Two unambiguous patterns only:
      1. single CAPITAL + '[' + 2+ letters ("H[Plain" -> "Explain");
      2. single CAPITAL + lone backslash at word end ("E\\ berthelot" -> "By").
    Genuine uses ("[1]", "Fig. [A]", LaTeX "\\\\") never match.
    """
    def _fix1(m):
        return _caesar_unshift(m.group(1)) + "x"

    def _fix2(m):
        return _caesar_unshift(m.group(1)) + "y"

    text = re.sub(r"\b([A-Z])\[(?=[A-Za-z]{2,})", _fix1, text)
    return re.sub(r"\b([A-Z])\\(?=\s|$)", _fix2, text)


def fix_smallcaps_case(text: str) -> str:
    def _fix(m):
        w = m.group(0)
        if _looks_like_smallcaps_mangle(w):
            low = w.lower()
            # preserve leading acronym like "IUPAC" (all-caps short already excluded)
            return low[0].upper() + low[1:] if w[0].isupper() else low
        return w

    return re.sub(r"[A-Za-z]{4,}", _fix, text)


def normalize_unicode_math(text: str) -> str:
    text = _replace_many(text, _SUP)
    text = _replace_many(text, _SUB)
    # combining arrow above (vector notation a⃗) -> \vec{a}
    text = re.sub(r"([A-Za-z])\u20D7", r"\\vec{\1}", text)
    text = re.sub(r"([A-Za-z])\u2192", r"\\vec{\1}", text)
    # common textual arrows -> unicode canonical
    text = text.replace("<=>", "⇌").replace("=>", "→").replace("->", "→").replace("<-", "←")
    # ensure spaces around binary operators inside formulas are kept, collapse 3+ spaces
    text = re.sub(r"[ \t]{3,}", "  ", text)
    return text


def normalize_chemistry_spacing(text: str) -> str:
    # "C H3 C O O H" (over-spaced extraction) -> "CH3COOH" when it looks elemental
    def _join_spaced_formula(m):
        seq = m.group(0)
        compact = seq.replace(" ", "")
        # accept if compact looks like element+digit runs
        if re.fullmatch(r"(?:[A-Z][a-z]?\d*\+?-?)+", compact) and len(compact) <= 24:
            return compact
        return seq

    text = re.sub(r"(?:[A-Z][a-z]?\d*\+?-?\s+){2,}[A-Z][a-z]?\d*\+?-?", _join_spaced_formula, text)
    # "Ca 2+" -> "Ca2+", "SO4 2-" -> "SO4^2-"
    text = re.sub(r"\b([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*)\s+(\d*[+-])\b", r"\1\2", text)
    return text


def strip_private_use(text: str) -> str:
    # Math fonts encode extensible delimiters (big parens/brackets) in the
    # Unicode Private Use Area (U+E002–U+F8FF). They extract as junk glyphs,
    # never as meaningful text — drop them. U+E000–U+E001 are reserved for
    # the chunker's own atomic-block placeholders, so they are preserved.
    # Also drop (cid:NN) placeholders emitted when a font's CID→Unicode map
    # is missing (custom subset fonts in some NCERT PDFs).
    text = re.sub(r"\(cid:\d+\)", "", text)
    return re.sub(r"[\ue002-\uf8ff]", "", text)


def strip_textbook_chrome(text: str) -> str:
    # Drop NCERT-style running heads/footers line-wise.
    lines = text.split("\n")
    kept = [ln for ln in lines if not _HEADER_LINE_RE.match(ln.strip())]
    return "\n".join(kept)


def rejoin_display_math(text: str) -> str:
    """Rejoin display-math lines fragmented by the PDF extractor.

    NCERT display fractions extract as vertical shards ("dy" / "dx" / "=" on
    separate lines), often interleaved with prose by reading order. Joining a
    run of short symbol-dense lines with spaces keeps the whole equation
    contiguous in one chunk (symbols adjacent for retrieval + LLM) without
    fabricating relations — we never invent "/" or "^".
    """
    lines = text.split("\n")
    out: list[str] = []
    run: list[str] = []

    def _flush():
        if not run:
            return
        if len(run) >= 2:
            out.append(" ".join(run))
        else:
            out.append(run[0])
        run.clear()

    for ln in lines:
        s = ln.strip()
        if s and _FRAGMENT_LINE_RE.match(s) and not re.search(r"[a-z]{4,}", s):
            # Fragment lines contain no real words (>=4 lowercase letters) —
            # "dy", "x2", "+", "=" qualify; "the order" does not.
            run.append(s)
        else:
            _flush()
            out.append(ln)
    _flush()
    return "\n".join(out)


# Pipeline's own marked blocks (TABLE / FORMULA / STRUCTURE / VISUAL).
# Stashed before any fixer runs and restored after.
_OWN_BLOCK_RE = re.compile(
    r"(\[TABLE\][\s\S]*?\[/TABLE\]"
    r"|\[FORMULA[^\]]*\][\s\S]*?\[/FORMULA\]"
    r"|\[STRUCTURE[^\]]*\][\s\S]*?\[/STRUCTURE\]"
    r"|\[VISUAL CONTENT[^\]]*\][\s\S]*?\[/VISUAL CONTENT\])"
)


def normalize_text(text: str) -> str:
    """Full lightweight pass. Idempotent, safe for prose + STEM."""
    if not text:
        return ""
    # Stash our own marked blocks FIRST — "STRUCTURE" Caesar-decodes to a
    # string containing "OR" and would otherwise be corrupted into
    # "[Pqorzqrob ...]", breaking chunk atomicity + stats. Same guard for
    # TABLE / FORMULA / VISUAL blocks.
    stashed: list[str] = []

    def _stash(m):
        stashed.append(m.group(0))
        return f"\ue000OWN{len(stashed) - 1}\ue001"

    text = _OWN_BLOCK_RE.sub(_stash, text)
    text = strip_private_use(text)
    text = strip_control_chars(text)
    text = fix_ligatures(text)
    text = fix_hyphenation(text)
    text = fix_bracket_x(text)
    text = normalize_unicode_math(text)
    text = normalize_chemistry_spacing(text)
    text = fix_caesar_fonts(text)
    text = deglue_words(text)
    text = fix_smallcaps_case(text)
    text = strip_textbook_chrome(text)
    text = rejoin_display_math(text)
    # collapse blank-run but keep paragraph breaks
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = text.strip()
    for i, block in enumerate(stashed):
        text = text.replace(f"\ue000OWN{i}\ue001", block)
    return text


def normalize_table_cell(cell: str) -> str:
    if not cell:
        return ""
    cell = normalize_text(cell)
    return re.sub(r"\s+", " ", cell).strip()


def detect_math(text: str) -> bool:
    if not text:
        return False
    if any(s in text for s in _MATH_SYMBOLS):
        return True
    if re.search(r"\^[\w(]|\_[\w(]|\\vec|\\frac|\\sqrt|\\int|\\sum|\\lim", text):
        return True
    patterns = [
        r"\bd\s*/\s*d\w", r"\bdy\s*/\s*dx\b", r"∫", r"\blim\b",
        r"\b(sin|cos|tan|log|ln|det|grad|div|curl)\b",
        r"[A-Za-z]\s*·\s*[A-Za-z]",  # dot product
        r"[A-Za-z]\s*×\s*[A-Za-z]",  # cross product
        r"\|\s*[A-Za-z]\s*\|",  # magnitude |a|
        r"\d\s*\^\s*\d", r"x\^2|y\^2",
    ]
    return any(re.search(p, text) for p in patterns)


def detect_chemistry(text: str) -> bool:
    if not text:
        return False
    if any(a in text for a in ("→", "⇌", "↔", "<=>")) and re.search(r"[A-Z][a-z]?\d*", text):
        return True
    # formula-like tokens: H2SO4, CH3COOH, C6H6, CaCO3, [Cu(NH3)4]2+
    hits = re.findall(r"\b(?:[A-Z][a-z]?\d*){2,}\+?\d*[+-]?\b", text)
    for h in hits:
        # Plain English/all-caps words ("HILBERT", "CHAPTER") must NOT match:
        # require a digit, a charge, or a two-letter element symbol.
        has_digit_or_charge = bool(re.search(r"\d|[+-]$", h))
        has_multi_element = any(e in h for e in _MULTI_ELEMENTS)
        if not (has_digit_or_charge or has_multi_element):
            continue
        if len(re.sub(r"[^A-Za-z]", "", h)) >= 2:
            return True
    chem_words = ("iupac", "alkane", "alkene", "alkyne", "benzene", "isomer",
                  "catalyst", "molarity", "titration", "esterification", "hybridization")
    low = text.lower()
    return any(w in low for w in chem_words)


def classify_chunk(text: str) -> dict:
    tags = {"has_math": detect_math(text), "has_chemistry": detect_chemistry(text)}
    tags["has_structure"] = bool(text) and ("SMILES:" in text or "[STRUCTURE" in text)
    return tags

"""
RAG retrieval — select most relevant chunks for generation / evaluation.
STEM-aware: indexes math symbols + formula tokens (not just [a-z]{3,} words)
so ∫, d/dx, H2SO4, \\vec{a} actually match. Boosts chunks tagged
has_math / has_chemistry when the query itself is STEM.
Uses lexical relevance + grounding score. Pluggable with embeddings
when available, but never falls back to ungrounded hallucination.
"""
from typing import List, Dict
import re
from collections import Counter

_WORD_RE = re.compile(r"[a-z]{3,}")
# Formula tokens: H2SO4, x^2, d/dx, \vec, \int, ∫, 3.14, Ca2+
_FORMULA_RE = re.compile(
    r"(\\[a-zA-Z]+|[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)*|\b\d+\.\d+\b"
    r"|[a-zA-Z]\^[\w(]+|[a-zA-Z]_\w+|∫|∂|∇|√|∑|∏|∞|→|⇌|×|÷)"
)

_STEM_HINT_RE = re.compile(
    r"(∫|∂|∇|√|∑|d/dx|dy/dx|\\vec|\\frac|\\int|⇌|→|H2SO4|CH3|C6H6|"
    r"\b(sin|cos|tan|log|ln|lim|det|grad|isomer|alkane|alkene|benzene|iupac|vector|integral|derivative)\b)",
    re.I,
)


def _tok(s: str) -> List[str]:
    words = _WORD_RE.findall(s.lower())
    formulas = [f.lower() for f in _FORMULA_RE.findall(s or "")]
    return words + formulas


def _is_stem_query(query: str) -> bool:
    return bool(_STEM_HINT_RE.search(query or ""))


def score_chunk(query: str, chunk: Dict) -> float:
    text = chunk.get("text", "") or ""
    q = Counter(_tok(query))
    c = Counter(_tok(text))
    overlap = sum(min(q[w], c[w]) for w in q)
    norm = (sum(q.values()) + sum(c.values())) / 2 or 1
    lexical = overlap / norm
    grounding = float(chunk.get("grounding_score", 0.9))
    score = lexical * 0.7 + grounding * 0.3
    # Boost STEM chunks for STEM queries so a formula-bearing chunk wins
    # over a longer prose chunk with incidental word overlap.
    if _is_stem_query(query):
        if chunk.get("has_math"):
            score += 0.08
        if chunk.get("has_chemistry"):
            score += 0.08
        if chunk.get("has_structure"):
            score += 0.10
    return score


def retrieve(query: str, chunks: List[Dict], top_k: int = 5) -> List[Dict]:
    if not chunks:
        return []
    scored = [(score_chunk(query, ch), ch) for ch in chunks]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [ch for _, ch in scored[:top_k]]


def build_context(chunks: List[Dict], limit: int = 5) -> str:
    lines = []
    for i, ch in enumerate(chunks[:limit]):
        tags = []
        if ch.get("has_math"):
            tags.append("math")
        if ch.get("has_chemistry"):
            tags.append("chem")
        if ch.get("has_structure"):
            tags.append("struct")
        tag = ("|" + ",".join(tags)) if tags else ""
        lines.append(f"[Chunk {ch['id']+1} | p{ch['page']} | {ch['tokens']} tok | g={ch['grounding_score']}{tag}]: {ch['text']}")
    return "\n\n".join(lines)


def assert_grounded(question_text: str, chunks: List[Dict]) -> Dict:
    """Return the chunk that best grounds a question, for citation."""
    best = retrieve(question_text, chunks, top_k=1)
    return best[0] if best else chunks[0]

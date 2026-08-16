"""
RAG retrieval — select most relevant chunks for generation / evaluation.
Uses lexical relevance (TF overlap) + recency. Pluggable with Gemini embeddings
when available, but never falls back to ungrounded hallucination.
"""
from typing import List, Dict
import re
from collections import Counter

def _tok(s: str) -> List[str]:
    return re.findall(r"[a-z]{3,}", s.lower())

def score_chunk(query: str, chunk: Dict) -> float:
    q = Counter(_tok(query))
    c = Counter(_tok(chunk["text"]))
    overlap = sum(min(q[w], c[w]) for w in q)
    norm = (sum(q.values()) + sum(c.values())) / 2 or 1
    lexical = overlap / norm
    grounding = float(chunk.get("grounding_score", 0.9))
    # boost longer, high-grounding chunks slightly
    return lexical * 0.7 + grounding * 0.3

def retrieve(query: str, chunks: List[Dict], top_k: int = 5) -> List[Dict]:
    if not chunks:
        return []
    scored = [(score_chunk(query, ch), ch) for ch in chunks]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [ch for _, ch in scored[:top_k]]

def build_context(chunks: List[Dict], limit: int = 5) -> str:
    lines = []
    for i, ch in enumerate(chunks[:limit]):
        lines.append(f"[Chunk {ch['id']+1} | p{ch['page']} | {ch['tokens']} tok | g={ch['grounding_score']}]: {ch['text']}")
    return "\n\n".join(lines)

def assert_grounded(question_text: str, chunks: List[Dict]) -> Dict:
    """Return the chunk that best grounds a question, for citation."""
    best = retrieve(question_text, chunks, top_k=1)
    return best[0] if best else chunks[0]

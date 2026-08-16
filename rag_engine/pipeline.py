"""
End-to-end RAG pipeline orchestration.
Ingest -> Chunk -> Retrieve -> Generate -> Evaluate
"""
from typing import List, Dict
from .chunking import chunk_text
from .retrieval import retrieve, build_context
from .generator import generate_questions
from .evaluator import evaluate_answer
from .config import assert_key

def ingest(title: str, content: str) -> List[Dict]:
    assert_key()
    return chunk_text(content, title=title)

def grounded_generation(title: str, content: str, chunks: List[Dict]) -> List[Dict]:
    assert_key()
    if not chunks:
        raise ValueError("No chunks — ingest first")
    return generate_questions(title, content, chunks)

def grounded_evaluation(questions: List[Dict], answers: List[Dict]) -> List[Dict]:
    """answers: [{question_id, student_answer, points}] matched to questions list"""
    assert_key()
    qmap = {q["id"]: q for q in questions}
    results = []
    for a in answers:
        q = qmap.get(a["question_id"])
        if not q:
            continue
        res = evaluate_answer(q, a.get("student_answer",""))
        results.append({"question_id": q["id"], **res})
    return results

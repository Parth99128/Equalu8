"""
Gemma 4 Evaluator — explains WHY, not just right/wrong.
"""
from typing import Dict
import json
from .ai_client import generate as ai_generate

def evaluate_answer(question: Dict, student_answer: str) -> Dict:
    qtype = question.get("question_type", "short")
    points = int(question.get("points", 10))
    options = question.get("options")
    prompt = f"""You are Gemma 4, evaluator for Next-Gen AI Education Track. Diagnose WHY.
QUESTION: {question.get('question_text','')}
Type: {qtype} | Concept: {question.get('concept_tag')} | Difficulty: {question.get('difficulty')} | Points: {points}
Grounding chunk: "{(question.get('grounding_chunk') or '')[:500]}"
Expected answer: "{(question.get('correct_answer') or '')[:500]}"
{('Options: ' + str(options)) if options else ''}

STUDENT ANSWER: "{(student_answer or '')[:900]}"

Return ONLY JSON: {{"is_correct": bool, "score": int 0..{points}, "feedback": "1-2 sentences why marked this way, cite chunk", "conceptual_gap": "diagnose mental model error + 1 actionable next step tailored"}}
Be constructive, precise, chunk-cited. Partial credit allowed.
"""
    raw = ai_generate(prompt, max_tokens=900)
    # extract JSON object
    start = raw.find("{")
    end = raw.rfind("}")
    blob = raw[start:end+1] if start != -1 and end != -1 else raw
    blob = blob.replace("```json","").replace("```","").strip()
    try:
        parsed = json.loads(blob)
    except Exception:
        import re
        m = re.search(r'\{[^{}]*\{[^\}]*\}[^\}]*\}|\{[^\}]+\}', raw, re.DOTALL)
        if m:
            parsed = json.loads(m.group(0))
        else:
            raise RuntimeError(f"Model returned invalid evaluation JSON: {raw[:500]}")
    return {
        "is_correct": bool(parsed.get("is_correct")),
        "score": max(0, min(points, int(parsed.get("score", 0)))),
        "feedback": str(parsed.get("feedback") or ""),
        "conceptual_gap": str(parsed.get("conceptual_gap") or ""),
    }

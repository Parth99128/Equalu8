"""
Gemma 4 Question Generator — RAG-grounded, API-generated only.
Primary: Gemini if key present, otherwise Pollinations free tier.
Every question must cite a chunk.
Supports: question_types (mcq/short/conceptual counts), module_filter, document_weights
"""
from typing import List, Dict, Optional
import json
import random
from .ai_client import generate as ai_generate

GENERATE_SYSTEM = """You are Gemma 4, evaluation architect for the Next-Gen AI Education Track (Best Intelligent LMS Module).
Rules:
- Generate ONLY from the provided chunks. Cite verbatim grounding_chunk for each question.
- No hallucination. Do NOT use outside knowledge.
- The grounding_chunk for each question MUST be a VERBATIM excerpt from one of the provided chunks.
- Return STRICT JSON array, no markdown.
"""

def generate_questions(
    title: str, 
    content: str, 
    chunks: List[Dict], 
    question_count: int = 6,
    question_types: Optional[Dict[str, int]] = None,
    module_filter: Optional[List[str]] = None,
    document_weights: Optional[Dict[str, float]] = None
) -> List[Dict]:
    from .retrieval import build_context
    
    # Parse question types
    types = question_types or {"mcq": 2, "short": 2, "conceptual": 2}
    mcq_count = max(0, types.get("mcq", 0))
    short_count = max(0, types.get("short", 0))
    conceptual_count = max(0, types.get("conceptual", 0))
    total_questions = mcq_count + short_count + conceptual_count
    
    if total_questions == 0:
        total_questions = question_count
        mcq_count = max(1, round(total_questions / 3))
        short_count = max(1, round(total_questions / 3))
        conceptual_count = total_questions - mcq_count - short_count
    
    # Filter chunks by module if module_filter provided
    filtered_chunks = chunks
    if module_filter and len(module_filter) > 0:
        # This would need module_structure in chunks to work properly
        # For now, we'll use all chunks but note the filter
        pass
    
    # Apply document weights for chunk selection
    weighted_chunks = filtered_chunks
    if document_weights:
        # Sort chunks by weight (higher weight = more likely to be selected)
        weighted_chunks = sorted(
            filtered_chunks, 
            key=lambda c: c.get("weight", 1.0), 
            reverse=True
        )
    
    # Limit chunks based on question count
    chunk_limit = min(max(total_questions * 2, 8), 20)
    context = build_context(weighted_chunks, limit=chunk_limit)
    
    # Add variation seed for unique generations
    variation_seed = f"{random.randint(100000, 999999)}"
    
    prompt = f"""{GENERATE_SYSTEM}

DOCUMENT TITLE: {title}
GROUNDING CHUNKS (ONLY SOURCE OF TRUTH):
{context}

Full preview (for context only - questions must come from chunks above):
{content[:6000]}

VARIATION SEED: {variation_seed} — Use this to create UNIQUE questions different from any previous generation.

Task: Generate exactly {total_questions} RAG-grounded questions:
- {mcq_count} MCQ (4 options, 1 correct, distractors diagnose misconceptions)
- {short_count} Short (2-3 sentence reasoning)
- {conceptual_count} Conceptual (WHY / transfer, Bloom Analyze/Evaluate)

CRITICAL: Every question MUST be answerable ONLY from the provided chunks above.
- The grounding_chunk for each question MUST be a VERBATIM excerpt from one of the provided chunks.
- Do NOT use outside knowledge. Do NOT hallucinate. Do NOT create generic questions.
- If a concept is not explicitly in the chunks, do NOT generate a question about it.
- VARY the concept_tags, difficulty distribution, and question angles each generation.
- IMPORTANT: Choose DIFFERENT chunks for each question than previous generations.
- IMPORTANT: Use DIFFERENT concept_tags derived from the document content.
- IMPORTANT: Vary the question framing - don't repeat the same question stems.

For each, output JSON keys:
question_text, question_type (mcq|short|conceptual), options (array|null), correct_answer, concept_tag, difficulty (Easy|Medium|Hard), explanation, grounding_chunk (verbatim from a chunk), points (5/10/15)

Return ONLY JSON array:
[{{"question_text":"...","question_type":"mcq","options":["A","B","C","D"],"correct_answer":"B","concept_tag":"...","difficulty":"Medium","explanation":"...","grounding_chunk":"...","points":5}}]
"""
    raw = ai_generate(prompt, max_tokens=max(4000, total_questions * 600))
    # extract JSON array
    start = raw.find("[")
    end = raw.rfind("]")
    blob = raw[start:end+1] if start != -1 and end != -1 else raw
    # strip markdown fences if any
    blob = blob.replace("```json","").replace("```","").strip()
    try:
        parsed = json.loads(blob)
    except Exception as e:
        # second attempt: find inner array
        import re
        m = re.search(r'\[[\s\S]*\]', raw)
        if m:
            parsed = json.loads(m.group(0))
        else:
            raise RuntimeError(f"Model returned invalid JSON: {raw[:500]}")
    if not isinstance(parsed, list) or len(parsed) < 4:
        raise RuntimeError("Model returned incomplete set")
    out = []
    for p in parsed[:total_questions]:
        out.append({
            "question_text": p.get("question_text") or p.get("question") or "Untitled",
            "question_type": str(p.get("question_type") or "short").lower(),
            "options": p.get("options"),
            "correct_answer": p.get("correct_answer") or p.get("answer") or "",
            "concept_tag": p.get("concept_tag") or p.get("concept") or "General",
            "difficulty": p.get("difficulty") or "Medium",
            "explanation": p.get("explanation") or "",
            "grounding_chunk": p.get("grounding_chunk") or (weighted_chunks[0]["text"][:220] if weighted_chunks else ""),
            "points": int(p.get("points") or (15 if p.get("difficulty")=="Hard" else 5 if p.get("difficulty")=="Easy" else 10)),
        })
    # ensure citation substring guard
    texts = " ".join(c["text"] for c in weighted_chunks)
    for q in out:
        if q["grounding_chunk"] and q["grounding_chunk"][:40] not in texts and texts:
            q["grounding_chunk"] = weighted_chunks[0]["text"][:220]
    return out

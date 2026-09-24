"""
Unified AI client — $0 operation via free chain (see free_llm.py).

Order: Ollama local (no key) -> Gemini free-tier (optional key)
  -> Groq free-tier (optional key) -> Pollinations anonymous (no key).
Kept as a thin backwards-compatible wrapper; new code should import free_llm.
"""
from typing import Optional

from .free_llm import generate as _free_generate
from .free_llm import get_gemini_key as _free_key


def _env_key() -> Optional[str]:
    return _free_key()


def _gemini(prompt: str, key: str, max_tokens: int = 8192) -> Optional[str]:
    from .free_llm import _gemini as _g
    return _g(prompt, key, max_tokens=max_tokens)


def _pollinations(prompt: str, retries: int = 6) -> Optional[str]:
    from .free_llm import _pollinations as _p
    return _p(prompt, retries=retries)


def generate(prompt: str, max_tokens: int = 2600) -> str:
    """Free chain — never requires a paid key. Raises only if all free providers fail."""
    return _free_generate(prompt, max_tokens=max_tokens)


# ============================================================================
# NEW PROMPT TEMPLATES FOR ENHANCED FLOW
# ============================================================================

SYLLABUS_ANALYSIS_PROMPT = """You are Gemma 4, an expert educational curriculum analyst.
Analyze this syllabus document and extract structured information.

DOCUMENT TITLE: {title}

SYLLABUS CONTENT (CHUNKS):
{chunks_text}

FULL DOCUMENT PREVIEW:
{full_content}

Return ONLY a JSON object with this exact structure:
{{
  "summary": "2-3 sentence summary of the course/syllabus",
  "key_concepts": ["concept1", "concept2", "concept3", ...],
  "module_structure": [
    {{
      "id": "module_1",
      "title": "Module 1: Title",
      "description": "Brief description of this module",
      "topics": [
        {{
          "id": "topic_1_1",
          "title": "Topic 1.1: Title",
          "description": "Brief description",
          "chunk_indices": [0, 1],
          "concepts": ["concept_a", "concept_b"]
        }}
      ],
      "chunk_indices": [0, 1, 2],
      "weight": 1.0
    }}
  ],
  "concept_coverage": {{
    "concept_name": 85.5
  }},
  "suggested_distribution": {{
    "mcq": 4,
    "short": 3,
    "conceptual": 3,
    "total": 10,
    "rationale": "Explanation of why this distribution fits the syllabus"
  }},
  "difficulty_distribution": {{
    "easy": 3,
    "medium": 5,
    "hard": 2
  }},
  "learning_objectives": ["objective1", "objective2", ...],
  "prerequisites": ["prereq1", "prereq2", ...]
}}

Guidelines:
- Identify 5-15 key concepts from the syllabus
- Create 3-8 modules based on the document structure
- Each module should have 2-5 topics
- chunk_indices should reference the chunk numbers (0-based) that relate to each module/topic
- concept_coverage: percentage (0-100) of how well each concept is covered in the chunks
- suggested_distribution: total questions 6-20 based on content depth
- learning_objectives: 5-10 specific, measurable objectives
- prerequisites: 3-6 prerequisite topics/skills
"""

TYPED_QUESTION_GENERATION_PROMPT = """You are Gemma 4, evaluation architect for the Next-Gen AI Education Track (Best Intelligent LMS Module).
Rules:
- Generate ONLY from the provided chunks. Cite verbatim grounding_chunk for each question.
- No hallucination. Do NOT use outside knowledge.
- The grounding_chunk for each question MUST be a VERBATIM excerpt from one of the provided chunks.
- Return STRICT JSON array, no markdown.

DOCUMENT TITLE: {title}
GROUNDING CHUNKS (ONLY SOURCE OF TRUTH):
{context}

Full preview (for context only - questions must come from chunks above):
{full_content}

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

FORBIDDEN QUESTION PATTERNS (NEVER generate these):
- "Which concept is listed X in the Y section?"
- "What is the Xth item in the list?"
- "Which key concept comes after/before [concept]?"
- "What is the order of concepts in the syllabus?"
- Any question that only tests list position or sequence memorization
- Generic "What is [concept]?" without context or application

REQUIRED QUESTION QUALITY STANDARDS:
1. **MCQ Questions**: Test conceptual understanding, not recall. Distractors must represent common misconceptions. Frame as scenarios, comparisons, or cause-effect.
   - Good: "A manufacturing system uses digital twins for predictive maintenance. If sensor data shows vibration anomalies, which Industry 4.0 principle enables real-time adjustment?"
   - Bad: "What is a digital twin?"

2. **Short Answer Questions**: Require synthesis, explanation, or application. 2-3 sentences demonstrating reasoning.
   - Good: "Explain how cyber-physical systems enable closed-loop control in smart factories, referencing the role of IoT sensors and real-time analytics."
   - Bad: "Define cyber-physical systems."

3. **Conceptual Questions**: Bloom's Analyze/Evaluate/Create. Transfer to new contexts, critique, design, or justify.
   - Good: "Critique the claim that 'interoperability is the most critical Industry 4.0 pillar.' Support your position with evidence from the syllabus regarding data integration challenges."
   - Bad: "Why is interoperability important?"

COGNITIVE DISTRIBUTION TARGET:
- 20% Remember/Understand (basic concept application)
- 40% Apply/Analyze (scenario-based, comparison, diagnosis)
- 40% Evaluate/Create (critique, design, justify, transfer)

For each, output JSON keys:
question_text, question_type (mcq|short|conceptual), options (array|null), correct_answer, concept_tag, difficulty (Easy|Medium|Hard), explanation, grounding_chunk (verbatim from a chunk), points (5/10/15)

Return ONLY JSON array:
[{{"question_text":"...","question_type":"mcq","options":["A","B","C","D"],"correct_answer":"B","concept_tag":"...","difficulty":"Medium","explanation":"...","grounding_chunk":"...","points":5}}]
"""


def analyze_syllabus(title: str, chunks_text: str, full_content: str, max_tokens: int = 4096) -> str:
    """Analyze syllabus using AI."""
    prompt = SYLLABUS_ANALYSIS_PROMPT.format(
        title=title,
        chunks_text=chunks_text,
        full_content=full_content[:6000]
    )
    return generate(prompt, max_tokens=max_tokens)


def generate_typed_questions(
    title: str,
    context: str,
    full_content: str,
    mcq_count: int,
    short_count: int,
    conceptual_count: int,
    variation_seed: str,
    max_tokens: int = 4096
) -> str:
    """Generate questions with specific type counts."""
    total = mcq_count + short_count + conceptual_count
    prompt = TYPED_QUESTION_GENERATION_PROMPT.format(
        title=title,
        context=context,
        full_content=full_content[:6000],
        mcq_count=mcq_count,
        short_count=short_count,
        conceptual_count=conceptual_count,
        total_questions=total,
        variation_seed=variation_seed
    )
    return generate(prompt, max_tokens=max_tokens)

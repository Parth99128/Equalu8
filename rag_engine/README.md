# EVALU8 — Python RAG Engine

Next-Gen AI Education Track / Best Intelligent LMS Module  
Powered by Gemma 4 (Google Generative Language API)

## Architecture

```
ingest (chunking.py) → retrieve (retrieval.py) → generate (generator.py) → evaluate (evaluator.py)
                           pipeline.py orchestrates end-to-end
```

* **config.py** — GEMINI_API_KEY is the single source. No fallback. No UI key input.
* **chunking.py** — semantic splitter (sentence-aware, 1100 chars, 140 overlap) with grounding_score + page metadata
* **retrieval.py** — lexical relevance + grounding score ranking, builds RAG context
* **generator.py** — calls Gemma 3 / Gemini 1.5 Flash via `generativelanguage.googleapis.com`, enforces verbatim grounding_chunk citations
* **evaluator.py** — per-answer WHY diagnosis: feedback + conceptual_gap, chunk-cited, constructive
* **pipeline.py** — `ingest()` / `grounded_generation()` / `grounded_evaluation()` helpers

Add your key to `.env` at project root or `rag_engine/.env`:

```
GEMINI_API_KEY=AIza...your_key
```

No key is ever displayed in the frontend.

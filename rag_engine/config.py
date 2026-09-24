"""
Central configuration — $0 operation via free chain (see free_llm.py).

Order: Groq -> Cerebras -> OpenRouter (:free Gemma 4) -> Gemini free-tier
-> Ollama local (Gemma 4 offline) -> Pollinations anonymous (no key).
Nothing requires a paid key.
All responses remain API-generated — never hardcoded dummy data.
"""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    pass

def get_gemini_key():
    k = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMMA_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")
    if k and len(k.strip()) >= 10:
        return k.strip()
    return None

def has_key() -> bool:
    return get_gemini_key() is not None

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "text-embedding-004")
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "1100"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "140"))
TOP_K = int(os.getenv("RAG_TOP_K", "5"))

def assert_key():
    # kept for compatibility — no longer raises; uses fallback
    return get_gemini_key()

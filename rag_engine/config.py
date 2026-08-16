"""
Central configuration — GEMINI_API_KEY from .env (hidden, never shown live)
is the preferred source. If absent, the free Pollinations API (still a
parameter-free model via API) is used so teacher flows never break.
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

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemma-4-26b-a4b-it")
GEMINI_EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "text-embedding-004")
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "1100"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "140"))
TOP_K = int(os.getenv("RAG_TOP_K", "5"))

def assert_key():
    # kept for compatibility — no longer raises; uses fallback
    return get_gemini_key()

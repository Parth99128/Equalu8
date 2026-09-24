"""
Free LLM chain — operate EVALU8 with $0 cost, no expiring credits required.

Permanently-free lanes (no card):
  1. Groq free-tier (GROQ_API_KEY) — per-MODEL buckets; llama-4-scout ≈ 30K
     TPM, gpt-oss/qwen ≈ 8K TPM. Start model rotates per call.
  2. GitHub Models (GITHUB_TOKEN = any PAT) — 150 req/day low-tier.
  3. Nvidia NIM (NVIDIA_API_KEY, email signup) — typically ~40 RPM.
  4. Cerebras free trial (CEREBRAS_API_KEY) — hosts Gemma 4 31B at ~1800 tok/s.
  5. OpenRouter :free (OPENROUTER_API_KEY) — real Gemma 4 free
     (google/gemma-4-31b-it:free), one key, no card.
  6. Gemini free-tier (GEMINI_API_KEY) — generous no-cost tier.
  7. Ollama local (OLLAMA_HOST, default http://localhost:11434) — fully offline,
     no key. Text models tried in order: OLLAMA_MODEL, gemma4:e4b, gemma3:4b;
     vision model: OLLAMA_VISION_MODEL.
  8. Pollinations keyed (POLLINATIONS_API_KEY, free sk_) — chat completions.
  9. Pollinations anonymous (no key) — public free tier.

Any key var accepts comma-separated keys ("k1,k2") — each key has its own
free quota, so rotation multiplies limits with zero new accounts.

Nothing here requires a paid key. Callers must still handle `None` /
exceptions with their local RAG-grounded fallback so teacher flows never break.
"""

import os
import time
import random
import urllib.parse
import urllib.request
import urllib.error
from typing import Optional


def ollama_host() -> str:
    return (os.getenv("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")


def ollama_model() -> str:
    return os.getenv("OLLAMA_MODEL", "gemma4:e4b")


def ollama_models() -> list:
    """Local models tried in order — configured first, then Gemma 4 edge, legacy."""
    first = ollama_model()
    out = []
    for m in (first, "gemma4:e4b", "gemma3:4b"):
        if m and m not in out:
            out.append(m)
    return out


def ollama_vision_model() -> str:
    return os.getenv("OLLAMA_VISION_MODEL", "moondream")


def parse_keys(raw) -> list:
    """Comma-separated key rotation: every key has its own free quota."""
    out = []
    for part in str(raw or "").split(","):
        k = part.strip()
        if len(k) >= 10 and k not in out:
            out.append(k)
    return out


def get_gemini_keys() -> list:
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMMA_API_KEY", "VITE_GEMINI_API_KEY"):
        keys = parse_keys(os.getenv(name))
        if keys:
            return keys
    return []


def get_gemini_key() -> Optional[str]:
    keys = get_gemini_keys()
    return keys[0] if keys else None


def get_groq_keys() -> list:
    return parse_keys(os.getenv("GROQ_API_KEY"))


def get_groq_key() -> Optional[str]:
    keys = get_groq_keys()
    return keys[0] if keys else None


def get_cerebras_keys() -> list:
    return parse_keys(os.getenv("CEREBRAS_API_KEY"))


def get_openrouter_keys() -> list:
    return parse_keys(os.getenv("OPENROUTER_API_KEY"))


def get_nvidia_keys() -> list:
    # NIM_API_KEY / NEMOTRON_OCR_API_KEY are the same build.nvidia.com keys
    # under older names — accept all three so existing .env files just work.
    out = []
    for name in ("NVIDIA_API_KEY", "NIM_API_KEY", "NEMOTRON_OCR_API_KEY"):
        for k in parse_keys(os.getenv(name)):
            if k not in out:
                out.append(k)
    return out


def get_pollinations_keys() -> list:
    return parse_keys(os.getenv("POLLINATIONS_API_KEY"))


def _ollama(prompt: str, max_tokens: int = 2600) -> Optional[str]:
    """Local Ollama — completely free, no key. Returns None fast if not running."""
    import socket

    host = ollama_host()
    try:
        timeout_s = float(os.getenv("OLLAMA_TIMEOUT_MS", "120000")) / 1000.0
    except Exception:
        timeout_s = 120.0
    # Fast reachability check so we never hang when Ollama is not installed.
    try:
        parsed = urllib.parse.urlparse(host)
        sock = socket.create_connection((parsed.hostname or "localhost", parsed.port or 11434), timeout=1.2)
        sock.close()
    except Exception:
        return None
    for model in ollama_models():
        try:
            import json as _json

            try:
                num_ctx = int(os.getenv("OLLAMA_NUM_CTX", "8192"))
            except Exception:
                num_ctx = 8192
            payload = _json.dumps({
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": max_tokens, "temperature": 0.6, "num_ctx": num_ctx},
            }).encode("utf-8")
            req = urllib.request.Request(
                host + "/api/generate",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                if resp.status == 404:
                    continue  # tag not pulled — try next local model
                body = _json.loads(resp.read().decode("utf-8", errors="ignore"))
                text = (body.get("response") or "").strip()
                if text:
                    return text
                return None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            return None
        except Exception:
            return None
    return None


def _gemini(prompt: str, max_tokens: int = 8192, temperature: float = 0.64) -> Optional[str]:
    try:
        import requests
    except Exception:
        return None
    keys = get_gemini_keys()
    if not keys:
        return None
    try:
        from .config import GEMINI_MODEL
        first = GEMINI_MODEL
    except Exception:
        first = "gemini-3.6-flash"
    # Verified: 1.x/2.x retired (404 / unavailable to new keys). 3.6-flash is
    # the fast non-thinking default; Gemma-4 kept last (thought traces skipped).
    models = [first, "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest",
              "gemini-3.7-flash", "gemma-4-26b-a4b-it", "gemma-4-31b-it"]
    for key in keys[:3]:
        seen = set()
        ordered = [m for m in models if m and not (m in seen or seen.add(m))]
        for m in ordered:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
                # Gemma models reject thinkingConfig (400) — omit it for them.
                gen_cfg = {"temperature": temperature, "maxOutputTokens": max_tokens}
                if "gemma" not in m.lower():
                    gen_cfg["thinkingConfig"] = {"thinkingBudget": 1024}
                r = requests.post(url, json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    # Cap reasoning so long JSON answers aren't cut off mid-object.
                    "generationConfig": gen_cfg,
                }, timeout=45)
                if r.status_code in (404, 410):
                    continue  # unknown/retired model — next
                if r.status_code == 403:
                    print(f"[free_llm] Gemini {m} -> 403: {r.text[:200]}")
                    break  # key revoked — try next key
                if r.status_code in (400, 429) or not r.ok:
                    # 400 (bad model param), 429 (quota), 5xx — try next model.
                    print(f"[free_llm] Gemini {m} -> {r.status_code}: {r.text[:200]}")
                    continue
                r.raise_for_status()
                j = r.json()
                parts = j.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                if parts:
                    for part in parts:
                        # NEVER return thought traces as answers.
                        if part.get("text") and not part.get("thought"):
                            return part["text"]
                    continue  # thought-only response — try next model
            except Exception:
                continue
    return None


_GROQ_ROTATE = 0


def _groq(prompt: str, max_tokens: int = 2600) -> Optional[str]:
    """Groq free-tier (OpenAI-compatible). Limits are PER MODEL (scout ~30K
    TPM, others ~8K TPM) — the start model rotates per call to spread load."""
    global _GROQ_ROTATE
    try:
        import requests
    except Exception:
        return None
    keys = get_groq_keys()
    if not keys:
        return None
    first = os.getenv("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
    # Verified live 2026 (llama-3.x retired). Scout leads on TPM headroom.
    models = [first, "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-20b",
              "qwen/qwen3.6-27b", "openai/gpt-oss-120b"]
    ordered = []
    for m in models:
        if m and m not in ordered:
            ordered.append(m)
    k = _GROQ_ROTATE % max(1, len(ordered))
    _GROQ_ROTATE += 1
    rotated = ordered[k:] + ordered[:k]
    for key in keys[:3]:
        seen = set()
        for model in rotated:
            if not model or model in seen:
                continue
            seen.add(model)
            try:
                r = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.6,
                        "max_tokens": max_tokens,
                    },
                    timeout=45,
                )
                if r.status_code in (404, 410):
                    continue  # unknown/retired model — next
                if r.status_code in (401, 403):
                    break  # bad key — try next key
                if not r.ok:
                    print(f"[free_llm] Groq {model} -> {r.status_code}: {r.text[:200]}")
                    continue
                j = r.json()
                t = (((j.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
                if t:
                    return t
            except Exception:
                continue
    return None


def _openai_chat(name: str, url: str, keys: list, models: list, prompt: str,
                 max_tokens: int = 2600, extra_headers: Optional[dict] = None,
                 timeout: int = 60) -> Optional[str]:
    """Shared OpenAI-compatible chat caller: rotates keys, skips 404 models,
    moves to the next key on 401/403, soldiers through 429/5xx."""
    try:
        import requests
    except Exception:
        return None
    if not keys:
        return None
    headers_base = {"Content-Type": "application/json"}
    if extra_headers:
        headers_base.update(extra_headers)
    for key in keys[:3]:
        seen = set()
        for model in models:
            if not model or model in seen:
                continue
            seen.add(model)
            try:
                headers = dict(headers_base)
                headers["Authorization"] = f"Bearer {key}"
                r = requests.post(
                    url,
                    headers=headers,
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.6,
                        "max_tokens": max_tokens,
                    },
                    timeout=timeout,
                )
                if r.status_code in (404, 410):
                    continue  # unknown/retired model — next
                if r.status_code in (401, 403):
                    break  # bad key — try next key
                if not r.ok:
                    print(f"[free_llm] {name} {model} -> {r.status_code}: {r.text[:200]}")
                    continue
                j = r.json()
                t = (((j.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
                if t:
                    return t
            except Exception:
                continue
    return None


def _ordered_unique(first, rest) -> list:
    out = []
    for m in [first] + list(rest):
        if m and m not in out:
            out.append(m)
    return out


def _cerebras(prompt: str, max_tokens: int = 2600) -> Optional[str]:
    """Cerebras free trial ($5 credits, no card) — hosts Gemma 4 31B at ~1800 tok/s."""
    first = os.getenv("CEREBRAS_MODEL", "gemma-4-31b-it")
    return _openai_chat("Cerebras", "https://api.cerebras.ai/v1/chat/completions",
                        get_cerebras_keys(),
                        _ordered_unique(first, ["gemma-4-31b-it", "gemma-4-26b-a4b-it",
                                               "gpt-oss-120b", "llama-3.3-70b"]),
                        prompt, max_tokens, timeout=45)


def _openrouter(prompt: str, max_tokens: int = 2600) -> Optional[str]:
    """OpenRouter :free models ($0, no card) — incl. real Gemma 4 free tiers."""
    first = os.getenv("OPENROUTER_MODEL", "google/gemma-4-31b-it:free")
    return _openai_chat("OpenRouter", "https://openrouter.ai/api/v1/chat/completions",
                        get_openrouter_keys(),
                        _ordered_unique(first, ["google/gemma-4-31b-it:free",
                                               "google/gemma-4-26b-a4b-it:free",
                                               "meta-llama/llama-3.3-70b-instruct:free"]),
                        prompt, max_tokens, timeout=60,
                        extra_headers={"HTTP-Referer": "https://evalu8.duckdns.org",
                                       "X-Title": "EVALU8"})


def _github(prompt: str, max_tokens: int = 2600) -> Optional[str]:
    """GitHub Models: any GitHub account + PAT (no card). Low-tier models get
    15 RPM / 150 req/day with 8000 in + 4000 out tokens per request."""
    first = os.getenv("GITHUB_MODEL", "meta/Llama-3.3-70B-Instruct")
    return _openai_chat("GitHub", "https://models.github.ai/inference/chat/completions",
                        get_github_keys(),
                        _ordered_unique(first, ["meta/Llama-3.3-70B-Instruct",
                                               "meta/Llama-4-Scout-17B-16E-Instruct",
                                               "mistral-ai/Mistral-Small-24B",
                                               "microsoft/Phi-4"]),
                        prompt, min(max_tokens, 4000), timeout=60)


def _nvidia(prompt: str, max_tokens: int = 2600) -> Optional[str]:
    """Nvidia NIM (build.nvidia.com, email signup, no card). All models free
    to prototype at ~40 RPM with no per-token billing. Verified IDs 2026."""
    first = os.getenv("NVIDIA_MODEL", "deepseek-ai/deepseek-v4-flash-0731")
    return _openai_chat("Nvidia", "https://integrate.api.nvidia.com/v1/chat/completions",
                        get_nvidia_keys(),
                        _ordered_unique(first, ["deepseek-ai/deepseek-v4-flash-0731",
                                               "mistralai/mistral-nemotron",
                                               "google/gemma-4-31b-it"]),
                        prompt, max_tokens, timeout=60)


def _pollinations_keyed(prompt: str, max_tokens: int = 2600) -> Optional[str]:
    """Pollinations keyed API (free sk_ from enter.pollinations.ai):
    OpenAI-compatible chat completions — far more reliable JSON than the
    anonymous GET endpoint. Light use typically costs nothing."""
    first = os.getenv("POLLINATIONS_MODEL", "openai")
    return _openai_chat("Pollinations+", "https://gen.pollinations.ai/v1/chat/completions",
                        get_pollinations_keys(),
                        _ordered_unique(first, ["openai"]),
                        prompt, max_tokens, timeout=60)


def _pollinations(prompt: str, retries: int = 4) -> Optional[str]:
    """Free anonymous GET — still API-generated (open model). Truncates for reliability."""
    base = " ".join(prompt.split())
    if len(base) > 1600:
        base = base[:1600]
    for attempt in range(retries):
        nonce = str(random.randint(10000000, 99999999))
        full = base + f" id:{nonce}"
        enc = urllib.parse.quote(full, safe="")
        url = f"https://text.pollinations.ai/{enc}?seed={random.randint(1, 9999999)}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "EVALU8/2.0", "Accept": "text/plain"})
            with urllib.request.urlopen(req, timeout=42) as resp:
                text = resp.read().decode("utf-8", errors="ignore")
                if not text or len(text.strip()) < 8:
                    raise RuntimeError("empty")
                low = text.lower()
                # Reject provider error pages masquerading as content.
                if "queue full" in low or ("payment required" in low and "anonymous" not in low):
                    raise RuntimeError(text[:320])
                import re as _re
                if _re.search(r"reached its budget|budget (exhausted|exceeded)|quota exceeded|"
                              r"too many requests|rate.?limit (exceeded|reached)|"
                              r"valid api key is required|unauthorized", low):
                    raise RuntimeError(text[:320])
                return text
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode()[:900]
            except Exception:
                pass
            low = (body or "").lower()
            if e.code in (429, 503, 502) or "queue full" in low:
                time.sleep(1.2 + attempt * 1.2 + random.random())
                continue
            if e.code in (402, 403):
                if len(base) > 900:
                    base = base[:950]
                time.sleep(1.0 + random.random())
                continue
            time.sleep(1.0 + random.random())
            continue
        except Exception:
            time.sleep(1.0 + random.random())
            continue
    return None


def generate(prompt: str, max_tokens: int = 2600, temperature: float = 0.64) -> str:
    """Free chain: fast cloud keys first, Ollama offline fallback, Pollinations last.

    Raises RuntimeError only when every free provider is unreachable so callers
    can fall back to local RAG-grounded templates. Set LLM_LOCAL_FIRST=1 to
    prefer Ollama (slow on CPU, fully offline Gemma 4).
    """
    local_first = (os.getenv("LLM_LOCAL_FIRST", "").strip().lower() in ("1", "true", "yes"))
    if local_first:
        t = _ollama(prompt, max_tokens=max_tokens)
        if t:
            return t
    # Highest free headroom first. Each helper no-ops fast without its keys.
    t = _groq(prompt, max_tokens=max_tokens)
    if t:
        return t
    t = _nvidia(prompt, max_tokens=max_tokens)
    if t:
        return t
    t = _cerebras(prompt, max_tokens=max_tokens)
    if t:
        return t
    t = _openrouter(prompt, max_tokens=max_tokens)
    if t:
        return t
    try:
        t = _gemini(prompt, max_tokens=max(max_tokens, 2048), temperature=temperature)
        if t:
            return t
    except Exception:
        pass
    if not local_first:
        t = _ollama(prompt, max_tokens=max_tokens)
        if t:
            return t
    t = _pollinations_keyed(prompt, max_tokens=max_tokens)
    if t:
        return t
    t = _pollinations(prompt)
    if t:
        return t
    raise RuntimeError(
        "All free providers unreachable (no GROQ/NVIDIA/CEREBRAS/OPENROUTER/"
        "GEMINI/POLLINATIONS keys, Ollama not running, Pollinations throttled). "
        "Set free keys (Groq: console.groq.com, Nvidia: build.nvidia.com, "
        "OpenRouter: openrouter.ai/keys — all no card) "
        "or start Ollama (`ollama serve && ollama pull gemma4:e4b`)."
    )


def describe_image_bytes(image_bytes: bytes, mime_type: str = "image/png") -> str:
    """Free image description: Gemini vision -> Ollama vision -> '' (skip).

    Cloud-first by default (seconds vs minutes on CPU Ollama); set
    VISION_LOCAL_FIRST=1 to prefer offline Ollama. Never raises — returns ''
    when no provider is available so ingestion still succeeds without any key.
    """
    local_first = (os.getenv("VISION_LOCAL_FIRST", "").strip().lower() in ("1", "true", "yes"))

    def _via_ollama():
        try:
            import base64 as _b64
            import json as _json
            import socket as _socket

            host = ollama_host()
            try:
                parsed = urllib.parse.urlparse(host)
                s = _socket.create_connection((parsed.hostname or "localhost", parsed.port or 11434), timeout=1.2)
                s.close()
                payload = _json.dumps({
                    "model": ollama_vision_model(),
                    "prompt": (
                        "Describe this educational figure in structured text: type "
                        "(diagram/chart/chemical structure/graph), all labels, values, "
                        "relationships, and the conclusion it conveys. Be thorough."
                    ),
                    "images": [_b64.b64encode(image_bytes).decode("utf-8")],
                    "stream": False,
                }).encode("utf-8")
                req = urllib.request.Request(
                    host + "/api/generate",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                try:
                    timeout_s = float(os.getenv("OLLAMA_TIMEOUT_MS", "120000")) / 1000.0
                except Exception:
                    timeout_s = 120.0
                with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                    body = _json.loads(resp.read().decode("utf-8", errors="ignore"))
                    text = (body.get("response") or "").strip()
                    if text:
                        return text
            except Exception:
                pass
        except Exception:
            pass
        return ""

    def _via_gemini():
        key = get_gemini_key()
        if not key:
            return ""
        try:
            import base64 as _b64
            import requests

            b64 = _b64.b64encode(image_bytes).decode("utf-8")
            prompt = (
                "You are analyzing a diagram, chart, chemical structure, or figure from an "
                "educational document. Provide a detailed text description: type, all labels, "
                "structure/relationships, data values, and overall meaning. Capture every detail — "
                "this will be used for question generation."
            )
            for m in ("gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"):
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
                    r = requests.post(url, json={
                        "contents": [{"parts": [
                            {"text": prompt},
                            {"inlineData": {"mimeType": mime_type, "data": b64}},
                        ]}],
                        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 2048},
                    }, timeout=60)
                    if r.status_code == 404:
                        continue
                    if r.status_code == 429:
                        import sys as _sys
                        print("[free_llm] Gemini vision QUOTA-EXCEEDED, skipping figure", file=_sys.stderr)
                        return ""
                    r.raise_for_status()
                    parts = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [])
                    for part in parts:
                        if part.get("text") and not part.get("thought"):
                            return part["text"]
                except Exception:
                    continue
        except Exception:
            pass
        return ""

    if local_first:
        t = _via_ollama()
        if t:
            return t
    t = _via_gemini()
    if t:
        return t
    if not local_first:
        t = _via_ollama()
        if t:
            return t
    return ""

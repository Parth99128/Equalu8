/**
 * free-llm.js — shared $0 model chain for all Node API routes.
 *
 * Order (all free, no credit card):
 *   Groq free-tier -> Cerebras free trial -> OpenRouter :free (Gemma 4)
 *   -> Gemini free-tier -> Ollama local (Gemma 4 offline) -> Pollinations anon.
 * Returns null when every provider fails so callers use RAG-grounded fallback.
 *
 * Keys (all optional, set what you have — chain skips missing ones):
 *   GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY,
 *   OLLAMA_HOST/OLLAMA_MODEL (no key, local).
 */

function ollamaHost() {
  return (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
}

// ── Multi-key rotation ──
// Any key var may hold comma-separated keys ("k1,k2,k3"); each key carries
// its OWN free quota, so rotation multiplies every free tier N× with zero
// new accounts. Exported for unit tests.
export function parseKeys(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const k = part.trim();
    if (k.length >= 10 && !out.includes(k)) out.push(k);
  }
  return out;
}

// Local model preference: configured model first, then Gemma 4 edge (small,
// CPU-friendly), then legacy Gemma 3. Ollama 404s fast when a tag is missing.
function ollamaModels() {
  const first = process.env.OLLAMA_MODEL || 'gemma4:e4b';
  const seen = new Set();
  return [first, 'gemma4:e4b', 'gemma3:4b'].filter((m) => m && !seen.has(m) && (seen.add(m), true));
}

function envKey() {
  return parseKeys(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMMA_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    ''
  );
}

function groqKeys() {
  return parseKeys(process.env.GROQ_API_KEY);
}

function cerebrasKeys() {
  return parseKeys(process.env.CEREBRAS_API_KEY);
}

function openRouterKeys() {
  return parseKeys(process.env.OPENROUTER_API_KEY);
}

function githubKeys() {
  return parseKeys(process.env.GITHUB_TOKEN);
}

function nvidiaKeys() {
  // NIM_API_KEY / NEMOTRON_OCR_API_KEY are the same build.nvidia.com keys
  // under older names — accept all three so existing .env files just work.
  return [
    ...parseKeys(process.env.NVIDIA_API_KEY),
    ...parseKeys(process.env.NIM_API_KEY),
    ...parseKeys(process.env.NEMOTRON_OCR_API_KEY),
  ].filter((k, i, a) => a.indexOf(k) === i);
}

function pollinationsKeys() {
  return parseKeys(process.env.POLLINATIONS_API_KEY);
}

async function viaOllama(prompt, maxTokens = 2600) {
  const host = ollamaHost();
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);
  for (const model of ollamaModels()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          // num_ctx must cover the prompt: default Ollama ctx (4096) silently
          // truncates our RAG prompts. Cap prompt size at call sites instead.
          options: { num_predict: maxTokens, temperature: 0.6, num_ctx: Number(process.env.OLLAMA_NUM_CTX || 8192) },
        }),
        signal: controller.signal,
      });
      if (r.status === 404 || r.status === 410) continue; // unknown/retired model — next // tag not pulled — try next local model
      if (!r.ok) return null;
      const j = await r.json();
      const t = (j?.response || '').trim();
      if (t) return t;
      return null;
    } catch {
      return null; // Ollama not running — fall through to cloud free tiers
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function viaGemini(prompt, { temperature = 0.6, maxTokens = 8192, thinkingBudget = 1024 } = {}) {
  const keys = envKey();
  if (!keys.length) return null;
  // Verified 2026: 1.x/2.x retired (404, or "no longer available to new users").
  // gemini-3.6-flash is the fast non-thinking default. Gemma-4 reasons with
  // thought parts — kept last; thought-only responses are skipped, never used.
  const first = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const models = [
    first,
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-3.7-flash',
    'gemma-4-26b-a4b-it',
    'gemma-4-31b-it',
  ];
  for (const key of keys.slice(0, 3)) {
    const seen = new Set();
    // Give up on remaining models after 3 consecutive slow/overloaded
    // failures (45s aborts, 429, 5xx) — one sick model list must not burn
    // minutes per batch when the whole endpoint is down. Instant 404/400s
    // (retired model, bad param) don't count: the provider is reachable.
    let sick = 0;
    const noteSick = () => {
      sick += 1;
      if (sick >= 3) {
        console.log('[free-llm] Gemini -> stopping model rotation (3 consecutive slow/overloaded fails)');
        return true;
      }
      return false;
    };
    for (const m of models) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
    const mStart = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      // Gemma models on the Gemini API reject thinkingConfig (400) — omit it.
      const genCfg = /gemma/i.test(m)
        ? { temperature, maxOutputTokens: maxTokens }
        : { temperature, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget } };
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // Thinking models spend maxOutputTokens on reasoning first — cap it
            // so long JSON answers aren't cut off mid-object (verified on 3.6).
            generationConfig: genCfg,
          }),
          signal: controller.signal,
        }
      );
      if (r.status === 404 || r.status === 410) { sick = 0; continue; } // unknown/retired model — next
      if (!r.ok) {
        const t = await r.text();
        // Bad key/quota: don't abort the whole chain — let other keys and
        // providers try. Logged server-side for diagnosis.
        const tag = r.status === 429 ? 'QUOTA-EXCEEDED' : `${r.status}`;
        console.warn(`[free-llm] Gemini ${m} -> ${tag}: ${t.slice(0, 200)}`);
        if (r.status === 403) break; // key revoked — try next key
        if (Date.now() - mStart > 5000 || r.status === 429 || r.status >= 500) {
          if (noteSick()) return null;
        } else { sick = 0; }
        continue; // 400/429/5xx — try next model, then next key/provider
      }
      const j = await r.json();
      const parts = j?.candidates?.[0]?.content?.parts;
      if (parts && parts.length > 0) {
        for (const part of parts) {
          // NEVER return thought traces as answers (Gemma-4 thinking models).
          if (part.text && !part.thought) {
            clearTimeout(timer);
            return part.text;
          }
        }
        continue; // thought-only response — try next model
      }
    } catch (e) {
      // 45s abort = sick endpoint — count it; instant errors just continue.
      if (String(e?.message || '').toLowerCase().includes('abort')) {
        if (noteSick()) return null;
        continue;
      }
      continue;
    } finally {
      clearTimeout(timer);
    }
    }
  }
  return null;
}

// Groq free limits are PER MODEL (gpt-oss/qwen ≈ 8K TPM, llama-4-scout ≈
// 30K TPM). The start model rotates every call so consecutive batches land
// in different per-model buckets instead of draining one.
let groqRotate = 0;

async function viaGroq(prompt, maxTokens = 2600) {
  const keys = groqKeys();
  if (!keys.length) return null;
  // Verified live 2026 (llama-3.x retired). Scout leads on TPM headroom.
  const first = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
  const models = [first, 'meta-llama/llama-4-scout-17b-16e-instruct', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-120b'];
  const ordered = [...new Set(models.filter(Boolean))];
  const rotated = ordered.slice(groqRotate % Math.max(1, ordered.length)).concat(ordered.slice(0, groqRotate % Math.max(1, ordered.length)));
  groqRotate++;
  for (const key of keys.slice(0, 3)) {
  const seen = new Set();
  for (const model of rotated) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      if (r.status === 404 || r.status === 410) continue; // unknown/retired model — next
      if (!r.ok) {
        const t = await r.text();
        console.warn(`[free-llm] Groq ${model} -> ${r.status}: ${t.slice(0, 200)}`);
        if (r.status === 401 || r.status === 403) break; // bad key — next key
        continue;
      }
      const j = await r.json();
      const t = (j?.choices?.[0]?.message?.content || '').trim();
      if (t) {
        clearTimeout(timer);
        return t;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
    }
  }
  return null;
}

async function viaCerebras(prompt, maxTokens = 2600) {
  const keys = cerebrasKeys();
  if (!keys.length) return null;
  // OpenAI-compatible. hosts Gemma 4 31B (~1800 tok/s) + GPT-OSS 120B.
  // Free trial: $5 credits on signup (https://cloud.cerebras.ai), no card.
  const first = process.env.CEREBRAS_MODEL || 'gemma-4-31b-it';
  const models = [first, 'gemma-4-31b-it', 'gemma-4-26b-a4b-it', 'gpt-oss-120b', 'llama-3.3-70b'];
  for (const key of keys.slice(0, 3)) {
  const seen = new Set();
  for (const model of models) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      if (r.status === 404 || r.status === 410) continue; // unknown/retired model — next
      if (!r.ok) {
        const t = await r.text();
        console.warn(`[free-llm] Cerebras ${model} -> ${r.status}: ${t.slice(0, 200)}`);
        if (r.status === 401 || r.status === 403) break;
        continue;
      }
      const j = await r.json();
      const t = (j?.choices?.[0]?.message?.content || '').trim();
      if (t) {
        clearTimeout(timer);
        return t;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  }
  return null;
}

async function viaOpenRouter(prompt, maxTokens = 2600) {
  const keys = openRouterKeys();
  if (!keys.length) return null;
  // One key, no card (https://openrouter.ai/keys). :free models cost $0 —
  // incl. real Gemma 4: google/gemma-4-31b-it:free, google/gemma-4-26b-a4b-it:free.
  // Free-tier limits: 20 RPM, 50/day (1000/day after $10 lifetime credits).
  const first = process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';
  const models = [first, 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'meta-llama/llama-3.3-70b-instruct:free'];
  for (const key of keys.slice(0, 3)) {
  const seen = new Set();
  for (const model of models) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://evalu8.duckdns.org',
          'X-Title': 'EVALU8',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      if (r.status === 404 || r.status === 410) continue; // unknown/retired model — next
      if (!r.ok) {
        const t = await r.text();
        console.warn(`[free-llm] OpenRouter ${model} -> ${r.status}: ${t.slice(0, 200)}`);
        if (r.status === 401 || r.status === 403) break;
        continue; // 402/408/429/5xx — try next free model
      }
      const j = await r.json();
      const t = (j?.choices?.[0]?.message?.content || '').trim();
      if (t) {
        clearTimeout(timer);
        return t;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  }
  return null;
}

// ── Permanently-free lanes (no card, no expiring credits) ──

async function viaNvidia(prompt, maxTokens = 2600) {
  const keys = nvidiaKeys();
  if (!keys.length) return null;
  // Nvidia NIM (https://build.nvidia.com, email signup, no card).
  // "All models free to prototype, up to ~40 RPM, no per-token billing."
  // IDs verified live against the account model list 2026-09-13 (deepseek
  // flash answers in ~1.5s; gemma-4-31b stalls on the free queue → last).
  const first = process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v4-flash-0731';
  const models = [first, 'deepseek-ai/deepseek-v4-flash-0731', 'mistralai/mistral-nemotron', 'google/gemma-4-31b-it'];
  for (const key of keys.slice(0, 3)) {
  const seen = new Set();
  for (const model of models) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      if (r.status === 404 || r.status === 410) continue; // unknown/retired model — next
      if (!r.ok) {
        const t = await r.text();
        console.warn(`[free-llm] Nvidia ${model} -> ${r.status}: ${t.slice(0, 200)}`);
        if (r.status === 401 || r.status === 403) break;
        continue;
      }
      const j = await r.json();
      const t = (j?.choices?.[0]?.message?.content || '').trim();
      if (t) {
        clearTimeout(timer);
        return t;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  }
  return null;
}

async function viaPollinationsKeyed(prompt, maxTokens = 2600) {
  const keys = pollinationsKeys();
  if (!keys.length) return null;
  // Pollinations keyed API (free sk_ from https://enter.pollinations.ai):
  // OpenAI-compatible chat completions — far more reliable JSON than the
  // anonymous GET endpoint. Light use typically costs nothing.
  const first = process.env.POLLINATIONS_MODEL || 'openai';
  const models = [...new Set([first, 'openai'].filter(Boolean))];
  for (const key of keys.slice(0, 2)) {
  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const r = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      if (r.status === 404 || r.status === 410) continue; // unknown/retired model — next
      if (!r.ok) {
        const t = await r.text();
        console.warn(`[free-llm] Pollinations+ ${model} -> ${r.status}: ${t.slice(0, 200)}`);
        if (r.status === 401 || r.status === 403) break;
        continue;
      }
      const j = await r.json();
      const t = (j?.choices?.[0]?.message?.content || '').trim();
      if (t) {
        clearTimeout(timer);
        return t;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  }
  return null;
}

async function viaPollinations(prompt, { maxChars = 1600, retries = 4 } = {}) {
  const short = prompt.slice(0, maxChars).replace(/\n/g, ' ').trim();
  let tries = 0;
  while (tries < retries) {
    tries++;
    const nonce = Math.floor(Math.random() * 9999999);
    const enc = encodeURIComponent(short + ` id:${nonce}`);
    const url = `https://text.pollinations.ai/${enc}?seed=${Math.floor(Math.random() * 999999)}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'EVALU8/2.0', Accept: 'text/plain' } });
      const text = await res.text();
      // Reject provider error pages masquerading as content (budget/quota/auth).
      if (res.ok && text && text.trim().length > 20
        && !/queue full|payment required|price:\s*poll|reached its budget|budget (exhausted|exceeded)|quota exceeded|too many requests|rate.?limit (exceeded|reached)|valid API key is required|unauthorized/i.test(text)) return text;
      await new Promise((r) => setTimeout(r, 1100 * tries));
    } catch {
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  return null;
}

// Circuit-breaker state for timed() — see below. Threshold/cooldown tunable
// via env without a redeploy: LLM_LANE_FAILS=2, LLM_LANE_COOLDOWN_MS=600000.
const laneState = {};
function laneFailThreshold() {
  const n = parseInt(process.env.LLM_LANE_FAILS || '2', 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
}
function laneCooldownMs() {
  const n = parseInt(process.env.LLM_LANE_COOLDOWN_MS || '600000', 10);
  return Number.isFinite(n) && n >= 0 ? n : 600000;
}
function recordLaneFail(name, st) {
  st.fails += 1;
  if (st.fails >= laneFailThreshold()) {
    st.skipUntil = Date.now() + laneCooldownMs();
    console.log(`[free-llm] ${name} -> circuit OPEN (${st.fails} slow fails, cooling down ${Math.round(laneCooldownMs() / 1000)}s)`);
  }
}

async function timed(name, fn) {
  // Circuit breaker: a lane that keeps FAILING SLOWLY (e.g. Gemini 503s /
  // 45s aborts) is skipped for a cooldown so one dead provider can't add
  // minutes to every batch. Instant nulls (<2s = no keys configured) never
  // trip it; any success resets it.
  const now = Date.now();
  const st = laneState[name] || (laneState[name] = { fails: 0, skipUntil: 0 });
  if (now < st.skipUntil) {
    console.log(`[free-llm] ${name} -> SKIPPED (cooling down after failures)`);
    return null;
  }
  const t0 = Date.now();
  try {
    const r = await fn();
    const dt = Date.now() - t0;
    if (r) {
      st.fails = 0; st.skipUntil = 0;
    } else if (dt >= 2000) {
      recordLaneFail(name, st);
    }
    console.log(`[free-llm] ${name} -> ${r ? `OK len=${r.length}` : 'null'} in ${(dt / 1000).toFixed(1)}s`);
    return r;
  } catch (e) {
    const dt = Date.now() - t0;
    if (dt >= 2000) recordLaneFail(name, st);
    console.log(`[free-llm] ${name} -> THREW ${String(e?.message || e).slice(0, 150)} in ${(dt / 1000).toFixed(1)}s`);
    return null;
  }
}

export async function callModel(prompt, opts = {}) {
  // Fast free cloud tiers first (seconds), local Ollama CPU (minutes) as
  // offline fallback, Pollinations anonymous last. Set LLM_LOCAL_FIRST=1
  // to prefer local Ollama (fully offline Gemma 4).
  // Gemini sits after Groq/Cerebras/OpenRouter: when its free quota is
  // exhausted every batch wasted ~3s on 429s before reaching working keys.
  const localFirst = ['1', 'true', 'yes'].includes(String(process.env.LLM_LOCAL_FIRST || '').toLowerCase());
  const tOllama = () => timed('ollama', () => viaOllama(prompt, opts.maxTokens || 2600));
  const steps = {
    groq: () => timed('groq', () => viaGroq(prompt, opts.maxTokens || 2600)),
    nvidia: () => timed('nvidia', () => viaNvidia(prompt, opts.maxTokens || 2600)),
    cerebras: () => timed('cerebras', () => viaCerebras(prompt, opts.maxTokens || 2600)),
    openrouter: () => timed('openrouter', () => viaOpenRouter(prompt, opts.maxTokens || 2600)),
    gemini: () => timed('gemini', () => viaGemini(prompt, { temperature: opts.temperature ?? 0.6, maxTokens: opts.maxTokens || 8192, thinkingBudget: opts.thinkingBudget ?? 1024 })),
    ollama: tOllama,
    pollinationsKeyed: () => timed('pollinations+', () => viaPollinationsKeyed(prompt, opts.maxTokens || 2600)),
    pollinations: () => timed('pollinations', () => viaPollinations(prompt, { maxChars: opts.pollinationsChars || 1600, retries: opts.pollinationsRetries ?? 4 })),
  };
  // opts.order lets callers rotate lanes across batches (quota spreading):
  // e.g. even batches ['groq','cerebras',...], odd batches ['cerebras','groq',...].
  // Missing keys skip instantly, so unknown/extra names are simply ignored.
  if (Array.isArray(opts.order) && opts.order.length) {
    const seq = opts.order.filter((k) => steps[k]);
    for (const k of (seq.length ? seq : Object.keys(steps))) {
      const r = await steps[k]();
      if (r) return r;
    }
    return null;
  }
  if (localFirst) {
    const t0 = await tOllama();
    if (t0) return t0;
  }
  // Highest free headroom first: Groq (per-model buckets incl. 30K-TPM scout)
  // → Nvidia (~40 RPM, no token billing) → trial/free leftovers → Gemini.
  for (const k of ['groq', 'nvidia', 'cerebras', 'openrouter', 'gemini']) {
    const r = await steps[k]();
    if (r) return r;
  }
  if (!localFirst) {
    const t0 = await tOllama();
    if (t0) return t0;
  }
  for (const k of ['pollinationsKeyed', 'pollinations']) {
    const r = await steps[k]();
    if (r) return r;
  }
  return null;
}

export function freeLlmStatus() {
  return {
    ollama: { host: ollamaHost(), models: ollamaModels() },
    groq: groqKeys().length,
    nvidia: nvidiaKeys().length,
    cerebras: cerebrasKeys().length,
    openrouter: openRouterKeys().length,
    gemini: envKey().length,
    pollinationsKeyed: pollinationsKeys().length,
    pollinations: true,
  };
}

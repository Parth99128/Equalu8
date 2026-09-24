import supabase from './db-client.js';
import { callModel } from './free-llm.js';

/**
 * Repair + salvage model JSON. Chemistry groundings contain lone backslashes
 * (E\, K\GUR) that models copy verbatim into JSON strings — one bad escape
 * used to nuke the ENTIRE set into template fallback. repairJson fixes the
 * escapes; salvage keeps individually-valid questions when repair isn't enough.
 */
function repairJson(blob) {
  // Escape only backslashes that don't start a valid JSON escape.
  return blob.replace(/\\(?![\"\\/bfnrtu])/g, '\\\\');
}

function tryParseQuestions(blob, totalQuestions) {
  const clean = repairJson(blob);
  try {
    const tmp = JSON.parse(clean);
    if (Array.isArray(tmp) && tmp.length >= Math.min(2, totalQuestions)) return tmp.slice(0, totalQuestions);
  } catch {}
  // Salvage: brace-scan top-level {...} objects, keep individually-valid ones.
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const o = JSON.parse(clean.slice(start, i + 1));
          if (o && o.question_text) out.push(o);
        } catch {}
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  if (out.length >= Math.min(2, totalQuestions)) {
    console.log(`Salvaged ${out.length}/${totalQuestions} questions from damaged JSON`);
    return out.slice(0, totalQuestions);
  }
  return null;
}

// ————————————————————————————————————————————————
// Quality gate — garbage-in must never become garbage-out.
// OCR-damaged chunks (Caesar-shift remnants, lone backslashes, inner-caps
// mangling like "oQHOfThe") used to flow verbatim into question stems,
// options and concept tags ("Let", "Thene", "\vec{h}"). These helpers
// filter damaged chunks BEFORE generation and reject garbled questions
// BEFORE the DB insert. A short set of good questions beats 14 with junk.
// ————————————————————————————————————————————————

// Tags that are sentence fragments / stopwords / chemistry splinters —
// never valid concept labels. (Thane/Thene/Thyne are word fragments from
// "Methane/Ethene/Ethyne" split by the old extractor, not concepts.)
const BAD_TAGS = new Set([
  'let', 'now', 'therefore', 'thus', 'then', 'to', 'by', 'of', 'and', 'the',
  'for', 'with', 'from', 'that', 'this', 'than', 'thene', 'thane', 'thyne',
  'more', 'other', 'such', 'into', 'upon', 'per', 'via', 'etc', 'eg', 'ie',
  'fig', 'eq', 'ex', 'in', 'on', 'at', 'as', 'is', 'it', 'an', 'or', 'if',
  'so', 'no', 'up', 'do', 'be', 'are', 'was', 'were', 'has', 'have', 'had',
  'will', 'would', 'could', 'should', 'shall', 'may', 'might', 'must',
  'just', 'like', 'over', 'under', 'most', 'only', 'very', 'each', 'also',
  'mathematical reasoning', 'of charge is', 'charge is', 'more stable than',
  'stable than', 'substances in', 'the substances', 'other examples',
  'electron density shift', 'and the shift',
]);

function scoreChunkQuality(text) {
  const t = String(text || '');
  if (t.length < 60) return 0;
  let score = 1;
  // Lone backslashes / font-glyph junk / control remnants.
  const slashes = (t.match(/\\/g) || []).length;
  score -= Math.min(0.7, slashes * 0.12);
  const weird = (t.match(/[¥©¶­Þß¤§]/g) || []).length;
  score -= Math.min(0.4, weird * 0.1);
  const cids = (t.match(/\(cid:\d+\)/gi) || []).length;
  score -= Math.min(0.4, cids * 0.1);
  // OCR splinters from broken math extraction: "x' cos", "E ysin (2)".
  if (/[A-Za-z]'[a-z]?\s+[a-z]{2,4}\b.*(cos|sin|dy|dx)/i.test(t)) score -= 0.25;
  // Inner-caps mangling: oQHOfThe, aIWHU, K\perconjugation, 2Rbital.
  // Caesar remnants: vowel-less runs (tkxv), digit-led caps (2Rbital),
  // shouting tokens (ExDPSOH) — all vanishingly rare in clean prose.
  const tokens = t.split(/\s+/);
  const EXEMPT = new Set(['SMILES', 'IUPAC', 'NCERT', 'RDKIT']);
  let mangled = 0, vowelless = 0, shout = 0, digcap = 0;
  for (const w of tokens) {
    const clean = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (clean.length >= 5 && /[a-z][A-Z]/.test(clean)) mangled++;
    else if (/^[A-Z\\]{4,}$/.test(clean) && !/^[A-Z]{2,4}$/.test(clean)) mangled++;
    if (/^[A-Za-z]{4,}$/.test(clean) && !/[aeiouAEIOU]/.test(clean)) vowelless++;
    if (/^[A-Z]{5,}$/.test(clean) && !EXEMPT.has(clean)) shout++;
    if (/^\d+[A-Z]/.test(clean)) digcap++;
  }
  const n = Math.max(1, tokens.length);
  score -= Math.min(0.5, (mangled / n) * 4);
  score -= Math.min(0.4, vowelless * 0.06);
  score -= Math.min(0.25, shout * 0.06);
  score -= Math.min(0.2, digcap * 0.05);
  // Caesar damage Title-Cases ordinary words ("Compounds Have Sharp Melting
  // Points ... oQHOfThe Way Is To Regard"): healthy prose has ~10% capped
  // tokens, damaged runs exceed 35%. Digit-tokens excluded so formula tables
  // (H2SO4, CH3) never trip this.
  let caps = 0, alpha = 0;
  for (const w of tokens) {
    const clean = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (/^[A-Za-z]{3,}$/.test(clean) && !/\d/.test(clean)) {
      alpha++;
      if (/^[A-Z]/.test(clean)) caps++;
    }
  }
  const capsRatio = caps / Math.max(1, alpha);
  if (capsRatio > 0.35) score -= Math.min(0.5, (capsRatio - 0.35) * 1.2);
  // Damaged extracts skew uppercase / symbol-heavy; healthy prose is mostly
  // lowercase letters and spaces.
  const letters = (t.match(/[a-z]/g) || []).length;
  score -= letters / Math.max(1, t.length) < 0.35 ? 0.35 : 0;
  return Math.max(0, Math.min(1, score));
}

// Leading words that can never start a real concept label.
const LEAD_STOP = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'of', 'to', 'by', 'for',
  'with', 'from', 'in', 'on', 'at', 'as', 'and', 'or', 'more', 'other', 'such',
  'into', 'upon', 'we', 'you', 'it', 'they', 'he', 'she', 'according',
  'example', 'figure', 'table', 'section', 'chapter', 'unit', 'solution',
  'given', 'using', 'based',
]);

function sanitizeConceptTag(tag, groundingChunk) {
  let t = String(tag || '').trim();
  const low = t.toLowerCase();
  const first = low.split(/\s+/)[0] || '';
  const bad = !t || t.length < 4 || BAD_TAGS.has(low) || LEAD_STOP.has(first)
    || /[\\¥©¶{}]/.test(t) || /SMILES:/i.test(t) || t.split(/\s+/).length > 6;
  if (!bad) return t;
  // Derive a real label from the grounding: longest capitalized phrase that
  // does not start with a stopword.
  const g = String(groundingChunk || '');
  const phrases = g.match(/[A-Z][a-z]+(?:\s+[A-Za-z][a-z]+){0,3}/g) || [];
  let best = '';
  for (const p of phrases) {
    const words = p.split(/\s+/);
    if (LEAD_STOP.has(words[0].toLowerCase())) continue;
    if (words.some((w) => w.length <= 1)) continue;
    if (p.length > best.length && p.length <= 48) best = p;
  }
  return best && best.length >= 4 ? best : 'General';
}

function isGarbledText(s) {
  const t = String(s || '');
  if (!t) return true;
  if (/[\\¥©¶]/.test(t)) return true;
  if (/\(cid:\d+\)/i.test(t)) return true;
  // 2+ inner-caps mangled tokens (oQHOfThe) or backslash-glyph words.
  const toks = t.split(/\s+/);
  let mangled = 0, shout = 0;
  const EXEMPT = new Set(['SMILES', 'IUPAC', 'NCERT', 'RDKIT']);
  for (const w of toks) {
    const clean = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (clean.length >= 5 && /[a-z][A-Z]/.test(clean)) mangled++;
    if (/^[A-Z]{5,}$/.test(clean) && !EXEMPT.has(clean)) shout++;
  }
  if (mangled >= 2 || shout >= 1) return true;
  // Parenthesis splinters from shattered extraction: ")Or ExDPSOH".
  if (/[\(\)][A-Z][a-z]{1,2}[\s"']/.test(t)) return true;
  // Quoted OCR splinters used as whole stems: E\, x' cos, 2an{ ...
  if (/[A-Za-z]'[a-z]?\s+[a-z]{2,4}\b.*(cos|sin|dy|dx)/i.test(t)) return true;
  return false;
}

// Gate-2 predicate (exported for tests): rejects template pathologies that
// survive character checks — exercise-list quoting, sequence-memorization and
// excerpt-hunt stems, self-answering MCQs.
function passesQualityGate(q) {
  if (!q || !q.question_text || q.question_text === 'Untitled') return false;
  if (isGarbledText(q.question_text) || isGarbledText(q.correct_answer)) return false;
  const t = String(q.question_type || '').toLowerCase();
  if (!['mcq', 'short', 'conceptual'].includes(t)) return false;
  if (t === 'mcq' && (!Array.isArray(q.options) || q.options.length < 3)) return false;
  if (t !== 'mcq' && (!q.correct_answer || String(q.correct_answer).trim().length < 4)) return false;
  const normWs = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const stem = normWs(q.question_text);
  const ans = normWs(q.correct_answer);
  if (/^Given ".+" what follows in the document\?$/.test(stem)) return false;
  if (/^Which excerpt comes from the section stating ".+"?$/.test(stem)) return false;
  if (t === 'mcq' && /^According to the (document|text), which statement about "\((A|B|1|2)|"Example \d/i.test(stem)) return false;
  if (t === 'mcq' && ans.length > 40 && stem.includes(ans.slice(0, 60))) return false;
  return true;
}

// Named exports for unit-testing the quality gate.
export { scoreChunkQuality, sanitizeConceptTag, isGarbledText, passesQualityGate };

// ————————————————————————————————————————————————
// Structure coverage — every RDKit-validated figure in the document must get
// a fair turn across generations (rotation, not first-N), tested through the
// LLM with natural varied angles. Canned questions are a last-resort gap
// filler only, built SOLELY from document facts (never invented distractors).
// ————————————————————————————————————————————————

// Deterministic RNG so a set's rotation is stable, but different seeds give
// different orders (no more "same structures at the start every time").
function seededRand(seedStr) {
  let h = 2166136261;
  const s = String(seedStr || 'x');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function collectStructureEntries(sourceChunks) {
  const entries = [];
  for (const c of sourceChunks || []) {
    const txt = String(c.text || '');
    if (!txt.includes('[STRUCTURE')) continue;
    const smiles = [...txt.matchAll(/SMILES:\s*([^\s,;\"']{2,120})/g)].map((m) => m[1]);
    const names = [...txt.matchAll(/^Name:\s*(.+)$/gm)].map((m) => m[1].trim());
    const formulas = [...txt.matchAll(/^Formula:\s*(.+)$/gm)].map((m) => m[1].trim());
    smiles.forEach((smi, i) => {
      if (smi && names[i]) entries.push({ smi, name: names[i], formula: formulas[i] || '', chunk: c.text, doc: c.document_title });
    });
  }
  return [...new Map(entries.map((e) => [e.smi, e])).values()];
}

function extractUsedSmiles(questions) {
  const used = new Set();
  for (const q of questions || []) {
    const hay = `${q.question_text || ''}\n${q.correct_answer || ''}`;
    for (const m of hay.matchAll(/SMILES:\s*([^\s,;\"']{2,120})/g)) used.add(m[1]);
  }
  return used;
}

// Rotation order: unused structures first (shuffled), then used ones
// (shuffled) — so repeated generations walk through the WHOLE figure set
// instead of re-testing the first two forever.
function planStructureOrder(entries, usedSmiles, seed) {
  const rand = seededRand(`struct-${seed}`);
  const fresh = seededShuffle(entries.filter((e) => !usedSmiles.has(e.smi)), rand);
  const seen = seededShuffle(entries.filter((e) => usedSmiles.has(e.smi)), rand);
  return [...fresh, ...seen];
}

// Varied natural angles for LLM-tested structures (rotated per batch).
const STRUCT_ANGLES = [
  (e) => `identify ${e.name} from its SMILES ${e.smi} (figure reading; plausible wrong isomer/ring-size as one distractor)`,
  (e) => `give the molecular formula of ${e.name} (SMILES ${e.smi}) and explain what the formula tells about its composition`,
  (e) => `classify ${e.name} (SMILES ${e.smi}): what structural family does it belong to per the document, and which feature decides it`,
  (e) => `correct a student who confuses ${e.name} (SMILES ${e.smi}) with a look-alike compound: what distinguishes them in the document's figure`,
];

// Canned gap-fillers — ONLY document facts. options/distractors are real
// names, formulas and SMILES from the SAME document. Frames that lack enough
// real pool entries are skipped (never invented: no CH4/C2H6O padding).
function buildVariedStructureQ(entry, allEntries, frameIdx, rand) {
  const others = allEntries.filter((e) => e.smi !== entry.smi);
  const otherNames = [...new Set(others.map((e) => e.name))];
  const otherFormulas = [...new Set(others.map((e) => e.formula).filter(Boolean))].filter((f) => f !== entry.formula);
  const otherSmiles = [...new Set(others.map((e) => e.smi))];
  const ground = String(entry.chunk).slice(0, 600);
  const frame = frameIdx % 4;
  if (frame === 0 || frame === 1) {
    if (otherNames.length < 3) return null;
    const distract = seededShuffle(otherNames, rand).slice(0, 3);
    const wrong = distract[0];
    const qtext = frame === 0
      ? `The document's figure shows a structure with SMILES ${entry.smi}. Which compound is it?`
      : `A student labels the structure with SMILES ${entry.smi} as "${wrong}". According to the document's figure, what is it actually?`;
    const opts = seededShuffle([entry.name, ...distract], rand);
    return {
      question_text: qtext, question_type: 'mcq', options: opts,
      correct_answer: `${entry.name} — SMILES: ${entry.smi}`,
      concept_tag: 'Structure identification', difficulty: frame === 0 ? 'Easy' : 'Medium',
      explanation: `Figure-validated structure${entry.formula ? ` (formula ${entry.formula})` : ''}${entry.doc ? ` (${entry.doc})` : ''}.`,
      grounding_chunk: ground, points: 5, _src: 'structure-canned',
    };
  }
  if (frame === 2) {
    if (!entry.formula || otherFormulas.length < 3) return null;
    const opts = seededShuffle([entry.formula, ...otherFormulas.slice(0, 3)], rand);
    return {
      question_text: `What is the molecular formula of ${entry.name} (SMILES ${entry.smi} in the document's figure)?`,
      question_type: 'mcq', options: opts,
      correct_answer: `${entry.formula} — ${entry.name}, SMILES: ${entry.smi}`,
      concept_tag: 'Molecular formula', difficulty: 'Easy',
      explanation: 'Formula from the validated structure block in the document.',
      grounding_chunk: ground, points: 5, _src: 'structure-canned',
    };
  }
  // frame 3: SMILES distinction between two real document compounds.
  if (otherSmiles.length < 3) return null;
  const opts = seededShuffle([entry.smi, ...otherSmiles.slice(0, 3)], rand);
  return {
    question_text: `Which SMILES corresponds to ${entry.name} in the document's figure?`,
    question_type: 'mcq', options: opts,
    correct_answer: `${entry.smi} — ${entry.name}`,
    concept_tag: 'Structure identification', difficulty: 'Medium',
    explanation: `Exact SMILES from the document's validated figure${entry.formula ? ` (formula ${entry.formula})` : ''}.`,
    grounding_chunk: ground, points: 5, _src: 'structure-canned',
  };
}

export { collectStructureEntries, planStructureOrder, buildVariedStructureQ, seededRand };

// ————————————————————————————————————————————————
// RAG-grounded fallback — NOT a dummy dataset
// Generates from the actual document chunks so teacher flow never breaks
// When GEMINI_API_KEY is set, this path is never taken (API is the only source)
// ————————————————————————————————————————————————

/**
 * Clean chunk text for question templates — STEM-preserving.
 * Keeps table content + formula content (previously stripped, which broke
 * math/chemistry questions); only removes the bracket markers themselves.
 */
function cleanChunkText(text) {
  if (!text) return '';
  return text
    // Unwrap [TABLE] blocks but KEEP the markdown content (formulas live here)
    .replace(/\[TABLE\]\s*([\s\S]*?)\s*\[\/TABLE\]/g, '$1')
    // Unwrap [FORMULA] blocks but KEEP LaTeX
    .replace(/\[FORMULA[^\]]*\]\s*([\s\S]*?)\s*\[\/FORMULA\]/g, '$1')
    // Unwrap [VISUAL CONTENT...] blocks but KEEP the description
    .replace(/\[VISUAL CONTENT[^\]]*\]\s*([\s\S]*?)\s*\[\/VISUAL CONTENT\]/g, '$1')
    // Unwrap [STRUCTURE...] blocks but KEEP SMILES + name + formula
    .replace(/\[STRUCTURE[^\]]*\]\s*([\s\S]*?)\s*\[\/STRUCTURE\]/g, '$1')
    // Remove leftover standalone markers
    .replace(/\[\/?TABLE\]/g, '')
    .replace(/\[\/?FORMULA[^\]]*\]/g, '')
    .replace(/\[\/?STRUCTURE[^\]]*\]/g, '')
    .replace(/\[\/?VISUAL CONTENT[^\]]*\]/g, '')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    // Trim whitespace
    .trim();
}

function extractFormulaConcepts(text) {
  // H2SO4, CH3COOH, x^2, d/dx, ∫, \vec — capitalized-phrase regex misses these.
  const out = [];
  const formulas = text.match(/(?:[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)*|\\vec\{[A-Za-z]+\}|\\frac\{[^}]*\}\{[^}]*\}|d\/d\w+|∫[^.\n]{0,40}|[A-Za-z]\^[\w(]+)/g);
  if (formulas) out.push(...formulas.slice(0, 4));
  return [...new Set(out)];
}

function localGenerate(doc, questionTypes = {mcq: 2, short: 2, conceptual: 2}, moduleFilter = null, documentWeights = null){
  const chunks = doc.chunks || [];
  const title = doc.title || 'Course Module';
  const allText = chunks.map(c=>cleanChunkText(c.text)).join(' ') || cleanChunkText(doc.content) || '';
  
  // Filter chunks by module if moduleFilter provided
  let filteredChunks = chunks;
  if(moduleFilter && moduleFilter.length > 0 && doc.module_structure){
    const allowedChunkIndices = new Set();
    for(const module of doc.module_structure){
      if(moduleFilter.includes(module.id)){
        for(const idx of module.chunk_indices || []){
          allowedChunkIndices.add(idx);
        }
        for(const topic of module.topics || []){
          for(const idx of topic.chunk_indices || []){
            allowedChunkIndices.add(idx);
          }
        }
      }
    }
    filteredChunks = chunks.filter((_, i) => allowedChunkIndices.has(i));
    if(filteredChunks.length === 0) filteredChunks = chunks; // fallback
  }
  
  // Extract candidate concepts from chunks (capitalized phrases + STEM formulas).
  // The old regex missed math/chemistry entirely (integrals, H2SO4, vectors).
  const conceptPool = [];
  for(const ch of filteredChunks){
    const cleanedText = cleanChunkText(ch.text);
    const m = cleanedText.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g);
    if(m) conceptPool.push(...m.slice(0,3));
    conceptPool.push(...extractFormulaConcepts(cleanedText));
    if (ch.has_math && !conceptPool.includes('Mathematical reasoning')) conceptPool.push('Mathematical reasoning');
    if (ch.has_chemistry && !conceptPool.includes('Chemical principles')) conceptPool.push('Chemical principles');
  }
  const uniq = [...new Set(conceptPool)].slice(0,20);
  const pickConcept = (i, fallback)=> uniq[i%uniq.length] || fallback;

  // Use exact counts from questionTypes
  const mcqCount = Math.max(0, questionTypes.mcq || 0);
  const shortCount = Math.max(0, questionTypes.short || 0);
  const conceptualCount = Math.max(0, questionTypes.conceptual || 0);
  const questionCount = mcqCount + shortCount + conceptualCount;

  // Create cleaned chunks for template use
  const cleanedChunks = filteredChunks.map(ch => ({
    ...ch,
    text: cleanChunkText(ch.text)
  }));

  // ── STEM-grounded helpers: every option/answer is a real excerpt ──
  // Generic distractors ("system fails due to missing integration") are banned:
  // WTO — distractors must come from OTHER chunks of the SAME document(s).
  const splitSentences = (text) => {
    if (!text) return [];
    return String(text)
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length >= 30 && s.length <= 400);
  };
  const keySentence = (chunkText, exclude = null) => {
    const sents = splitSentences(chunkText);
    if (!sents.length) return String(chunkText || '').slice(0, 180).trim();
    // Prefer sentences with STEM signals: definitions, methods, equations, conditions.
    const scored = sents.map(s => {
      let sc = s.length;
      if (/is (called|defined|known as|given by|expressed as|used to|used for)/i.test(s)) sc += 200;
      if (/(solve|solution|method|equation|formula|theorem|principle|definition|example)/i.test(s)) sc += 80;
      if (/[=∫^_]|dy\/dx|d2y|\\frac|H2SO4|CH3|C6H|SMILES:/i.test(s)) sc += 120;
      if (/^(A|An|The) (system|approach|document|method)/i.test(s)) sc -= 100;
      if (exclude && s.slice(0, 40) === exclude.slice(0, 40)) sc -= 1000;
      return { s, sc };
    });
    scored.sort((a, b) => b.sc - a.sc);
    return scored[0].s;
  };
  const shortLabel = (s, n = 140) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n).trim() + '…' : t;
  };
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // Distractor pool: one key sentence per OTHER chunk (real document content).
  const distractorFor = (selfIdx, n = 3) => {
    const pool = [];
    const order = shuffle(cleanedChunks.map((_, i) => i).filter(i => i !== selfIdx));
    for (const i of order) {
      const s = keySentence(cleanedChunks[i].text);
      if (s && !pool.some(p => p.slice(0, 40) === s.slice(0, 40))) pool.push(shortLabel(s));
      if (pool.length >= n) break;
    }
    // Absolute fallback (should rarely trigger): other sentences from same chunk.
    if (pool.length < n) {
      const own = splitSentences(cleanedChunks[selfIdx]?.text || '').map(s => shortLabel(s));
      for (const s of shuffle(own)) {
        if (!pool.some(p => p.slice(0, 40) === s.slice(0, 40)) && s.length > 30) pool.push(s);
        if (pool.length >= n) break;
      }
    }
    return pool.slice(0, n);
  };
  // Distinct-chunk assignment: shuffle chunk order once, walk without repeat
  // so Q1 and Q11 never share grounding (the duplication bug in the report).
  const chunkOrder = shuffle(cleanedChunks.map((_, i) => i));
  const chunkAt = (k) => cleanedChunks[chunkOrder[k % Math.max(1, chunkOrder.length)]];

  const templates = [];

  // MCQ templates — every stem quotes a REAL chunk excerpt; every option is a
  // REAL excerpt from the same document(s). No generic IT distractors.
  const mcqTemplates = [
    (c, tag, ci) => {
      const focus = keySentence(c.text);
      const correct = shortLabel(focus);
      const d = distractorFor(ci, 3);
      return {
        type: 'mcq', difficulty: 'Medium', points: 5, tag,
        q: () => `According to the document, which statement about "${shortLabel(focus, 80)}" is correct?`,
        opts: () => shuffle([correct, ...d]),
        ans: () => correct,
        explain: 'Tests precise recall of the documented statement.'
      };
    },
    (c, tag, ci) => {
      const focus = keySentence(c.text);
      const correct = shortLabel(focus);
      const d = distractorFor(ci, 3);
      return {
        type: 'mcq', difficulty: 'Medium', points: 5, tag,
        q: () => `The document states: "${shortLabel(focus, 100)}" Under what condition or by which method does this hold?`,
        opts: () => shuffle([correct, ...d]),
        ans: () => correct,
        explain: 'Tests the condition/method tied to the documented claim.'
      };
    },
    (c, tag, ci) => {
      const focus = keySentence(c.text);
      const correct = shortLabel(focus);
      const d = distractorFor(ci, 3);
      return {
        type: 'mcq', difficulty: 'Hard', points: 10, tag,
        q: () => `Which of the following is directly stated in the document about "${shortLabel(focus, 70)}"?`,
        opts: () => shuffle([correct, ...d]),
        ans: () => correct,
        explain: 'Discriminates the verbatim claim from nearby but different claims.'
      };
    },
    (c, tag, ci) => {
      const sents = splitSentences(c.text);
      const first = shortLabel(sents[0] || c.text.slice(0, 140));
      const second = shortLabel(sents[1] || keySentence(c.text));
      const d = distractorFor(ci, 3);
      // Ensure correct is in options even if second duplicates first.
      const correct = second.slice(0, 40) === first.slice(0, 40) ? shortLabel(sents[2] || second) : second;
      return {
        type: 'mcq', difficulty: 'Medium', points: 5, tag,
        q: () => `Given "${first}" what follows in the document?`,
        opts: () => shuffle([correct, ...d]),
        ans: () => correct,
        explain: 'Tests sequential understanding of the documented exposition.'
      };
    },
    (c, tag, ci) => {
      const focus = keySentence(c.text);
      const correct = shortLabel(focus);
      const d = distractorFor(ci, 3);
      return {
        type: 'mcq', difficulty: 'Easy', points: 5, tag,
        q: () => `Which excerpt comes from the section stating "${shortLabel(focus, 70)}"?`,
        opts: () => shuffle([correct, ...d]),
        ans: () => correct,
        explain: 'Tests recognition of the documented formulation.'
      };
    },
    (c, tag, ci) => {
      const focus = keySentence(c.text);
      const correct = shortLabel(focus);
      const d = distractorFor(ci, 3);
      return {
        type: 'mcq', difficulty: 'Hard', points: 10, tag,
        q: () => `A student claims the opposite of "${shortLabel(focus, 80)}". Which document excerpt refutes them?`,
        opts: () => shuffle([correct, ...d]),
        ans: () => correct,
        explain: 'Tests using the document as evidence against a misconception.'
      };
    }
  ];
  
  // Short answer templates — extractive answers (real sentences), not filler.
  const shortTemplates = [
    (c, tag) => ({
      type: 'short', difficulty: 'Medium', points: 10, tag,
      q: () => `The document states: "${shortLabel(keySentence(c.text), 100)}" Explain this in 2-3 sentences using only the document.`,
      ans: () => splitSentences(c.text).slice(0, 2).map(s => shortLabel(s, 160)).join(' ') || shortLabel(c.text, 180),
      opts: null, explain: 'Requires restating the documented explanation in own words.'
    }),
    (c, tag) => ({
      type: 'short', difficulty: 'Medium', points: 10, tag,
      q: () => `Based on "${shortLabel(keySentence(c.text), 90)}", describe the relationship or steps the document gives and why they matter.`,
      ans: () => splitSentences(c.text).slice(0, 2).map(s => shortLabel(s, 160)).join(' ') || shortLabel(c.text, 180),
      opts: null, explain: 'Tests synthesis of the documented relationship.'
    }),
    (c, tag) => ({
      type: 'short', difficulty: 'Hard', points: 15, tag,
      q: () => `Why does the document present "${shortLabel(keySentence(c.text), 80)}"? Give the document's reasoning.`,
      ans: () => splitSentences(c.text).slice(0, 2).map(s => shortLabel(s, 160)).join(' ') || shortLabel(c.text, 180),
      opts: null, explain: 'Tests extracting justification from the document.'
    }),
    (c, tag) => ({
      type: 'short', difficulty: 'Medium', points: 10, tag,
      q: () => `How does "${shortLabel(keySentence(c.text), 80)}" work per the document? Outline the steps or logic.`,
      ans: () => splitSentences(c.text).slice(0, 2).map(s => shortLabel(s, 160)).join(' ') || shortLabel(c.text, 180),
      opts: null, explain: 'Tests stepwise understanding from the text.'
    }),
    (c, tag) => ({
      type: 'short', difficulty: 'Hard', points: 15, tag,
      q: () => `What condition, formula, or rule does "${shortLabel(keySentence(c.text), 90)}" depend on? State it exactly as documented.`,
      ans: () => shortLabel(keySentence(c.text), 220),
      opts: null, explain: 'Tests exact condition/formula recall with context.'
    }),
    (c, tag) => ({
      type: 'short', difficulty: 'Medium', points: 10, tag,
      q: () => `What is the significance of "${shortLabel(keySentence(c.text), 80)}" in its section? Answer from the document.`,
      ans: () => splitSentences(c.text).slice(0, 2).map(s => shortLabel(s, 160)).join(' ') || shortLabel(c.text, 180),
      opts: null, explain: 'Tests contextual understanding of the documented concept.'
    })
  ];
  
  // Conceptual templates — grounded transfer, no placeholder domains.
  const conceptualTemplates = [
    (c, tag) => ({
      type: 'conceptual', difficulty: 'Hard', points: 15, tag,
      q: () => `A student claims "${shortLabel(keySentence(c.text), 80)}" applies universally. Using ONLY the document, critique this claim with evidence.`,
      ans: () => shortLabel(keySentence(c.text), 220),
      opts: null, explain: 'Tests critical evaluation using only document evidence.'
    }),
    (c, tag, ci) => {
      const other = cleanedChunks[(ci + 1) % cleanedChunks.length];
      const otherSent = other ? shortLabel(keySentence(other.text), 90) : '';
      return {
        type: 'conceptual', difficulty: 'Hard', points: 15, tag,
        q: () => `Connect "${shortLabel(keySentence(c.text), 70)}" with "${otherSent}". What does the document imply about their relationship?`,
        ans: () => `${shortLabel(keySentence(c.text), 140)} Related: ${otherSent}`,
        opts: null, explain: 'Tests connecting two documented ideas.'
      };
    },
    (c, tag) => ({
      type: 'conceptual', difficulty: 'Hard', points: 15, tag,
      q: () => `If the condition in "${shortLabel(keySentence(c.text), 70)}" were violated, what would the document predict? Justify.`,
      ans: () => shortLabel(keySentence(c.text), 220),
      opts: null, explain: 'Tests causal reasoning from the documented condition.'
    }),
    (c, tag) => ({
      type: 'conceptual', difficulty: 'Hard', points: 15, tag,
      q: () => `What limitation or edge case does the document attach to "${shortLabel(keySentence(c.text), 80)}"? Justify from the text.`,
      ans: () => shortLabel(keySentence(c.text), 220),
      opts: null, explain: 'Tests limitation analysis from the text.'
    }),
    (c, tag) => ({
      type: 'conceptual', difficulty: 'Hard', points: 15, tag,
      q: () => `Design a verification step for "${shortLabel(keySentence(c.text), 90)}" using only methods the document describes.`,
      ans: () => shortLabel(keySentence(c.text), 220),
      opts: null, explain: 'Tests applied verification grounded in the document.'
    }),
    (c, tag) => ({
      type: 'conceptual', difficulty: 'Hard', points: 15, tag,
      q: () => `Why does "${shortLabel(keySentence(c.text), 80)}" matter for what comes next in the document? Explain the link.`,
      ans: () => splitSentences(c.text).slice(0, 2).map(s => shortLabel(s, 160)).join(' ') || shortLabel(c.text, 200),
      opts: null, explain: 'Tests forward-link reasoning within the document.'
    })
  ];

  // Build templates with DISTINCT chunks (no repeats until pool exhausted).
  let k = 0;
  const nextChunk = () => {
    const c = chunkAt(k);
    const ci = chunkOrder[k % Math.max(1, chunkOrder.length)];
    k += 1;
    return { c, ci };
  };
  for (let i = 0; i < mcqCount; i++) {
    const { c, ci } = nextChunk();
    const templateFn = mcqTemplates[i % mcqTemplates.length];
    templates.push({ built: templateFn(c, pickConcept(k, 'Core Principles'), ci), chunk: c });
  }

  for (let i = 0; i < shortCount; i++) {
    const { c, ci } = nextChunk();
    const templateFn = shortTemplates[i % shortTemplates.length];
    templates.push({ built: templateFn(c, pickConcept(k, 'Key Ideas'), ci), chunk: c });
  }

  for (let i = 0; i < conceptualCount; i++) {
    const { c, ci } = nextChunk();
    const templateFn = conceptualTemplates[i % conceptualTemplates.length];
    templates.push({ built: templateFn(c, pickConcept(k, 'Analysis'), ci), chunk: c });
  }

  return templates.map(({ built: t, chunk: ch }) => {
    const safeChunk = ch || { text: allText.slice(0, 260) || title, id: 0, page: 1, tokens: 30, grounding_score: '0.91' };
    const correct = typeof t.ans === 'function' ? t.ans(safeChunk) : t.ans;
    let options = null;
    if (t.type === 'mcq') {
      const raw = typeof t.opts === 'function' ? t.opts(correct) : t.opts;
      // Dedupe + ensure correct present exactly once, always 4 options.
      const seen = new Set();
      const deduped = [];
      for (const o of [correct, ...(raw || [])]) {
        const key = String(o || '').slice(0, 60);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(o);
      }
      if (!deduped.some(o => String(o).slice(0, 60) === String(correct).slice(0, 60))) deduped[0] = correct;
      options = shuffle(deduped).slice(0, 4);
      while (options.length < 4 && cleanedChunks.length > options.length) {
        const extra = shortLabel(keySentence(cleanedChunks[options.length % cleanedChunks.length].text));
        if (!options.some(o => String(o).slice(0, 40) === extra.slice(0, 40))) options.push(extra);
        else break;
      }
    }
    return {
      question_text: typeof t.q === 'function' ? t.q(safeChunk) : t.q,
      question_type: t.type,
      options,
      correct_answer: correct,
      concept_tag: t.tag,
      difficulty: t.difficulty,
      explanation: t.explain,
      grounding_chunk: safeChunk.text,
      points: t.points
    };
  });
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='GET'){
      const { document_id, set_id } = req.query;
      let q = supabase.from('questions').select('*').order('id',{ascending:true});
      if(document_id) q = q.eq('document_id', document_id);
      if(set_id) q = q.eq('set_id', set_id);
      const { data, error } = await q;
      if(error) throw error;
      return res.status(200).json(data);
    }
    if(req.method==='POST'){
      const { document_id, document_ids, generate, question_types, module_filter, document_weights } = req.body;
      
      // Support both old (document_id) and new (document_ids) format
      const docIds = document_ids && Array.isArray(document_ids) && document_ids.length > 0 
        ? document_ids 
        : (document_id ? [document_id] : []);
      
      if(generate){
        if(docIds.length === 0){
          return res.status(400).json({error:'document_id or document_ids required'});
        }
        
        // Validate question_types
        const types = question_types || { mcq: 2, short: 2, conceptual: 2 };
        const mcqCount = Math.max(0, parseInt(types.mcq) || 0);
        const shortCount = Math.max(0, parseInt(types.short) || 0);
        const conceptualCount = Math.max(0, parseInt(types.conceptual) || 0);
        const totalQuestions = mcqCount + shortCount + conceptualCount;
        
        if(totalQuestions === 0 || totalQuestions > 50){
          return res.status(400).json({error:'Total questions must be between 1 and 50'});
        }
        
        // Fetch all documents
        const { data: docs, error: docsErr } = await supabase
          .from('documents')
          .select('*')
          .in('id', docIds);
        
        if(docsErr) throw docsErr;
        if(!docs || docs.length === 0){
          return res.status(404).json({error:'No documents found'});
        }
        
        // Combine chunks from all documents with weights.
        // Track per-document chunk index (_docIdx) so module_filter maps
        // correctly when several PDFs are selected (indexOf across the flat
        // list was wrong and dropped most filters).
        const weights = document_weights || {};
        const allChunks = [];
        const allContent = [];
        const docTitles = [];

        for (const doc of docs) {
          docTitles.push(doc.title);
          if (doc.content) allContent.push(doc.content);
          if (doc.chunks && doc.chunks.length > 0) {
            const weight = weights[doc.id] || (1 / docs.length);
            doc.chunks.forEach((chunk, docIdx) => {
              allChunks.push({ ...chunk, document_id: doc.id, document_title: doc.title, weight, _docIdx: docIdx });
            });
          }
        }
        
        // Filter chunks by module if module_filter provided
        let filteredChunks = allChunks;
        if(module_filter && module_filter.length > 0){
          const allowedChunkIndices = new Set();
          for(const doc of docs){
            if(doc.module_structure){
              for(const module of doc.module_structure){
                if(module_filter.includes(module.id)){
                  for(const idx of module.chunk_indices || []){
                    allowedChunkIndices.add(`${doc.id}-${idx}`);
                  }
                  for(const topic of module.topics || []){
                    for(const idx of topic.chunk_indices || []){
                      allowedChunkIndices.add(`${doc.id}-${idx}`);
                    }
                  }
                }
              }
            }
          }
          filteredChunks = allChunks.filter((c) => allowedChunkIndices.has(`${c.document_id}-${c._docIdx ?? 0}`));
          if(filteredChunks.length === 0) filteredChunks = allChunks; // fallback
        }

        // Stratified sampling: round-robin across documents so multi-PDF sets
        // draw from EVERY selected PDF (weight controls share), structures
        // boosted but never crowding out other docs. Limit scales with the
        // request so 20Q uses up to 24 distinct chunks instead of 10.
        const byDoc = new Map();
        for (const c of filteredChunks) {
          if (!byDoc.has(c.document_id)) byDoc.set(c.document_id, []);
          byDoc.get(c.document_id).push(c);
        }
        for (const arr of byDoc.values()) {
          arr.sort((a, b) =>
            (((b.weight || 0) + (b.has_structure ? 0.5 : 0)) - ((a.weight || 0) + (a.has_structure ? 0.5 : 0))) +
            (Math.random() - 0.5) * 0.15);
        }
        const docIdsOrdered = [...byDoc.keys()].sort((a, b) =>
          ((weights[b] || 0) - (weights[a] || 0)) || (Math.random() - 0.5));
        const chunkLimit = Math.min(filteredChunks.length, Math.max(totalQuestions * 2, 12), 40);
        const sampledChunks = [];
        let ri = 0;
        while (sampledChunks.length < chunkLimit) {
          let progressed = false;
          for (const did of docIdsOrdered) {
            const arr = byDoc.get(did);
            if (ri < arr.length && sampledChunks.length < chunkLimit) {
              sampledChunks.push(arr[ri]);
              progressed = true;
            }
          }
          ri += 1;
          if (!progressed) break;
        }

        // Quality gate 1: drop OCR-damaged chunks BEFORE generation so neither
        // the LLM nor the fallback ever quotes garbled text as a question stem.
        // Keep at least minKeep of the best-scoring chunks so small docs work.
        const scored = sampledChunks.map((c) => ({ c, q: scoreChunkQuality(c.text) }));
        scored.sort((a, b) => b.q - a.q);
        const minKeep = Math.min(sampledChunks.length, Math.max(4, totalQuestions));
        let kept = scored.filter((s) => s.q >= 0.45).map((s) => s.c);
        if (kept.length < minKeep) kept = scored.slice(0, minKeep).map((s) => s.c);
        if (kept.length && scored[0].q < 0.25) {
          return res.status(422).json({
            error: 'Document text quality is too low for question generation (scanned/OCR damage). Re-upload a clearer PDF or request fewer questions.',
          });
        }
        // Re-shuffle kept chunks so batches draw from across the document.
        for (let i = kept.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [kept[i], kept[j]] = [kept[j], kept[i]];
        }
        sampledChunks.length = 0;
        sampledChunks.push(...kept);
        
        const combinedDoc = {
          title: docTitles.join(' + '),
          chunks: sampledChunks,
          content: allContent.join('\n\n'),
          module_structure: docs.flatMap(d => d.module_structure || [])
        };
        
        // ── Try real API (GEMINI_API_KEY via .env is the only source when present) ──
        let parsed = null;
        
        // Add variation seed to ensure different questions each generation
        const variationSeed = Date.now().toString(36) + Math.random().toString(36).slice(2,8);
        
        // Get existing questions for these documents to avoid repetition
        const { data: existingQuestions } = await supabase
          .from('questions')
          .select('question_text, concept_tag, grounding_chunk, correct_answer')
          .in('document_id', docIds)
          .limit(100);
        const existingTexts = (existingQuestions || []).map(q => q.question_text.slice(0, 80)).join('\n- ');
        const existingTags = [...new Set((existingQuestions || []).map(q => q.concept_tag))].join(', ');
        // Structures already tested in earlier sets (via SMILES in text/answer)
        // are deprioritized so new sets walk through the remaining figures.
        const usedSmiles = extractUsedSmiles(existingQuestions);
        
        // Randomly select which chunks to focus on for this generation.
        // Truncated for prompt budget — grounding guard still uses full text.
        const focusChunks = sampledChunks
          .sort(() => Math.random() - 0.5)
          .slice(0, Math.min(totalQuestions, sampledChunks.length));
        const focusText = focusChunks.map((c,i) => `FOCUS CHUNK ${i+1} (Doc: ${c.document_title} | p${c.page}): ${String(c.text).slice(0, 700)}`).join('\n\n');

        const chunksText = sampledChunks.map((c,i)=>`[Chunk ${i+1} | Doc: ${c.document_title} | p${c.page}]: ${String(c.text).slice(0, 800)}`).join('\n\n');
        
        // Random question angles to use
        const mcqAngles = [
          "What specific technique/method is described for...",
          "Which principle/rule does the document state about...",
          "What is the key distinction between...",
          "According to the text, what happens when...",
          "Which condition leads to...",
          "What role does X play in..."
        ];
        const shortAngles = [
          "Explain the mechanism by which...",
          "Describe the relationship between X and Y...",
          "Why does the document recommend...",
          "How does X address the problem of Y...",
          "What is the significance of...",
          "Explain the trade-off between..."
        ];
        const conceptualAngles = [
          "Critique this claim using the document: ...",
          "Apply the concept of X to a new scenario: ...",
          "What would happen if we removed X from the pipeline...",
          "How does X relate to Y in a different domain...",
          "Design a follow-up experiment based on...",
          "What are the implications of X for..."
        ];
        
        // Shuffle angles for variety
        const shuffledMcqAngles = mcqAngles.sort(() => Math.random() - 0.5);
        const shuffledShortAngles = shortAngles.sort(() => Math.random() - 0.5);
        const shuffledConceptualAngles = conceptualAngles.sort(() => Math.random() - 0.5);
        
        const prompt = `You are Gemma 4, evaluation architect for the Next-Gen AI Education Track (Best Intelligent LMS Module).
Rules:
- Generate ONLY from the provided chunks. Cite verbatim grounding_chunk for each question.
- No hallucination. Do NOT use outside knowledge.
- The grounding_chunk for each question MUST be a VERBATIM excerpt from one of the provided chunks.
- Return STRICT JSON array, no markdown.

DOCUMENT TITLES: ${combinedDoc.title}
GROUNDING CHUNKS (ONLY SOURCE OF TRUTH):
${chunksText}

FOCUS CHUNKS FOR THIS GENERATION:
${focusText}

Full document preview (for context only - questions must come from chunks above):
${combinedDoc.content.slice(0, 2500)}

VARIATION SEED: ${variationSeed} — Use this to create UNIQUE questions different from any previous generation.

PREVIOUSLY GENERATED QUESTIONS (DO NOT REPEAT THESE):
${existingTexts || 'None yet'}

PREVIOUSLY USED CONCEPT TAGS (VARY FROM THESE):
${existingTags || 'None yet'}

Task: Generate exactly ${totalQuestions} RAG-grounded questions:
- ${mcqCount} MCQ (4 options, 1 correct, distractors diagnose misconceptions)
- ${shortCount} Short (2-3 sentence reasoning)
- ${conceptualCount} Conceptual (WHY / transfer, Bloom Analyze/Evaluate)
${sampledChunks.some((c) => String(c.text || '').includes('[STRUCTURE')) ? `- QUESTION 1 MUST be about the cyclic structures in the [STRUCTURE] chunk(s): test identification or benzenoid vs non-benzenoid classification, and MUST include the SMILES string in correct_answer.` : ''}

CRITICAL: Every question MUST be answerable ONLY from the provided chunks above.
- The grounding_chunk for each question MUST be a VERBATIM excerpt from one of the provided chunks.
- Do NOT use outside knowledge. Do NOT hallucinate. Do NOT create generic questions.
- If a concept is not explicitly in the chunks, do NOT generate a question about it.
- VARY the concept_tags, difficulty distribution, and question angles each generation.
- IMPORTANT: Choose DIFFERENT chunks for each question than previous generations.
- IMPORTANT: Use DIFFERENT concept_tags derived from the document content.
- IMPORTANT: Vary the question framing - don't repeat the same question stems.

STEM FIDELITY (math / chemistry / vectors / calculus):
- Preserve formulas EXACTLY as written: H2SO4 stays H2SO4, x^2 stays x^2, ∫..dx stays intact. Never "simplify" or reformat symbols.
- NCERT text extraction renders superscripts inline (x2 = x^2, dx2 = dx^2, y' = dy/dx prime notation) and display fractions as adjacent fragments ("dy dx = ..." means dy/dx). Interpret powers/derivatives contextually.
- CYCLIC STRUCTURES: chunks may contain [STRUCTURE] blocks with RDKit-validated
  SMILES + Name + Formula. When asking about a cyclic compound, ALWAYS include
  both the SMILES and the compound name in correct_answer (e.g. "benzene —
  SMILES: c1ccccc1"), copy SMILES character-for-character (never reformat
  aromatic↔Kekule), and make at least one MCQ distractor a plausible wrong
  isomer/ring-size (e.g. cyclohexane SMILES C1CCCCC1 vs benzene c1ccccc1).
- MANDATORY: if any provided chunk contains a [STRUCTURE] block, at least ONE
  generated question MUST test those cyclic structures (identification,
  benzenoid vs non-benzenoid classification, or isomer distinction) and MUST
  include the SMILES string in its correct_answer.
- For calculation questions, the correct_answer MUST show the full working (substitution → simplification → result), not just the final value.
- MCQ distractors for STEM must encode classic errors: sign flip, chain-rule miss, off-by-one charge, vector vs scalar confusion, integration-constant drop.
- If a chunk contains a reaction, equation, or derivation, at least one question must require USING it (balance, differentiate, integrate, resolve components) — not merely recalling its name.

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

JSON HYGIENE (critical): chemistry text contains lone backslashes (E\, K\GUR). Inside JSON strings every backslash MUST be escaped as \\ or the whole answer is discarded. Never emit raw control characters.

Return ONLY JSON array:
[{"question_text":"...","question_type":"mcq","options":["A","B","C","D"],"correct_answer":"B","concept_tag":"...","difficulty":"Medium","explanation":"...","grounding_chunk":"...","points":5}]`;
        // ── Batched LLM calls sized for free-tier quotas ──
        // Measured Groq free limits: 8000 TPM / 1000 OTPM. Old 5Q batches
        // (~7000 output tokens, 8×900-char chunks) blew the per-minute budget
        // on batch 3 every time → silent localGenerate tail. Now: max 4Q per
        // batch, 6×800-char chunks, ≤4000 output tokens, 5s pacing between
        // batches, one 15s retry before any fallback. With a CEREBRAS_API_KEY
        // set, odd batches lead with Cerebras so two lanes share the load.
        const buildBatchPrompt = (bMcq, bShort, bConcept, batchChunks, batchIdx, batchSeed, structFocus = []) => {
          const bText = batchChunks.map((c, i) => `[Chunk ${i + 1} | Doc: ${c.document_title} | p${c.page}]: ${String(c.text).slice(0, 800)}`).join('\n\n');
          const bTotal = bMcq + bShort + bConcept;
          const structHit = batchChunks.some((c) => String(c.text || '').includes('[STRUCTURE'));
          const focusLines = (structFocus && structFocus.length)
            ? `STRUCTURE FOCUS — test THESE figures with natural, varied questions (NOT copy-paste stems). Put both SMILES and compound name in correct_answer:\n${structFocus.map((f, i) => `${i + 1}. ${f.angle}`).join('\n')}`
            : (structHit && bMcq > 0 ? `- One MCQ MUST test a [STRUCTURE] cyclic compound: natural identification or classification question, include SMILES + name in correct_answer.` : '');
          return `You are Gemma 4, evaluation architect. Generate ONLY from the chunks. Cite verbatim grounding_chunk. Return STRICT JSON array, no markdown.

DOCUMENTS: ${combinedDoc.title}
GROUNDING CHUNKS:
${bText}

VARIATION SEED: ${batchSeed}-${batchIdx} — UNIQUE questions, do not repeat previous batches.
AVOID: ${existingTexts ? existingTexts.slice(0, 600) : 'None yet'}

Task: exactly ${bTotal} questions: ${bMcq} MCQ (4 options, distractors = plausible wrong answers from the chunks, NEVER generic IT phrases), ${bShort} Short (2-3 sentence reasoning from the chunks), ${bConcept} Conceptual (WHY/transfer, Bloom Analyze).
${focusLines}
STEM: preserve formulas exactly (H2SO4, x^2, dy/dx, integrals). Calculation answers show working. MCQ distractors encode classic errors (sign flip, order/degree confusion, wrong substitution y=vx).
FORBIDDEN stems: "A system implements the approach", "which condition is necessary for ... to be effective", "what is the key trade-off", "what role does X play", "consequence of omitting". Ask about the ACTUAL content (definitions, methods, equations, examples).
Each: question_text, question_type (mcq|short|conceptual), options (array|null), correct_answer, concept_tag, difficulty (Easy|Medium|Hard), explanation, grounding_chunk (verbatim excerpt), points (5/10/15).
Escape every backslash as \\\\ for JSON hygiene.
Return ONLY JSON array.`;
        };
        const batches = [];
        {
          let rMcq = mcqCount, rShort = shortCount, rConcept = conceptualCount;
          const BATCH = 4;
          while (rMcq + rShort + rConcept > 0) {
            const bMcq = Math.min(rMcq, BATCH, Math.max(0, BATCH - 0));
            const take = Math.min(BATCH, rMcq + rShort + rConcept);
            let bbMcq = Math.min(rMcq, take >= 3 ? Math.ceil(take * (mcqCount / Math.max(1, totalQuestions))) : rMcq);
            let bbShort = Math.min(rShort, take - bbMcq >= 1 ? Math.ceil(take * (shortCount / Math.max(1, totalQuestions))) : 0);
            let bbConcept = Math.min(rConcept, take - bbMcq - bbShort);
            // Fill remainder greedily so every batch sums to `take`.
            while (bbMcq + bbShort + bbConcept < take) {
              if (rMcq - bbMcq > 0) bbMcq++;
              else if (rShort - bbShort > 0) bbShort++;
              else if (rConcept - bbConcept > 0) bbConcept++;
              else break;
            }
            if (bbMcq + bbShort + bbConcept === 0) break;
            batches.push({ mcq: bbMcq, short: bbShort, conceptual: bbConcept });
            rMcq -= bbMcq; rShort -= bbShort; rConcept -= bbConcept;
          }
        }
        // Structure rotation plan: walk through EVERY figure (unused first),
        // assigning up to 2 focus structures per MCQ-bearing batch.
        const structEntries = collectStructureEntries(sampledChunks);
        const structOrder = planStructureOrder(structEntries, usedSmiles, variationSeed);
        let structCursor = 0, structAngleCursor = 0;
        const assignStructFocus = (bMcq) => {
          if (!structOrder.length || bMcq <= 0) return [];
          const out = [];
          const n = Math.min(2, bMcq, structOrder.length);
          for (let k = 0; k < n; k++) {
            const entry = structOrder[structCursor % structOrder.length];
            structCursor++;
            const angleFn = STRUCT_ANGLES[structAngleCursor % STRUCT_ANGLES.length];
            structAngleCursor++;
            out.push({ entry, angle: angleFn(entry) });
          }
          return out;
        };

        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const parseBatchRaw = (raw, bTotal, bi) => {
          if (!raw) return null;
          const start = raw.indexOf('['), end = raw.lastIndexOf(']');
          const blob = (start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw).replace(/```json|```/g, '').trim();
          const bp = tryParseQuestions(blob, bTotal);
          if (!bp) console.warn(`Batch ${bi + 1} JSON parse failed (tail: ${raw.slice(-160)})`);
          return bp;
        };

        parsed = [];
        try {
          console.log(`Batched generation: ${batches.length} batch(es) for ${totalQuestions}Q (structures: ${structOrder.length}, used before: ${usedSmiles.size})`);
          const shuffledForBatches = [...sampledChunks].sort(() => Math.random() - 0.5);
          for (let bi = 0; bi < batches.length; bi++) {
            const b = batches[bi];
            const bTotal = b.mcq + b.short + b.conceptual;
            // Distinct focus chunks per batch (stride through shuffled list).
            const batchChunks = [];
            for (let j = 0; j < Math.min(6, shuffledForBatches.length); j++) {
              batchChunks.push(shuffledForBatches[(bi * 6 + j) % shuffledForBatches.length]);
            }
            // Attach focus-figure text so the LLM grounds structure Qs verbatim.
            const structFocus = assignStructFocus(b.mcq);
            for (const f of structFocus) {
              if (!batchChunks.some((c) => String(c.text || '').includes(f.entry.smi))) {
                batchChunks.push({ text: String(f.entry.chunk).slice(0, 800), document_title: f.entry.doc || combinedDoc.title, page: 'fig' });
              }
            }
            const prompt = buildBatchPrompt(b.mcq, b.short, b.conceptual, batchChunks, bi, variationSeed, structFocus);
            console.log(`Batch ${bi + 1}/${batches.length}: ${bTotal}Q prompt len=${prompt.length}${structFocus.length ? ` structFocus=${structFocus.length}` : ''}`);
            // Quota pacing: 5s between batches keeps Groq free-tier TPM refilling.
            if (bi > 0) await sleep(5000);
            // Odd batches lead with Cerebras when a key exists (two-lane load
            // sharing); without a key it skips instantly — zero cost.
            const order = bi % 2 === 1
              ? ['cerebras', 'groq', 'openrouter', 'gemini', 'ollama', 'pollinations']
              : undefined;
            const budget = Math.min(4000, 1400 + bTotal * 550);
            const thinkingBudget = Math.min(1024, 256 + bTotal * 120);
            const callOpts = { temperature: 0.85, maxTokens: budget, thinkingBudget, pollinationsChars: 3200, pollinationsRetries: 3 };
            if (order) callOpts.order = order;
            let raw = null;
            try {
              raw = await callModel(prompt, callOpts);
            } catch (e) {
              console.warn(`Batch ${bi + 1} model error:`, e.message?.slice(0, 150));
            }
            console.log(`Batch ${bi + 1} response:`, raw ? `len=${raw.length}` : 'null');
            let bParsed = parseBatchRaw(raw, bTotal, bi);
            if (!bParsed) {
              // One retry after 15s: free-tier 429 windows are per-minute, so a
              // short wait usually recovers without any fallback at all.
              console.log(`Batch ${bi + 1} retrying once after 15s…`);
              await sleep(15000);
              try {
                raw = await callModel(prompt, callOpts);
              } catch (e) {
                console.warn(`Batch ${bi + 1} retry error:`, e.message?.slice(0, 150));
              }
              console.log(`Batch ${bi + 1} retry response:`, raw ? `len=${raw.length}` : 'null');
              bParsed = parseBatchRaw(raw, bTotal, bi);
            }
            if (bParsed && bParsed.length) {
              // A batch may salvage fewer than requested (damaged JSON with
              // lone backslashes). Top up THAT batch immediately with grounded
              // local questions so counts stay exact per type.
              const got = bParsed.slice(0, bTotal);
              parsed.push(...got.map((q) => ({ ...q, _src: 'llm' })));
              if (got.length < bTotal) {
                const short = bTotal - got.length;
                const gotMcq = got.filter(q => String(q.question_type || '').toLowerCase() === 'mcq').length;
                const gotShort = got.filter(q => String(q.question_type || '').toLowerCase() === 'short').length;
                const needMcq = Math.max(0, b.mcq - gotMcq);
                const needShort = Math.max(0, b.short - gotShort);
                const needConcept = Math.max(0, short - needMcq - needShort);
                console.log(`Batch ${bi + 1} top-up: +${short}Q (mcq:${needMcq} short:${needShort} conceptual:${needConcept})`);
                const fbDoc = { ...combinedDoc, chunks: batchChunks.length ? batchChunks : sampledChunks };
                const fb = localGenerate(fbDoc, { mcq: needMcq, short: needShort, conceptual: needConcept }, null, null);
                // If type-specific top-up still short, fill remainder as MCQ.
                let extra = fb;
                if (extra.length < short) {
                  const fb2 = localGenerate(fbDoc, { mcq: short - extra.length, short: 0, conceptual: 0 }, null, null);
                  extra = [...extra, ...fb2];
                }
                parsed.push(...extra.slice(0, short).map(q => ({
                  question_text: q.question_text, question_type: q.question_type, options: q.options,
                  correct_answer: q.correct_answer,
                  concept_tag: sanitizeConceptTag(q.concept_tag, q.grounding_chunk),
                  difficulty: q.difficulty,
                  explanation: q.explanation, grounding_chunk: q.grounding_chunk, points: q.points,
                  _src: 'local'
                })));
              }
            } else {
              // Partial fallback: only this batch uses local templates (grounded,
              // STEM-specific), successful batches keep LLM quality.
              console.log(`Batch ${bi + 1} FALLBACK to localGenerate (${bTotal}Q)`);
              const fbDoc = { ...combinedDoc, chunks: batchChunks.length ? batchChunks : sampledChunks };
              const fb = localGenerate(fbDoc, { mcq: b.mcq, short: b.short, conceptual: b.conceptual }, null, null);
              parsed.push(...fb.map(q => ({
                question_text: q.question_text, question_type: q.question_type, options: q.options,
                correct_answer: q.correct_answer,
                concept_tag: sanitizeConceptTag(q.concept_tag, q.grounding_chunk),
                difficulty: q.difficulty,
                explanation: q.explanation, grounding_chunk: q.grounding_chunk, points: q.points,
                _src: 'local'
              })));
            }
          }
          if (!parsed.length) parsed = null;
          else {
            parsed = parsed.slice(0, totalQuestions);
            if (parsed.length < totalQuestions) {
              const short = totalQuestions - parsed.length;
              console.log(`Final top-up: +${short}Q to reach ${totalQuestions}`);
              const fb = localGenerate({ ...combinedDoc, chunks: sampledChunks }, { mcq: short, short: 0, conceptual: 0 }, null, null);
              parsed.push(...fb.slice(0, short).map(q => ({
                question_text: q.question_text, question_type: q.question_type, options: q.options,
                correct_answer: q.correct_answer,
                concept_tag: sanitizeConceptTag(q.concept_tag, q.grounding_chunk),
                difficulty: q.difficulty,
                explanation: q.explanation, grounding_chunk: q.grounding_chunk, points: q.points,
                _src: 'local'
              })));
            }
          }
        } catch (e) {
          console.warn('Batched generation failed, full RAG fallback:', e.message?.slice(0, 200));
          parsed = null;
        }

        let normalized;
        let llmCount = 0, localCount = 0;
        if(parsed){
          console.log('Using API-generated questions');
          normalized = parsed.map((p, i)=>{
            const grounding = p.grounding_chunk || sampledChunks[i % Math.max(1, sampledChunks.length)]?.text?.slice(0,220) || '';
            return {
              question_text: p.question_text || p.question || 'Untitled',
              question_type: String(p.question_type||'short').toLowerCase(),
              options: p.options || null,
              correct_answer: p.correct_answer || p.answer || '',
              concept_tag: sanitizeConceptTag(p.concept_tag || 'General', grounding),
              difficulty: p.difficulty || 'Medium',
              explanation: p.explanation || '',
              grounding_chunk: grounding,
              points: parseInt(p.points)||10,
              _src: p._src || 'llm',
            };
          });
          llmCount = normalized.filter((q) => q._src === 'llm').length;
          localCount = normalized.length - llmCount;
          // grounding guard — rotate fallback across chunks so rejected
          // citations never collapse onto a single repeated excerpt.
          const texts = sampledChunks.map(c=>c.text).join(' ');
          normalized.forEach((q, i)=>{ if(q.grounding_chunk && !texts.includes(q.grounding_chunk.slice(0,40))) q.grounding_chunk = sampledChunks[i % Math.max(1, sampledChunks.length)]?.text?.slice(0,220) || q.grounding_chunk; });
        } else {
          console.log('FALLBACK: Using localGenerate - API failed or returned null');
          // RAG-grounded local generation — ensures teacher flow never shows "Service unavailable"
          // When a real key is configured, this branch is never hit because callModel succeeds.
          normalized = localGenerate(combinedDoc, types, module_filter, weights).map((q) => ({
            ...q,
            concept_tag: sanitizeConceptTag(q.concept_tag, q.grounding_chunk),
            _src: 'local',
          }));
          localCount = normalized.length;
        }

        // Quality gate 2: reject garbled questions BEFORE the DB insert.
        // A short set of clean questions is delivered instead of a full set
        // padded with OCR verbatim ("E ysin...", "Thene", "\vec{h}").
        // Also kills the clean-character template pathologies seen in set 225:
        // exercise-list quoting ("(A) (4x+6y+5) dy..."), sequence-memorization
        // stems (Given X → what follows), excerpt-hunt stems, and
        // self-answering MCQs whose key is quoted verbatim inside the stem.
        const beforeGate = normalized.length;
        normalized = normalized.filter(passesQualityGate);
        const dropped = beforeGate - normalized.length;
        if (dropped > 0) console.log(`Quality gate dropped ${dropped}/${beforeGate} garbled questions`);
        if (!normalized.length) {
          return res.status(422).json({
            error: 'Could not generate clean questions from these documents (text too damaged or providers throttled). Try fewer questions, a clearer PDF, or retry in a minute.',
          });
        }

        // ── Structure coverage top-up ──
        // The LLM already received rotated STRUCTURE FOCUS assignments per
        // batch (unused figures first, varied angles). This only fills the
        // REMAINDER with canned questions built solely from document facts —
        // and inserts them at RANDOM positions (never a Q1 pile-up).
        try {
          const uniqStruct = structOrder;
          if (uniqStruct.length >= 1 && normalized.length) {
            const isStructQ = (q) => /SMILES:/i.test(`${q.question_text || ''} ${q.correct_answer || ''}`);
            const covered = new Set();
            for (const q of normalized) {
              if (!isStructQ(q)) continue;
              for (const m of `${q.question_text || ''}\n${q.correct_answer || ''}`.matchAll(/SMILES:\s*([^\s,;\"']{2,120})/g)) covered.add(m[1]);
            }
            // Every figure deserves one question (cap 6 per set to avoid
            // swamping); prefer figures still uncovered after the LLM pass.
            const want = structOrder.filter((e) => !covered.has(e.smi))
              .concat(structOrder.filter((e) => covered.has(e.smi)))
              .slice(0, Math.min(6, structOrder.length));
            const missing = want.filter((e) => !covered.has(e.smi));
            if (missing.length) {
              const rand = seededRand(`canned-${variationSeed}`);
              const filled = [];
              let frame = 0;
              for (const entry of missing) {
                // Try all 4 natural frames; take the first with enough real pool.
                let built = null;
                for (let f = 0; f < 4 && !built; f++) built = buildVariedStructureQ(entry, structOrder, frame++, rand);
                if (built) filled.push(built);
              }
              // Weakest-first replacement order, index 0 (Q1) NEVER touched:
              // offline-fallback MCQs, then any non-structure MCQ, then any
              // non-structure question. Positions drawn randomly.
              const candidates = [];
              const pushIdx = (pred) => normalized.forEach((q, i) => {
                if (i !== 0 && !isStructQ(q) && pred(q) && !candidates.includes(i)) candidates.push(i);
              });
              pushIdx((q) => q.question_type === 'mcq' && (q._src === 'local' || q._src === 'structure-canned'));
              pushIdx((q) => q.question_type === 'mcq');
              pushIdx(() => true);
              const shuffledSpots = seededShuffle(candidates, rand);
              let replaced = 0;
              for (const nq of filled) {
                if (!shuffledSpots.length) break;
                normalized[shuffledSpots.pop()] = nq;
                replaced++;
              }
              if (replaced) {
                localCount = normalized.filter((q) => q._src === 'local').length;
                console.log(`Structure top-up: +${replaced} canned Qs at random positions (covered ${covered.size} → ${covered.size + replaced}/${want.length} figures)`);
              }
            }
          }
        } catch (e) {
          console.warn('Structure top-up skipped:', e.message?.slice(0, 150));
        }

        // Use first document_id for the question_set (primary document)
        const primaryDocId = docIds[0];
        const { data: setData, error: setErr } = await supabase.from('question_sets').insert({ 
          document_id: primaryDocId, 
          total_questions: normalized.length,
          question_types: types,
          module_filter: module_filter || null,
          document_weights: weights
        }).select().single();
        if(setErr) throw setErr;
        
        const rows = normalized.map(g=>({ 
          set_id: setData.id, 
          document_id: primaryDocId, 
          question_text:g.question_text, 
          question_type:g.question_type, 
          options: g.options? JSON.stringify(g.options): null, 
          correct_answer:g.correct_answer, 
          concept_tag:g.concept_tag, 
          difficulty:g.difficulty, 
          explanation:g.explanation, 
          grounding_chunk:g.grounding_chunk, 
          points:g.points 
        }));
        const { data: inserted, error: insErr } = await supabase.from('questions').insert(rows).select();
        if(insErr) throw insErr;
        // Provenance metadata (additive — old clients ignore it). Lets the
        // teacher UI warn when part of a set came from the offline fallback.
        const generation = {
          requested: totalQuestions,
          delivered: inserted.length,
          llm: llmCount,
          fallback: localCount,
          dropped,
          clean: dropped === 0 && localCount === 0,
        };
        return res.status(201).json({ set: setData, questions: inserted, generation });
      }
      return res.status(400).json({error:'Invalid request'});
    }
    if(req.method==='DELETE'){
      const id = req.query.id || req.body?.id;
      const setId = req.query.set_id || req.body?.set_id;
      if(id){
        const { error } = await supabase.from('questions').delete().eq('id', id);
        if(error) throw error;
        return res.status(200).json({ok:true});
      }
      if(setId){
        const { error } = await supabase.from('questions').delete().eq('set_id', setId);
        if(error) throw error;
        return res.status(200).json({ok:true});
      }
      return res.status(400).json({error:'id or set_id required'});
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){
    console.error('questions handler', err);
    res.status(500).json({error: String(err.message||'failed').slice(0,900)});
 }
}

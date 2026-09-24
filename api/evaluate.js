import supabase from './db-client.js';
import { callModel } from './free-llm.js';

// Lone backslashes from chemistry text break JSON.parse — escape only those
// that don't start a valid JSON escape sequence.
function repairJson(blob) {
  return blob.replace(/\\(?![\"\\/bfnrtu])/g, '\\\\');
}

// Normalize STEM answers before comparison: whitespace/case/arrow/format tolerant.
function normStem(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[₂]/g, '_2').replace(/[₃]/g, '_3').replace(/[₄]/g, '_4')
    .replace(/[²]/g, '^2').replace(/[³]/g, '^3')
    .replace(/<=>|⇌|↔/g, '->').replace(/=>|→|⟶/g, '->').replace(/←/g, '<-')
    .replace(/\\vec\{([a-z])\}/g, '$1').replace(/[\s_^*]+/g, '')
    .replace(/[,;]+/g, '')
    .trim();
}

// Extract ring-containing SMILES-like tokens (c1ccccc1, C1CCCCC1, ...).
function extractSmiles(s) {
  const out = [];
  const re = /(?<![A-Za-z0-9])(?=[A-Za-z0-9\[])([A-Za-z0-9@+\-#=\(\)\[\]\/\\%.]{4,120})(?![A-Za-z0-9])/g;
  let m;
  while ((m = re.exec(String(s || ''))) !== null) {
    const tok = m[1];
    if (/\d/.test(tok) && /[Cc]/.test(tok)) out.push(tok);
    if (out.length >= 6) break;
  }
  return [...new Set(out)];
}

// Authoritative SMILES equivalence lives in Python (RDKit). This Node
// fallback scores exact normalized matches only — equivalent-but-rewritten
// SMILES (aromatic vs Kekule) still earn credit via the AI path + name match.
function smilesEqual(a, b) {
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  return norm(a) === norm(b);
}

// Local WHY evaluation — grounded in the question's chunk, still explains the conceptual gap
function localEvaluate(question, studentAnswer){
  const qa = (question.correct_answer||'').toLowerCase();
  const sa = (studentAnswer||'').toLowerCase().trim();
  const points = question.points || 10;
  if(!sa || sa.length < 2){
    return { is_correct:false, score:0, feedback: `No substantive answer — the grounded chunk notes: "${(question.grounding_chunk||'').slice(0,120)}…". Gemma flags missing engagement with the cited source.`, conceptual_gap: "Gap: Absence of retrieval — re-read the cited chunk and restate the core idea in one sentence focusing on WHY." }
  }
  // Cyclic-structure answers: identical SMILES (formatting ignored) = full credit.
  const expSmiles = extractSmiles(question.correct_answer);
  const gotSmiles = extractSmiles(studentAnswer);
  if (expSmiles.length && gotSmiles.some((g) => expSmiles.some((e) => smilesEqual(g, e)))) {
    return { is_correct: true, score: points,
      feedback: `Correct — your structure matches the grounded answer "${question.correct_answer.slice(0,120)}" (chunk: "${(question.grounding_chunk||'').slice(0,90)}…").`,
      conceptual_gap: "No gap. Stretch: name one isomer and explain how its properties differ." };
  }
  if(question.question_type==='mcq'){
    const isCorrect = sa===qa || qa.includes(sa.slice(0,12)) || sa.includes(qa.slice(0,12));
    // also check option equality
    try{
      const opts = question.options ? JSON.parse(question.options) : [];
      const match = opts.find(o=> String(o).toLowerCase().trim()===sa);
      if(match){
        // precise option match
        const correct = String(question.correct_answer).toLowerCase().trim()===sa;
        if(correct) return { is_correct:true, score: points, feedback: `Correct — aligns with the grounded source: "${(question.grounding_chunk||'').slice(0,110)}…". You discriminated the diagnostic distractors.`, conceptual_gap: "No gap. Stretch: write one sentence for why each distractor is wrong." };
        else return { is_correct:false, score:0, feedback: `Your choice "${studentAnswer}" does not match the grounded expectation "${question.correct_answer}". The chunk states: "${(question.grounding_chunk||'').slice(0,120)}…".`, conceptual_gap: "Misconception: distractor maps to surface familiarity, not the grounded principle. Annotate the chunk and explain why the correct option follows from it." };
      }
    }catch{}
    if(isCorrect) return { is_correct:true, score: points, feedback: `Correct — matches the grounded answer and the chunk: "${(question.grounding_chunk||'').slice(0,110)}…".`, conceptual_gap: "No gap. Next: link this concept to a concrete example from the lecture." };
    return { is_correct:false, score:0, feedback: `Not aligned with the grounded answer "${question.correct_answer}". Grounded source: "${(question.grounding_chunk||'').slice(0,120)}…".`, conceptual_gap: "Gap: shallow pattern match vs grounded reasoning. Re-read the chunk and justify the correct choice in one sentence." };
  }
  // short / conceptual — keyword + STEM-formula coverage, but always WHY.
  // Old code split on \W+ and dropped symbols (H2SO4 fragments, ∫, x^2).
  const keywords = qa.split(/\W+/).filter(w=>w.length>4).slice(0,6);
  const formulas = [...new Set([
    ...(String(question.correct_answer||'').match(/(?:[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)*|\\vec\{[A-Za-z]+\}|d\/d\w+|[A-Za-z]\^[\w(]+|∫|∂)/g) || []),
  ])].slice(0,6);
  const matched = keywords.filter(k=> sa.includes(k)).length;
  const matchedFormulas = formulas.filter(f=> normStem(studentAnswer).includes(normStem(f))).length;
  // Exact STEM match (formula/equation tolerant to formatting) = full credit.
  if (formulas.length > 0 && normStem(studentAnswer) && normStem(question.correct_answer) &&
      (normStem(studentAnswer) === normStem(question.correct_answer) ||
       normStem(studentAnswer).includes(normStem(question.correct_answer)) ||
       normStem(question.correct_answer).includes(normStem(studentAnswer)))) {
    return { is_correct: true, score: points,
      feedback: `Correct — symbolic match with the grounded answer "${question.correct_answer.slice(0,120)}" (chunk: "${(question.grounding_chunk||'').slice(0,90)}…"). Formatting differences ignored.`,
      conceptual_gap: "No gap. Stretch: derive the result one alternative way." };
  }
  const coverage = (matched + matchedFormulas) / Math.max(1, keywords.length + formulas.length);
  if(coverage >= 0.65){
    const sc = coverage>=0.85 ? points : Math.round(points*0.6);
    return {
      is_correct: coverage>=0.7,
      score: sc,
      feedback: coverage>=0.85 ? `Strong — you hit ${matched}/${keywords.length} key ideas (${keywords.slice(0,3).join(', ')}) and track the grounded chunk: "${(question.grounding_chunk||'').slice(0,100)}…".` : `Partial — ${matched}/${keywords.length} core ideas present but missing nuance: expected direction "${question.correct_answer.slice(0,120)}…" (chunk: "${(question.grounding_chunk||'').slice(0,90)}…").`,
      conceptual_gap: coverage>=0.85 ? "Minor gap: expression depth — connect the idea to a concrete example to cement transfer." : `Gap: incomplete conceptual chain. You covered ${matched} ideas yet missed the link the chunk stresses. Next: rewrite adding the missing link in one sentence.`
    }
  }
  // low coverage — conceptual misunderstanding, explain WHY
  let why = "Answer diverges from the grounded source — indicates retrieval without grounding.";
  if(String(question.concept_tag||'').toLowerCase().includes('overfit') || qa.includes('generalization')) why = "Classic overfitting fallacy: training accuracy ≠ generalization — variance and validation matter per the chunk.";
  else if(String(question.concept_tag||'').toLowerCase().includes('paradigm')) why = "Paradigms conflated: theory-driven (interpretable/low-data) vs data-driven (perceptual/large-data) — trade-off missed.";
  else if(String(question.concept_tag||'').toLowerCase().includes('iterat')) why = "Feedback-loop rationale missed — single-pass cannot revise early errors per the iterative chunk.";
  return {
    is_correct:false,
    score: Math.round(points*0.2),
    feedback: `Grounded expectation: "${question.correct_answer.slice(0,140)}…" (chunk: "${(question.grounding_chunk||'').slice(0,100)}…"). Your answer "${studentAnswer.slice(0,120)}…" diverges from that lineage.`,
    conceptual_gap: why + " Action: re-read the cited chunk, then explain the concept to a peer in 30s focusing on WHY."
  }
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='POST'){
      const { submission_id } = req.body;
      if(!submission_id) return res.status(400).json({error:'submission_id required'});
      const { data: answers, error: aErr } = await supabase.from('answers').select('*').eq('submission_id', submission_id);
      if(aErr) throw aErr;
      const qIds = answers.map(a=>a.question_id);
      const { data: questions, error: qErr } = await supabase.from('questions').select('*').in('id', qIds.length? qIds:[0]);
      if(qErr) throw qErr;
      const qMap = Object.fromEntries(questions.map(q=>[q.id,q]));
      let totalScore=0, maxTotal=0;
      const evaluations=[];
      for(const ans of answers){
        const q = qMap[ans.question_id];
        if(!q) continue;
        let parsed = null;
        try{
          const prompt = `You are Gemma 4, evaluator for Next-Gen AI Education Track. Diagnose WHY.\nQUESTION: ${q.question_text}\nType: ${q.question_type} | Concept: ${q.concept_tag} | Difficulty: ${q.difficulty} | Points: ${q.points}\nGrounding: "${(q.grounding_chunk||'').slice(0,500)}"\nExpected: "${(q.correct_answer||'').slice(0,500)}"\n${q.options?`Options: ${q.options}`:''}\nSTUDENT: "${(ans.student_answer||'').slice(0,900)}"\nSTEM RULES: preserve formulas exactly (H2SO4, x^2, ∫..dx, vectors). Accept formatting variants (H_2SO_4=H2SO4, ->=→). For calculations require working, not just the final value; award partial credit for correct setup with arithmetic slip. STRUCTURES: answers may contain SMILES; treat identical SMILES (ignoring whitespace) as correct, and equivalent SMILES with same connectivity (aromatic c1ccccc1 vs Kekule C1=CC=CC=C1) as correct with full credit — never penalize valid resonance spellings.\nReturn ONLY JSON: {"is_correct": bool, "score": int 0..${q.points}, "feedback": "1-2 sentences why marked this way, cite chunk", "conceptual_gap": "diagnose mental model error + tailored next step"} Constructive, precise.`;
          const raw = await callModel(prompt, { temperature: 0.38, maxTokens: 1200, thinkingBudget: 256 });
          if(raw){
            const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
            const blob = (s!==-1 && e!==-1 ? raw.slice(s,e+1) : raw).replace(/```json|```/g,'').trim();
            const tmp = JSON.parse(repairJson(blob));
            if(typeof tmp.is_correct==='boolean' && typeof tmp.score==='number'){
              parsed = { is_correct: !!tmp.is_correct, score: Math.max(0, Math.min(q.points, Math.round(Number(tmp.score)))), feedback: String(tmp.feedback||''), conceptual_gap: String(tmp.conceptual_gap||'') };
            }
          }
        }catch(e){
          // fall through to local
          console.warn('eval API fallback', e.message?.slice(0,200));
        }
        if(!parsed){
          parsed = localEvaluate(q, ans.student_answer);
        }
        maxTotal += q.points; totalScore += parsed.score;
        await supabase.from('answers').update({ is_correct: parsed.is_correct, score: parsed.score, max_score: q.points, feedback: parsed.feedback, conceptual_gap: parsed.conceptual_gap }).eq('id', ans.id);
        evaluations.push({ answer_id: ans.id, is_correct: parsed.is_correct, score: parsed.score, feedback: parsed.feedback, conceptual_gap: parsed.conceptual_gap, question_id: q.id });
      }
      await supabase.from('submissions').update({ score: totalScore, total: maxTotal, status:'evaluated' }).eq('id', submission_id);
      return res.status(200).json({ score: totalScore, total: maxTotal, evaluations });
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){
    console.error(err);
    res.status(500).json({error: String(err.message||'failed').slice(0,900)});
  }
}

import supabase from './db-client.js';

function envKey(){
  console.log('[eval] envKey check:', process.env.GEMINI_API_KEY ? 'FOUND (length: ' + process.env.GEMINI_API_KEY.length + ')' : 'NOT FOUND');
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMMA_API_KEY || process.env.VITE_GEMINI_API_KEY || null;
}
async function viaGemini(prompt){
  const key = envKey();
  if(!key) return null;
  const models=['gemma-4-26b-a4b-it','gemma-4-31b-it','gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash','gemini-2.0-flash-lite','gemini-1.5-flash','gemini-1.5-pro','gemini-1.0-pro'];
  for(const m of models){
    try{
      console.log('[eval] viaGemini: Trying model:', m);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.38,maxOutputTokens:8192}})});
      console.log('[eval] viaGemini: Response status:', r.status);
      if(r.status===404) continue;
      if(!r.ok){
        const t=await r.text();
        console.log('[eval] viaGemini: Error response:', t.slice(0,600));
        if(r.status===400||r.status===403||String(t).toLowerCase().includes('api key')) throw new Error(t.slice(0,600));
        continue;
      }
      const j=await r.json(); 
      const parts = j?.candidates?.[0]?.content?.parts;
      if(parts && parts.length > 0){
        // Handle thinking tokens - find the non-thought part
        let text = '';
        for(const part of parts){
          if(part.text && !part.thought){
            text = part.text;
            break;
          }
        }
        // Fallback to first part if no non-thought part found
        if(!text && parts[0].text){
          text = parts[0].text;
        }
        if(text){
          console.log('[eval] viaGemini: Success, got response length:', text.length);
          return text;
        }
      }
    }catch(e){ 
      console.log('[eval] viaGemini: Error:', e.message?.slice(0,200));
      if(String(e.message).toLowerCase().includes('key')) throw e; 
      continue; 
    }
  }
  return null;
}
async function viaPollinations(prompt){
  const short = prompt.slice(0,1500).replace(/\n/g,' ').trim();
  let tries=0;
  while(tries<4){
    tries++;
    const nonce = Math.floor(Math.random()*9999999);
    const enc = encodeURIComponent(short + ` id:${nonce}`);
    const url = `https://text.pollinations.ai/${enc}?seed=${Math.floor(Math.random()*999999)}`;
    try{
      const res = await fetch(url, { headers:{ 'User-Agent':'EVALU8/2.0' } });
      const text = await res.text();
      if(res.ok && text && !/queue full|payment required/i.test(text) && text.trim().length>10) return text;
      await new Promise(r=>setTimeout(r, 1100*tries));
    }catch(e){ await new Promise(r=>setTimeout(r, 900)); }
  }
  return null;
}
async function callModel(prompt){
  const t1 = await viaGemini(prompt);
  if(t1) return t1;
  const t2 = await viaPollinations(prompt);
  if(t2) return t2;
  return null;
}

// Local WHY evaluation — grounded in the question's chunk, still explains the conceptual gap
function localEvaluate(question, studentAnswer){
  const qa = (question.correct_answer||'').toLowerCase();
  const sa = (studentAnswer||'').toLowerCase().trim();
  const points = question.points || 10;
  if(!sa || sa.length < 2){
    return { is_correct:false, score:0, feedback: `No substantive answer — the grounded chunk notes: "${(question.grounding_chunk||'').slice(0,120)}…". Gemma flags missing engagement with the cited source.`, conceptual_gap: "Gap: Absence of retrieval — re-read the cited chunk and restate the core idea in one sentence focusing on WHY." }
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
  // short / conceptual — keyword coverage + length heuristics, but always WHY
  const keywords = qa.split(/\W+/).filter(w=>w.length>4).slice(0,6);
  const matched = keywords.filter(k=> sa.includes(k)).length;
  const coverage = matched / Math.max(1, keywords.length);
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
          const prompt = `You are Gemma 4, evaluator for Next-Gen AI Education Track. Diagnose WHY.\nQUESTION: ${q.question_text}\nType: ${q.question_type} | Concept: ${q.concept_tag} | Difficulty: ${q.difficulty} | Points: ${q.points}\nGrounding: "${(q.grounding_chunk||'').slice(0,500)}"\nExpected: "${(q.correct_answer||'').slice(0,500)}"\n${q.options?`Options: ${q.options}`:''}\nSTUDENT: "${(ans.student_answer||'').slice(0,900)}"\nReturn ONLY JSON: {"is_correct": bool, "score": int 0..${q.points}, "feedback": "1-2 sentences why marked this way, cite chunk", "conceptual_gap": "diagnose mental model error + tailored next step"} Constructive, precise.`;
          const raw = await callModel(prompt);
          if(raw){
            const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
            const blob = (s!==-1 && e!==-1 ? raw.slice(s,e+1) : raw).replace(/```json|```/g,'').trim();
            const tmp = JSON.parse(blob);
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

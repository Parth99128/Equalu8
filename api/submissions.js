import supabase from './db-client.js';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='GET'){
      const { set_id, document_id, student_id } = req.query;
      let q = supabase.from('submissions').select('*').order('submitted_at',{ascending:false});
      if(set_id) q = q.eq('set_id', set_id);
      if(document_id) q = q.eq('document_id', document_id);
      if(student_id) q = q.eq('student_id', student_id);
      const { data, error } = await q;
      if(error) throw error;
      return res.status(200).json(data);
    }
    if(req.method==='POST'){
      const { student_id, set_id, document_id, answers } = req.body;
      // create submission with answers
      const { data: sub, error: sErr } = await supabase.from('submissions').insert({ student_id, set_id, document_id, answers: answers || [], status:'submitted', score:0, total:0 }).select().single();
      if(sErr) throw sErr;
      // insert answers
      if(answers && answers.length){
        const rows = answers.map(a=>({
          submission_id: sub.id,
          question_id: a.question_id,
          student_answer: a.student_answer,
          is_correct: false,
          score: 0,
          max_score: a.max_score||10,
          feedback: null,
          conceptual_gap: null
        }));
        const { error: aErr } = await supabase.from('answers').insert(rows);
        if(aErr) throw aErr;
      }
      return res.status(201).json(sub);
    }
    if(req.method==='PUT'){
      const { id, score, total, status } = req.body;
      const { data, error } = await supabase.from('submissions').update({ score, total, status }).eq('id', id).select().single();
      if(error) throw error;
      return res.status(200).json(data);
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){ console.error(err); res.status(500).json({error: err.message}); }
}

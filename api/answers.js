import supabase from './db-client.js';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='GET'){
      const { submission_id } = req.query;
      let q = supabase.from('answers').select('*').order('id');
      if(submission_id) q = q.eq('submission_id', submission_id);
      const { data, error } = await q;
      if(error) throw error;
      return res.status(200).json(data);
    }
    if(req.method==='PUT'){
      const { id, is_correct, score, feedback, conceptual_gap } = req.body;
      const { data, error } = await supabase.from('answers').update({ is_correct, score, feedback, conceptual_gap }).eq('id', id).select().single();
      if(error) throw error;
      return res.status(200).json(data);
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){ res.status(500).json({error: err.message}); }
}

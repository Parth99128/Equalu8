import supabase from './db-client.js';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='GET'){
      const { document_id } = req.query;
      let q = supabase.from('question_sets').select('*').order('created_at',{ascending:false});
      if(document_id) q = q.eq('document_id', document_id);
      const { data, error } = await q;
      if(error) throw error;
      return res.status(200).json(data);
    }
    if(req.method==='POST'){
      const { document_id, total_questions } = req.body;
      const { data, error } = await supabase.from('question_sets').insert({ document_id, total_questions }).select().single();
      if(error) throw error;
      return res.status(201).json(data);
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){ res.status(500).json({error: err.message}); }
}

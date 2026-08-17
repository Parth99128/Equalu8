import supabase from './db-client.js';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='GET'){
      const { document_id, published_only } = req.query;
      let q = supabase.from('question_sets').select('*').order('created_at',{ascending:false});
      if(document_id) q = q.eq('document_id', document_id);
      if(published_only === 'true') q = q.eq('is_published', true);
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
    if(req.method==='PUT'){
      // Update publishing / scheduling fields — does NOT touch question generation
      const { id, is_published, due_date, time_limit_minutes } = req.body;
      if(!id) return res.status(400).json({error:'id required'});
      const updates = {};
      if(typeof is_published === 'boolean') {
        updates.is_published = is_published;
        updates.published_at = is_published ? new Date().toISOString() : null;
      }
      if(due_date !== undefined) updates.due_date = due_date || null;
      if(time_limit_minutes !== undefined) updates.time_limit_minutes = time_limit_minutes || null;
      const { data, error } = await supabase.from('question_sets').update(updates).eq('id', id).select().single();
      if(error) throw error;
      return res.status(200).json(data);
    }
    if(req.method==='DELETE'){
      const id = req.query.id || req.body?.id;
      if(!id) return res.status(400).json({error:'id required'});
      // Cascade: deleting the set cascades to questions (FK ON DELETE CASCADE)
      const { error } = await supabase.from('question_sets').delete().eq('id', id);
      if(error) throw error;
      return res.status(200).json({ok:true});
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){ res.status(500).json({error: err.message}); }
}

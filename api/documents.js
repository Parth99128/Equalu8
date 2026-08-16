import supabase from './db-client.js';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='GET'){
      const { data, error } = await supabase.from('documents').select('*').order('uploaded_at',{ascending:false});
      if(error) throw error;
      return res.status(200).json(data);
    }
    if(req.method==='POST'){
      const { title, original_name, content, chunks, status } = req.body;
      const { data, error } = await supabase.from('documents').insert({ title, original_name, content, chunks: chunks || [], status: status||'parsed' }).select().single();
      if(error) throw error;
      return res.status(201).json(data);
    }
    if(req.method==='DELETE'){
      const { id } = req.body;
      const { error } = await supabase.from('documents').delete().eq('id', id);
      if(error) throw error;
      return res.status(200).json({ok:true});
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){ console.error(err); res.status(500).json({error: err.message}); }
}

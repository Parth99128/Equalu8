import supabase from './db-client.js';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='GET'){
      const { data, error } = await supabase.from('students').select('*').order('id');
      if(error) throw error;
      return res.status(200).json(data);
    }
    if(req.method==='POST'){
      const { name, email, avatar } = req.body;
      const { data, error } = await supabase.from('students').insert({ name, email, avatar }).select().single();
      if(error) throw error;
      return res.status(201).json(data);
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){ res.status(500).json({error: err.message}); }
}

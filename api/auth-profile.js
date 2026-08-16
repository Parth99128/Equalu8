import supabase from './db-client.js';
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  try{
    if(req.method==='GET'){
      const { id, email } = req.query;
      let q = supabase.from('profiles').select('*');
      if(id) q = q.eq('id', id);
      if(email) q = q.eq('email', email);
      const { data, error } = await q;
      if(error) throw error;
      return res.status(200).json(data);
    }
    if(req.method==='POST'){
      const { id, email, name, role, avatar } = req.body;
      if(!email || !role) return res.status(400).json({error:'email and role required'});
      const { data: existing } = await supabase.from('profiles').select('*').eq('email', email).limit(1);
      if(existing && existing.length){
        return res.status(200).json(existing[0]);
      }
      const { data, error } = await supabase.from('profiles').insert({ id: id||email, email, name: name||email.split('@')[0], role, avatar: avatar||`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name||email)}` }).select().single();
      if(error) throw error;
      return res.status(201).json(data);
    }
    if(req.method==='PUT'){
      const { id, name, role, avatar } = req.body;
      const { data, error } = await supabase.from('profiles').update({ name, role, avatar }).eq('id', id).select().single();
      if(error) throw error;
      return res.status(200).json(data);
    }
    res.status(405).json({error:'Method not allowed'});
  }catch(err){ console.error(err); res.status(500).json({error: err.message}); }
}

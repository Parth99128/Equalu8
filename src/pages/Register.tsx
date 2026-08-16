import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GraduationCap, School, Mail, Lock, User, Eye, EyeOff, AlertTriangle, Sparkles, Atom } from 'lucide-react'
import supabase from '../lib/supabase'
import { signInWithGoogle } from '../lib/googleAuth'
import { useAuth } from '../contexts/AuthContext'
export default function Register(){
  const [role, setRole] = useState<'teacher'|'student'>('teacher')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState<string|null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const ensureProfile = async (uid:string, email:string, name:string, r:string, avatar?:string)=>{
    await fetch('/api/auth-profile',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: uid, email, name, role: r, avatar })})
    await refreshProfile()
    if(r==='student') await fetch('/api/students',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, email, avatar })})
  }
  const handle = async (e:any)=>{
    e.preventDefault(); setErr(null); setBusy(true)
    try{
      if(!name.trim()) throw new Error('Enter your full name')
      if(!email || !password) throw new Error('Email and password required')
      if(password.length<6) throw new Error('Password must be at least 6 characters')
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options:{ data:{ name: name.trim(), role } } })
      if(error) throw error
      if(data.user){ await ensureProfile(data.user.id, email.trim(), name.trim(), role); navigate(role==='teacher'? '/teacher/ingest' : '/student/assignments') }
    }catch(e:any){ setErr(e.message)} finally{ setBusy(false)}
  }
  const handleGoogle = (r:'teacher'|'student')=>{
    localStorage.setItem('evalu8_pendingRole', r)
    signInWithGoogle('EVALU8')
    let tries=0
    const iv=setInterval(async()=>{
      tries++
      const { data:{ session } } = await supabase.auth.getSession()
      if(session?.user){
        clearInterval(iv)
        const a = await fetch(`/api/auth-profile?id=${session.user.id}`).then(x=>x.json()).catch(()=>[])
        const b = await fetch(`/api/auth-profile?email=${encodeURIComponent(session.user.email!)}`).then(x=>x.json()).catch(()=>[])
        const exists=(a&&a.length)||(b&&b.length)
        if(!exists){
          const pending=(localStorage.getItem('evalu8_pendingRole') as any)||r
          await ensureProfile(session.user.id, session.user.email!, session.user.user_metadata?.full_name||session.user.user_metadata?.name||session.user.email!.split('@')[0], pending, session.user.user_metadata?.avatar_url)
        } else await refreshProfile()
        localStorage.removeItem('evalu8_pendingRole')
        navigate(r==='teacher'? '/teacher/ingest' : '/student/assignments')
      }
      if(tries>14) clearInterval(iv)
    },1100)
  }
  return (
    <div className="min-h-screen bg-[#fcfcfd]" style={{fontFamily:"'Plus Jakarta Sans', sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');`}</style>
      <div className="max-w-[980px] mx-auto px-4 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-black"><span className="w-9 h-9 rounded-xl bg-zinc-900 text-white grid place-items-center text-xs">E8</span> EVALU8</Link>
        <div className="mt-8 grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2">
            <h1 className="text-2xl font-black tracking-tight">Create account</h1>
            <p className="text-sm text-zinc-500 mt-1">Separate portals ensure students and teachers see only their tools.</p>
            <div className="mt-6 grid grid-cols-2 gap-2">
              {[
                {id:'teacher', label:'Teacher', icon: GraduationCap, grad:'from-violet-600 to-indigo-600'},
                {id:'student', label:'Student', icon: School, grad:'from-emerald-600 to-teal-600'},
              ].map(x=>(
                <button key={x.id} onClick={()=>setRole(x.id as any)} className={`text-left p-4 rounded-2xl border-2 ${role===x.id?'border-zinc-900 bg-zinc-900 text-white shadow':'bg-white border-zinc-200'}`}>
                  <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${x.grad} text-white grid place-items-center mb-2`}><x.icon size={16}/></div>
                  <div className="text-sm font-black">{x.label}</div>
                  <div className={`text-xs ${role===x.id?'text-zinc-300':'text-zinc-500'}`}>{x.id==='teacher'?'Ingest & grade':'Take tests & learn'}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="bg-white rounded-[28px] border shadow-xl overflow-hidden">
              <div className="px-6 pt-6 flex items-center justify-between"><h2 className="font-black">{role==='teacher'?'Teacher registration':'Student registration'}</h2><div className="w-8 h-8 rounded-full bg-zinc-900 text-white grid place-items-center"><Atom size={14}/></div></div>
              <form onSubmit={handle} className="px-6 py-6 space-y-3">
                <label className="block"><span className="text-[11px] font-bold tracking-widest text-zinc-500">FULL NAME</span><div className="mt-1 relative"><User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"/><input value={name} onChange={e=>setName(e.target.value)} placeholder={role==='teacher'?'Dr. Anya Rao':'Aarav Mehta'} className="w-full pl-9 pr-3 py-2.5 rounded-xl border bg-zinc-50 focus:bg-white outline-none text-sm"/></div></label>
                <label className="block"><span className="text-[11px] font-bold tracking-widest text-zinc-500">EMAIL</span><div className="mt-1 relative"><Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder={role==='teacher'?'teacher@university.edu':'student@university.edu'} className="w-full pl-9 pr-3 py-2.5 rounded-xl border bg-zinc-50 focus:bg-white outline-none text-sm"/></div></label>
                <label className="block"><span className="text-[11px] font-bold tracking-widest text-zinc-500">PASSWORD</span><div className="mt-1 relative"><Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"/><input type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" className="w-full pl-9 pr-9 py-2.5 rounded-xl border bg-zinc-50 focus:bg-white outline-none text-sm"/><button type="button" onClick={()=>setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-zinc-100">{show?<EyeOff size={14}/>:<Eye size={14}/>}</button></div><div className="text-[11px] text-zinc-500 mt-1">Min 6 characters. Role is locked to your portal.</div></label>
                {err && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-xs font-semibold flex gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5"/>{err}</div>}
                <button type="submit" disabled={busy} className="w-full py-3 rounded-full bg-zinc-900 text-white font-black text-sm disabled:opacity-60 flex items-center justify-center gap-2">{busy? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Creating…</> : <><Sparkles size={16}/> Create {role} account</>}</button>
                <div className="relative py-2"><div className="absolute inset-0 flex items-center"><div className="w-full border-t"/></div><div className="relative flex justify-center"><span className="bg-white px-3 text-[11px] font-bold tracking-widest text-zinc-500">OR</span></div></div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={()=>handleGoogle('teacher')} className="py-2.5 rounded-full border bg-white text-xs font-bold flex items-center justify-center gap-2"><img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-4 h-4" alt="g"/> Teacher Google</button>
                  <button type="button" onClick={()=>handleGoogle('student')} className="py-2.5 rounded-full border bg-white text-xs font-bold flex items-center justify-center gap-2"><img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-4 h-4" alt="g"/> Student Google</button>
                </div>
                <div className="text-center text-xs text-zinc-500 pt-2">Have an account? <Link to="/login" className="font-black text-zinc-900 underline">Sign in</Link></div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Database, Layers, ClipboardList, BarChart3, LogOut, Cpu } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
export default function TeacherLayout(){
  const { profile, logout } = useAuth()
  const navigate = useNavigate()
  const handleLogout = async()=>{ await logout(); navigate('/')}
  return (
    <div className="min-h-screen bg-[#fcfcfd]" style={{fontFamily:"'Plus Jakarta Sans', sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');`}</style>
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/90 border-b">
        <div className="max-w-[1360px] mx-auto px-4 lg:px-6 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white grid place-items-center font-black text-xs">E8</div>
            <div>
              <div className="font-black tracking-tight flex items-center gap-2 text-sm">EVALU8 <span className="text-[10px] font-bold tracking-widest bg-violet-600 text-white px-2 py-0.5 rounded-full">TEACHER</span><span className="hidden lg:inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 border"><Cpu size={10}/> GEMMA 4</span></div>
              <div className="text-[11px] text-zinc-500 -mt-0.5 hidden sm:block">Studio • Grounded Evaluation</div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1 p-1 bg-zinc-900 rounded-full">
            <NavLink to="/teacher/ingest" className={({isActive})=> `px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${isActive?'bg-white text-zinc-900':'text-zinc-400 hover:text-white'}`}><Database size={14}/> Ingest</NavLink>
            <NavLink to="/teacher/sets" className={({isActive})=> `px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${isActive?'bg-white text-zinc-900':'text-zinc-400 hover:text-white'}`}><Layers size={14}/> Question Sets</NavLink>
            <NavLink to="/teacher/submissions" className={({isActive})=> `px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${isActive?'bg-white text-zinc-900':'text-zinc-400 hover:text-white'}`}><ClipboardList size={14}/> Submissions</NavLink>
            <NavLink to="/teacher/analytics" className={({isActive})=> `px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${isActive?'bg-white text-zinc-900':'text-zinc-400 hover:text-white'}`}><BarChart3 size={14}/> Analytics</NavLink>
          </nav>
          <div className="flex items-center gap-2">
            <img src={profile?.avatar} className="w-8 h-8 rounded-full object-cover border" alt="t"/>
            <div className="hidden lg:block text-left"><div className="text-xs font-black leading-none">{profile?.name}</div><div className="text-[11px] text-zinc-500">{profile?.email}</div></div>
            <button onClick={handleLogout} className="p-2 rounded-full hover:bg-zinc-100"><LogOut size={16}/></button>
          </div>
        </div>
        <div className="md:hidden max-w-[1360px] mx-auto px-4 pb-3">
          <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-900 rounded-2xl">
            <NavLink to="/teacher/ingest" className={({isActive})=> `py-2 rounded-xl text-xs font-bold flex flex-col items-center gap-1 ${isActive?'bg-white text-zinc-900':'text-zinc-400'}`}><Database size={14}/>Ingest</NavLink>
            <NavLink to="/teacher/sets" className={({isActive})=> `py-2 rounded-xl text-xs font-bold flex flex-col items-center gap-1 ${isActive?'bg-white text-zinc-900':'text-zinc-400'}`}><Layers size={14}/>Sets</NavLink>
            <NavLink to="/teacher/submissions" className={({isActive})=> `py-2 rounded-xl text-xs font-bold flex flex-col items-center gap-1 ${isActive?'bg-white text-zinc-900':'text-zinc-400'}`}><ClipboardList size={14}/>Grade</NavLink>
            <NavLink to="/teacher/analytics" className={({isActive})=> `py-2 rounded-xl text-xs font-bold flex flex-col items-center gap-1 ${isActive?'bg-white text-zinc-900':'text-zinc-400'}`}><BarChart3 size={14}/>Stats</NavLink>
          </div>
        </div>
      </header>
      <main className="max-w-[1360px] mx-auto px-4 lg:px-6 py-6"><Outlet/></main>
    </div>
  )
}

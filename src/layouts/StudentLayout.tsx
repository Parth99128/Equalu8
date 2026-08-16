import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Library, PencilRuler, MessageSquareQuote, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
export default function StudentLayout(){
  const { profile, logout } = useAuth()
  const navigate = useNavigate()
  const handleLogout = async()=>{ await logout(); navigate('/')}
  return (
    <div className="min-h-screen bg-[#f6faf7]" style={{fontFamily:"'Plus Jakarta Sans', sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');`}</style>
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/90 border-b border-emerald-100">
        <div className="max-w-[1360px] mx-auto px-4 lg:px-6 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white grid place-items-center font-black text-xs">E8</div>
            <div>
              <div className="font-black tracking-tight flex items-center gap-2 text-sm">EVALU8 <span className="text-[10px] font-bold tracking-widest bg-emerald-600 text-white px-2 py-0.5 rounded-full">STUDENT</span></div>
              <div className="text-[11px] text-zinc-500 -mt-0.5 hidden sm:block">My assignments • Feedback</div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1 p-1 bg-zinc-900 rounded-full">
            <NavLink to="/student/assignments" className={({isActive})=> `px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${isActive?'bg-white text-zinc-900':'text-zinc-400 hover:text-white'}`}><Library size={14}/> Assignments</NavLink>
            <NavLink to="/student/feedback" className={({isActive})=> `px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${isActive?'bg-white text-zinc-900':'text-zinc-400 hover:text-white'}`}><MessageSquareQuote size={14}/> My Feedback</NavLink>
          </nav>
          <div className="flex items-center gap-2">
            <img src={profile?.avatar} className="w-8 h-8 rounded-full object-cover border" alt="me"/>
            <div className="hidden lg:block text-left"><div className="text-xs font-black leading-none">{profile?.name}</div><div className="text-[11px] text-zinc-500">{profile?.email}</div></div>
            <button onClick={handleLogout} className="p-2 rounded-full hover:bg-zinc-100"><LogOut size={16}/></button>
          </div>
        </div>
        <div className="md:hidden max-w-[1360px] mx-auto px-4 pb-3">
          <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-900 rounded-2xl">
            <NavLink to="/student/assignments" className={({isActive})=> `py-2 rounded-xl text-xs font-bold flex flex-col items-center gap-1 ${isActive?'bg-white text-zinc-900':'text-zinc-400'}`}><Library size={14}/>Assignments</NavLink>
            <NavLink to="/student/feedback" className={({isActive})=> `py-2 rounded-xl text-xs font-bold flex flex-col items-center gap-1 ${isActive?'bg-white text-zinc-900':'text-zinc-400'}`}><MessageSquareQuote size={14}/>Feedback</NavLink>
          </div>
        </div>
      </header>
      <main className="max-w-[1360px] mx-auto px-4 lg:px-6 py-6"><Outlet/></main>
    </div>
  )
}

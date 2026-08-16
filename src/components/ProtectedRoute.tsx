import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
export default function ProtectedRoute({ role, children }: { role?: 'teacher' | 'student', children: React.ReactNode }){
  const { user, profile, loading } = useAuth()
  if(loading) return <div className="min-h-screen grid place-items-center bg-[#fcfcfd]"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 border-[3px] border-zinc-900 border-t-transparent rounded-full animate-spin"/><span className="text-sm font-bold text-zinc-500">Loading…</span></div></div>
  if(!user || !profile) return <Navigate to="/login" replace />
  if(role && profile.role !== role){
    return <Navigate to={profile.role==='teacher' ? '/teacher/ingest' : '/student/assignments'} replace />
  }
  return <>{children}</>
}

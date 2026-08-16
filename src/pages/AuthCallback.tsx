import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import supabase from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Supabase automatically handles the OAuth callback and sets the session
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('[AuthCallback] Session error:', error.message)
          navigate('/login?error=oauth_failed')
          return
        }

        if (session?.user) {
          // Check if profile exists
          const [byId, byEmail] = await Promise.all([
            fetch(`/api/auth-profile?id=${session.user.id}`).then(r => r.json()).catch(() => []),
            fetch(`/api/auth-profile?email=${encodeURIComponent(session.user.email!)}`).then(r => r.json()).catch(() => [])
          ])
          
          const exists = (byId && byId.length) || (byEmail && byEmail.length)
          
          if (!exists) {
            const pendingRole = (localStorage.getItem('evalu8_pendingRole') as 'teacher' | 'student') || 'teacher'
            await fetch('/api/auth-profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: session.user.id,
                email: session.user.email!,
                name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email!.split('@')[0],
                role: pendingRole,
                avatar: session.user.user_metadata?.avatar_url
              })
            })
            
            if (pendingRole === 'student') {
              await fetch('/api/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email!.split('@')[0],
                  email: session.user.email!,
                  avatar: session.user.user_metadata?.avatar_url
                })
              })
            }
            
            localStorage.removeItem('evalu8_pendingRole')
          }
          
          await refreshProfile()
          
          const profile = (byId && byId[0]) || (byEmail && byEmail[0])
          const targetRole = profile?.role || (localStorage.getItem('evalu8_pendingRole') as 'teacher' | 'student') || 'teacher'
          navigate(targetRole === 'teacher' ? '/teacher/ingest' : '/student/assignments')
        } else {
          navigate('/login?error=no_session')
        }
      } catch (e) {
        console.error('[AuthCallback] Error:', e)
        navigate('/login?error=callback_error')
      }
    }
    
    handleCallback()
  }, [navigate, refreshProfile])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fcfcfd]">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-zinc-600 font-medium">Completing sign in...</p>
      </div>
    </div>
  )
}
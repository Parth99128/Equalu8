import { createContext, useContext, useEffect, useState } from 'react'
import supabase from '../lib/supabase'
type Profile = { id:string, email:string, name:string, role:'teacher'|'student', avatar:string }
type AuthCtx = { user:any, profile: Profile|null, loading:boolean, isTeacher:boolean, isStudent:boolean, refreshProfile:()=>Promise<void>, logout:()=>Promise<void> }
const AuthContext = createContext<AuthCtx>({ user:null, profile:null, loading:true, isTeacher:false, isStudent:false, refreshProfile: async()=>{}, logout: async()=>{} })
export function AuthProvider({children}:{children:any}){
  const [user,setUser]=useState<any>(null)
  const [profile,setProfile]=useState<Profile|null>(null)
  const [loading,setLoading]=useState(true)
  const fetchProfile = async (uid:string, email:string)=>{
    try{
      const res = await fetch(`/api/auth-profile?id=${encodeURIComponent(uid)}`)
      const data = await res.json()
      if(Array.isArray(data) && data.length) setProfile(data[0])
      else {
        // try by email
        const r2 = await fetch(`/api/auth-profile?email=${encodeURIComponent(email)}`)
        const d2 = await r2.json()
        if(Array.isArray(d2) && d2.length) setProfile(d2[0])
      }
    }catch{}
  }
  const refreshProfile = async()=>{
    if(user){
      await fetchProfile(user.id, user.email)
    }
  }
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setUser(session?.user ?? null)
      if(session?.user){ fetchProfile(session.user.id, session.user.email!).finally(()=>setLoading(false)) } else setLoading(false)
    })
    const {data:{subscription}} = supabase.auth.onAuthStateChange(async (_event, session)=>{
      setUser(session?.user ?? null)
      if(session?.user){ await fetchProfile(session.user.id, session.user.email!) }
      else setProfile(null)
      setLoading(false)
    })
    return ()=> subscription.unsubscribe()
  },[])
  const logout = async()=>{ await supabase.auth.signOut(); setProfile(null); setUser(null) }
  return <AuthContext.Provider value={{user, profile, loading, isTeacher: profile?.role==='teacher', isStudent: profile?.role==='student', refreshProfile, logout}}>{children}</AuthContext.Provider>
}
export const useAuth = ()=> useContext(AuthContext)

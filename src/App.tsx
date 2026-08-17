import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import AuthCallback from './pages/AuthCallback'
import TeacherLayout from './layouts/TeacherLayout'
import StudentLayout from './layouts/StudentLayout'
import Ingest from './pages/teacher/Ingest'
import Sets from './pages/teacher/Sets'
import Submissions from './pages/teacher/Submissions'
import Analytics from './pages/teacher/Analytics'
import Materials from './pages/teacher/Materials'
import Assignments from './pages/student/Assignments'
import Attempt from './pages/student/Attempt'
import Feedback from './pages/student/Feedback'
import StudyMaterials from './pages/student/StudyMaterials'

function Toast({ msg }: { msg: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
      className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-4 py-2.5 rounded-full text-xs font-bold shadow-xl flex items-center gap-2 z-50">
      <CheckCircle2 size={14} className="text-emerald-400" />{msg}
    </motion.div>
  )
}

function RoleRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return <div className="min-h-screen grid place-items-center"><div className="w-6 h-6 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" /></div>
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={profile.role === 'teacher' ? '/teacher/ingest' : '/student/assignments'} replace />
}

export default function App() {
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600) }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Teacher routes - fully separate layout & tasks */}
        <Route element={<ProtectedRoute role="teacher"><TeacherLayout /></ProtectedRoute>}>
          <Route path="/teacher/ingest" element={<Ingest onToast={showToast} />} />
          <Route path="/teacher/sets" element={<Sets onToast={showToast} />} />
          <Route path="/teacher/submissions" element={<Submissions onToast={showToast} />} />
          <Route path="/teacher/analytics" element={<Analytics />} />
          <Route path="/teacher/materials" element={<Materials onToast={showToast} />} />
          <Route path="/teacher" element={<Navigate to="/teacher/ingest" replace />} />
        </Route>

        {/* Student routes - fully separate layout & tasks */}
        <Route element={<ProtectedRoute role="student"><StudentLayout /></ProtectedRoute>}>
          <Route path="/student/assignments" element={<Assignments />} />
          <Route path="/student/attempt/:setId" element={<Attempt onToast={showToast} />} />
          <Route path="/student/feedback" element={<Feedback onToast={showToast} />} />
          <Route path="/student/materials" element={<StudyMaterials />} />
          <Route path="/student" element={<Navigate to="/student/assignments" replace />} />
        </Route>

        <Route path="/dashboard" element={<RoleRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <AnimatePresence>{toast && <Toast msg={toast} />}</AnimatePresence>
    </BrowserRouter>
  )
}

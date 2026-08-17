import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Clock } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
export default function Attempt({ onToast }: { onToast:(m:string)=>void }){
  const { setId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [questions, setQuestions] = useState<any[]>([])
  const [docTitle, setDocTitle] = useState('')
  const [answers, setAnswers] = useState<Record<number,string>>({})
  const [students, setStudents] = useState<any[]>([])
  const [setData, setSetData] = useState<any>(null)
  const [timeLeft, setTimeLeft] = useState<number|null>(null)
  const [started, setStarted] = useState(false)
  const submittedRef = useRef(false)
  const parseOptions = (s:string|null)=>{ try{ const j=JSON.parse(s||''); return Array.isArray(j)?j:[] }catch{ return [] }}
  useEffect(()=>{
    if(!setId) return
    Promise.all([
      fetch(`/api/questions?set_id=${setId}`).then(r=>r.json()),
      fetch('/api/students').then(r=>r.json()),
      fetch('/api/documents').then(r=>r.json()),
      fetch('/api/question-sets').then(r=>r.json()),
    ]).then(([qs, sts, docs, sets])=>{
      if(Array.isArray(qs)) setQuestions(qs)
      if(Array.isArray(sts)) setStudents(sts)
      if(Array.isArray(sets)){
        const s = sets.find((x:any)=> x.id===Number(setId))
        setSetData(s)
        if(Array.isArray(docs) && Array.isArray(qs) && qs[0]){
          const doc = docs.find((d:any)=> d.id===qs[0].document_id || d.id===s?.document_id)
          if(doc) setDocTitle(doc.title)
        }
      }
    })
  },[setId])

  const submit = useCallback(async()=>{
    if(!setId) return
    if(!questions.length) return
    const me = students.find(s=> s.email.toLowerCase()===(profile?.email||user?.email||'').toLowerCase())
    const studentId = me?.id
    if(!studentId) return onToast('Identity not found — please re-login')
    const payload = questions.map(q=>({ question_id:q.id, student_answer: answers[q.id]||'', max_score:q.points }))
    // For auto-submit, allow incomplete; for manual submit, require all answered
    if(!submittedRef.current && payload.some(a=>!a.student_answer.trim())) return onToast('Answer all questions')
    const docId = questions[0].document_id
    const r = await fetch('/api/submissions',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ student_id: studentId, set_id: Number(setId), document_id: docId, answers: payload })})
    if(r.ok){ onToast('Submitted for evaluation'); navigate('/student/feedback') } else onToast('Submission failed')
  },[setId, questions, students, profile, user, answers, navigate, onToast])

  // Countdown timer
  useEffect(()=>{
    if(!started || timeLeft===null) return
    if(timeLeft <= 0){
      if(!submittedRef.current){
        submittedRef.current = true
        onToast('Time up — auto-submitting…')
        submit()
      }
      return
    }
    const t = setTimeout(()=> setTimeLeft(prev => prev!==null ? prev-1 : null), 1000)
    return ()=> clearTimeout(t)
  },[started, timeLeft, submit, onToast])

  const formatTime = (s:number)=>{
    const m = Math.floor(s/60), r = s%60
    return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`
  }

  if(!setId) return <div className="bg-white rounded-[24px] border p-8 text-center text-sm">Select a test from <Link to="/student/assignments" className="underline font-bold">Assignments</Link>.</div>

  // Pre-start screen if time limit is set
  if(setData?.time_limit_minutes && !started){
    const isOverdue = setData.due_date && new Date(setData.due_date) < new Date()
    return (
      <div className="max-w-[860px] mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Link to="/student/assignments" className="p-2 rounded-full border bg-white"><ArrowLeft size={14}/></Link>
          <h2 className="font-black">Take Test</h2>
        </div>
        <div className="bg-white rounded-[24px] border p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 grid place-items-center mx-auto"><Clock size={28}/></div>
          <div className="text-lg font-black">Timed Quiz</div>
          <div className="text-sm text-zinc-600">You have <b>{setData.time_limit_minutes} minutes</b> to complete {questions.length} questions.</div>
          {isOverdue ? (
            <div className="text-sm font-bold text-red-600">This quiz is past its due date and can no longer be taken.</div>
          ) : (
            <button onClick={()=>{ setTimeLeft(setData.time_limit_minutes * 60); setStarted(true) }} className="px-8 py-3 rounded-full bg-emerald-600 text-white text-sm font-black">Start Timer & Begin</button>
          )}
          <div className="text-xs text-zinc-500">The quiz will auto-submit when the timer reaches zero.</div>
        </div>
      </div>
    )
  }
  return (
    <div className="max-w-[860px] mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Link to="/student/assignments" className="p-2 rounded-full border bg-white"><ArrowLeft size={14}/></Link>
        <h2 className="font-black">Take Test</h2>
        <span className="text-xs font-bold bg-emerald-600 text-white px-2 py-1 rounded-full">{questions.length} items</span>
      </div>
      {timeLeft!==null && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-xl ${timeLeft<60?'bg-red-600 text-white animate-pulse':'bg-zinc-900 text-white'}`}>
          <Clock size={16}/>
          <span className="text-sm font-black tabular-nums">{formatTime(timeLeft)}</span>
        </div>
      )}
      {questions.length===0 ? (
        <div className="bg-white rounded-[24px] border p-10 text-center">
          <div className="text-sm font-black">No questions in this set</div>
          <div className="text-xs text-zinc-500">Ask your teacher to generate questions.</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-[20px] bg-white border border-emerald-100 p-4 flex items-center justify-between">
            <div><div className="text-sm font-black">{docTitle}</div><div className="text-xs text-zinc-500">Set #{setId} • {questions.length} questions • {questions.reduce((a:any,b:any)=>a+b.points,0)} pts</div></div>
            <div className="text-xs font-bold bg-zinc-900 text-white px-3 py-1 rounded-full">{Object.keys(answers).length}/{questions.length} answered</div>
          </div>
          {questions.map((q:any, idx:number)=>(
            <div key={q.id} className="bg-white rounded-[24px] border p-5">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-zinc-900 text-white grid place-items-center text-xs font-black">{idx+1}</span>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border">{q.concept_tag}</span>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-zinc-100 border">{q.question_type}</span>
                <span className="ml-auto text-xs font-bold text-zinc-500">{q.points} pts</span>
              </div>
              <p className="text-[13.5px] font-semibold leading-relaxed mt-3">{q.question_text}</p>
              {q.question_type==='mcq' ? (
                <div className="mt-3 grid gap-2">
                  {parseOptions(q.options).map((opt:string)=>(
                    <label key={opt} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${answers[q.id]===opt?'bg-emerald-600 text-white border-emerald-600':'bg-zinc-50 hover:bg-white'}`}>
                      <input type="radio" name={`q-${q.id}`} checked={answers[q.id]===opt} onChange={()=>setAnswers(p=>({...p,[q.id]:opt}))} className="accent-emerald-600"/>
                      <span className="text-sm font-medium">{opt}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="mt-3">
                  <textarea value={answers[q.id]||''} onChange={e=>setAnswers(p=>({...p,[q.id]:e.target.value}))} placeholder={q.question_type==='short' ? 'Answer in 2-3 sentences…' : 'Explain the reasoning — Gemma will diagnose WHY…'} rows={q.question_type==='conceptual'?4:3} className="w-full rounded-xl border bg-zinc-50 focus:bg-white outline-none p-3 text-sm resize-none"/>
                  <div className="text-[10px] font-bold text-zinc-500 mt-1 flex items-center gap-1"><MessageSquare size={10}/> Gemma will explain WHY if incomplete • <span className="font-mono">{(answers[q.id]||'').length} chars</span></div>
                </div>
              )}
              <details className="mt-3"><summary className="text-[11px] font-bold tracking-widest text-zinc-500 cursor-pointer">SHOW GROUNDING</summary><div className="mt-2 rounded-xl bg-zinc-50 border p-3 text-xs leading-relaxed">“{q.grounding_chunk}”</div></details>
            </div>
          ))}
          <div className="sticky bottom-4 bg-white border shadow-xl rounded-2xl p-3 flex items-center justify-between">
            <div className="text-xs"><b>{Object.keys(answers).length}/{questions.length} answered</b><div className="text-zinc-500">Submit to receive WHY feedback.</div></div>
            <button onClick={()=>{ submittedRef.current = true; submit() }} className="px-6 py-2.5 rounded-full bg-emerald-600 text-white text-sm font-black">Submit</button>
          </div>
        </div>
      )}
    </div>
  )
}

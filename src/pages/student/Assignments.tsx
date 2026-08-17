import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Library, FileText, ArrowUpRight, Clock, Calendar } from 'lucide-react'
export default function Assignments(){
  const [qsets, setQsets] = useState<any[]>([])
  const [docs, setDocs] = useState<any[]>([])
  const [questions, setQuestions] = useState<any[]>([])
  const [subs, setSubs] = useState<any[]>([])
  const nav = useNavigate()
  useEffect(()=>{
    Promise.all([
      fetch('/api/question-sets?published_only=true').then(r=>r.json()),
      fetch('/api/documents').then(r=>r.json()),
      fetch('/api/questions').then(r=>r.json()),
      fetch('/api/submissions').then(r=>r.json()),
    ]).then(([a,b,c,d])=>{ if(Array.isArray(a)) setQsets(a); if(Array.isArray(b)) setDocs(b); if(Array.isArray(c)) setQuestions(c); if(Array.isArray(d)) setSubs(d)})
  },[])
  const now = new Date()
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-[24px] border border-emerald-100 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between"><h3 className="font-black text-sm flex items-center gap-2"><Library size={16} className="text-emerald-600"/> Available Tests</h3><span className="text-xs font-bold bg-zinc-900 text-white px-2 py-1 rounded-full">{qsets.length} sets</span></div>
        {qsets.length===0 ? (
          <div className="p-10 text-center"><div className="w-12 h-12 rounded-2xl bg-zinc-100 grid place-items-center mx-auto text-zinc-400"><Library size={18}/></div><div className="text-sm font-black mt-3">No tests published yet</div><div className="text-xs text-zinc-500">Your teacher will publish a grounded set after ingesting a syllabus.</div></div>
        ) : (
          <div className="divide-y">
            {qsets.map(s=>{
              const doc = docs.find(d=>d.id===s.document_id)
              const qs = questions.filter(q=>q.set_id===s.id)
              const attempts = subs.filter(x=>x.set_id===s.id)
              const dueDate = s.due_date ? new Date(s.due_date) : null
              const isOverdue = dueDate && dueDate < now
              return (
                <div key={s.id} className="p-5 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 grid place-items-center"><FileText size={18}/></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black truncate">{doc?.title || 'Untitled source'}</div>
                    <div className="text-xs text-zinc-500">{qs.length} questions • {qs.reduce((a:any,b:any)=>a+b.points,0)} pts • {attempts.length} attempts</div>
                    <div className="flex gap-1.5 mt-1 flex-wrap items-center">
                      {qs.slice(0,3).map((q:any)=> <span key={q.id} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white border">{q.concept_tag}</span>)}
                      {s.time_limit_minutes && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border flex items-center gap-1"><Clock size={10}/> {s.time_limit_minutes} min</span>}
                      {dueDate && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${isOverdue?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}><Calendar size={10}/> {isOverdue?'Overdue':dueDate.toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <button onClick={()=>nav(`/student/attempt/${s.id}`)} disabled={isOverdue} className={`px-4 py-2 rounded-full text-xs font-black flex items-center gap-1 ${isOverdue?'bg-zinc-200 text-zinc-400 cursor-not-allowed':'bg-emerald-600 text-white'}`}>{isOverdue?'Closed':<><span>Take</span> <ArrowUpRight size={14}/></>}</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

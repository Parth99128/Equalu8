import { useEffect, useState } from 'react'
import { Brain, AlertTriangle, Lightbulb } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
export default function Feedback({ onToast }: { onToast:(m:string)=>void }){
  const { user, profile } = useAuth()
  const [subs, setSubs] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [docs, setDocs] = useState<any[]>([])
  const [view, setView] = useState<any|null>(null)
  const [answers, setAnswers] = useState<any[]>([])
  const [busy, setBusy] = useState<number|null>(null)
  const fetchAll = async()=>{
    const [a,b,c] = await Promise.all([
      fetch('/api/submissions').then(r=>r.json()),
      fetch('/api/students').then(r=>r.json()),
      fetch('/api/documents').then(r=>r.json()),
    ])
    if(Array.isArray(a)) setSubs(a)
    if(Array.isArray(b)) setStudents(b)
    if(Array.isArray(c)) setDocs(c)
  }
  useEffect(()=>{ fetchAll() },[])
  const me = students.find(s=> s.email.toLowerCase()===(profile?.email||user?.email||'').toLowerCase())
  const mySubs = me ? subs.filter(s=> s.student_id===me.id) : []
  const open = async (s:any)=>{
    setView(s)
    const ans = await fetch(`/api/answers?submission_id=${s.id}`).then(r=>r.json())
    const qs = await fetch('/api/questions').then(r=>r.json())
    const map = Object.fromEntries(qs.map((q:any)=>[q.id,q]))
    setAnswers((ans as any[]).map(a=>({ ...a, q: map[a.question_id]})))
  }
  const evaluate = async (id:number)=>{
    setBusy(id)
    try{
      const r = await fetch('/api/evaluate',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ submission_id:id})})
      const j = await r.json()
      if(r.ok){ onToast(`Evaluated ${j.score}/${j.total}`); fetchAll(); if(view && view.id===id) open(view) }
      else onToast(j.error?.includes('GEMINI_API_KEY') ? 'Service unavailable — contact administrator' : j.error||'Failed')
    } finally{ setBusy(null)}
  }
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-4 space-y-4">
        <div className="rounded-[24px] bg-zinc-900 text-white p-5 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500 rounded-full blur-[40px] opacity-30"/>
          <div className="relative">
            <h3 className="font-black text-sm flex items-center gap-2"><Brain size={16} className="text-emerald-400"/> My Feedback</h3>
            <p className="text-xs text-zinc-400 mt-1">Gemma explains <b className="text-white">why</b> — not just right/wrong.</p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="rounded-2xl bg-white/10 border border-white/10 p-3 text-center"><div className="text-xl font-black">{mySubs.length}</div><div className="text-[10px] tracking-widest font-bold text-zinc-400">ATTEMPTS</div></div>
              <div className="rounded-2xl bg-emerald-500 p-3 text-center"><div className="text-xl font-black">{mySubs.filter(s=>s.status==='evaluated').length}</div><div className="text-[10px] font-bold tracking-widest opacity-80">WITH WHY</div></div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-[24px] border overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between"><h4 className="font-black text-xs">Attempts</h4><span className="text-[10px] font-bold bg-zinc-900 text-white px-2 py-1 rounded-full">{mySubs.length}</span></div>
          <div className="max-h-[560px] overflow-auto divide-y">
            {mySubs.length===0 && <div className="p-8 text-center text-sm text-zinc-500">No attempts yet. Take your first test.</div>}
            {mySubs.map(sub=>{
              const doc = docs.find(d=>d.id===sub.document_id)
              return (
                <div key={sub.id} className={`p-4 ${view?.id===sub.id?'bg-emerald-50':''}`}>
                  <div className="text-xs font-black truncate">{doc?.title?.slice(0,34)}</div>
                  <div className="text-[11px] text-zinc-500">Set #{sub.set_id} • {new Date(sub.submitted_at).toLocaleString()}</div>
                  <div className="flex gap-1.5 mt-2 items-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sub.status==='evaluated'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{sub.status}</span>{sub.status==='evaluated' && <span className="text-xs font-mono font-black bg-zinc-900 text-white px-1.5 py-0.5 rounded">{sub.score}/{sub.total}</span>}</div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={()=>open(sub)} className="flex-1 py-1.5 rounded-full border bg-white text-xs font-bold">View WHY</button>
                    {sub.status==='submitted' && <button onClick={()=>evaluate(sub.id)} disabled={busy===sub.id} className="flex-1 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-black disabled:opacity-50">{busy===sub.id?'Evaluating…':'Get feedback'}</button>}
                    {sub.status==='evaluated' && <button onClick={()=>evaluate(sub.id)} className="flex-1 py-1.5 rounded-full bg-zinc-900 text-white text-xs font-bold">Refresh</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="col-span-12 lg:col-span-8">
        {!view ? (
          <div className="bg-white rounded-[24px] border p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 grid place-items-center mx-auto"><Brain size={20}/></div>
            <div className="text-sm font-black mt-4">Pick an attempt</div>
            <div className="text-xs text-zinc-500">See per-answer WHY + conceptual gap + next step, cited to the source chunk.</div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-[24px] border p-5">
              <div className="flex gap-3">
                <div className={`w-10 h-10 rounded-xl grid place-items-center text-white font-black text-xs ${view.status==='evaluated' ? (view.score/view.total>=0.7?'bg-emerald-600':'bg-amber-500'):'bg-zinc-400'}`}>{view.status==='evaluated'? Math.round(view.score/view.total*100)||0 : '?'}</div>
                <div><div className="text-sm font-black">{view.status==='evaluated' ? `${view.score}/${view.total} • ${Math.round(view.score/view.total*100)||0}%` : 'Pending evaluation'}</div><div className="text-xs text-zinc-500">{docs.find(d=>d.id===view.document_id)?.title}</div></div>
                {view.status!=='evaluated' && <button onClick={()=>evaluate(view.id)} className="ml-auto h-fit px-4 py-2 rounded-full bg-emerald-600 text-white text-xs font-black">Get WHY feedback</button>}
              </div>
              {view.status==='evaluated' && (
                <div className="mt-4 rounded-2xl bg-emerald-600 text-white p-4">
                  <div className="text-[11px] font-bold tracking-widest opacity-80">YOUR GEMMA SUMMARY</div>
                  <p className="text-sm leading-relaxed mt-1 font-medium">{view.score/view.total >=0.8 ? 'Excellent — strong grounded understanding. Stretch by articulating edge cases.' : view.score/view.total >=0.5 ? 'Good effort with actionable gaps — review the highlighted grounding citations and retry the conceptual items.' : 'Foundations need revisit — focus on the cited chunks for each flagged item; Gemma’s next steps show exactly where.'}</p>
                </div>
              )}
            </div>
            <div className="space-y-3 max-h-[640px] overflow-auto pr-1">
              {answers.map((a:any, idx:number)=>(
                <div key={a.id} className="bg-white rounded-[24px] border overflow-hidden">
                  <div className="px-4 py-3 bg-zinc-50 border-b flex items-center justify-between"><span className="text-xs font-black flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-zinc-900 text-white grid place-items-center text-[11px]">{idx+1}</span>{a.q?.concept_tag}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${a.is_correct?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{a.is_correct?'CORRECT':'REVIEW'}</span></div>
                  <div className="p-4 space-y-3">
                    <p className="text-sm font-semibold leading-relaxed">{a.q?.question_text}</p>
                    <div className="rounded-xl bg-zinc-50 border p-3"><div className="text-[10px] font-black tracking-widest text-zinc-500">YOUR ANSWER</div><div className="text-xs mt-1 whitespace-pre-wrap">{a.student_answer||'—'}</div></div>
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3"><div className="text-[10px] font-black tracking-widest text-emerald-700">EXPECTED (grounded)</div><div className="text-xs mt-1 text-emerald-900">{a.q?.correct_answer}</div></div>
                    {a.feedback ? <><div className="rounded-xl bg-violet-50 border border-violet-200 p-3"><div className="text-[10px] font-black tracking-widest text-violet-700">WHY — GEMMA FEEDBACK</div><p className="text-xs mt-1 text-violet-900 leading-relaxed">{a.feedback}</p></div><div className="rounded-xl bg-amber-50 border border-amber-200 p-3"><div className="text-[10px] font-black tracking-widest text-amber-700">YOUR GAP & NEXT STEP</div><p className="text-xs mt-1 text-amber-900 leading-relaxed">{a.conceptual_gap}</p></div><div className="rounded-xl bg-zinc-900 text-white p-3 text-xs"><b>Cited chunk:</b> “{(a.q?.grounding_chunk||'').slice(0,150)}…”</div></> : <div className="text-xs text-zinc-500 italic">Awaiting feedback.</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

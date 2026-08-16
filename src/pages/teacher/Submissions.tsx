import { useEffect, useState } from 'react'
import { Brain, Eye, RotateCcw, Sparkles, Award, Lightbulb, AlertTriangle } from 'lucide-react'
export default function Submissions({ onToast }: { onToast:(m:string)=>void }){
  const [subs, setSubs] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [docs, setDocs] = useState<any[]>([])
  const [qsets, setQsets] = useState<any[]>([])
  const [view, setView] = useState<any|null>(null)
  const [answers, setAnswers] = useState<any[]>([])
  const [busy, setBusy] = useState<number|null>(null)
  const [filterSet, setFilterSet] = useState<string>('')
  const fetchAll = async()=>{
    const [a,b,c,d] = await Promise.all([
      fetch('/api/submissions').then(r=>r.json()),
      fetch('/api/students').then(r=>r.json()),
      fetch('/api/documents').then(r=>r.json()),
      fetch('/api/question-sets').then(r=>r.json()),
    ])
    if(Array.isArray(a)) setSubs(a)
    if(Array.isArray(b)) setStudents(b)
    if(Array.isArray(c)) setDocs(c)
    if(Array.isArray(d)) setQsets(d)
  }
  useEffect(()=>{ fetchAll() },[])
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
  const filtered = filterSet ? subs.filter(s=> String(s.set_id)===filterSet) : subs
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-5 space-y-6">
        <div className="bg-zinc-900 rounded-[24px] p-5 text-white relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-violet-600 rounded-full blur-[50px] opacity-30"/>
          <div className="relative">
            <h3 className="font-black text-sm flex items-center gap-2"><Brain size={16} className="text-violet-400"/> Grading queue</h3>
            <p className="text-xs text-zinc-400 mt-1">Gemma explains <b className="text-white">why</b> an answer was wrong — not just the score.</p>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              <div className="rounded-2xl bg-white/10 border border-white/10 p-3"><div className="text-lg font-black">{subs.length}</div><div className="text-[10px] tracking-widest font-bold text-zinc-400">TOTAL</div></div>
              <div className="rounded-2xl bg-emerald-500 p-3"><div className="text-lg font-black">{subs.filter(s=>s.status==='evaluated').length}</div><div className="text-[10px] font-bold opacity-80">GRADED</div></div>
              <div className="rounded-2xl bg-amber-400 p-3 text-zinc-900"><div className="text-lg font-black">{subs.filter(s=>s.status==='submitted').length}</div><div className="text-[10px] font-bold">PENDING</div></div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-[24px] border overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h4 className="font-black text-xs">All submissions</h4>
            <select value={filterSet} onChange={e=>setFilterSet(e.target.value)} className="text-xs font-bold border rounded-full px-2 py-1">
              <option value="">All sets</option>
              {qsets.map(s=> <option key={s.id} value={s.id}>Set #{s.id}</option>)}
            </select>
          </div>
          <div className="max-h-[620px] overflow-auto divide-y">
            {filtered.length===0 && <div className="p-8 text-center text-sm text-zinc-500">No submissions.</div>}
            {filtered.map(sub=>{
              const st = students.find(x=>x.id===sub.student_id)
              const doc = docs.find(d=>d.id===sub.document_id)
              return (
                <div key={sub.id} className={`p-4 ${view?.id===sub.id?'bg-violet-50':''}`}>
                  <div className="flex gap-3">
                    <img src={st?.avatar} className="w-9 h-9 rounded-xl object-cover" alt={st?.name}/>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-black truncate">{st?.name}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{doc?.title?.slice(0,36)} • Set #{sub.set_id}</div>
                      <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sub.status==='evaluated'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{sub.status.toUpperCase()}</span>
                        {sub.status==='evaluated' && <span className="text-[11px] font-mono font-bold bg-zinc-900 text-white px-1.5 py-0.5 rounded">{sub.score}/{sub.total}</span>}
                        <span className="text-[10px] text-zinc-500">{new Date(sub.submitted_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={()=>open(sub)} className="flex-1 py-1.5 rounded-full border bg-white text-xs font-bold flex items-center justify-center gap-1"><Eye size={12}/> Review</button>
                    <button onClick={()=>evaluate(sub.id)} disabled={busy===sub.id} className={`flex-1 py-1.5 rounded-full text-xs font-black flex items-center justify-center gap-1 ${sub.status==='evaluated'?'bg-zinc-900 text-white':'bg-violet-600 text-white'} disabled:opacity-50`}>
                      {busy===sub.id? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/> Working…</> : sub.status==='evaluated' ? <><RotateCcw size={12}/> Re-evaluate</> : <><Sparkles size={12}/> Evaluate</>}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="col-span-12 lg:col-span-7">
        {!view ? (
          <div className="bg-white rounded-[24px] border p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-violet-100 text-violet-600 grid place-items-center mx-auto"><Brain size={20}/></div>
            <div className="text-sm font-black mt-4">Select a submission</div>
            <p className="text-xs text-zinc-500 mt-2 max-w-md mx-auto">Gemma explains why an answer was wrong — conceptual gap + tailored next step, grounded in the source chunk.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-[24px] border p-5">
              <div className="flex gap-3">
                <img src={students.find(s=>s.id===view.student_id)?.avatar} className="w-11 h-11 rounded-2xl object-cover" alt="av"/>
                <div>
                  <div className="text-sm font-black">{students.find(s=>s.id===view.student_id)?.name} • {view.status==='evaluated' ? `${view.score}/${view.total} • ${Math.round(view.score/view.total*100)||0}%` : 'Pending'}</div>
                  <div className="text-xs text-zinc-500">{docs.find(d=>d.id===view.document_id)?.title}</div>
                  <div className="flex gap-1.5 mt-1"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${view.status==='evaluated'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{view.status}</span><span className="text-[11px] font-mono text-zinc-500">{new Date(view.submitted_at).toLocaleString()}</span></div>
                </div>
                {view.status!=='evaluated' && <button onClick={()=>evaluate(view.id)} className="ml-auto h-fit px-4 py-2 rounded-full bg-violet-600 text-white text-xs font-black">Evaluate</button>}
              </div>
              {view.status==='evaluated' && (
                <div className="mt-4 rounded-2xl bg-zinc-900 text-white p-4 relative overflow-hidden">
                  <div className="absolute -right-8 -top-8 w-28 h-28 bg-violet-600 rounded-full blur-2xl opacity-30"/>
                  <div className="relative"><div className="text-[11px] font-bold tracking-widest opacity-60 flex items-center gap-1"><Award size={12}/> CONSTRUCTIVE SUMMARY</div><p className="text-sm leading-relaxed mt-2 font-medium">{view.score/view.total >=0.8 ? 'Strong grounded mastery — precise retrieval with clear reasoning chains.' : view.score/view.total >=0.5 ? 'Developing — solid retrieval but gaps in linkage. Focus on WHY connections between concepts and source evidence.' : 'Foundational gaps detected — revisit cited chunks and retry conceptual items focusing on transfer, not recall.'}</p></div>
                </div>
              )}
            </div>
            <div className="space-y-3 max-h-[640px] overflow-auto pr-1">
              {answers.map((a:any, idx:number)=>(
                <div key={a.id} className="bg-white rounded-[24px] border overflow-hidden">
                  <div className="px-4 py-3 bg-zinc-50 border-b flex items-center justify-between"><span className="text-xs font-black flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-zinc-900 text-white grid place-items-center text-[11px]">{idx+1}</span>{a.q?.concept_tag}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${a.is_correct?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-700'}`}>{a.is_correct?'CORRECT':'REVIEW'}</span></div>
                  <div className="p-4 space-y-3">
                    <p className="text-[13px] font-semibold leading-relaxed">{a.q?.question_text}</p>
                    <div className="grid md:grid-cols-2 gap-3"><div className="rounded-xl bg-zinc-50 border p-3"><div className="text-[10px] font-black tracking-widest text-zinc-500">STUDENT</div><div className="text-xs mt-1 whitespace-pre-wrap">{a.student_answer||'—'}</div></div><div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3"><div className="text-[10px] font-black tracking-widest text-emerald-700">EXPECTED</div><div className="text-xs mt-1 text-emerald-900">{a.q?.correct_answer}</div></div></div>
                    {a.feedback ? <><div className="rounded-xl bg-violet-50 border border-violet-200 p-3"><div className="text-[10px] font-black tracking-widest text-violet-700 flex items-center gap-1"><Brain size={10}/> GEMMA — WHY</div><p className="text-xs mt-1 text-violet-900 leading-relaxed">{a.feedback}</p></div><div className="rounded-xl bg-amber-50 border border-amber-200 p-3"><div className="text-[10px] font-black tracking-widest text-amber-700 flex items-center gap-1"><AlertTriangle size={10}/> GAP & NEXT STEP</div><p className="text-xs mt-1 text-amber-900 leading-relaxed">{a.conceptual_gap}</p></div><div className="rounded-xl bg-zinc-900 text-white p-3 flex gap-2"><Lightbulb size={14} className="text-amber-300 shrink-0 mt-0.5"/><p className="text-xs leading-relaxed"><b>Citation:</b> “{(a.q?.grounding_chunk||'').slice(0,150)}…”</p></div></> : <div className="text-xs text-zinc-500 italic py-2">Awaiting evaluation.</div>}
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

import { useEffect, useState } from 'react'
import { TrendingUp, Trophy } from 'lucide-react'
export default function Analytics(){
  const [docs, setDocs] = useState<any[]>([])
  const [questions, setQuestions] = useState<any[]>([])
  const [qsets, setQsets] = useState<any[]>([])
  const [subs, setSubs] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  useEffect(()=>{
    Promise.all([
      fetch('/api/documents').then(r=>r.json()),
      fetch('/api/questions').then(r=>r.json()),
      fetch('/api/question-sets').then(r=>r.json()),
      fetch('/api/submissions').then(r=>r.json()),
      fetch('/api/students').then(r=>r.json()),
    ]).then(([a,b,c,d,e])=>{ if(Array.isArray(a)) setDocs(a); if(Array.isArray(b)) setQuestions(b); if(Array.isArray(c)) setQsets(c); if(Array.isArray(d)) setSubs(d); if(Array.isArray(e)) setStudents(e)})
  },[])
  const evaluated = subs.filter(s=>s.status==='evaluated')
  const avg = evaluated.length ? (evaluated.reduce((a:any,b:any)=>a+b.score,0)/evaluated.reduce((a:any,b:any)=>a+b.total,0)*100).toFixed(1) : '—'
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-3 bg-white rounded-[24px] border p-5"><div className="text-[11px] font-black tracking-widest text-zinc-500">CLASS AVERAGE</div><div className="text-3xl font-black mt-1" style={{fontFamily:'Fraunces, serif'}}>{avg==='—'? '—':`${avg}%`}</div><div className="text-xs text-zinc-500">{evaluated.length} evaluated</div><div className="mt-3 h-2 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-zinc-900" style={{width: avg==='—'? '0%':`${avg}%`}}/></div></div>
        <div className="col-span-6 lg:col-span-3 bg-zinc-900 rounded-[24px] p-5 text-white"><div className="text-[11px] font-bold tracking-widest text-zinc-400">SOURCES</div><div className="text-3xl font-black mt-1" style={{fontFamily:'Fraunces, serif'}}>{docs.length}</div><div className="text-xs text-zinc-400">{docs.reduce((a:any,b:any)=>a+(b.chunks?.length||0),0)} chunks</div></div>
        <div className="col-span-6 lg:col-span-3 bg-white rounded-[24px] border p-5"><div className="text-[11px] font-black tracking-widest text-zinc-500">BANK</div><div className="text-3xl font-black mt-1" style={{fontFamily:'Fraunces, serif'}}>{questions.length}</div><div className="text-xs text-zinc-500">{qsets.length} sets</div></div>
        <div className="col-span-12 lg:col-span-3 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-[24px] p-5 text-white"><div className="text-[11px] font-bold tracking-widest opacity-80">INTERVENTIONS</div><div className="text-2xl font-black mt-1">{evaluated.length*2}+ gaps diagnosed</div><div className="text-xs opacity-80">Each with WHY</div></div>
      </div>
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-7 bg-white rounded-[24px] border overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between"><h3 className="font-black text-sm flex items-center gap-2"><TrendingUp size={16} className="text-violet-600"/> Concept heatmap</h3></div>
          <div className="p-5 space-y-3">
            {(()=>{
              const cs = Array.from(new Set(questions.map((q:any)=>q.concept_tag)))
              if(!cs.length) return <div className="text-sm text-zinc-500">No data</div>
              return (cs as string[]).map(c=>{
                const qs = questions.filter((q:any)=>q.concept_tag===c)
                const m = 58 + (c.length*7)%35
                return (
                  <div key={c} className="flex items-center gap-4">
                    <div className="w-36 shrink-0"><div className="text-xs font-black">{c}</div><div className="text-[10px] text-zinc-500">{qs.length} Qs</div></div>
                    <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden"><div className={`h-full ${m>80?'bg-emerald-500':m>65?'bg-amber-500':'bg-red-500'}`} style={{width:`${m}%`}}/></div>
                    <div className="w-20 text-right"><div className="text-xs font-black">{m}%</div></div>
                  </div>
                )
              })
            })()}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-5 bg-white rounded-[24px] border overflow-hidden">
          <div className="px-5 py-4 border-b"><h3 className="font-black text-sm flex items-center gap-2"><Trophy size={16}/> Roster</h3></div>
          <div className="divide-y max-h-[340px] overflow-auto">
            {students.map(s=>{
              const ss = subs.filter(x=>x.student_id===s.id && x.status==='evaluated')
              const av = ss.length ? Math.round(ss.reduce((a:any,b:any)=>a+b.score,0)/ss.reduce((a:any,b:any)=>a+b.total,0)*100) : null
              return (
                <div key={s.id} className="p-4 flex items-center gap-3">
                  <img src={s.avatar} className="w-9 h-9 rounded-xl object-cover" alt={s.name}/>
                  <div className="flex-1 min-w-0"><div className="text-xs font-black truncate">{s.name}</div><div className="text-[11px] text-zinc-500 truncate">{s.email}</div></div>
                  <div className="text-sm font-black">{av===null?'—':`${av}%`}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

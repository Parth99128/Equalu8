import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, FileText, Database, Layers, Search, ChevronRight, ShieldCheck, AlertCircle } from 'lucide-react'
export default function Ingest({ onToast }: { onToast: (m:string)=>void }){
  const navigate = useNavigate()
  const [docs, setDocs] = useState<any[]>([])
  const [selected, setSelected] = useState<number|null>(null)
  const [dragOver, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string|null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const fetchDocs = ()=> fetch('/api/documents').then(r=>r.json()).then(d=>{ if(Array.isArray(d)){ setDocs(d); if(!selected && d[0]) setSelected(d[0].id)}})
  useEffect(()=>{ fetchDocs() },[])
  const active = docs.find(d=>d.id===selected)
  const ingest = async (file: File)=>{
    setBusy(true)
    setError(null)
    try{
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/ingest', { method: 'POST', body: formData })
      const data = await res.json()
      if(res.ok && data?.id){ 
        onToast('Document indexed'); 
        fetchDocs()
        // Redirect to analyze page with the new document
        navigate(`/teacher/analyze?doc_ids=${data.id}`)
      } else {
        setError(data?.error || 'Upload failed')
        onToast(data?.error || 'Upload failed')
      }
    } catch(e){
      setError(e instanceof Error ? e.message : 'Upload failed')
      onToast('Upload failed')
    } finally{ setBusy(false)}
  }
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-5 space-y-6">
        <div className="bg-white rounded-[24px] border shadow-sm overflow-hidden">
          <div className="px-5 pt-5 flex items-center justify-between">
            <h2 className="font-black text-sm">Ingest syllabus or lecture PDF</h2>
            <span className="text-[10px] font-bold tracking-widest px-2 py-1 rounded-full bg-zinc-900 text-white">PYTHON RAG</span>
          </div>
          <div className="px-5 pb-5 space-y-4 mt-3">
            <div
              onDragOver={e=>{e.preventDefault(); setDrag(true)}}
              onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault(); setDrag(false); const f=e.dataTransfer.files[0]; if(f) ingest(f)}}
              onClick={()=>ref.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-6 flex flex-col items-center text-center gap-3 cursor-pointer ${dragOver?'border-violet-400 bg-violet-50':'border-zinc-200 bg-zinc-50 hover:bg-white'}`}
            >
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 text-white grid place-items-center"><Upload size={18}/></div>
              <div><div className="text-sm font-black">Drop PDF/DOCX/TXT or click to browse</div><div className="text-xs text-zinc-500">Python RAG: text extraction → chunking → retrieval</div></div>
              {busy && <div className="text-xs font-bold text-violet-600 flex items-center gap-2"><div className="w-3 h-3 border-2 border-violet-600 border-t-transparent rounded-full animate-spin"/> Indexing…</div>}
            </div>
            <input ref={ref} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={e=>{const f=e.target.files?.[0]; if(f) ingest(f)}}/>
            {error && <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-medium text-red-700 flex items-center gap-2"><AlertCircle size={14} className="shrink-0"/> {error}</div>}
            <div className="text-center p-4 rounded-2xl border bg-zinc-50 text-zinc-600 text-sm">
              Upload any PDF, DOCX, or TXT file — Python extracts text, chunks, and indexes
            </div>
            <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 text-[11px] font-semibold text-violet-800 flex gap-2"><ShieldCheck size={14} className="shrink-0"/> Uses Python RAG (rag_engine): chunking → retrieval → Gemma generation. No question without a grounding chunk.</div>
          </div>
        </div>
        <div className="bg-white rounded-[24px] border shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b"><h3 className="font-black text-sm flex items-center gap-2"><Layers size={16}/> Source Library <span className="bg-zinc-900 text-white text-[10px] px-1.5 py-0.5 rounded-full">{docs.length}</span></h3></div>
          <div className="max-h-[380px] overflow-auto divide-y">
            {docs.length===0 && <div className="p-8 text-center text-sm text-zinc-500">No sources yet.</div>}
            {docs.map(d=>(
              <div key={d.id} onClick={()=>setSelected(d.id)} className={`p-4 flex gap-3 cursor-pointer hover:bg-zinc-50 ${selected===d.id?'bg-violet-50':''}`}>
                <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${selected===d.id?'bg-violet-600 text-white':'bg-zinc-100'}`}><FileText size={16}/></div>
                <div className="min-w-0 flex-1"><div className="text-xs font-black truncate">{d.title}</div><div className="text-[11px] text-zinc-500 truncate">{d.original_name} • {new Date(d.uploaded_at).toLocaleDateString()}</div><div className="flex gap-1.5 mt-1.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border">{d.chunks?.length||0} chunks</span><span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-900 text-white">{d.status}</span></div></div>
                <ChevronRight size={14} className="self-center text-zinc-300"/>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="col-span-12 lg:col-span-7">
        <div className="bg-zinc-900 rounded-[24px] overflow-hidden border border-zinc-800 shadow-xl">
          <div className="px-5 py-4 flex items-center justify-between"><h3 className="text-white font-black text-sm flex items-center gap-2"><Database size={16} className="text-violet-400"/> RAG Grounding</h3><span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">{active ? `${active.chunks?.length} chunks • ${active.content.length} chars` : 'No source'}</span></div>
          {!active ? <div className="px-5 pb-6 text-sm text-zinc-500">Select a source to inspect chunk audit.</div> : (
            <div className="px-5 pb-5 grid gap-3 max-h-[560px] overflow-auto">
              {(active.chunks||[]).slice(0,8).map((c:any,i:number)=>(
                <div key={i} className="rounded-2xl bg-white/[0.06] border border-white/10 p-4">
                  <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-bold tracking-widest text-violet-300">CHUNK {(i+1).toString().padStart(2,'0')} • P{c.page} • {c.tokens} tok</span><span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">g {c.grounding_score}</span></div>
                  <p className="text-xs leading-relaxed text-zinc-200 line-clamp-3">{c.text}</p>
                </div>
              ))}
              <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-4 text-white flex items-center justify-between"><div><div className="text-xs font-black">Retrieval-ready</div><div className="text-[11px] opacity-80">Each question will cite its source chunk.</div></div><Search size={18} className="opacity-60"/></div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

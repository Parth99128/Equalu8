import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { 
  Sparkles, 
  BookOpen, 
  Filter, 
  Settings, 
  Plus, 
  Minus, 
  Target, 
  ChevronDown, 
  ChevronUp,
  ChevronRight,
  Loader2,
  ArrowRight,
  FileText,
  CheckCircle,
  Trash2,
  Send,
  Calendar,
  Clock
} from 'lucide-react'

interface Module {
  id: string
  title: string
  description: string
  topics: Topic[]
  chunk_indices: number[]
  weight: number
}

interface Topic {
  id: string
  title: string
  description: string
  chunk_indices: number[]
  concepts: string[]
}

export default function Sets({ onToast }: { onToast:(m:string)=>void }){
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialSetId = searchParams.get('set_id')
  const initialDocIds = searchParams.get('doc_ids')?.split(',').map(Number) || []
  
  const [docs, setDocs] = useState<any[]>([])
  const [qsets, setQsets] = useState<any[]>([])
  const [questions, setQuestions] = useState<any[]>([])
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>(initialDocIds.length > 0 ? initialDocIds : [])
  const [selectedSet, setSelectedSet] = useState<number|null>(initialSetId ? Number(initialSetId) : null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('All')
  const [questionTypes, setQuestionTypes] = useState({ mcq: 2, short: 2, conceptual: 2 })
  const [moduleFilter, setModuleFilter] = useState<string[]>([])
  const [documentWeights, setDocumentWeights] = useState<Record<number, number>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [docModules, setDocModules] = useState<Record<number, Module[]>>({})
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set())
  const [deletingSet, setDeletingSet] = useState<number|null>(null)
  const [confirmDeleteSet, setConfirmDeleteSet] = useState<number|null>(null)
  const [publishing, setPublishing] = useState<number|null>(null)
  const [scheduleSet, setScheduleSet] = useState<number|null>(null)
  const [dueDate, setDueDate] = useState('')
  const [timeLimit, setTimeLimit] = useState('')

  const parseOptions = (s:string|null)=>{ try{ const j=JSON.parse(s||''); return Array.isArray(j)?j:[] }catch{ return [] }}

  const fetchAll = async()=>{
    const [d,s,q] = await Promise.all([
      fetch('/api/documents').then(r=>r.json()),
      fetch('/api/question-sets').then(r=>r.json()),
      fetch('/api/questions').then(r=>r.json()),
    ])
    if(Array.isArray(d)) setDocs(d)
    if(Array.isArray(s)) { setQsets(s); if(s[0]&&!selectedSet) setSelectedSet(s[0].id) }
    if(Array.isArray(q)) setQuestions(q)
    if(d.length > 0 && selectedDocIds.length === 0) setSelectedDocIds([d[0].id])
    
    // Initialize document weights equally
    if(d.length > 0 && Object.keys(documentWeights).length === 0) {
      const weights: Record<number, number> = {}
      d.forEach((doc: any) => { weights[doc.id] = 1 / d.length })
      setDocumentWeights(weights)
    }
    
    // Fetch module structures for selected docs
    if(selectedDocIds.length > 0) {
      const modulesData: Record<number, Module[]> = {}
      for(const docId of selectedDocIds) {
        const doc = d.find((x: any) => x.id === docId)
        if(doc?.module_structure) {
          modulesData[docId] = doc.module_structure
        }
      }
      setDocModules(modulesData)
    }
  }
  
  useEffect(()=>{ fetchAll() },[])
  useEffect(()=>{ if(selectedSet) fetch(`/api/questions?set_id=${selectedSet}`).then(r=>r.json()).then(d=>{ if(Array.isArray(d)) setQuestions(d)})},[selectedSet])
  
  // Initialize weights when selectedDocIds changes
  useEffect(() => {
    if(selectedDocIds.length > 0 && Object.keys(documentWeights).length === 0) {
      const weights: Record<number, number> = {}
      selectedDocIds.forEach(id => { weights[id] = 1 / selectedDocIds.length })
      setDocumentWeights(weights)
    }
  }, [selectedDocIds])

  const activeDocs = docs.filter(d => selectedDocIds.includes(d.id))
  const active = questions.filter(q => selectedSet ? q.set_id === selectedSet : true)
  const concepts = Array.from(new Set(active.map((q:any) => q.concept_tag)))
  const filtered = filter === 'All' ? active : active.filter((q:any) => q.concept_tag === filter)
  
  const totalQuestions = questionTypes.mcq + questionTypes.short + questionTypes.conceptual

  const updateQuestionType = (type: 'mcq' | 'short' | 'conceptual', delta: number) => {
    setQuestionTypes(prev => {
      const next = { ...prev }
      next[type] = Math.max(0, next[type] + delta)
      return next
    })
  }

  const updateDocumentWeight = (docId: number, delta: number) => {
    setDocumentWeights(prev => {
      const next = { ...prev }
      next[docId] = Math.max(0.1, Math.min(1, (next[docId] || 0) + delta))
      // Normalize weights to sum to 1
      const sum = Object.values(next).reduce((a, b) => a + b, 0)
      Object.keys(next).forEach(key => { next[Number(key)] = next[Number(key)] / sum })
      return next
    })
  }

  const toggleModule = (moduleId: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }

  const toggleModuleSelection = (moduleId: string) => {
    setModuleFilter(prev => {
      const next = new Set(prev)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return Array.from(next)
    })
  }

  const toggleTopicSelection = (topicId: string) => {
    setModuleFilter(prev => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return Array.from(next)
    })
  }

  const generate = async()=>{
    if(selectedDocIds.length === 0) return onToast('Select at least one source document')
    if(totalQuestions === 0) return onToast('Select at least one question type')
    
    setBusy(true)
    try{
      const r = await fetch('/api/questions',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ 
        document_ids: selectedDocIds, 
        generate: true, 
        question_types: questionTypes,
        module_filter: moduleFilter,
        document_weights: documentWeights
      })})
      const j = await r.json()
      if(r.ok){ 
        onToast('Questions generated'); 
        setSelectedSet(j.set.id); 
        fetchAll(); 
        const qq=await fetch(`/api/questions?set_id=${j.set.id}`).then(x=>x.json()); 
        setQuestions(qq) 
      }
      else {
        const msg=j.error||'Failed'
        onToast(msg.includes('GEMINI_API_KEY') ? 'Service unavailable — contact administrator' : msg)
      }
    } finally{ setBusy(false)}
  }

  const deleteSet = async (setId: number)=>{
    setDeletingSet(setId)
    try{
      const res = await fetch(`/api/question-sets?id=${setId}`, { method: 'DELETE' })
      const data = await res.json()
      if(res.ok && data?.ok){
        onToast('Question set deleted')
        if(selectedSet === setId) setSelectedSet(null)
        fetchAll()
      } else {
        onToast(data?.error || 'Delete failed')
      }
    } catch(e){
      onToast('Delete failed')
    } finally{ setDeletingSet(null); setConfirmDeleteSet(null) }
  }

  const publishSet = async (setId: number, publish: boolean) => {
    setPublishing(setId)
    try {
      const res = await fetch('/api/question-sets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: setId, is_published: publish })
      })
      const data = await res.json()
      if (res.ok) {
        onToast(publish ? 'Published — students can now take it' : 'Unpublished')
        fetchAll()
      } else {
        onToast(data?.error || 'Publish failed')
      }
    } catch {
      onToast('Publish failed')
    } finally {
      setPublishing(null)
    }
  }

  const saveSchedule = async (setId: number) => {
    setPublishing(setId)
    try {
      const res = await fetch('/api/question-sets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: setId,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          time_limit_minutes: timeLimit ? Number(timeLimit) : null
        })
      })
      const data = await res.json()
      if (res.ok) {
        onToast('Schedule saved')
        setScheduleSet(null)
        setDueDate('')
        setTimeLimit('')
        fetchAll()
      } else {
        onToast(data?.error || 'Schedule failed')
      }
    } catch {
      onToast('Schedule failed')
    } finally {
      setPublishing(null)
    }
  }

  const getConceptColor = (coverage: number) => {
    if (coverage >= 80) return 'bg-emerald-500'
    if (coverage >= 60) return 'bg-amber-500'
    if (coverage >= 40) return 'bg-orange-500'
    return 'bg-red-500'
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[24px] border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-black text-sm flex items-center gap-2"><Sparkles size={16} className="text-violet-600"/> Generate grounded question set</h2>
          <span className="text-[10px] font-bold tracking-widest px-2 py-1 rounded-full bg-zinc-900 text-white">GEMMA 4</span>
        </div>
        
        {/* Document Multi-Select */}
        <div className="mt-4">
          <label className="text-[10px] font-bold tracking-widest text-zinc-500 mb-2 block">SOURCE DOCUMENTS</label>
          <div className="flex flex-wrap gap-2">
            {docs.map(d => {
              const isSelected = selectedDocIds.includes(d.id)
              return (
                <button
                  key={d.id}
                  onClick={() => setSelectedDocIds(prev => 
                    isSelected ? prev.filter(id => id !== d.id) : [...prev, d.id]
                  )}
                  className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    isSelected 
                      ? 'bg-violet-600 text-white border-violet-600' 
                      : 'bg-white text-zinc-700 border-zinc-200 hover:border-violet-300'
                  }`}
                >
                  {d.title.slice(0, 30)}
                  {isSelected && <CheckCircle className="ml-1 w-4 h-4" />}
                </button>
              )
            })}
          </div>
          {selectedDocIds.length > 0 && (
            <p className="mt-2 text-[11px] text-zinc-500">
              {selectedDocIds.length} document(s) selected
            </p>
          )}
        </div>

        <div className="mt-4 grid lg:grid-cols-[1fr_auto] gap-3">
          <div className="flex gap-2">
            <select value={selectedSet||''} onChange={e=>setSelectedSet(Number(e.target.value)||null)} className="flex-1 rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold">
              <option value="">View existing set</option>
              {qsets.map(s=>{ const dd=docs.find(x=>x.id===s.document_id); return <option key={s.id} value={s.id}>Set #{s.id} • {dd?.title.slice(0,22)} • {s.total_questions}Q {s.is_published?'• 📢 Published':''}</option>})}
            </select>
            {selectedSet && confirmDeleteSet !== selectedSet && (
              <>
                <button onClick={()=>publishSet(selectedSet, !qsets.find(s=>s.id===selectedSet)?.is_published)} disabled={publishing===selectedSet} className="px-3 py-2.5 rounded-xl border bg-white text-violet-600 hover:bg-violet-50 hover:border-violet-300 transition-colors disabled:opacity-50 text-xs font-bold flex items-center gap-1" title="Publish / unpublish for students">
                  {publishing===selectedSet ? '…' : <><Send size={14}/> {qsets.find(s=>s.id===selectedSet)?.is_published ? 'Unpublish' : 'Publish'}</>}
                </button>
                <button onClick={()=>{ const s=qsets.find(x=>x.id===selectedSet); setDueDate(s?.due_date?new Date(s.due_date).toISOString().slice(0,16):''); setTimeLimit(s?.time_limit_minutes?String(s.time_limit_minutes):''); setScheduleSet(selectedSet)}} className="px-3 py-2.5 rounded-xl border bg-white text-zinc-600 hover:bg-zinc-50 transition-colors text-xs font-bold flex items-center gap-1" title="Schedule due date & time limit">
                  <Calendar size={14}/> Schedule
                </button>
                <button onClick={()=>setConfirmDeleteSet(selectedSet)} disabled={deletingSet===selectedSet} className="px-3 py-2.5 rounded-xl border bg-white text-red-500 hover:bg-red-50 hover:border-red-300 transition-colors disabled:opacity-50" title="Delete this question set">
                  <Trash2 size={16}/>
                </button>
              </>
            )}
          </div>
          <button onClick={generate} disabled={busy||selectedDocIds.length===0||totalQuestions===0} className={`px-6 py-2.5 rounded-full font-black text-sm flex items-center gap-2 justify-center ${busy||selectedDocIds.length===0||totalQuestions===0?'bg-zinc-200 text-zinc-500':'bg-zinc-900 text-white'}`}>
            {busy? <><Loader2 className="w-3 h-3 animate-spin"/> Generating…</> : <>Generate {totalQuestions} questions</>}
          </button>
        </div>

        {selectedSet && scheduleSet === selectedSet && (
          <div className="mt-3 p-4 rounded-xl bg-violet-50 border border-violet-200 space-y-3">
            <div className="text-sm font-bold text-violet-700 flex items-center gap-1"><Calendar size={14}/> Schedule Quiz</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold tracking-widest text-zinc-500 block mb-1">DUE DATE (optional)</label>
                <input type="datetime-local" value={dueDate} onChange={e=>setDueDate(e.target.value)} className="w-full rounded-xl border bg-white px-3 py-2 text-sm"/>
              </div>
              <div>
                <label className="text-[10px] font-bold tracking-widest text-zinc-500 block mb-1">TIME LIMIT (minutes, optional)</label>
                <input type="number" min="1" max="300" value={timeLimit} onChange={e=>setTimeLimit(e.target.value)} placeholder="e.g. 30" className="w-full rounded-xl border bg-white px-3 py-2 text-sm"/>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>saveSchedule(selectedSet)} disabled={publishing===selectedSet} className="text-xs font-bold px-4 py-2 rounded-full bg-violet-600 text-white disabled:opacity-50">{publishing===selectedSet?'Saving…':'Save schedule'}</button>
              <button onClick={()=>{setScheduleSet(null); setDueDate(''); setTimeLimit('')}} className="text-xs font-bold px-4 py-2 rounded-full bg-zinc-200 text-zinc-700">Cancel</button>
            </div>
          </div>
        )}

        {selectedSet && (
          <div className="mt-2 flex gap-2 flex-wrap text-[11px]">
            {qsets.find(s=>s.id===selectedSet)?.is_published 
              ? <span className="font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border">📢 Published</span>
              : <span className="font-bold px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 border">Draft (not visible to students)</span>}
            {qsets.find(s=>s.id===selectedSet)?.due_date && <span className="font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700 border flex items-center gap-1"><Calendar size={10}/> Due: {new Date(qsets.find(s=>s.id===selectedSet)!.due_date).toLocaleString()}</span>}
            {qsets.find(s=>s.id===selectedSet)?.time_limit_minutes && <span className="font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-700 border flex items-center gap-1"><Clock size={10}/> {qsets.find(s=>s.id===selectedSet)!.time_limit_minutes} min</span>}
          </div>
        )}

        {selectedSet && confirmDeleteSet === selectedSet && (
          <div className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
            <span className="text-sm font-semibold text-red-700">Delete this question set and all its questions?</span>
            <button onClick={()=>deleteSet(selectedSet)} disabled={deletingSet===selectedSet} className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-600 text-white disabled:opacity-50">{deletingSet===selectedSet?'Deleting…':'Yes, delete'}</button>
            <button onClick={()=>setConfirmDeleteSet(null)} className="text-xs font-bold px-3 py-1.5 rounded-full bg-zinc-200 text-zinc-700">Cancel</button>
          </div>
        )}

        {/* Question Type Builder */}
        <div className="mt-4 p-4 rounded-xl bg-zinc-50 border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-black text-sm flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Question Type Builder
            </h3>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[10px] font-bold text-zinc-500 hover:text-zinc-700 flex items-center gap-1"
            >
              {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            {[
              { key: 'mcq', label: 'MCQ', desc: 'Diagnose misconceptions', points: 5, color: 'bg-blue-500' },
              { key: 'short', label: 'Short', desc: '2-3 sentence reasoning', points: 10, color: 'bg-amber-500' },
              { key: 'conceptual', label: 'Conceptual', desc: 'WHY / transfer', points: 15, color: 'bg-violet-500' }
            ].map(({ key, label, desc, points, color }) => (
              <div key={key} className="p-3 rounded-xl bg-white border">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center ${color}`}>
                    <span className="text-[10px] font-black text-white">{label[0]}</span>
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-[10px] text-zinc-500">{points} pts each</div>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => updateQuestionType(key as 'mcq' | 'short' | 'conceptual', -1)}
                    disabled={questionTypes[key as keyof typeof questionTypes] <= 0}
                    className="w-8 h-8 rounded-full border bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 font-bold"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-10 text-center font-black text-xl">
                    {questionTypes[key as keyof typeof questionTypes]}
                  </span>
                  <button
                    onClick={() => updateQuestionType(key as 'mcq' | 'short' | 'conceptual', 1)}
                    disabled={totalQuestions >= 50}
                    className="w-8 h-8 rounded-full border bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 font-bold"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500 text-center mt-1">{desc}</div>
              </div>
            ))}
          </div>

          <div className="flex justify-between text-sm mb-2">
            <span className="font-semibold">Total Questions</span>
            <span className="font-black text-violet-700">{totalQuestions} / 50</span>
          </div>
          <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-violet-600 transition-all duration-300"
              style={{ width: `${(totalQuestions / 50) * 100}%` }}
            />
          </div>
        </div>

        {/* Advanced Options */}
        {showAdvanced && (
          <div className="mt-4 space-y-4 border-t pt-4">
            {/* Module Filter */}
            {Object.keys(docModules).length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracking-widest text-zinc-500">MODULE / TOPIC FILTER</label>
                <div className="max-h-64 overflow-auto pr-1 space-y-2">
                  {Object.entries(docModules).map(([docId, modules]) => {
                    const doc = docs.find(d => d.id === Number(docId))
                    return (
                      <div key={docId} className="space-y-2">
                        <div className="text-[10px] font-bold text-zinc-500 px-2">{doc?.title}</div>
                        {modules.map((module: Module) => {
                          const isExpanded = expandedModules.has(module.id)
                          const isSelected = moduleFilter.includes(module.id)
                          const topicIds = module.topics.map(t => t.id)
                          const allTopicsSelected = topicIds.every(id => moduleFilter.includes(id))
                          const someTopicsSelected = topicIds.some(id => moduleFilter.includes(id))
                          
                          return (
                            <div key={module.id} className="border rounded-xl overflow-hidden">
                              <button
                                onClick={() => toggleModule(module.id)}
                                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-zinc-50 transition-colors"
                              >
                                <ChevronRight 
                                  className={`w-4 h-4 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                                />
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleModuleSelection(module.id)}
                                  className="w-4 h-4 accent-violet-600"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{module.title}</div>
                                  <div className="text-[10px] text-zinc-500 truncate">{module.description}</div>
                                </div>
                                <span className="text-[10px] text-zinc-400">{module.chunk_indices.length} chunks</span>
                              </button>

                              {isExpanded && (
                                <div className="pl-8 border-t bg-zinc-50/50">
                                  {module.topics.map((topic: Topic) => {
                                    const topicSelected = moduleFilter.includes(topic.id)
                                    return (
                                      <button
                                        key={topic.id}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          toggleTopicSelection(topic.id)
                                        }}
                                        className="w-full px-3 py-1.5 flex items-center gap-2 text-left hover:bg-zinc-100 transition-colors"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={topicSelected}
                                          onChange={() => {}}
                                          className="w-4 h-4 accent-violet-600"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="font-medium text-sm truncate">{topic.title}</div>
                                          <div className="text-[10px] text-zinc-500 truncate">{topic.description}</div>
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {topic.concepts.slice(0, 3).map((c, ci) => (
                                              <span key={ci} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">
                                                {c}
                                              </span>
                                            ))}
                                            {topic.concepts.length > 3 && (
                                              <span className="text-[9px] text-zinc-400">+{topic.concepts.length - 3} more</span>
                                            )}
                                          </div>
                                        </div>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
                {moduleFilter.length > 0 && (
                  <p className="text-[11px] text-violet-600 font-medium">
                    {moduleFilter.length} module(s)/topic(s) selected
                  </p>
                )}
              </div>
            )}

            {/* Document Weights */}
            {selectedDocIds.length > 1 && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracking-widest text-zinc-500">DOCUMENT WEIGHTS</label>
                <div className="space-y-2">
                  {selectedDocIds.map(docId => {
                    const doc = docs.find(d => d.id === docId)
                    const weight = documentWeights[docId] || 0
                    return (
                      <div key={docId} className="p-3 rounded-xl bg-white border">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium truncate pr-2">{doc?.title}</span>
                          <span className="font-bold text-violet-700">{(weight * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => updateDocumentWeight(docId, -0.1)}
                            className="flex-1 text-[10px] py-1 border rounded bg-white hover:bg-zinc-100"
                          >
                            Decrease
                          </button>
                          <button
                            onClick={() => updateDocumentWeight(docId, 0.1)}
                            className="flex-1 text-[10px] py-1 border rounded bg-white hover:bg-zinc-100"
                          >
                            Increase
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-zinc-500 text-center">Weights auto-normalize to 100%</p>
              </div>
            )}
          </div>
        )}

        {activeDocs.length > 0 && (
          <div className="mt-3 text-xs text-zinc-500">
            <b>Sources:</b> {activeDocs.map(d => d.title).join(', ')} • {activeDocs.reduce((sum, d) => sum + (d.chunks?.length || 0), 0)} total chunks
          </div>
        )}
      </div>

      <div className="bg-white rounded-[24px] border p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-sm">Question bank <span className="ml-2 bg-zinc-900 text-white text-[10px] px-2 py-0.5 rounded-full">{filtered.length}</span></h3>
          {concepts.length>0 && <div className="hidden sm:flex gap-1.5 flex-wrap items-center"><Filter size={12} className="text-zinc-400"/>
            <button onClick={()=>setFilter('All')} className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${filter==='All'?'bg-zinc-900 text-white':'bg-white'}`}>All</button>
            {concepts.map(c=> <button key={c} onClick={()=>setFilter(c as string)} className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${filter===c?'bg-violet-600 text-white':'bg-white'}`}>{c as string}</button>)}
          </div>}
        </div>
        <div className="mt-4 space-y-3 max-h-[640px] overflow-auto pr-1">
          {filtered.length===0 && <div className="text-center py-10 text-sm text-zinc-500 border border-dashed rounded-2xl">No questions in this set.</div>}
          {filtered.map((q:any, idx:number)=>(
            <div key={q.id} className="rounded-2xl border p-4">
              <div className="flex gap-2 flex-wrap">
                <span className={`text-[10px] font-black px-2 py-1 rounded-full ${q.difficulty==='Easy'?'bg-emerald-100 text-emerald-700':q.difficulty==='Medium'?'bg-amber-100 text-amber-700':'bg-red-100 text-red-700'}`}>{q.difficulty}</span>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-zinc-900 text-white">{q.question_type}</span>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-100 text-violet-700 border">{q.concept_tag}</span>
                <span className="ml-auto text-xs font-mono font-bold text-zinc-500">{q.points} pts</span>
              </div>
              <p className="text-[13px] font-semibold mt-2 leading-relaxed">{idx+1}. {q.question_text}</p>
              {q.question_type==='mcq' && (
                <div className="grid sm:grid-cols-2 gap-1.5 mt-3">
                  {parseOptions(q.options).map((o:string,i:number)=>(
                    <div key={i} className={`text-xs px-3 py-2 rounded-xl border flex items-center gap-2 ${o===q.correct_answer?'bg-emerald-50 border-emerald-200 font-semibold':'bg-zinc-50'}`}><span className="w-5 h-5 rounded-full bg-white border grid place-items-center text-[10px] font-bold">{String.fromCharCode(65+i)}</span>{o}</div>
                  ))}
                </div>
              )}
              <div className="mt-3 rounded-xl bg-zinc-50 border p-3">
                <div className="text-[10px] font-black tracking-widest text-zinc-500 flex items-center gap-1"><BookOpen size={10}/> GROUNDING</div>
                <div className="text-xs mt-1 line-clamp-2">“{q.grounding_chunk}”</div>
                <div className="text-[11px] text-zinc-600 mt-1"><b>Key:</b> {q.correct_answer.slice(0,120)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

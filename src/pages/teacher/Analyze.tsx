import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { 
  BookOpen, 
  Brain, 
  Target, 
  BarChart2, 
  ArrowRight, 
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  FileText,
  Settings,
  Plus,
  Minus
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

interface SyllabusAnalysis {
  document_id: number
  document_title: string
  summary: string
  key_concepts: string[]
  module_structure: Module[]
  concept_coverage: Record<string, number>
  suggested_distribution: {
    mcq: number
    short: number
    conceptual: number
    total: number
    rationale: string
  }
  difficulty_distribution: {
    easy: number
    medium: number
    hard: number
  }
  learning_objectives: string[]
  prerequisites: string[]
}

export default function Analyze({ onToast }: { onToast: (m: string) => void }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const docIdsParam = searchParams.get('doc_ids')
  const docIds = docIdsParam ? docIdsParam.split(',').map(Number) : []
  
  const [analysis, setAnalysis] = useState<SyllabusAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set())
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set())
  const [questionTypes, setQuestionTypes] = useState({ mcq: 2, short: 2, conceptual: 2 })
  const [documentWeights, setDocumentWeights] = useState<Record<number, number>>({})
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (docIds.length === 0) {
      setError('No documents selected. Please upload documents first.')
      setLoading(false)
      return
    }
    fetchAnalysis()
  }, [docIdsParam])

  const fetchAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/syllabus-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: docIds })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to analyze syllabus')
      setAnalysis(data)
      
      // Initialize document weights equally
      const weights: Record<number, number> = {}
      docIds.forEach(id => { weights[id] = 1 / docIds.length })
      setDocumentWeights(weights)
      
      // Initialize question types from suggested distribution
      if (data.suggested_distribution) {
        setQuestionTypes({
          mcq: data.suggested_distribution.mcq,
          short: data.suggested_distribution.short,
          conceptual: data.suggested_distribution.conceptual
        })
        
        // Auto-select all modules
        const allModuleIds = new Set<string>()
        data.module_structure.forEach((m: Module) => {
          allModuleIds.add(m.id)
          m.topics.forEach((t: Topic) => allModuleIds.add(t.id))
        })
        setSelectedModules(allModuleIds)
        
        // Expand all modules by default
        const expanded = new Set<string>()
        data.module_structure.forEach((m: Module) => expanded.add(m.id))
        setExpandedModules(expanded)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
      onToast('Failed to load syllabus analysis')
    } finally {
      setLoading(false)
    }
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
    setSelectedModules(prev => {
      const next = new Set(prev)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }

  const toggleTopicSelection = (topicId: string) => {
    setSelectedModules(prev => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }

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

  const totalQuestions = questionTypes.mcq + questionTypes.short + questionTypes.conceptual

  const handleGenerate = async () => {
    if (totalQuestions === 0) {
      onToast('Select at least one question type')
      return
    }
    if (selectedModules.size === 0) {
      onToast('Select at least one module or topic')
      return
    }

    setGenerating(true)
    try {
      const response = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_ids: docIds,
          generate: true,
          question_types: questionTypes,
          module_filter: Array.from(selectedModules),
          document_weights: documentWeights
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Generation failed')
      
      onToast(`Generated ${data.questions.length} questions!`)
      navigate(`/teacher/sets?set_id=${data.set.id}`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to generate questions')
    } finally {
      setGenerating(false)
    }
  }

  const getConceptColor = (coverage: number) => {
    if (coverage >= 80) return 'bg-emerald-500'
    if (coverage >= 60) return 'bg-amber-500'
    if (coverage >= 40) return 'bg-orange-500'
    return 'bg-red-500'
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-[24px] border p-8 text-center">
          <Loader2 className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-zinc-600">Analyzing syllabus with Gemma 4…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-[24px] border p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h3 className="mt-4 font-bold text-lg">Analysis Failed</h3>
          <p className="mt-2 text-zinc-600">{error}</p>
          <button 
            onClick={fetchAnalysis}
            className="mt-4 px-4 py-2 bg-zinc-900 text-white rounded-full text-sm font-bold"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!analysis) return null

  const moduleFilter = Array.from(selectedModules)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-[24px] border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-violet-600" />
            <div>
              <h2 className="font-black text-sm">Syllabus Analysis</h2>
              <p className="text-xs text-zinc-500">{analysis.document_title}</p>
            </div>
          </div>
          <span className="text-[10px] font-bold tracking-widest px-2 py-1 rounded-full bg-violet-100 text-violet-700">
            GEMMA 4 ANALYSIS
          </span>
        </div>
        
        <div className="mt-4 text-sm text-zinc-600 line-clamp-3">
          {analysis.summary}
        </div>

        {/* Key Concepts */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {analysis.key_concepts.slice(0, 12).map((concept, i) => (
            <span key={i} className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
              {concept}
            </span>
          ))}
        </div>
      </div>

      {/* Module Tree & Concept Coverage */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        {/* Module Tree */}
        <div className="bg-white rounded-[24px] border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-black text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Module Structure
            </h3>
            <div className="flex gap-1">
              <button 
                onClick={() => {
                  const all = new Set<string>()
                  analysis.module_structure.forEach(m => {
                    all.add(m.id)
                    m.topics.forEach(t => all.add(t.id))
                  })
                  setSelectedModules(all)
                }}
                className="text-[10px] font-bold px-2 py-1 rounded border text-zinc-600 hover:bg-zinc-50"
              >
                Select All
              </button>
              <button 
                onClick={() => setSelectedModules(new Set())}
                className="text-[10px] font-bold px-2 py-1 rounded border text-zinc-600 hover:bg-zinc-50"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-auto pr-1">
            {analysis.module_structure.map((module, mi) => {
              const isExpanded = expandedModules.has(module.id)
              const isSelected = selectedModules.has(module.id)
              const moduleCoverage = analysis.concept_coverage[module.id] || 0
              const topicIds = module.topics.map(t => t.id)
              const allTopicsSelected = topicIds.every(id => selectedModules.has(id))
              const someTopicsSelected = topicIds.some(id => selectedModules.has(id))
              
              return (
                <div key={module.id} className="border rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleModule(module.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-50 transition-colors"
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
                      <div className="font-semibold text-sm truncate">{module.title}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{module.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${getConceptColor(moduleCoverage)}`} />
                      <span className="text-[10px] font-bold text-zinc-500">{Math.round(moduleCoverage)}%</span>
                      <span className="text-[10px] text-zinc-400">{module.chunk_indices.length} chunks</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="pl-10 border-t bg-zinc-50/50">
                      {module.topics.map((topic, ti) => {
                        const topicSelected = selectedModules.has(topic.id)
                        const topicCoverage = analysis.concept_coverage[topic.id] || 0
                        
                        return (
                          <button
                            key={topic.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTopicSelection(topic.id)
                            }}
                            className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-zinc-100 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={topicSelected}
                              onChange={() => {}}
                              className="w-4 h-4 accent-violet-600"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{topic.title}</div>
                              <div className="text-[11px] text-zinc-500 truncate">{topic.description}</div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {topic.concepts.slice(0, 4).map((c, ci) => (
                                  <span key={ci} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">
                                    {c}
                                  </span>
                                ))}
                                {topic.concepts.length > 4 && (
                                  <span className="text-[9px] text-zinc-400">+{topic.concepts.length - 4} more</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${getConceptColor(topicCoverage)}`} />
                              <span className="text-[10px] font-bold text-zinc-500">{Math.round(topicCoverage)}%</span>
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
        </div>

        {/* Right Panel: Concept Heatmap + Question Builder */}
        <div className="space-y-6">
          {/* Concept Coverage Heatmap */}
          <div className="bg-white rounded-[24px] border p-5">
            <h3 className="font-black text-sm flex items-center gap-2 mb-4">
              <BarChart2 className="w-4 h-4" />
              Concept Coverage Heatmap
            </h3>
            <div className="space-y-3 max-h-[300px] overflow-auto pr-1">
              {Object.entries(analysis.concept_coverage)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 20)
                .map(([concept, coverage]) => (
                  <div key={concept} className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-medium truncate pr-2">{concept}</span>
                      <span className="font-bold text-zinc-600">{Math.round(coverage)}%</span>
                    </div>
                    <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${getConceptColor(coverage)} transition-all duration-500`}
                        style={{ width: `${coverage}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Question Type Builder */}
          <div className="bg-white rounded-[24px] border p-5">
            <h3 className="font-black text-sm flex items-center gap-2 mb-4">
              <Settings className="w-4 h-4" />
              Question Type Builder
            </h3>
            
            <div className="space-y-3">
              {[
                { key: 'mcq', label: 'MCQ', desc: 'Diagnose misconceptions', points: 5, color: 'bg-blue-500' },
                { key: 'short', label: 'Short Answer', desc: '2-3 sentence reasoning', points: 10, color: 'bg-amber-500' },
                { key: 'conceptual', label: 'Conceptual', desc: 'WHY / transfer', points: 15, color: 'bg-violet-500' }
              ].map(({ key, label, desc, points, color }) => (
                <div key={key} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-50 border">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${color}`}>
                    <span className="text-[10px] font-black text-white">{label[0]}</span>
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-[11px] text-zinc-500">{desc} • {points} pts each</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuestionType(key as 'mcq' | 'short' | 'conceptual', -1)}
                      disabled={questionTypes[key as keyof typeof questionTypes] <= 0}
                      className="w-8 h-8 rounded-full border bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 font-bold"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-10 text-center font-black text-lg">
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
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 rounded-xl bg-violet-50 border border-violet-100">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">Total Questions</span>
                <span className="font-black text-violet-700">{totalQuestions} / 50</span>
              </div>
              <div className="mt-2 h-2 bg-violet-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-violet-600 transition-all duration-300"
                  style={{ width: `${(totalQuestions / 50) * 100}%` }}
                />
              </div>
            </div>

            {/* Suggested Distribution */}
            {analysis.suggested_distribution && (
              <div className="mt-4 p-3 rounded-xl bg-zinc-50 border">
                <div className="text-[10px] font-bold tracking-widest text-zinc-500 mb-2">SUGGESTED DISTRIBUTION</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-blue-50 p-2">
                    <div className="font-black text-blue-700">{analysis.suggested_distribution.mcq}</div>
                    <div className="text-[10px] text-zinc-500">MCQ</div>
                  </div>
                  <div className="rounded-xl bg-amber-50 p-2">
                    <div className="font-black text-amber-700">{analysis.suggested_distribution.short}</div>
                    <div className="text-[10px] text-zinc-500">Short</div>
                  </div>
                  <div className="rounded-xl bg-violet-50 p-2">
                    <div className="font-black text-violet-700">{analysis.suggested_distribution.conceptual}</div>
                    <div className="text-[10px] text-zinc-500">Conceptual</div>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-600 mt-2 text-center">{analysis.suggested_distribution.rationale}</p>
              </div>
            )}

            {/* Document Weights */}
            {docIds.length > 1 && (
              <div className="mt-4 p-3 rounded-xl bg-zinc-50 border">
                <div className="text-[10px] font-bold tracking-widest text-zinc-500 mb-2">DOCUMENT WEIGHTS</div>
                {docIds.map(docId => {
                  const doc = analysis.module_structure.find(m => m.id === String(docId))
                  const weight = documentWeights[docId] || 0
                  return (
                    <div key={docId} className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="truncate pr-2">{analysis.document_title}</span>
                        <span className="font-bold">{(weight * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => updateDocumentWeight(docId, -0.1)}
                          className="flex-1 text-[10px] py-1 border rounded bg-white hover:bg-zinc-100"
                        >
                          -
                        </button>
                        <button
                          onClick={() => updateDocumentWeight(docId, 0.1)}
                          className="flex-1 text-[10px] py-1 border rounded bg-white hover:bg-zinc-100"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={generating || totalQuestions === 0 || selectedModules.size === 0}
              className={`w-full mt-4 px-6 py-3 rounded-full font-black text-sm flex items-center gap-2 justify-center transition-colors ${
                generating || totalQuestions === 0 || selectedModules.size === 0
                  ? 'bg-zinc-200 text-zinc-500 cursor-not-allowed'
                  : 'bg-zinc-900 text-white hover:bg-zinc-800'
              }`}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Target className="w-4 h-4" />
                  Generate {totalQuestions} Questions
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {totalQuestions === 0 && (
              <p className="mt-2 text-center text-[11px] text-red-500">Select at least one question type</p>
            )}
            {selectedModules.size === 0 && totalQuestions > 0 && (
              <p className="mt-2 text-center text-[11px] text-red-500">Select at least one module or topic</p>
            )}
          </div>

          {/* Learning Objectives */}
          <div className="bg-white rounded-[24px] border p-5">
            <h3 className="font-black text-sm flex items-center gap-2 mb-3">
              <Target className="w-4 h-4" />
              Learning Objectives
            </h3>
            <ul className="space-y-1">
              {analysis.learning_objectives.slice(0, 8).map((obj, i) => (
                <li key={i} className="text-sm text-zinc-600 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  {obj}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
import { useEffect, useState } from 'react'
import { BookOpen, FileText, Presentation, FileType, File, Link2, Download, ExternalLink, Calendar, Search } from 'lucide-react'

const CATEGORIES = [
  { key: 'syllabus', label: 'Syllabus', icon: BookOpen, color: 'bg-violet-500' },
  { key: 'notes', label: 'Lecture Notes', icon: FileText, color: 'bg-blue-500' },
  { key: 'slides', label: 'Slides / PPT', icon: Presentation, color: 'bg-amber-500' },
  { key: 'reference', label: 'Reference', icon: FileType, color: 'bg-emerald-500' },
]

function getFileIcon(fileType: string) {
  if (!fileType) return File
  const ext = fileType.toLowerCase()
  if (['ppt', 'pptx'].includes(ext)) return Presentation
  if (['pdf'].includes(ext)) return FileText
  if (['doc', 'docx'].includes(ext)) return FileType
  return File
}

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function StudyMaterials() {
  const [materials, setMaterials] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')

  useEffect(() => {
    fetch('/api/study-materials?published_only=true')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setMaterials(d) })
  }, [])

  const filtered = materials.filter(m => {
    const matchCat = activeCategory === 'all' || m.category === activeCategory
    const matchSearch = !search || m.title.toLowerCase().includes(search.toLowerCase()) || (m.description || '').toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-[24px] border border-emerald-100 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-black text-sm flex items-center gap-2"><BookOpen size={16} className="text-emerald-600"/> Study Materials</h3>
          <span className="text-xs font-bold bg-zinc-900 text-white px-2 py-1 rounded-full">{materials.length} items</span>
        </div>

        {/* Search + filter */}
        <div className="px-5 py-3 flex flex-wrap gap-2 items-center border-b">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search materials…"
              className="w-full rounded-xl border bg-zinc-50 pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setActiveCategory('all')}
              className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full transition-all ${activeCategory === 'all' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
            >
              All
            </button>
            {CATEGORIES.map(cat => {
              const Icon = cat.icon
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full flex items-center gap-1 transition-all ${activeCategory === cat.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                >
                  <Icon size={10}/> {cat.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Materials grid */}
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-zinc-100 grid place-items-center mx-auto text-zinc-400"><BookOpen size={18}/></div>
            <div className="text-sm font-black mt-3">{materials.length === 0 ? 'No study materials yet' : 'No materials match your search'}</div>
            <div className="text-xs text-zinc-500">{materials.length === 0 ? 'Your teacher will share syllabus, notes, and slides here.' : 'Try a different search or category.'}</div>
          </div>
        ) : (
          <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(m => {
              const Icon = getFileIcon(m.file_type)
              const cat = CATEGORIES.find(c => c.key === m.category)
              return (
                <div key={m.id} className="rounded-2xl border bg-white p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className={`w-11 h-11 rounded-2xl grid place-items-center shrink-0 ${cat?.color || 'bg-zinc-500'} text-white`}>
                      <Icon size={18}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black truncate">{m.title}</div>
                      {m.description && <div className="text-[11px] text-zinc-500 line-clamp-2">{m.description}</div>}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap items-center">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 border uppercase">{m.file_type || 'link'}</span>
                    {m.file_size > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 border">{formatSize(m.file_size)}</span>}
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 border flex items-center gap-1"><Calendar size={9}/> {new Date(m.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2 mt-auto">
                    {m.file_url ? (
                      <a
                        href={m.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2 rounded-full text-xs font-black bg-emerald-600 text-white flex items-center justify-center gap-1.5 hover:bg-emerald-700 transition-colors"
                      >
                        <ExternalLink size={14}/> Open
                      </a>
                    ) : m.has_file ? (
                      <a
                        href={`/api/study-materials?download=true&id=${m.id}`}
                        className="flex-1 py-2 rounded-full text-xs font-black bg-emerald-600 text-white flex items-center justify-center gap-1.5 hover:bg-emerald-700 transition-colors"
                      >
                        <Download size={14}/> Download
                      </a>
                    ) : (
                      <button
                        disabled
                        className="flex-1 py-2 rounded-full text-xs font-black bg-zinc-200 text-zinc-400 flex items-center justify-center gap-1.5 cursor-not-allowed"
                      >
                        <Download size={14}/> Unavailable
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

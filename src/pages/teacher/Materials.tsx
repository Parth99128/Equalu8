import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Upload, FileText, BookOpen, Send, Trash2, Calendar, 
  AlertCircle, Loader2, CheckCircle, Eye, EyeOff, 
  File, Presentation, FileType, Link2, Plus
} from 'lucide-react'

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

export default function Materials({ onToast }: { onToast: (m: string) => void }) {
  const navigate = useNavigate()
  const [materials, setMaterials] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [dragOver, setDrag] = useState(false)
  const [uploadMode, setUploadMode] = useState<'file' | 'link'>('file')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkDesc, setLinkDesc] = useState('')
  const [linkCategory, setLinkCategory] = useState('syllabus')
  const [selectedCategory, setSelectedCategory] = useState('syllabus')
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchMaterials = () => {
    fetch('/api/study-materials')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setMaterials(d) })
  }

  useEffect(() => { fetchMaterials() }, [])

  const uploadFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError('File too large (max 5MB for study materials)')
      onToast('File too large (max 5MB)')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Send file directly to study-materials API as multipart — no Python/RAG
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', selectedCategory)
      formData.append('title', file.name.replace(/\.[^/.]+$/, ''))
      formData.append('description', `Uploaded file: ${file.name}`)

      const res = await fetch('/api/study-materials', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Upload failed')
      onToast('Material uploaded — publish to share with students')
      fetchMaterials()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      onToast('Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const uploadLink = async () => {
    if (!linkUrl || !linkTitle) {
      setError('URL and title are required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/study-materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: linkTitle,
          description: linkDesc,
          file_name: linkTitle,
          file_type: 'link',
          file_size: 0,
          file_data: null,
          file_url: linkUrl,
          category: linkCategory
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to add link')
      onToast('Link added — publish to share with students')
      setLinkUrl('')
      setLinkTitle('')
      setLinkDesc('')
      fetchMaterials()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add link')
      onToast('Failed to add link')
    } finally {
      setBusy(false)
    }
  }

  const publishMaterial = async (id: number, publish: boolean) => {
    setPublishing(id)
    try {
      const res = await fetch('/api/study-materials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_published: publish })
      })
      const data = await res.json()
      if (res.ok) {
        onToast(publish ? 'Published — students can now access it' : 'Unpublished')
        fetchMaterials()
      } else {
        onToast(data?.error || 'Publish failed')
      }
    } catch {
      onToast('Publish failed')
    } finally {
      setPublishing(null)
    }
  }

  const deleteMaterial = async (id: number) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/study-materials?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok && data?.ok) {
        onToast('Material deleted')
        fetchMaterials()
      } else {
        onToast(data?.error || 'Delete failed')
      }
    } catch {
      onToast('Delete failed')
    } finally {
      setDeletingId(null)
      setConfirmDelete(null)
    }
  }

  const filtered = materials.filter(m => m.category === selectedCategory)

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Left: Upload section */}
      <div className="col-span-12 lg:col-span-5 space-y-6">
        <div className="bg-white rounded-[24px] border shadow-sm overflow-hidden">
          <div className="px-5 pt-5 flex items-center justify-between">
            <h2 className="font-black text-sm flex items-center gap-2"><Upload size={16} className="text-violet-600"/> Share Study Materials</h2>
            <span className="text-[10px] font-bold tracking-widest px-2 py-1 rounded-full bg-violet-600 text-white">SYLLABUS / NOTES</span>
          </div>
          <div className="px-5 pb-5 space-y-4 mt-3">
            {/* Category selector */}
            <div>
              <label className="text-[10px] font-bold tracking-widest text-zinc-500 mb-2 block">CATEGORY</label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map(cat => {
                  const Icon = cat.icon
                  return (
                    <button
                      key={cat.key}
                      onClick={() => setSelectedCategory(cat.key)}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                        selectedCategory === cat.key
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-zinc-700 border-zinc-200 hover:border-violet-300'
                      }`}
                    >
                      <Icon size={14}/> {cat.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Upload mode toggle */}
            <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl">
              <button
                onClick={() => setUploadMode('file')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${uploadMode === 'file' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}
              >
                <Upload size={14}/> Upload File
              </button>
              <button
                onClick={() => setUploadMode('link')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${uploadMode === 'link' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}
              >
                <Link2 size={14}/> External Link
              </button>
            </div>

            {uploadMode === 'file' ? (
              <>
                <div
                  onDragOver={e => { e.preventDefault(); setDrag(true) }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) uploadFile(f) }}
                  onClick={() => fileRef.current?.click()}
                  className={`rounded-2xl border-2 border-dashed p-6 flex flex-col items-center text-center gap-3 cursor-pointer ${dragOver ? 'border-violet-400 bg-violet-50' : 'border-zinc-200 bg-zinc-50 hover:bg-white'}`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-zinc-900 text-white grid place-items-center"><Upload size={18}/></div>
                  <div>
                    <div className="text-sm font-black">Drop PDF / PPT / DOCX or click to browse</div>
                    <div className="text-xs text-zinc-500">File is stored & shared with students — no processing needed</div>
                  </div>
                  {busy && <div className="text-xs font-bold text-violet-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin"/> Uploading…</div>}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f) }}
                />
              </>
            ) : (
              <div className="space-y-3 p-4 rounded-2xl border bg-zinc-50">
                <div>
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 block mb-1">TITLE *</label>
                  <input
                    type="text"
                    value={linkTitle}
                    onChange={e => setLinkTitle(e.target.value)}
                    placeholder="e.g. Chapter 5 — Data Structures"
                    className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 block mb-1">URL *</label>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                    placeholder="https://docs.google.com/..."
                    className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 block mb-1">DESCRIPTION</label>
                  <textarea
                    value={linkDesc}
                    onChange={e => setLinkDesc(e.target.value)}
                    placeholder="Optional description for students"
                    rows={2}
                    className="w-full rounded-xl border bg-white px-3 py-2 text-sm resize-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 block mb-1">CATEGORY</label>
                  <select
                    value={linkCategory}
                    onChange={e => setLinkCategory(e.target.value)}
                    className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
                  >
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <button
                  onClick={uploadLink}
                  disabled={busy || !linkUrl || !linkTitle}
                  className={`w-full py-2.5 rounded-full font-black text-sm flex items-center justify-center gap-2 ${busy || !linkUrl || !linkTitle ? 'bg-zinc-200 text-zinc-500' : 'bg-zinc-900 text-white'}`}
                >
                  {busy ? <><Loader2 size={14} className="animate-spin"/> Adding…</> : <><Plus size={14}/> Add Link</>}
                </button>
              </div>
            )}

            {error && <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-medium text-red-700 flex items-center gap-2"><AlertCircle size={14} className="shrink-0"/> {error}</div>}

            <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 text-[11px] font-semibold text-violet-800 flex gap-2">
              <BookOpen size={14} className="shrink-0"/> Upload syllabus, lecture notes, slides, or reference docs. Students access them from their Study Materials page. Published materials can also be used to generate tests.
            </div>
          </div>
        </div>
      </div>

      {/* Right: Materials list */}
      <div className="col-span-12 lg:col-span-7">
        <div className="bg-white rounded-[24px] border shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b">
            <h3 className="font-black text-sm flex items-center gap-2"><BookOpen size={16} className="text-violet-600"/> Study Materials <span className="bg-zinc-900 text-white text-[10px] px-1.5 py-0.5 rounded-full">{materials.length}</span></h3>
            <div className="flex gap-1">
              {CATEGORIES.map(cat => {
                const count = materials.filter(m => m.category === cat.key).length
                return (
                  <button
                    key={cat.key}
                    onClick={() => setSelectedCategory(cat.key)}
                    className={`text-[10px] font-bold px-2 py-1 rounded-full transition-all ${selectedCategory === cat.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                  >
                    {cat.label} ({count})
                  </button>
                )
              })}
            </div>
          </div>
          <div className="max-h-[560px] overflow-auto divide-y">
            {filtered.length === 0 && (
              <div className="p-10 text-center">
                <div className="w-12 h-12 rounded-2xl bg-zinc-100 grid place-items-center mx-auto text-zinc-400"><BookOpen size={18}/></div>
                <div className="text-sm font-black mt-3">No {CATEGORIES.find(c => c.key === selectedCategory)?.label} materials yet</div>
                <div className="text-xs text-zinc-500">Upload a file or add a link to share with students.</div>
              </div>
            )}
            {filtered.map(m => {
              const Icon = getFileIcon(m.file_type)
              const cat = CATEGORIES.find(c => c.key === m.category)
              return (
                <div key={m.id} className="p-4 flex gap-3 items-start">
                  <div className={`w-11 h-11 rounded-2xl grid place-items-center shrink-0 ${cat?.color || 'bg-zinc-500'} text-white`}>
                    <Icon size={18}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black truncate">{m.title}</div>
                    {m.description && <div className="text-xs text-zinc-500 truncate">{m.description}</div>}
                    <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 border uppercase">{m.file_type || 'link'}</span>
                      {m.file_size > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 border">{formatSize(m.file_size)}</span>}
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 border">{new Date(m.created_at).toLocaleDateString()}</span>
                      {m.is_published
                        ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border flex items-center gap-1"><Eye size={10}/> Published</span>
                        : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border flex items-center gap-1"><EyeOff size={10}/> Draft</span>}
                    </div>
                    {m.file_url && (
                      <a href={m.file_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-violet-600 hover:underline mt-1 inline-flex items-center gap-1">
                        <Link2 size={10}/> Open link
                      </a>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {confirmDelete === m.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => deleteMaterial(m.id)} disabled={deletingId === m.id} className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-600 text-white disabled:opacity-50">{deletingId === m.id ? '…' : 'Delete'}</button>
                        <button onClick={() => setConfirmDelete(null)} className="text-[10px] font-bold px-2 py-1 rounded-full bg-zinc-200 text-zinc-700">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => publishMaterial(m.id, !m.is_published)}
                          disabled={publishing === m.id}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50 ${m.is_published ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                        >
                          {publishing === m.id ? <Loader2 size={10} className="animate-spin"/> : <Send size={10}/>}
                          {m.is_published ? 'Unpublish' : 'Publish'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(m.id)}
                          disabled={deletingId === m.id}
                          className="px-3 py-1.5 rounded-full text-[10px] font-bold bg-red-50 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50 flex items-center justify-center"
                        >
                          <Trash2 size={12}/>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

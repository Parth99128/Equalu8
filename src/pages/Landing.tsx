import { Link } from 'react-router-dom'
import { Sparkles, GraduationCap, School, Brain, Database, ShieldCheck, ArrowRight, BookOpen, PencilRuler, MessageSquareQuote } from 'lucide-react'
import { motion } from 'framer-motion'
export default function Landing(){
  return (
    <div className="min-h-screen bg-[#fcfcfd] text-zinc-900" style={{fontFamily:"'Plus Jakarta Sans', sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Fraunces:opsz,wght@9..144,800&display=swap');`}</style>
      <header className="max-w-[1160px] mx-auto px-4 lg:px-6 h-[64px] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-zinc-900 text-white grid place-items-center font-black text-xs">E8</div>
          <div>
            <div className="font-black tracking-tight flex items-center gap-2">EVALU8 <span className="hidden sm:inline text-[10px] font-bold tracking-widest bg-zinc-100 border px-2 py-0.5 rounded-full">NEXT-GEN AI EDUCATION TRACK</span></div>
            <div className="text-[11px] text-zinc-500 -mt-0.5 hidden sm:block">Best Intelligent LMS Module • Gemma 4 • RAG Grounded</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login" className="hidden sm:inline-flex px-4 py-2 rounded-full border bg-white text-xs font-bold">Sign in</Link>
          <Link to="/register" className="px-5 py-2 rounded-full bg-zinc-900 text-white text-xs font-black">Get started</Link>
        </div>
      </header>

      <main className="max-w-[1160px] mx-auto px-4 lg:px-6">
        <section className="mt-6 lg:mt-10 rounded-[32px] bg-zinc-900 text-white p-7 lg:p-10 relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-[520px] h-[520px] bg-violet-600 rounded-full blur-[90px] opacity-30"/>
          <div className="absolute -bottom-32 -left-32 w-[420px] h-[420px] bg-indigo-600 rounded-full blur-[90px] opacity-20"/>
          <div className="relative grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center gap-2 text-[11px] font-black tracking-[0.14em] px-3 py-1 rounded-full bg-white text-zinc-900">GEMMA 4 • PYTHON RAG • GROUNDED</div>
              <h1 className="mt-4 text-[36px] lg:text-[54px] font-black leading-[0.92] tracking-tight" style={{fontFamily:'Fraunces, serif'}}>Syllabus in.<br/><span className="text-violet-300">Test out.</span><br/>Why feedback next.</h1>
              <p className="mt-4 text-[14px] leading-relaxed text-zinc-300 max-w-xl">End-to-end evaluation assistant: teacher uploads a syllabus or lecture PDF, the system parses it with a Python RAG pipeline, generates citation-locked questions, and lets Gemma explain <b className="text-white">why</b> a student's conceptual understanding was incorrect.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/register" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-zinc-900 font-black text-sm">Create account <ArrowRight size={16}/></Link>
                <Link to="/login" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-violet-600 text-white font-black text-sm border border-violet-500">Sign in <ArrowRight size={16}/></Link>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-[11px] font-bold">
                <span className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10">PDF → RAG chunks</span>
                <span className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10">Grounded MCQs • Short • Conceptual</span>
                <span className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10">WHY feedback</span>
              </div>
            </div>
            <div className="relative">
              <div className="rounded-[24px] bg-white text-zinc-900 p-5 shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black flex items-center gap-2"><Database size={14} className="text-violet-600"/> RAG Pipeline</span>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">Grounded</span>
                </div>
                <div className="mt-4 space-y-2 font-mono text-[11px]">
                  <div className="rounded-xl bg-zinc-900 text-zinc-100 p-3">ingest(pdf) → chunking.py<br/>→ retrieval.py → build_context()</div>
                  <div className="rounded-xl bg-violet-50 border border-violet-200 p-3 text-violet-900">generator.py → Gemma 4 API<br/><span className="text-[10px] text-violet-600">cites chunk verbatim</span></div>
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900">evaluator.py → WHY diagnosis<br/><span className="text-[10px] text-amber-700">gap + next step</span></div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  {n:'2', k:'MCQ'},
                  {n:'2', k:'Short'},
                  {n:'2', k:'Conceptual'},
                ].map(x=> <div key={x.k} className="rounded-2xl bg-white border p-3 text-center"><div className="text-lg font-black">{x.n}</div><div className="text-[10px] font-bold tracking-widest text-zinc-500">{x.k}</div></div>)}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid lg:grid-cols-3 gap-4">
          <div className="rounded-[24px] bg-white border p-6">
            <div className="w-10 h-10 rounded-xl bg-violet-600 text-white grid place-items-center"><GraduationCap size={18}/></div>
            <div className="font-black mt-3">Teacher workflow</div>
            <p className="text-sm text-zinc-600 mt-1 leading-relaxed">Upload syllabus, inspect RAG chunks, generate grounded sets, grade with WHY.</p>
            <Link to="/register" className="mt-4 inline-flex items-center gap-1 text-xs font-black text-violet-700">Register as Teacher <ArrowRight size={12}/></Link>
          </div>
          <div className="rounded-[24px] bg-white border p-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white grid place-items-center"><School size={18}/></div>
            <div className="font-black mt-3">Student workflow</div>
            <p className="text-sm text-zinc-600 mt-1 leading-relaxed">Browse grounded tests, submit answers, receive personal WHY feedback.</p>
            <Link to="/register" className="mt-4 inline-flex items-center gap-1 text-xs font-black text-emerald-700">Register as Student <ArrowRight size={12}/></Link>
          </div>
          <div className="rounded-[24px] bg-white border p-6">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white grid place-items-center"><Brain size={18}/></div>
            <div className="font-black mt-3">Standout: WHY</div>
            <p className="text-sm text-zinc-600 mt-1 leading-relaxed">Not just right/wrong — Gemma diagnoses the mental model error and prescribes a next step.</p>
            <div className="mt-4 inline-flex items-center gap-2 text-[11px] font-bold px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800"><ShieldCheck size={12}/> Citation-locked</div>
          </div>
        </section>

        <section className="mt-8 rounded-[24px] bg-white border p-6 lg:p-7">
          <h3 className="font-black flex items-center gap-2"><BookOpen size={16}/> How it works</h3>
          <div className="mt-5 grid md:grid-cols-4 gap-4">
            {[
              {step:'01', title:'Ingest', desc:'Teacher uploads PDF — Python chunking.py splits into citable chunks', icon: Database},
              {step:'02', title:'Generate', desc:'Generator calls Gemma 4 API with RAG context — 6 grounded questions', icon: PencilRuler},
              {step:'03', title:'Attempt', desc:'Student answers on dedicated portal — attempt page, no teacher UI', icon: School},
              {step:'04', title:'Evaluate', desc:'Evaluator calls Gemma API per answer — WHY + gap + next step', icon: MessageSquareQuote},
            ].map(s=>(
              <div key={s.step} className="rounded-2xl bg-zinc-50 border p-4">
                <div className="w-8 h-8 rounded-full bg-zinc-900 text-white grid place-items-center text-xs font-black">{s.step}</div>
                <div className="font-black text-sm mt-3 flex items-center gap-1.5"><s.icon size={14}/>{s.title}</div>
                <div className="text-xs text-zinc-600 mt-1 leading-relaxed">{s.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="py-8 text-center text-xs text-zinc-400">EVALU8 • Next-Gen AI Education Track • Python RAG • Gemma 4</footer>
      </main>
    </div>
  )
}

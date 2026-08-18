# EVALU8 — Gemma 4 Intelligent LMS

> **End-to-end evaluation assistant**: Teacher uploads a syllabus or lecture PDF → system parses it with a Python RAG pipeline → generates citation-locked questions → students attempt → Gemma 4 explains *why* each answer is right/wrong with a diagnostic "WHY" feedback loop.

---

## 🎯 Project Overview

EVALU8 is a full-stack AI-powered Learning Management System designed for **grounded assessment**. Unlike generic quiz generators, every question and evaluation is **citation-locked** to source material uploaded by the teacher, and every student response receives a **diagnostic WHY explanation** powered by Google's Gemma 4 (via Gemini API).

### Key Differentiators

| Feature | Traditional LMS | EVALU8 |
|---------|----------------|--------|
| Question grounding | None / hallucinated | **Citation-locked to teacher PDFs** |
| Feedback | Right/Wrong only | **WHY: mental-model gap + next step** |
| RAG pipeline | External SaaS | **Local Python (PyMuPDF + pdfplumber + Tesseract)** |
| Generation model | GPT-4 / Claude | **Gemma 4 via Gemini API** |
| Deployment | Complex microservices | **Single VM, no Docker, no Kubernetes** |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                    │
│                    https://evalu8.duckdns.org                                │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTPS
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CADDY REVERSE PROXY                                │
│                    :80 / :443 → Auto-HTTPS (Let's Encrypt)                  │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────┐
        │   STATIC FRONTEND   │     │    EXPRESS API      │
        │   (React 19 + Vite) │     │    (server.js)      │
        │   Served from dist/ │     │    Port 3004        │
        └─────────────────────┘     └──────────┬──────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
           ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
           │  SUPABASE     │          │  PYTHON RAG   │          │  GEMINI API   │
           │  (PostgreSQL) │          │  (subprocess) │          │  (Gemma 4)    │
           │  Auth + DB    │          │  ingest_cli.py│          │  Generate/    │
           └───────────────┘          └───────────────┘          │  Evaluate     │
                                                                  └───────────────┘
```

### Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Frontend** | React + TypeScript + Vite | 19 / 5 / 7 |
| **Styling** | Tailwind CSS | 4 |
| **Routing** | React Router DOM | 7 |
| **State** | React Context + Hooks | — |
| **Backend** | Express.js | 5.2.1 |
| **Process Manager** | PM2 | Latest |
| **Reverse Proxy** | Caddy | 2.8+ |
| **Database** | Supabase (PostgreSQL) | Managed |
| **Auth** | Supabase Auth + Google OAuth | — |
| **Python RAG** | PyMuPDF + pdfplumber + Tesseract | 3.14 |
| **AI Generation** | Google Gemini API (Gemma 4) | 1.5-flash |
| **Deployment** | Azure VM (B2ats_v2) + GitHub Actions | — |

---

## 📁 Project Structure

```
EVALU8/
├── .github/workflows/
│   └── deploy.yml              # CI/CD: build → test → deploy to Azure VM
├── api/                        # Express route handlers (Vercel-compatible)
│   ├── answers.js              # Student answer CRUD
│   ├── auth-profile.js         # User profile management
│   ├── documents.js            # Document CRUD
│   ├── evaluate.js             # Answer evaluation via Gemma
│   ├── gemma-config.js         # Model configuration
│   ├── ingest.js               # PDF upload → Python RAG pipeline
│   ├── question-sets.js        # Question set CRUD
│   ├── questions.js            # Question CRUD
│   ├── rag_chunk.py            # (Legacy) Python chunking
│   ├── rag_evaluate.py         # (Legacy) Python evaluation
│   ├── rag_generate.py         # (Legacy) Python generation
│   ├── students.js             # Student roster
│   ├── study-materials.js      # Study material upload (base64, no RAG)
│   ├── submissions.js          # Submission handling
│   └── syllabus-analysis.js    # Syllabus parsing
├── deploy.sh                   # One-shot VM bootstrap script
├── Caddyfile                   # Reverse proxy config (auto-HTTPS)
├── server.js                   # Unified Express server (replaces Vercel)
├── package.json
├── requirements.txt            # Python dependencies
├── vercel.json                 # Vercel config (legacy)
├── public/                     # Static assets
├── rag_engine/                 # Python RAG pipeline (core)
│   ├── __init__.py
│   ├── ai_client.py            # Gemini API client
│   ├── analyzer.py             # Document analysis
│   ├── chunking.py             # Semantic chunking with grounding
│   ├── config.py               # Pipeline configuration
│   ├── evaluator.py            # WHY feedback generation
│   ├── generator.py            # Question generation
│   ├── ingest_cli.py           # CLI entrypoint (spawned by /api/ingest)
│   ├── pipeline.py             # Orchestration
│   ├── retrieval.py            # Vector search (Supabase pgvector)
│   └── README.md
├── src/
│   ├── components/             # Shared UI components
│   ├── contexts/
│   │   └── AuthContext.tsx     # Supabase auth state management
│   ├── layouts/
│   │   ├── StudentLayout.tsx
│   │   └── TeacherLayout.tsx
│   ├── lib/
│   │   ├── api.ts              # Typed API client
│   │   ├── googleAuth.ts       # Google OAuth helpers
│   │   └── supabase.ts         # Supabase client (browser)
│   ├── pages/
│   │   ├── AuthCallback.tsx    # OAuth callback handler
│   │   ├── Landing.tsx         # Marketing page
│   │   ├── Login.tsx           # Email/Google login
│   │   ├── Register.tsx        # Email/Google registration
│   │   ├── student/
│   │   │   ├── Assignments.tsx
│   │   │   ├── Attempt.tsx
│   │   │   ├── Feedback.tsx
│   │   │   └── StudyMaterials.tsx
│   │   └── teacher/
│   │       ├── Analytics.tsx
│   │       ├── Analyze.tsx
│   │       ├── Ingest.tsx      # PDF upload + RAG pipeline
│   │       ├── Sets.tsx        # Question set management
│   │       └── Submissions.tsx
│   ├── App.tsx                 # Routes + providers
│   ├── main.tsx                # Entry point
│   └── index.css               # Global styles
├── supabase/
│   └── migrations/             # SQL schema (run in order)
│       ├── 000_initial_schema.sql
│       ├── 001_add_syllabus_analysis_and_question_types.sql
│       └── 002_add_answers_table.sql
└── .env.example                # Environment template
```

---

## 🚀 Features

### Teacher Workflow
1. **Ingest** — Upload syllabus/lecture PDF → Python RAG extracts text, tables, diagrams (via Gemini Vision), OCR fallback
2. **Analyze** — View extracted chunks, verify grounding quality
3. **Generate** — Create citation-locked question sets (MCQ, Short Answer, Conceptual)
4. **Review** — Grade submissions with Gemma-powered WHY feedback
5. **Analytics** — Class performance, question difficulty, concept gaps

### Student Workflow
1. **Browse** — See assigned question sets
2. **Attempt** — Answer questions with source citations visible
3. **Feedback** — Receive WHY explanation: *what you missed, why, next step*

### RAG Pipeline (Python)
```
PDF → pdfplumber (text + tables→Markdown)
    → PyMuPDF (fallback text + image extraction)
    → Gemini Vision (diagram/chart description)
    → Tesseract OCR (scanned pages)
    → Semantic chunking (grounding metadata preserved)
    → Supabase pgvector storage
    → Retrieval → Context building → Gemma 4 generation
```

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role (server) |
| `VITE_SUPABASE_URL` | ✅ | Duplicate for Vite build |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Duplicate for Vite build |
| `VITE_GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key |
| `GEMINI_MODEL` | ❌ | Default: `gemini-1.5-flash` |
| `PORT` | ❌ | Server port (default: 3004) |

---

## 🛠️ Local Development

### Prerequisites
- Node.js 20+
- Python 3.11+
- Tesseract OCR (`brew install tesseract` / `apt install tesseract-ocr`)
- Supabase project (local or cloud)
- Google Cloud project (OAuth + Gemini API)

### Setup

```bash
# 1. Clone
git clone https://github.com/Parth99128/Equalu8.git
cd Equalu8

# 2. Install Node deps
npm install

# 3. Python environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate

# 4. Environment
cp .env.example .env
# Edit .env with your keys

# 5. Database
# Run migrations in supabase/migrations/ in order on your Supabase project

# 6. Dev servers (two terminals)
npm run dev          # Vite frontend on :5173
# OR unified server:
npm run start        # Express on :3004 (serves API + static)
```

---

## 🚀 Production Deployment (Azure VM)

### One-Time VM Setup

```bash
# On fresh Ubuntu 24.04 VM
ssh azureuser@YOUR_VM_IP 'bash -s' < deploy.sh
```

`deploy.sh` installs: Node 20, Python 3, Tesseract, Caddy, PM2, clones repo, builds, starts services.

### CI/CD (GitHub Actions)

**Required Secrets** (Repo → Settings → Secrets → Actions):
| Secret | Value |
|--------|-------|
| `VM_HOST` | `20.219.5.41` |
| `VM_USER` | `azureuser` |
| `VM_SSH_KEY` | Private SSH key (`cat ~/.ssh/id_rsa`) |
| `VITE_SUPABASE_URL` | `https://...supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` |
| `VITE_GOOGLE_CLIENT_ID` | `123...googleusercontent.com` |

**On every `git push main`:**
1. GitHub Actions builds frontend
2. SSHes to VM → `git pull` → `npm install` → `npm run build` → `pm2 restart`
3. Health check verifies deployment

### Custom Domain (Free)

**DuckDNS** (2 min):
1. [duckdns.org](https://duckdns.org) → GitHub login → subdomain `yourname.duckdns.org`
2. Point A record to VM IP
3. Update Caddy: `yourname.duckdns.org { reverse_proxy localhost:3004 }`
4. `sudo systemctl reload caddy` → Auto-HTTPS via Let's Encrypt

**Update OAuth:**
- Google Cloud: Add `https://yourname.duckdns.org` + `/auth/callback`
- Supabase: Site URL + Redirect URL same

---

## 🗄️ Database Schema (Key Tables)

```sql
-- Users & roles
profiles (id, email, name, role, avatar)

-- Teacher content
documents (id, teacher_id, title, file_path, extraction_stats, status)
question_sets (id, document_id, teacher_id, name, questions_json)
questions (id, set_id, type, prompt, answer, grounding_citations)

-- Student work
submissions (id, student_id, set_id, answers_json, score, feedback_json)
answers (id, submission_id, question_id, student_answer, evaluation_json)

-- Study materials (base64, no RAG)
study_materials (id, teacher_id, title, file_base64, mime_type)
```

Run migrations in order: `000 → 001 → 002`.

---

## 🔐 Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│  Supabase   │────▶│  Your App   │
│  (React)    │     │   Auth      │     │  (Profile)  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │ 1. signInWithOAuth│                   │
       │  (Google)         │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│  Redirect to /auth/callback                         │
│  → supabase.auth.getSession()                       │
│  → Create profile if missing (role from localStorage)│
│  → Navigate to /teacher/ingest or /student/assignments│
└─────────────────────────────────────────────────────┘
```

- **Email/Password**: `signUp` → `signInWithPassword` → profile creation
- **Google OAuth**: `signInWithOAuth` → callback → profile creation
- **Session**: Persisted in localStorage, restored on refresh via `onAuthStateChange`

---

## 🧪 Testing

```bash
# Frontend type-check + build
npm run build

# Python pipeline test
cd rag_engine
python -m ingest_cli --file ../test.pdf --filename test.pdf

# API health
curl http://localhost:3004/api/health
```

---

## 📊 Monitoring & Logs

```bash
# PM2
pm2 status
pm2 logs evalu8-server
pm2 monit

# Caddy
sudo systemctl status caddy
sudo journalctl -u caddy -f

# Supabase
# Dashboard → Logs → Auth / Database / Edge Functions
```

---

## 🔧 Troubleshooting

| Issue | Fix |
|-------|-----|
| `supabaseUrl is required` | `.env` missing Vite vars → rebuild |
| Python spawn ENOENT | Use full venv path in `ingest.js` |
| Fitz deprecation | `import pymupdf` with warning filter |
| Express 5 wildcard | Use `{*path}` not `*` |
| Login fails | Check Supabase providers + redirect URLs |
| Caddy no HTTPS | Domain must resolve to VM IP; check DNS |

---

## 📈 Roadmap

- [ ] Automated test suite (Vitest + Playwright)
- [ ] Staging environment (preview deployments)
- [ ] WebSocket for real-time grading updates
- [ ] Export results to CSV/PDF
- [ ] Multi-language support
- [ ] Plugin architecture for custom question types

---

## 🤝 Contributing

1. Fork → feature branch → PR
2. `npm run build` must pass
3. Follow existing code style (ESLint + Prettier)
4. Update migrations if schema changes

---

## 📄 License

Educational / research use. Built for **Google AI x Gemma 4** hackathon track.

---

## 🙏 Acknowledgments

- **Google Gemma Team** — Model access
- **Supabase** — Auth + Database + pgvector
- **PyMuPDF / pdfplumber / Tesseract** — Document extraction
- **Caddy** — Zero-config HTTPS
- **Azure for Students** — Free compute credit

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Parth99128/Equalu8/issues)
- **Architecture questions**: See `README.md` for pipeline details
- **Deployment help**: Check `deploy.sh` comments

---

**Live Demo**: https://evalu8.duckdns.org  
**Repository**: https://github.com/Parth99128/Equalu8

# EVALU8 — Gemma 4 Intelligent LMS

An AI-powered Learning Management System with a Python RAG engine for grounded question generation and evaluation. Built with React, TypeScript, Vite, Supabase, and Google Gemini.

## Features

### Teacher
- **Ingest** — Upload PDF/DOCX/TXT syllabi and lecture materials. Python extracts text, tables, diagrams, and charts, chunks them semantically, and indexes for retrieval.
- **Analyze** — AI-driven syllabus analysis: key concepts, module structure, learning objectives, and recommended question distribution.
- **Sets** — Generate grounded question sets (MCQ, short answer, conceptual) from ingested sources. Every question cites its grounding chunk.
- **Grade** — Review student submissions with AI-assisted evaluation and per-answer feedback.
- **Analytics** — Class-wide performance insights.

### Student
- **Assignments** — View and attempt assigned question sets.
- **Attempt** — Take quizzes with a clean, focused interface.
- **Feedback** — Receive AI-generated feedback with conceptual gap analysis and source citations.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React + TypeScript + Vite + Tailwind)    │
│  ├── Teacher: Ingest → Analyze → Sets → Grade       │
│  └── Student: Assignments → Attempt → Feedback      │
├─────────────────────────────────────────────────────┤
│  API Layer (Vercel Serverless Functions)            │
│  ├── ingest.js    — multipart upload → Python CLI   │
│  ├── syllabus-analysis.js — AI syllabus breakdown   │
│  ├── question-sets.js — question set CRUD           │
│  ├── questions.js   — question CRUD                 │
│  ├── answers.js     — answer storage                │
│  ├── submissions.js — submission management         │
│  ├── evaluate.js    — AI evaluation endpoint        │
│  ├── documents.js   — document library              │
│  ├── students.js    — student profiles              │
│  └── auth-profile.js — auth + profile management    │
├─────────────────────────────────────────────────────┤
│  Python RAG Engine (rag_engine/)                    │
│  ├── ingest_cli.py — text/table/vision extraction   │
│  ├── chunking.py   — semantic splitter w/ metadata  │
│  ├── retrieval.py  — lexical + grounding ranking    │
│  ├── generator.py  — Gemini-grounded question gen   │
│  ├── evaluator.py  — per-answer WHY diagnosis       │
│  ├── analyzer.py   — syllabus structure analysis    │
│  ├── ai_client.py  — Gemini API client              │
│  └── pipeline.py   — end-to-end orchestration       │
├─────────────────────────────────────────────────────┤
│  Supabase (PostgreSQL + Auth)                       │
│  └── documents, question_sets, questions, answers,  │
│      submissions, profiles                          │
└─────────────────────────────────────────────────────┘
```

### RAG Pipeline Flow

```
                              Upload → Extract Text/Tables/Visuals → Semantic Chunking → Index in Supabase
                                                                    ↓
                                          Retrieve Relevant Chunks ← Generate Questions
                                                                    ↓
                                               Evaluate Answers → Feedback w/ Citations
```

- **Chunking** — Sentence-aware splitter (1100 chars, 140 overlap) with grounding scores and page metadata.
- **Retrieval** — Lexical relevance + grounding score ranking builds RAG context.
- **Generation** — Calls Gemini 1.5 Flash via Google Generative Language API. Enforces verbatim grounding chunk citations — no question without a source.
- **Evaluation** — Per-answer diagnosis: feedback + conceptual gap analysis, chunk-cited, constructive.

## Models flow

""if one model i.e primary or else fails then the architecture follows the following flow:""
                                          |
                            1. gemma-4-26b-a4b-it ← primary (Gemma 4) 
                            2. gemma-4-31b-it ← Gemma 4
                            3. gemini-2.5-flash ← Gemini Flash
                            4. gemini-2.5-pro
                            5. gemini-2.0-flash
                            6. gemini-2.0-flash-lite
                            7. gemini-1.5-flash
                            8. gemini-1.5-pro
                            9. gemini-1.0-pro

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, Framer Motion |
| Backend  | Vercel Serverless Functions (Node.js) |
| AI/RAG   | Python 3, gemma-4-26b-a4b-it, pdfplumber, PyMuPDF, Tesseract OCR |
| Database | Supabase (PostgreSQL + Auth) |
| Auth     | Supabase Auth + Google OAuth |

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) (for scanned PDF support)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd evalu8
   ```

2. **Install Node dependencies**
   ```bash
   npm install
   ```

3. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase and Gemini API keys
   ```

5. **Set up the database**
   - Create a Supabase project
   - Run the SQL migrations in `supabase/migrations/` in order

6. **Run the dev server**
   ```bash
   npx vercel dev
   # or
   npm run dev
   ```

   The app will be available at `http://localhost:3004`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL` | Gemini model (default: `gemini-1.5-flash`) |

See `.env.example` for all variables.

## Project Structure

```
├── api/                    # Vercel serverless functions
├── rag_engine/             # Python RAG engine
├── src/
│   ├── components/         # Shared React components
│   ├── contexts/           # React contexts (Auth)
│   ├── layouts/            # Teacher & Student layouts
│   ├── lib/                # API client, Supabase, Google Auth
│   └── pages/
│       ├── teacher/        # Ingest, Analyze, Sets, Submissions, Analytics
│       └── student/        # Assignments, Attempt, Feedback
├── supabase/migrations/    # SQL schema migrations
├── public/                 # Static assets
├── .env.example            # Environment variable template
└── vercel.json.example     # Vercel config template (secrets removed)
```

## Document Ingestion

The ingest pipeline supports multi-source extraction:

| Source Type | How it is handled |
|-------------|-------------------|
| **Text-based PDFs** | Extracted via pdfplumber / PyMuPDF |
| **Tables in PDFs** | Extracted via `pdfplumber.extract_tables()`, converted to Markdown format |
| **Tables in DOCX** | Extracted via python-docx table API, converted to Markdown |
| **Diagrams / Charts / Flowcharts** | Gemini vision model describes visual content (type, labels, structure, data values) |
| **Scanned/image PDFs** | OCR fallback via Tesseract (renders pages at 150 DPI) |
| **DOCX** | Paragraphs + tables extracted via python-docx |
| **TXT/MD** | Direct file read |

### Extraction Pipeline

```
1. pdfplumber: text + table extraction (tables converted to Markdown)
2. PyMuPDF: text (if pdfplumber got nothing) + vision model for images/diagrams
3. Tesseract OCR: fallback for scanned/image-only PDFs
```

The vision model (Gemini) analyzes embedded images and diagram-heavy pages, producing structured text descriptions that capture:
- Visual type (flowchart, bar chart, diagram, etc.)
- All labels, nodes, and text elements
- Structure and relationships (arrows, connections, hierarchy)
- Data values, axes, and numerical information

Extracted content is semantically chunked with grounding metadata and stored in Supabase for retrieval. The output includes `extraction_stats` showing how many tables and visuals were found.

## License

This project is for educational purposes.

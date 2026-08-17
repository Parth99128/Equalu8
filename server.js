/**
 * server.js — Unified Express Server
 * Replaces Vercel's serverless routing for VM deployment.
 *
 * - Serves static frontend from dist/ (built Vite output)
 * - Mounts all /api/*.js handlers as Express routes
 * - Python (rag_engine/ingest_cli.py) is spawned by /api/ingest as a subprocess
 * - Single process, single port — no serverless, no Docker required
 */

// ── Load .env BEFORE any other imports (Vercel injects env vars automatically;
//    on a VM we need to load them from a .env file before db-client.js runs) ──
// CRITICAL: ES module static imports are hoisted — they execute BEFORE any code.
// Since db-client.js calls createClient() at module top-level, we must NOT
// statically import the API handlers. We use dynamic imports (await import())
// AFTER dotenv.config() runs so env vars are available.
import { config } from 'dotenv';
config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ── API handlers loaded dynamically AFTER .env is loaded ──
// db-client.js creates a Supabase client at import time and needs env vars.
const [
  { default: answersHandler },
  { default: authProfileHandler },
  { default: documentsHandler },
  { default: evaluateHandler },
  { default: gemmaConfigHandler },
  { default: ingestHandler },
  { default: questionSetsHandler },
  { default: questionsHandler },
  { default: studentsHandler },
  { default: studyMaterialsHandler },
  { default: submissionsHandler },
  { default: syllabusAnalysisHandler },
] = await Promise.all([
  import('./api/answers.js'),
  import('./api/auth-profile.js'),
  import('./api/documents.js'),
  import('./api/evaluate.js'),
  import('./api/gemma-config.js'),
  import('./api/ingest.js'),
  import('./api/question-sets.js'),
  import('./api/questions.js'),
  import('./api/students.js'),
  import('./api/study-materials.js'),
  import('./api/submissions.js'),
  import('./api/syllabus-analysis.js'),
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3004;

// ── Middleware ──
// Parse JSON bodies (for non-multipart requests)
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS headers (matching what Vercel functions set individually)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// ── Raw body capture for multipart endpoints (ingest, study-materials) ──
// These endpoints need the raw Buffer body, not parsed JSON.
// We capture it before Express parsing and attach it to req for those routes.
app.use('/api/ingest', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    req._rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
});

app.use('/api/study-materials', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const contentType = req.headers['content-type'] || '';
  // Only capture raw body for multipart (file uploads)
  if (!contentType.startsWith('multipart/form-data')) return next();
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    req._rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
});

// ── API Routes ──
// Each handler is a Vercel-style function: async function handler(req, res)
// We wrap it to work with Express by passing req/res directly.
// Express req has .method, .headers, .query, .body — same as Vercel's req.
// For multipart routes, we restore req.body to the raw Buffer.

function wrapHandler(handler) {
  return async (req, res) => {
    try {
      // For multipart endpoints, restore raw body if captured
      if (req._rawBody) {
        req.body = req._rawBody;
      }
      await handler(req, res);
    } catch (err) {
      console.error(`API error [${req.method} ${req.path}]:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  };
}

// Mount all API routes — ALL methods go to the same handler (they switch on req.method internally)
const apiRoutes = {
  '/api/answers': answersHandler,
  '/api/auth-profile': authProfileHandler,
  '/api/documents': documentsHandler,
  '/api/evaluate': evaluateHandler,
  '/api/gemma-config': gemmaConfigHandler,
  '/api/ingest': ingestHandler,
  '/api/question-sets': questionSetsHandler,
  '/api/questions': questionsHandler,
  '/api/students': studentsHandler,
  '/api/study-materials': studyMaterialsHandler,
  '/api/submissions': submissionsHandler,
  '/api/syllabus-analysis': syllabusAnalysisHandler,
};

for (const [route, handler] of Object.entries(apiRoutes)) {
  app.all(route, wrapHandler(handler));
}

// ── Health check endpoint ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    node: process.version,
    python: 'available via subprocess',
  });
});

// ── Serve static frontend (built Vite output) ──
const distPath = path.join(__dirname, 'dist');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  // SPA fallback — all non-API, non-static routes serve index.html
  // This handles React Router routes like /teacher/analyze, /student/assignments, etc.
  // Express 5 uses path-to-regexp v8 — '*' is invalid, use '{*path}' catch-all syntax
  app.get('{*path}', (req, res) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.warn('⚠️  dist/ directory not found. Run "npm run build" first.');
  app.get('{*path}', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(503).send('Frontend not built. Run: npm run build');
  });
}

// ── Start server ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  EVALU8 Server running on port ${PORT}              ║`);
  console.log(`║  Frontend:  http://localhost:${PORT}                ║`);
  console.log(`║  API:       http://localhost:${PORT}/api/health     ║`);
  console.log(`║  Static:    ${distPath}  ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
});

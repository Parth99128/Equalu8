import supabase from './db-client.js';

function envKey(){
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMMA_API_KEY || process.env.VITE_GEMINI_API_KEY || null;
  return key;
}

async function viaGemini(prompt){
  const key = envKey();
  if(!key) return null;
  const models = ['gemma-4-26b-a4b-it','gemma-4-31b-it','gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash','gemini-2.0-flash-lite','gemini-1.5-flash','gemini-1.5-pro','gemini-1.0-pro'];
  for(const model of models){
    try{
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.3, maxOutputTokens:8192} }) });
      if(res.status===404) continue;
      if(!res.ok) continue;
      const j = await res.json();
      let t = null;
      const parts = j?.candidates?.[0]?.content?.parts;
      if(parts && parts.length > 0) {
        for(const part of parts) {
          if(part.text && !part.thought) { t = part.text; break; }
        }
        if(!t && parts[parts.length - 1].text) t = parts[parts.length - 1].text;
      }
      if(t) return t;
    }catch(e){ continue; }
  }
  return null;
}

async function viaPollinations(prompt){
  const short = prompt.slice(0,1300).replace(/\n/g,' ').trim();
  let tries=0;
  while(tries<4){
    tries++;
    const nonce = Math.floor(Math.random()*9999999);
    const enc = encodeURIComponent(short + ` id:${nonce}`);
    const url = `https://text.pollinations.ai/${enc}?seed=${Math.floor(Math.random()*999999)}`;
    try{
      const res = await fetch(url, { headers:{ 'User-Agent':'EVALU8/2.0', 'Accept':'text/plain' } });
      const text = await res.text();
      if(res.ok && text && !/queue full|payment required|price:\s*poll/i.test(text) && text.trim().length>20) return text;
      await new Promise(r=>setTimeout(r, 1200*tries));
    }catch(e){ await new Promise(r=>setTimeout(r, 900)); }
  }
  return null;
}

async function callModel(prompt){
  const t1 = await viaGemini(prompt);
  if(t1) return t1;
  const t2 = await viaPollinations(prompt);
  if(t2) return t2;
  return null;
}

function localAnalyze(doc){
  const chunks = doc.chunks || [];
  const title = doc.title || 'Course Module';
  const allText = chunks.map(c=>c.text).join(' ') || doc.content || '';
  
  // Simple heuristic analysis
  const modules = [];
  let currentModule = null;
  
  for(let i=0; i<chunks.length; i++){
    const chunk = chunks[i];
    const text = chunk.text;
    
    // Detect module headers (lines starting with "Module" or "MODULE" or numbered sections)
    const moduleMatch = text.match(/^(Module|MODULE|Unit|UNIT)\s+(\d+|[IVX]+)[:.\s]/im);
    if(moduleMatch){
      if(currentModule) modules.push(currentModule);
      currentModule = {
        id: modules.length + 1,
        title: moduleMatch[0].replace(/[:.]$/, '').trim(),
        order: modules.length + 1,
        topics: [],
        chunk_indices: [i]
      };
    } else if(currentModule){
      currentModule.chunk_indices.push(i);
      // Extract topics from capitalized phrases
      const topics = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g) || [];
      for(const t of topics.slice(0,3)){
        if(!currentModule.topics.find(tp => tp.title === t)){
          currentModule.topics.push({
            id: `${currentModule.id}.${currentModule.topics.length + 1}`,
            title: t,
            key_concepts: [t],
            learning_objectives: [`Understand ${t}`],
            chunk_indices: [i]
          });
        }
      }
    } else {
      // No module detected yet, create a default one
      if(!currentModule){
        currentModule = {
          id: 1,
          title: 'General Content',
          order: 1,
          topics: [],
          chunk_indices: [i]
        };
      }
      currentModule.chunk_indices.push(i);
    }
  }
  if(currentModule) modules.push(currentModule);
  
  // If no modules detected, create one from all chunks
  if(modules.length === 0){
    modules.push({
      id: 1,
      title: title,
      order: 1,
      topics: [{
        id: '1.1',
        title: 'Core Concepts',
        key_concepts: ['Core Concepts'],
        learning_objectives: ['Understand the main concepts'],
        chunk_indices: Array.from({length: chunks.length}, (_, i) => i)
      }],
      chunk_indices: Array.from({length: chunks.length}, (_, i) => i)
    });
  }
  
  // Concept coverage
  const conceptCounts = {};
  for(const chunk of chunks){
    const concepts = chunk.text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g) || [];
    for(const c of concepts){
      conceptCounts[c] = (conceptCounts[c] || 0) + 1;
    }
  }
  const concept_coverage = Object.entries(conceptCounts)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 20)
    .map(([concept, count]) => ({ concept, chunk_count: count, modules: modules.map(m => m.title) }));
  
  // Suggested distribution
  const totalQuestions = Math.min(Math.max(chunks.length, 6), 20);
  const mcqCount = Math.max(1, Math.round(totalQuestions * 0.4));
  const shortCount = Math.max(1, Math.round(totalQuestions * 0.3));
  const conceptualCount = totalQuestions - mcqCount - shortCount;
  
  const per_module = {};
  for(const m of modules){
    const modQuestions = Math.max(1, Math.round(totalQuestions * (m.chunk_indices.length / chunks.length)));
    per_module[m.id] = {
      mcq: Math.max(1, Math.round(modQuestions * 0.4)),
      short: Math.max(1, Math.round(modQuestions * 0.3)),
      conceptual: Math.max(1, modQuestions - Math.round(modQuestions * 0.4) - Math.round(modQuestions * 0.3))
    };
  }
  
  return {
    modules,
    concept_coverage,
    suggested_distribution: { mcq: mcqCount, short: shortCount, conceptual: conceptualCount, per_module },
    prerequisites: [],
    total_chunks: chunks.length
  };
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS') return res.status(204).end();
  
  if(req.method!=='POST'){
    return res.status(405).json({error:'Method not allowed'});
  }
  
  console.log('syllabus-analysis: req.body =', req.body);
  console.log('syllabus-analysis: req.headers =', req.headers);
  
  try{
    const { document_ids } = req.body;
    if(!document_ids || !Array.isArray(document_ids) || document_ids.length === 0){
      return res.status(400).json({error:'document_ids array required'});
    }
    
    // Fetch all documents
    const { data: docs, error } = await supabase
      .from('documents')
      .select('*')
      .in('id', document_ids);
    
    if(error) throw error;
    if(!docs || docs.length === 0){
      return res.status(404).json({error:'No documents found'});
    }
    
    // Combine chunks from all documents
    const allChunks = [];
    const allContent = [];
    for(const doc of docs){
      if(doc.chunks && doc.chunks.length > 0){
        for(const chunk of doc.chunks){
          allChunks.push({...chunk, document_id: doc.id, document_title: doc.title});
        }
      }
      if(doc.content) allContent.push(doc.content);
    }
    
    const combinedDoc = {
      title: docs.map(d => d.title).join(' + '),
      chunks: allChunks,
      content: allContent.join('\n\n')
    };
    
    // Try AI analysis first
    let analysis = null;
    const prompt = `You are an expert curriculum analyst. Given document chunks from a syllabus/course material, extract:
1. Module hierarchy (ordered)
2. Topics per module with key concepts
3. Learning objectives (explicit or inferred)
4. Concept coverage frequency
5. Prerequisite relationships

Return structured JSON only with this exact schema:
{
  "modules": [
    {
      "id": 1,
      "title": "Module 1: Foundations",
      "order": 1,
      "topics": [
        {
          "id": "1.1",
          "title": "Perceptron",
          "key_concepts": ["Perceptron", "Linear Separability"],
          "learning_objectives": ["Understand perceptron learning rule"],
          "chunk_indices": [0, 1]
        }
      ],
      "chunk_indices": [0, 1, 2]
    }
  ],
  "concept_coverage": [
    {"concept": "Perceptron", "chunk_count": 3, "modules": ["Module 1: Foundations"]}
  ],
  "suggested_distribution": {
    "mcq": 8,
    "short": 6,
    "conceptual": 4,
    "per_module": {"1": {"mcq": 4, "short": 3, "conceptual": 2}}
  },
  "prerequisites": [
    {"concept": "Gradient Descent", "depends_on": ["Linear Algebra"]}
  ],
  "total_chunks": 10
}

DOCUMENT TITLE: ${combinedDoc.title}
CHUNKS:
${combinedDoc.chunks.map((c,i) => `[Chunk ${i+1} | Doc: ${c.document_title} | p${c.page}]: ${c.text.slice(0,500)}`).join('\n\n')}

FULL CONTENT PREVIEW:
${combinedDoc.content.slice(0,8000)}`;
    
    try{
      const raw = await callModel(prompt);
      if(raw){
        const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
        const blob = (start!==-1 && end!==-1 ? raw.slice(start,end+1) : raw).replace(/```json|```/g,'').trim();
        const parsed = JSON.parse(blob);
        if(parsed && parsed.modules && Array.isArray(parsed.modules)){
          analysis = parsed;
        }
      }
    }catch(e){
      console.warn('AI analysis failed, using local:', e.message);
    }
    
    if(!analysis){
      analysis = localAnalyze(combinedDoc);
    }
    
    // Store analysis in each document
    for(const doc of docs){
      await supabase
        .from('documents')
        .update({ syllabus_analysis: analysis, module_structure: analysis.modules })
        .eq('id', doc.id);
    }
    
    return res.status(200).json(analysis);
    
  }catch(err){
    console.error('syllabus-analysis handler', err);
    res.status(500).json({error: String(err.message||'failed').slice(0,900)});
  }
}
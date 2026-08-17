import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Parse multipart form data
    const contentType = req.headers['content-type'] || '';
    console.log('Content-Type:', contentType);
    if (!contentType.startsWith('multipart/form-data')) {
      return res.status(400).json({ error: 'Expected multipart/form-data' });
    }
    
    // Get the boundary
    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    const boundary = boundaryMatch ? boundaryMatch[1].trim() : null;
    console.log('Boundary:', boundary);
    if (!boundary) {
      return res.status(400).json({ error: 'No boundary found' });
    }
    
    // Read the body
    console.log('Request object keys:', Object.keys(req));
    console.log('Request method:', req.method);
    console.log('Request headers:', req.headers);
    console.log('Request body:', req.body);
    console.log('Request rawBody:', req.rawBody);
    console.log('Request readable:', req.readable);
    console.log('Request socket:', req.socket ? 'exists' : 'none');
    console.log('Request _readableState:', req._readableState ? 'exists' : 'none');
    
    // Try to read from req directly if it has a body property
    let body;
    if (req.body) {
      console.log('Using req.body directly');
      body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    } else {
      // Use event-based reading for Node.js streams
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on('data', (chunk) => {
          console.log('Got data event:', chunk.length);
          chunks.push(chunk);
        });
        req.on('end', () => {
          console.log('Request ended');
          resolve();
        });
        req.on('error', (err) => {
          console.log('Request error:', err);
          reject(err);
        });
      });
      body = Buffer.concat(chunks);
    }
    console.log('Body length:', body.length);
    console.log('Body preview:', body.slice(0, 500).toString());
    
    // Parse multipart manually
    // The boundary in content-type doesn't include the leading --, but the actual parts do
    // Parts are separated by \r\n--boundary\r\n
    const boundaryBytes = Buffer.from('\r\n--' + boundary);
    const parts = splitBuffer(body, boundaryBytes);
    console.log('Parts found:', parts.length);
    console.log('First part preview:', parts[0] ? parts[0].slice(0, 200).toString() : 'none');
    
    let fileData = null;
    let filename = null;
    
    for (const part of parts) {
      if (!part.length || part.equals(Buffer.from('--'))) continue;
      
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      
      const headersRaw = part.slice(0, headerEnd).toString();
      const content = part.slice(headerEnd + 4);
      
      // Remove trailing \r\n
      let cleanContent = content;
      if (cleanContent.length >= 2 && cleanContent[cleanContent.length - 2] === 0x0d && cleanContent[cleanContent.length - 1] === 0x0a) {
        cleanContent = cleanContent.slice(0, -2);
      }
      
      // Parse headers
      const headers = {};
      for (const line of headersRaw.split('\r\n')) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          headers[line.slice(0, colonIndex).toLowerCase().trim()] = line.slice(colonIndex + 1).trim();
        }
      }
      
      console.log('Part headers:', headers);
      const contentDisp = headers['content-disposition'] || '';
      if (contentDisp.includes('filename=')) {
        // Extract filename
        const match = contentDisp.match(/filename="([^"]+)"/);
        if (match) {
          filename = match[1];
          fileData = cleanContent;
          console.log('Found file:', filename, 'size:', fileData.length);
        }
      }
    }
    
    if (!fileData || !filename) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Save to temp file
    const ext = filename.split('.').pop();
    const tmpPath = path.join(os.tmpdir(), `upload_${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, fileData);
    
    try {
      // Call Python script for text extraction and chunking
      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      // On Windows, file:// URLs start with /C:/... so we need to remove the leading slash
      const normalizedDirname = __dirname.startsWith('/') ? __dirname.slice(1) : __dirname;
      const pythonScript = path.join(normalizedDirname, '..', 'rag_engine', 'ingest_cli.py');
      console.log('Python script path:', pythonScript);
      console.log('Calling Python script with args:', [tmpPath, filename]);
      const result = await runPythonScript(pythonScript, [tmpPath, filename]);
      console.log('Python script result:', JSON.stringify(result).slice(0, 500));
      
      if (result.error) {
        console.error('Python script error:', result.error);
        return res.status(500).json({ error: result.error });
      }
      
      // Store in Supabase if configured
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      console.log('Supabase URL:', supabaseUrl ? 'SET' : 'NOT SET');
      console.log('Supabase Service Role Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'NOT SET');
      if (supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.log('Creating Supabase client...');
        const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
        
        console.log('Inserting document into Supabase...');
        const { data, error } = await supabase
          .from('documents')
          .insert({
            title: result.title,
            original_name: filename,
            content: result.content,
            chunks: result.chunks,
            status: 'parsed'
          })
          .select()
          .single();
        
        if (error) {
          console.error('Supabase error:', error);
          return res.status(500).json({ error: 'Failed to store document' });
        }
        
        console.log('Document inserted successfully:', data.id);
        return res.json(data);
      } else {
        // Return without storing
        console.log('Supabase not configured, returning without storing');
        return res.json({
          title: result.title,
          original_name: filename,
          content: result.content,
          chunks: result.chunks,
          status: 'parsed'
        });
      }
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  } catch (error) {
    console.error('Ingest error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  
  while (true) {
    const index = buffer.indexOf(delimiter, start);
    if (index === -1) break;
    
    if (index > start) {
      parts.push(buffer.slice(start, index));
    }
    start = index + delimiter.length;
  }
  
  if (start < buffer.length) {
    parts.push(buffer.slice(start));
  }
  
  return parts;
}

function runPythonScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    // Resolve Python executable — prefer project venv, then system Python
    let python = process.platform === 'win32' ? 'python' : 'python3';
    if (process.platform === 'win32') {
      const venvPython = path.join(process.cwd(), '.venv', 'Scripts', 'python.exe');
      if (fs.existsSync(venvPython)) {
        python = venvPython;
      } else {
        // Fallback to full system path to avoid Windows Store stub
        const systemPython = 'C:\\Users\\Parth\\AppData\\Local\\Programs\\Python\\Python314\\python.exe';
        if (fs.existsSync(systemPython)) {
          python = systemPython;
        }
      }
    }
    console.log('Spawning Python:', python, scriptPath, args);
    
    // Set up environment with Tesseract PATH for Windows
    const env = { ...process.env };
    if (process.platform === 'win32') {
      const tesseractPaths = [
        'C:\\Program Files\\Tesseract-OCR',
        'C:\\Program Files (x86)\\Tesseract-OCR',
        'C:\\Users\\Parth\\AppData\\Local\\Programs\\Tesseract-OCR',
      ];
      const existingPath = env.PATH || '';
      for (const tp of tesseractPaths) {
        if (!existingPath.includes(tp)) {
          env.PATH = tp + ';' + existingPath;
        }
      }
    }
    console.log('Python env PATH:', env.PATH);
    
    const child = spawn(python, [scriptPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => { 
      console.log('Python stdout:', data.toString().slice(0, 200));
      stdout += data.toString(); 
    });
    child.stderr.on('data', (data) => { 
      console.log('Python stderr:', data.toString().slice(0, 200));
      stderr += data.toString(); 
    });
    
    child.on('close', (code) => {
      console.log('Python process exited with code:', code);
      console.log('Python stdout:', stdout);
      console.log('Python stderr:', stderr);
      if (code !== 0) {
        // Python script prints JSON error to stdout before sys.exit(1)
        // Try to parse the actual error from stdout first, then fall back to stderr
        let errorMsg = stderr || `Python script exited with code ${code}`;
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed && parsed.error) {
            errorMsg = parsed.error;
          }
        } catch (e) {
          // stdout wasn't valid JSON — use stderr if available, or include raw stdout
          if (stderr) {
            errorMsg = stderr;
          } else if (stdout.trim()) {
            errorMsg = stdout.trim();
          }
        }
        resolve({ error: errorMsg });
      } else {
        // The Python script may print warnings (e.g. fitz deprecation) to stdout
        // before the JSON output. Find the first '{' and parse from there.
        const trimmed = stdout.trim();
        const jsonStart = trimmed.indexOf('{');
        if (jsonStart === -1) {
          resolve({ error: 'No JSON output from Python script. stdout: ' + trimmed.slice(0, 500) });
        } else {
          const jsonStr = trimmed.slice(jsonStart);
          try {
            const result = JSON.parse(jsonStr);
            resolve(result);
          } catch (e) {
            // Try to find the last valid JSON object (in case there's trailing text too)
            const jsonEnd = jsonStr.lastIndexOf('}');
            if (jsonEnd > 0) {
              try {
                const result = JSON.parse(jsonStr.slice(0, jsonEnd + 1));
                resolve(result);
              } catch (e2) {
                resolve({ error: 'Invalid JSON from Python script: ' + jsonStr.slice(0, 500) });
              }
            } else {
              resolve({ error: 'Invalid JSON from Python script: ' + jsonStr.slice(0, 500) });
            }
          }
        }
      }
    });
    
    child.on('error', (err) => {
      console.error('Python spawn error:', err);
      resolve({ error: 'Failed to spawn Python: ' + err.message });
    });
  });
}
import supabase from './db-client.js';

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  while (true) {
    const index = buffer.indexOf(delimiter, start);
    if (index === -1) break;
    if (index > start) parts.push(buffer.slice(start, index));
    start = index + delimiter.length;
  }
  if (start < buffer.length) parts.push(buffer.slice(start));
  return parts;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // GET — list study materials (optionally filter published_only)
    // GET ?download=true&id=X — serve the raw file for download
    if (req.method === 'GET') {
      const { published_only, category, download, id } = req.query;

      // Download mode — serve raw file data
      if (download === 'true' && id) {
        const { data, error } = await supabase.from('study_materials').select('*').eq('id', id).single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Not found' });
        if (!data.file_data) {
          if (data.file_url) return res.redirect(302, data.file_url);
          return res.status(404).json({ error: 'No file data' });
        }
        const buf = Buffer.from(data.file_data, 'base64');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${data.file_name}"`);
        return res.status(200).send(buf);
      }

      let q = supabase.from('study_materials').select('*').order('created_at', { ascending: false });
      if (published_only === 'true') q = q.eq('is_published', true);
      if (category) q = q.eq('category', category);
      const { data, error } = await q;
      if (error) throw error;
      // Strip file_data from list responses to keep payload small
      const clean = (data || []).map(m => {
        const { file_data, ...rest } = m;
        return { ...rest, has_file: !!file_data };
      });
      return res.status(200).json(clean);
    }

    // POST — create a new study material
    // Supports two modes:
    //   1. multipart/form-data (file upload) — stores file as base64 in DB
    //   2. application/json (link or metadata only)
    if (req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';

      if (contentType.startsWith('multipart/form-data')) {
        // --- File upload mode (no Python, no RAG — just store the file) ---
        const boundaryMatch = contentType.match(/boundary=([^;]+)/);
        const boundary = boundaryMatch ? boundaryMatch[1].trim() : null;
        if (!boundary) return res.status(400).json({ error: 'No boundary found' });

        let body;
        if (req.body) {
          body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
        } else {
          const chunks = [];
          await new Promise((resolve, reject) => {
            req.on('data', c => chunks.push(c));
            req.on('end', resolve);
            req.on('error', reject);
          });
          body = Buffer.concat(chunks);
        }

        const boundaryBytes = Buffer.from('\r\n--' + boundary);
        const parts = splitBuffer(body, boundaryBytes);

        let fileData = null;
        let fileName = null;
        let fileType = null;
        let fileSize = 0;
        let category = 'syllabus';
        let title = null;
        let description = null;

        for (const part of parts) {
          if (!part.length || part.equals(Buffer.from('--'))) continue;
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const headersRaw = part.slice(0, headerEnd).toString();
          let content = part.slice(headerEnd + 4);
          if (content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a) {
            content = content.slice(0, -2);
          }

          const headers = {};
          for (const line of headersRaw.split('\r\n')) {
            const ci = line.indexOf(':');
            if (ci > 0) headers[line.slice(0, ci).toLowerCase().trim()] = line.slice(ci + 1).trim();
          }

          const contentDisp = headers['content-disposition'] || '';
          const nameMatch = contentDisp.match(/name="([^"]+)"/);
          const fieldName = nameMatch ? nameMatch[1] : null;

          if (contentDisp.includes('filename=')) {
            const match = contentDisp.match(/filename="([^"]+)"/);
            if (match) {
              fileName = match[1];
              fileData = content;
              fileSize = content.length;
              const ext = fileName.split('.').pop()?.toLowerCase() || '';
              fileType = ext;
            }
          } else if (fieldName === 'category') {
            category = content.toString().trim() || 'syllabus';
          } else if (fieldName === 'title') {
            title = content.toString().trim();
          } else if (fieldName === 'description') {
            description = content.toString().trim();
          }
        }

        if (!fileData || !fileName) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        // Limit file size to ~5MB
        if (fileSize > 5 * 1024 * 1024) {
          return res.status(413).json({ error: 'File too large (max 5MB for study materials)' });
        }

        const base64Data = fileData.toString('base64');
        const finalTitle = title || fileName.replace(/\.[^/.]+$/, '');

        const { data, error } = await supabase.from('study_materials').insert({
          title: finalTitle,
          description: description || `Uploaded file: ${fileName}`,
          file_name: fileName,
          file_type: fileType,
          file_size: fileSize,
          file_data: base64Data,
          file_url: null,
          category,
          is_published: false
        }).select().single();

        if (error) throw error;
        return res.status(201).json(data);
      }

      // --- JSON mode (link or metadata) ---
      const { title, description, file_name, file_type, file_size, file_data, file_url, category } = req.body;
      if (!title || !file_name) return res.status(400).json({ error: 'title and file_name required' });
      const { data, error } = await supabase.from('study_materials').insert({
        title,
        description: description || null,
        file_name,
        file_type: file_type || null,
        file_size: file_size || null,
        file_data: file_data || null,
        file_url: file_url || null,
        category: category || 'syllabus',
        is_published: false
      }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    // PUT — update a study material (publish/unpublish, edit metadata)
    if (req.method === 'PUT') {
      const { id, title, description, category, is_published, file_url } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const updates = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (category !== undefined) updates.category = category;
      if (file_url !== undefined) updates.file_url = file_url;
      if (typeof is_published === 'boolean') {
        updates.is_published = is_published;
        updates.published_at = is_published ? new Date().toISOString() : null;
      }
      updates.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from('study_materials').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    // DELETE — remove a study material
    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const { error } = await supabase.from('study_materials').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('study-materials API error:', err);
    res.status(500).json({ error: err.message });
  }
}

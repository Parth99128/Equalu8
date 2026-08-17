-- Migration: Study Materials — teacher shares syllabus/notes with students
-- Run this in Supabase SQL Editor

-- 1. Create study_materials table
CREATE TABLE IF NOT EXISTS study_materials (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  file_data TEXT,
  file_url TEXT,
  category TEXT DEFAULT 'syllabus',
  is_published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add indexes
CREATE INDEX IF NOT EXISTS idx_study_materials_published ON study_materials(is_published);
CREATE INDEX IF NOT EXISTS idx_study_materials_created_at ON study_materials(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_materials_category ON study_materials(category);

-- 3. RLS Policies
ALTER TABLE study_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read study_materials" ON study_materials;
DROP POLICY IF EXISTS "Service role full access study_materials" ON study_materials;

CREATE POLICY "Public read study_materials" ON study_materials FOR SELECT USING (true);
CREATE POLICY "Service role full access study_materials" ON study_materials FOR ALL USING (auth.role() = 'service_role');

-- 4. Comment
COMMENT ON TABLE study_materials IS 'Teacher-shared study materials (syllabus, notes, slides) accessible to students';

-- Initial schema for EVALU8 project (idempotent - safe to run multiple times)
-- Run this in Supabase SQL Editor for new project

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Documents table
CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  original_name TEXT,
  content TEXT,
  chunks JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'parsed',
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  syllabus_analysis JSONB,
  module_structure JSONB
);

-- 2. Question sets table
CREATE TABLE IF NOT EXISTS question_sets (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT REFERENCES documents(id) ON DELETE CASCADE,
  total_questions INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  question_types JSONB,
  module_filter JSONB,
  document_weights JSONB
);

-- 3. Questions table
CREATE TABLE IF NOT EXISTS questions (
  id BIGSERIAL PRIMARY KEY,
  set_id BIGINT REFERENCES question_sets(id) ON DELETE CASCADE,
  document_id BIGINT REFERENCES documents(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq', 'short', 'conceptual')),
  options JSONB,
  correct_answer TEXT NOT NULL,
  concept_tag TEXT,
  difficulty TEXT CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  explanation TEXT,
  grounding_chunk TEXT,
  points INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Students table
CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Profiles table (for auth)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT CHECK (role IN ('teacher', 'student')),
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Students table
CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Submissions table
CREATE TABLE IF NOT EXISTS submissions (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
  set_id BIGINT REFERENCES question_sets(id) ON DELETE CASCADE,
  document_id BIGINT REFERENCES documents(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score INTEGER,
  total INTEGER,
  status TEXT DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_sets_document_id ON question_sets(document_id);
CREATE INDEX IF NOT EXISTS idx_questions_set_id ON questions(set_id);
CREATE INDEX IF NOT EXISTS idx_questions_document_id ON questions(document_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_set_id ON submissions(set_id);
CREATE INDEX IF NOT EXISTS idx_documents_syllabus_analysis ON documents USING GIN (syllabus_analysis);
CREATE INDEX IF NOT EXISTS idx_question_sets_question_types ON question_sets USING GIN (question_types);
CREATE INDEX IF NOT EXISTS idx_question_sets_module_filter ON question_sets USING GIN (module_filter);
CREATE INDEX IF NOT EXISTS idx_question_sets_document_weights ON question_sets USING GIN (document_weights);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- 7. RLS Policies (enable row level security)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "Public read documents" ON documents;
DROP POLICY IF EXISTS "Public read question_sets" ON question_sets;
DROP POLICY IF EXISTS "Public read questions" ON questions;
DROP POLICY IF EXISTS "Public read profiles" ON profiles;
DROP POLICY IF EXISTS "Service role full access documents" ON documents;
DROP POLICY IF EXISTS "Service role full access question_sets" ON question_sets;
DROP POLICY IF EXISTS "Service role full access questions" ON questions;
DROP POLICY IF EXISTS "Service role full access profiles" ON profiles;
DROP POLICY IF EXISTS "Service role full access students" ON students;
DROP POLICY IF EXISTS "Service role full access submissions" ON submissions;

-- Public read access for documents, question_sets, questions, profiles
CREATE POLICY "Public read documents" ON documents FOR SELECT USING (true);
CREATE POLICY "Public read question_sets" ON question_sets FOR SELECT USING (true);
CREATE POLICY "Public read questions" ON questions FOR SELECT USING (true);
CREATE POLICY "Public read profiles" ON profiles FOR SELECT USING (true);

-- Service role has full access
CREATE POLICY "Service role full access documents" ON documents FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access question_sets" ON question_sets FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access questions" ON questions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access profiles" ON profiles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access students" ON students FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access submissions" ON submissions FOR ALL USING (auth.role() = 'service_role');

-- 8. Comments
COMMENT ON TABLE documents IS 'Uploaded syllabus documents with chunks and analysis';
COMMENT ON TABLE question_sets IS 'Generated question sets with metadata';
COMMENT ON TABLE questions IS 'Individual questions with grounding chunks';
COMMENT ON TABLE students IS 'Student accounts';
COMMENT ON TABLE submissions IS 'Student submissions with evaluations';
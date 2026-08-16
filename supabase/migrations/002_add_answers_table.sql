-- Migration: Add answers table for evaluation
-- Run this in Supabase SQL Editor

-- 1. Create answers table
CREATE TABLE IF NOT EXISTS answers (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT REFERENCES submissions(id) ON DELETE CASCADE,
  question_id BIGINT REFERENCES questions(id) ON DELETE CASCADE,
  student_answer TEXT,
  is_correct BOOLEAN DEFAULT FALSE,
  score INTEGER DEFAULT 0,
  max_score INTEGER DEFAULT 10,
  feedback TEXT,
  conceptual_gap TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add indexes
CREATE INDEX IF NOT EXISTS idx_answers_submission_id ON answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers(question_id);

-- 3. RLS Policies
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read answers" ON answers;
DROP POLICY IF EXISTS "Service role full access answers" ON answers;

CREATE POLICY "Public read answers" ON answers FOR SELECT USING (true);
CREATE POLICY "Service role full access answers" ON answers FOR ALL USING (auth.role() = 'service_role');

-- 4. Comment
COMMENT ON TABLE answers IS 'Individual student answers with evaluation results';
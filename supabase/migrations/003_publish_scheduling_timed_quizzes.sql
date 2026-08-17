-- Migration: Add publishing, scheduling, and timed quiz support
-- Run this in Supabase SQL Editor

-- Add publishing & scheduling columns to question_sets
ALTER TABLE question_sets
ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER;

-- Index for filtering published sets
CREATE INDEX IF NOT EXISTS idx_question_sets_is_published ON question_sets(is_published);
CREATE INDEX IF NOT EXISTS idx_question_sets_due_date ON question_sets(due_date);

COMMENT ON COLUMN question_sets.is_published IS 'Whether the set is visible to students';
COMMENT ON COLUMN question_sets.published_at IS 'When the set was published';
COMMENT ON COLUMN question_sets.due_date IS 'Optional due date — students cannot start after this';
COMMENT ON COLUMN question_sets.time_limit_minutes IS 'Optional time limit in minutes for the quiz';

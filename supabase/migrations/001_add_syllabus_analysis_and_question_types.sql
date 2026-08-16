-- Migration: Add syllabus analysis and enhanced question generation columns
-- Run this in Supabase SQL Editor

-- 1. Add syllabus_analysis and module_structure columns to documents table
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS syllabus_analysis JSONB,
ADD COLUMN IF NOT EXISTS module_structure JSONB;

-- 2. Add question_types, module_filter, document_weights columns to question_sets table
ALTER TABLE question_sets 
ADD COLUMN IF NOT EXISTS question_types JSONB,
ADD COLUMN IF NOT EXISTS module_filter JSONB,
ADD COLUMN IF NOT EXISTS document_weights JSONB;

-- 3. Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_documents_syllabus_analysis ON documents USING GIN (syllabus_analysis);
CREATE INDEX IF NOT EXISTS idx_question_sets_question_types ON question_sets USING GIN (question_types);
CREATE INDEX IF NOT EXISTS idx_question_sets_module_filter ON question_sets USING GIN (module_filter);
CREATE INDEX IF NOT EXISTS idx_question_sets_document_weights ON question_sets USING GIN (document_weights);

-- 4. Add comments for documentation
COMMENT ON COLUMN documents.syllabus_analysis IS 'Full syllabus analysis result from AI including modules, topics, concept coverage, suggested distribution, learning objectives, prerequisites';
COMMENT ON COLUMN documents.module_structure IS 'Structured module hierarchy with topics, chunk indices, and weights for filtering';
COMMENT ON COLUMN question_sets.question_types IS 'Question type distribution: {mcq: number, short: number, conceptual: number}';
COMMENT ON COLUMN question_sets.module_filter IS 'Array of module/topic IDs that were selected for question generation';
COMMENT ON COLUMN question_sets.document_weights IS 'Document weight distribution used for generation: {doc_id: weight}';

-- 5. Verify the columns exist
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name IN ('documents', 'question_sets') 
AND column_name IN ('syllabus_analysis', 'module_structure', 'question_types', 'module_filter', 'document_weights')
ORDER BY table_name, column_name;
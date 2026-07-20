-- SQL Migration: Add senior recruiter authenticity fields to scorecards_ai_interview
ALTER TABLE scorecards_ai_interview
ADD COLUMN IF NOT EXISTS authenticity_score DECIMAL(5,2) CHECK (authenticity_score BETWEEN 0 AND 100),
ADD COLUMN IF NOT EXISTS red_flag_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS red_flags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS resume_vs_reality JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS detailed_rationale TEXT;

ALTER TABLE interview_answers_ai_interview
ADD COLUMN IF NOT EXISTS ai_live_note JSONB;

ALTER TABLE scorecards_ai_interview
ADD COLUMN IF NOT EXISTS live_notes JSONB DEFAULT '[]'::jsonb;

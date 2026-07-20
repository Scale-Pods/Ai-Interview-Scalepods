-- SQL Migration: Add ai_live_note column to interview_answers_ai_interview
-- This was missing from previous migrations, causing 400 errors when persisting
-- live assessments during an interview.
ALTER TABLE interview_answers_ai_interview
ADD COLUMN IF NOT EXISTS ai_live_note JSONB;

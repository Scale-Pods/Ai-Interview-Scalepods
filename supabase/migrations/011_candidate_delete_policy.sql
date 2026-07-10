-- ==========================================================
-- AI INTERVIEWER — HR Delete Policies
-- Allows HR roles to delete candidates (CASCADE handles rest)
-- RLS is checked on each CASCADE target too, so each table
-- needs its own DELETE policy for the HR role.
-- ==========================================================

-- Helper: true if the current JWT has an HR role
CREATE OR REPLACE FUNCTION public.is_hr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    ''
  ) IN ('hr_admin', 'hr_recruiter', 'system');
$$;

-- candidates (source of the delete)
DROP POLICY IF EXISTS hr_delete_candidates ON candidates;
CREATE POLICY hr_delete_candidates ON candidates
  FOR DELETE USING (public.is_hr());

-- resumes (CASCADE from candidates)
DROP POLICY IF EXISTS hr_delete_resumes ON resumes;
CREATE POLICY hr_delete_resumes ON resumes
  FOR DELETE USING (public.is_hr());

-- job_descriptions (CASCADE from candidates)
DROP POLICY IF EXISTS hr_delete_job_descriptions ON job_descriptions;
CREATE POLICY hr_delete_job_descriptions ON job_descriptions
  FOR DELETE USING (public.is_hr());

-- interview_sessions (CASCADE from candidates)
DROP POLICY IF EXISTS hr_delete_sessions ON interview_sessions;
CREATE POLICY hr_delete_sessions ON interview_sessions
  FOR DELETE USING (public.is_hr());

-- interview_questions (CASCADE from sessions) 
-- (also has candidate_delete_session_questions from 009)
DROP POLICY IF EXISTS hr_delete_questions ON interview_questions;
CREATE POLICY hr_delete_questions ON interview_questions
  FOR DELETE USING (public.is_hr());

-- interview_answers (CASCADE from sessions/questions)
DROP POLICY IF EXISTS hr_delete_answers ON interview_answers;
CREATE POLICY hr_delete_answers ON interview_answers
  FOR DELETE USING (public.is_hr());

-- proctoring_events (CASCADE from sessions)
DROP POLICY IF EXISTS hr_delete_proctoring_events ON proctoring_events;
CREATE POLICY hr_delete_proctoring_events ON proctoring_events
  FOR DELETE USING (public.is_hr());

-- recordings (CASCADE from sessions)
DROP POLICY IF EXISTS hr_delete_recordings ON recordings;
CREATE POLICY hr_delete_recordings ON recordings
  FOR DELETE USING (public.is_hr());

-- scorecards (CASCADE from sessions)
DROP POLICY IF EXISTS hr_delete_scorecards ON scorecards;
CREATE POLICY hr_delete_scorecards ON scorecards
  FOR DELETE USING (public.is_hr());

-- ==========================================================
-- AI INTERVIEWER — Candidate Resumes & JDs Access Policies
-- ==========================================================

-- Allow candidates to read the resume associated with their session
DROP POLICY IF EXISTS candidate_select_resumes ON resumes;
CREATE POLICY candidate_select_resumes ON resumes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions s
      WHERE s.resume_id = resumes.id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

-- Allow candidates to read the job description associated with their session
DROP POLICY IF EXISTS candidate_select_jd ON job_descriptions;
CREATE POLICY candidate_select_jd ON job_descriptions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions s
      WHERE s.jd_id = job_descriptions.id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

-- Allow candidates to insert questions dynamically for active sessions
DROP POLICY IF EXISTS candidate_insert_session_questions ON interview_questions;
CREATE POLICY candidate_insert_session_questions ON interview_questions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_sessions s
      WHERE s.id = interview_questions.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

-- Allow candidates to delete questions (e.g. clearing pre-generated questions at start)
DROP POLICY IF EXISTS candidate_delete_session_questions ON interview_questions;
CREATE POLICY candidate_delete_session_questions ON interview_questions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions s
      WHERE s.id = interview_questions.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

-- Allow HR roles and system to read resumes
DROP POLICY IF EXISTS hr_select_resumes ON resumes;
CREATE POLICY hr_select_resumes ON resumes
  FOR SELECT
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
  );

-- Allow HR roles and system to read job descriptions
DROP POLICY IF EXISTS hr_select_jd ON job_descriptions;
CREATE POLICY hr_select_jd ON job_descriptions
  FOR SELECT
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
  );

-- Allow HR roles and system to insert resumes
DROP POLICY IF EXISTS hr_insert_resumes ON resumes;
CREATE POLICY hr_insert_resumes ON resumes FOR INSERT
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'system'));

-- Allow HR roles and system to insert job descriptions
DROP POLICY IF EXISTS hr_insert_jd ON job_descriptions;
CREATE POLICY hr_insert_jd ON job_descriptions FOR INSERT
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'system'));

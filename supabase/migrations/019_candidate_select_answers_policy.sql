-- SQL Migration: Add candidate SELECT policy to interview_answers_ai_interview

DROP POLICY IF EXISTS candidate_select_session_answers ON interview_answers_ai_interview;
CREATE POLICY candidate_select_session_answers ON interview_answers_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = interview_answers_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

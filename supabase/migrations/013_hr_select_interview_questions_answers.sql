-- HR SELECT policies for interview_questions and interview_answers
-- These were missing from previous migrations, so HR users see empty
-- answers in the transcript viewer despite data existing in the tables.

DROP POLICY IF EXISTS hr_select_questions ON interview_questions;
CREATE POLICY hr_select_questions ON interview_questions
  FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_select_answers ON interview_answers;
CREATE POLICY hr_select_answers ON interview_answers
  FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

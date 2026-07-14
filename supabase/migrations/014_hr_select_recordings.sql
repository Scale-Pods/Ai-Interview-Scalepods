-- Keep recordings accessible to every HR role after a scorecard is reviewed.
-- The candidate-facing policy is intentionally limited by session status, so
-- HR access must not depend on the candidate remaining in a pre-review state.

DROP POLICY IF EXISTS hr_select_recordings ON recordings_ai_interview;
CREATE POLICY hr_select_recordings ON recordings_ai_interview
  FOR SELECT
  USING (
    COALESCE(
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() -> 'user_metadata' ->> 'role',
      ''
    ) IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
  );

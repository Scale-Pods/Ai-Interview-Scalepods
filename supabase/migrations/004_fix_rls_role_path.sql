-- Fix RLS policies to check for the role in app_metadata / raw_user_meta_data
-- instead of the top-level JWT 'role' claim (which is always 'authenticated'
-- for logged-in users or 'anon' for anonymous).

-- ----------
-- Candidates — the main fix: the join `select('*, candidates(*)')` silently
-- returns null when RLS blocks reading this table.
-- ----------
DROP POLICY IF EXISTS hr_select_candidates ON candidates;
CREATE POLICY hr_select_candidates ON candidates FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_insert_candidates ON candidates;
CREATE POLICY hr_insert_candidates ON candidates FOR INSERT
  WITH CHECK (auth.jwt() -> 'app_metadata' ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system')
          OR auth.jwt() -> 'user_metadata' ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system'));

DROP POLICY IF EXISTS hr_update_candidates ON candidates;
CREATE POLICY hr_update_candidates ON candidates FOR UPDATE
  USING (auth.jwt() -> 'app_metadata' ->> 'role' IN ('hr_admin', 'system')
      OR auth.jwt() -> 'user_metadata' ->> 'role' IN ('hr_admin', 'system'));

DROP POLICY IF EXISTS system_all ON candidates;
CREATE POLICY system_all ON candidates FOR ALL
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

-- ----------
-- Interview Sessions — restore the original top-level role check (the public
-- 'candidate_select_active_session' policy handles unauthenticated reads).
-- ----------
DROP POLICY IF EXISTS hr_select_sessions ON interview_sessions;
CREATE POLICY hr_select_sessions ON interview_sessions FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_insert_sessions ON interview_sessions;
CREATE POLICY hr_insert_sessions ON interview_sessions FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system'));

DROP POLICY IF EXISTS hr_update_sessions ON interview_sessions;
CREATE POLICY hr_update_sessions ON interview_sessions FOR UPDATE
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'system'));

-- ----------
-- Audit Log — needed by the fetchSessions() fallback when candidate_id is null
-- ----------
DROP POLICY IF EXISTS hr_select_audit ON audit_log;
CREATE POLICY hr_select_audit ON audit_log FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' IN ('hr_admin', 'system')
      OR auth.jwt() -> 'user_metadata' ->> 'role' IN ('hr_admin', 'system'));

-- ----------
-- Scorecards, Recordings, Proctoring Events — fix to use metadata role path
-- ----------
DROP POLICY IF EXISTS hr_select_scorecards ON scorecards;
CREATE POLICY hr_select_scorecards ON scorecards FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_select_recordings ON recordings;
CREATE POLICY hr_select_recordings ON recordings FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'system'));

DROP POLICY IF EXISTS hr_select_proctoring ON proctoring_events;
CREATE POLICY hr_select_proctoring ON proctoring_events FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'system'));

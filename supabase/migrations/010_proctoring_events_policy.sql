  -- ==========================================================
  -- AI INTERVIEWER — Proctoring Events Insert Policy
  -- Allows anon (candidate) sessions to insert proctoring events
  -- ==========================================================

  -- Allow candidates to insert proctoring events for active sessions
  DROP POLICY IF EXISTS candidate_insert_proctoring_events ON proctoring_events;
  CREATE POLICY candidate_insert_proctoring_events ON proctoring_events
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM interview_sessions s
        WHERE s.id = session_id
          AND s.status IN ('invited', 'in_progress')
          AND s.expires_at > now()
      )
    );

  -- Allow candidates to read their own proctoring events
  DROP POLICY IF EXISTS candidate_select_proctoring_events ON proctoring_events;
  CREATE POLICY candidate_select_proctoring_events ON proctoring_events
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM interview_sessions s
        WHERE s.id = session_id
          AND s.expires_at > now()
      )
    );

  -- Allow HR roles to read proctoring events
  DROP POLICY IF EXISTS hr_select_proctoring_events ON proctoring_events;
  CREATE POLICY hr_select_proctoring_events ON proctoring_events
    FOR SELECT
    USING (
      COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
    );

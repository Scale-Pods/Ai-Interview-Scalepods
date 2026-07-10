-- Public candidate interview access.
--
-- The frontend invite link currently uses the interview session UUID as the
-- bearer token. These policies keep anonymous access scoped to active session
-- data needed by the candidate room.

CREATE POLICY candidate_select_active_session ON interview_sessions
  FOR SELECT
  USING (
    status IN ('invited', 'in_progress', 'completed')
    AND expires_at > now()
  );

CREATE POLICY candidate_update_active_session_status ON interview_sessions
  FOR UPDATE
  USING (
    status IN ('invited', 'in_progress')
    AND expires_at > now()
  )
  WITH CHECK (
    status IN ('in_progress', 'completed')
  );

CREATE POLICY candidate_select_session_questions ON interview_questions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM interview_sessions s
      WHERE s.id = interview_questions.session_id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

CREATE POLICY candidate_insert_session_answers ON interview_answers
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM interview_sessions s
      WHERE s.id = interview_answers.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

CREATE POLICY candidate_insert_proctoring_events ON proctoring_events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM interview_sessions s
      WHERE s.id = proctoring_events.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

CREATE POLICY candidate_select_own_candidate_record ON candidates
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM interview_sessions s
      WHERE s.candidate_id = candidates.id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

-- Fix recordings RLS: allow UPDATE when session is completed (for finalizing recording metadata after interview ends)
DROP POLICY IF EXISTS candidate_update_recordings ON recordings;
CREATE POLICY candidate_update_recordings ON recordings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions s
      WHERE s.id = recordings.session_id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

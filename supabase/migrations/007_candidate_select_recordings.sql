-- Allow candidates/anonymous users to SELECT recordings for their active sessions
DROP POLICY IF EXISTS candidate_select_own_recordings ON recordings;
CREATE POLICY candidate_select_own_recordings ON recordings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions s
      WHERE s.id = session_id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

-- Allow candidates/anonymous users to list/select their recording files in storage
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'candidate_select_recordings_storage' AND tablename = 'objects'
  ) THEN
    CREATE POLICY candidate_select_recordings_storage ON storage.objects
      FOR SELECT
      USING (
        bucket_id = 'recordings'
        AND (storage.foldername(name))[1] = 'sessions'
      );
  END IF;
END $$;

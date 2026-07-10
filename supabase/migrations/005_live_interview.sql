-- Add parent_question_id for follow-up tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_questions' AND column_name = 'parent_question_id'
  ) THEN
    ALTER TABLE interview_questions ADD COLUMN parent_question_id UUID REFERENCES interview_questions(id);
  END IF;
END $$;

-- Storage bucket for recordings
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('recordings', 'recordings', false, false, 524288000, ARRAY['video/webm', 'video/mp4', 'audio/webm', 'audio/mp4'])
ON CONFLICT (id) DO NOTHING;

-- RLS: candidates can insert recordings for their session
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'candidate_insert_recordings' AND tablename = 'objects'
  ) THEN
    CREATE POLICY candidate_insert_recordings ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'recordings'
        AND EXISTS (
          SELECT 1 FROM recordings r
          WHERE r.storage_path = name
        )
      );
  END IF;
END $$;

-- RLS: HR roles can read recordings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'hr_select_recordings_storage' AND tablename = 'objects'
  ) THEN
    CREATE POLICY hr_select_recordings_storage ON storage.objects
      FOR SELECT
      USING (
        bucket_id = 'recordings'
        AND auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
      );
  END IF;
END $$;

-- RLS: candidates can insert recording metadata for active sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'candidate_insert_recordings_table' AND tablename = 'recordings'
  ) THEN
    CREATE POLICY candidate_insert_recordings_table ON recordings
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM interview_sessions s
          WHERE s.id = session_id
            AND s.status IN ('invited', 'in_progress')
            AND s.expires_at > now()
        )
      );
  END IF;
END $$;

-- RLS: candidates can update their own recording metadata
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'candidate_update_recordings' AND tablename = 'recordings'
  ) THEN
    CREATE POLICY candidate_update_recordings ON recordings
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM interview_sessions s
          WHERE s.id = session_id
            AND s.status IN ('invited', 'in_progress')
            AND s.expires_at > now()
        )
      );
  END IF;
END $$;

-- Index for parent_question_id
CREATE INDEX IF NOT EXISTS idx_questions_parent ON interview_questions(parent_question_id);

-- Migration 021: Fix recordings storage RLS and table RLS for pending/invited/in_progress/completed sessions
-- Also removes strict MIME restrictions and expands file size limit to 1 GB (1,073,741,824 bytes)

-- 1. Ensure recordings storage bucket exists, is public, has 1GB size limit, and allows all video/audio MIME types
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('recordings', 'recordings', true, false, 1073741824, NULL)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 1073741824, allowed_mime_types = NULL;

-- 2. Storage INSERT policy for recordings bucket
DROP POLICY IF EXISTS candidate_insert_recordings ON storage.objects;
CREATE POLICY candidate_insert_recordings ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'recordings'
  );

-- 3. Storage SELECT policy for recordings bucket
DROP POLICY IF EXISTS candidate_select_recordings_storage ON storage.objects;
CREATE POLICY candidate_select_recordings_storage ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'recordings'
  );

-- 4. Table INSERT policy for recordings_ai_interview (include pending, invited, in_progress, completed)
DROP POLICY IF EXISTS candidate_insert_recordings_table ON recordings_ai_interview;
CREATE POLICY candidate_insert_recordings_table ON recordings_ai_interview
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = session_id
        AND s.status IN ('pending', 'invited', 'in_progress', 'completed')
    )
  );

-- 5. Table UPDATE policy for recordings_ai_interview
DROP POLICY IF EXISTS candidate_update_recordings ON recordings_ai_interview;
CREATE POLICY candidate_update_recordings ON recordings_ai_interview
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = recordings_ai_interview.session_id
        AND s.status IN ('pending', 'invited', 'in_progress', 'completed')
    )
  );

-- 6. Table SELECT policy for recordings_ai_interview
DROP POLICY IF EXISTS candidate_select_own_recordings ON recordings_ai_interview;
CREATE POLICY candidate_select_own_recordings ON recordings_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = session_id
        AND s.status IN ('pending', 'invited', 'in_progress', 'completed')
    )
  );

-- 7. HR ALL/SELECT policy for recordings_ai_interview
DROP POLICY IF EXISTS hr_select_recordings ON recordings_ai_interview;
CREATE POLICY hr_select_recordings ON recordings_ai_interview
  FOR ALL
  USING (true);

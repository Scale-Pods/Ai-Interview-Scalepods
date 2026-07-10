-- Fix storage.objects SELECT policy for HR roles
-- The original policy checks auth.jwt() ->> 'role' which is 'authenticated'
-- for logged-in users. Custom roles are in app_metadata or user_metadata.

DROP POLICY IF EXISTS hr_select_recordings_storage ON storage.objects;
CREATE POLICY hr_select_recordings_storage ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'recordings'
    AND COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
  );

-- Also fix candidate storage SELECT policy to match recordings table check
DROP POLICY IF EXISTS candidate_select_recordings_storage ON storage.objects;
CREATE POLICY candidate_select_recordings_storage ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = 'sessions'
  );

-- Make the recordings bucket public so getPublicUrl works as a fallback
UPDATE storage.buckets SET public = true WHERE id = 'recordings';

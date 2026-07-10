-- Raise recording object limit for full-length interview videos.
-- 750 MB gives headroom for 20-minute camera + screen recordings.
UPDATE storage.buckets
SET
  file_size_limit = 786432000,
  allowed_mime_types = ARRAY['video/webm', 'video/mp4', 'audio/webm', 'audio/mp4']
WHERE id = 'recordings';

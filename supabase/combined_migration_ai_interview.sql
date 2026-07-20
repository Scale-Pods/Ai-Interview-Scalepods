-- =============================================================
-- AI INTERVIEWER — Combined Schema Migration
-- All tables suffixed with _ai_interview
-- Run this in the Supabase SQL editor on your new project
-- =============================================================

-- 001: Initial Schema
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE candidates_ai_interview (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT UNIQUE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  metadata      JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE job_descriptions_ai_interview (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID REFERENCES candidates_ai_interview(id) ON DELETE CASCADE,
  raw_text      TEXT NOT NULL,
  parsed_skills TEXT[] DEFAULT '{}',
  parsed_years_experience DECIMAL(4,1),
  parsed_roles  TEXT[] DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resumes_ai_interview (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID REFERENCES candidates_ai_interview(id) ON DELETE CASCADE,
  raw_text      TEXT NOT NULL,
  file_url      TEXT,
  parsed_skills TEXT[] DEFAULT '{}',
  parsed_experience JSONB DEFAULT '[]'::jsonb,
  parsed_education JSONB DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE interview_sessions_ai_interview (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID REFERENCES candidates_ai_interview(id) ON DELETE CASCADE,
  jd_id           UUID REFERENCES job_descriptions_ai_interview(id),
  resume_id       UUID REFERENCES resumes_ai_interview(id),
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','invited','in_progress',
                                      'completed','expired','cancelled','flagged')),
  invite_link     TEXT UNIQUE,
  token_hash      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE interview_questions_ai_interview (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES interview_sessions_ai_interview(id) ON DELETE CASCADE,
  question_text   TEXT NOT NULL,
  question_type   TEXT DEFAULT 'technical'
                    CHECK (question_type IN ('technical','behavioral',
                                             'situational','cultural')),
  source          TEXT DEFAULT 'ai_generated',
  order_index     INT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE interview_answers_ai_interview (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID REFERENCES interview_questions_ai_interview(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES interview_sessions_ai_interview(id) ON DELETE CASCADE,
  answer_text     TEXT,
  audio_url       TEXT,
  duration_secs   INT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE proctoring_events_ai_interview (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES interview_sessions_ai_interview(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL
                    CHECK (event_type IN ('tab_switch','window_blur','browser_resize',
                                          'face_absent','face_multiple','face_mismatch',
                                          'audio_silence','audio_level','copy_paste',
                                          'keyboard_shortcut','fullscreen_exit')),
  severity        TEXT DEFAULT 'warning'
                    CHECK (severity IN ('info','warning','critical')),
  timestamp       TIMESTAMPTZ DEFAULT now(),
  payload         JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE recordings_ai_interview (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES interview_sessions_ai_interview(id) ON DELETE CASCADE,
  stream_type     TEXT NOT NULL
                    CHECK (stream_type IN ('camera_video','screen_video','audio_mixed')),
  status          TEXT DEFAULT 'processing'
                    CHECK (status IN ('processing','ready','archived','failed')),
  storage_path    TEXT NOT NULL,
  duration_secs   INT,
  file_size_bytes BIGINT,
  mime_type       TEXT,
  transcoded_paths JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE scorecards_ai_interview (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID REFERENCES interview_sessions_ai_interview(id) ON DELETE CASCADE UNIQUE,
  technical_score         DECIMAL(5,2) CHECK (technical_score BETWEEN 0 AND 100),
  communication_score     DECIMAL(5,2) CHECK (communication_score BETWEEN 0 AND 100),
  problem_solving_score   DECIMAL(5,2) CHECK (problem_solving_score BETWEEN 0 AND 100),
  cultural_fit_score      DECIMAL(5,2) CHECK (cultural_fit_score BETWEEN 0 AND 100),
  overall_score           DECIMAL(5,2) CHECK (overall_score BETWEEN 0 AND 100),
  strengths               TEXT[] DEFAULT '{}',
  weaknesses              TEXT[] DEFAULT '{}',
  recommendation          TEXT CHECK (recommendation IN ('strong_hire','hire',
                                                         'consider','no_go')),
  ai_rationale            TEXT,
  scoring_model_version   TEXT,
  evaluated_at            TIMESTAMPTZ DEFAULT now(),
  reviewed_by_human       BOOLEAN DEFAULT FALSE,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_log_ai_interview (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('system','hr_user','candidate','api')),
  actor_id        TEXT,
  action          TEXT NOT NULL,
  resource_type   TEXT,
  resource_id     TEXT,
  details         JSONB DEFAULT '{}'::jsonb,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE event_queue_ai_interview (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  target_url      TEXT NOT NULL,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','delivered','failed')),
  retry_count     INT DEFAULT 0,
  max_retries     INT DEFAULT 3,
  last_error      TEXT,
  next_retry_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);

CREATE INDEX idx_sessions_status ON interview_sessions_ai_interview(status);
CREATE INDEX idx_sessions_candidate ON interview_sessions_ai_interview(candidate_id);
CREATE INDEX idx_sessions_expires ON interview_sessions_ai_interview(expires_at);
CREATE INDEX idx_proctoring_session ON proctoring_events_ai_interview(session_id, timestamp DESC);
CREATE INDEX idx_proctoring_severity ON proctoring_events_ai_interview(session_id, severity);
CREATE INDEX idx_scorecards_session ON scorecards_ai_interview(session_id);
CREATE INDEX idx_audit_created ON audit_log_ai_interview(created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log_ai_interview(resource_type, resource_id);
CREATE INDEX idx_answers_session ON interview_answers_ai_interview(session_id);
CREATE INDEX idx_questions_session ON interview_questions_ai_interview(session_id, order_index);
CREATE INDEX idx_event_queue_status ON event_queue_ai_interview(status, next_retry_at);
CREATE INDEX idx_candidates_email ON candidates_ai_interview(email);

ALTER TABLE candidates_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_descriptions_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_sessions_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_questions_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_answers_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE proctoring_events_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecards_ai_interview ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_ai_interview ENABLE ROW LEVEL SECURITY;

-- HR roles: full read access to all tables
CREATE POLICY hr_select_candidates ON candidates_ai_interview FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));
CREATE POLICY hr_insert_candidates ON candidates_ai_interview FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system'));
CREATE POLICY hr_update_candidates ON candidates_ai_interview FOR UPDATE
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'system'));

CREATE POLICY hr_select_sessions ON interview_sessions_ai_interview FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));
CREATE POLICY hr_insert_sessions ON interview_sessions_ai_interview FOR INSERT
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'system'));
CREATE POLICY hr_update_sessions ON interview_sessions_ai_interview FOR UPDATE
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'system'));

CREATE POLICY hr_select_scorecards ON scorecards_ai_interview FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

CREATE POLICY hr_select_recordings ON recordings_ai_interview FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'system'));
CREATE POLICY system_manage_recordings ON recordings_ai_interview FOR ALL
  USING (auth.jwt() ->> 'role' = 'system');

CREATE POLICY hr_select_proctoring ON proctoring_events_ai_interview FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system'));

CREATE POLICY hr_select_audit ON audit_log_ai_interview FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'system'));

CREATE POLICY system_all ON candidates_ai_interview FOR ALL
  USING (auth.jwt() ->> 'role' = 'system');

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_candidates_updated_at
  BEFORE UPDATE ON candidates_ai_interview FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_sessions_updated_at
  BEFORE UPDATE ON interview_sessions_ai_interview FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 002: Public interview policies
-- ==========================================================

CREATE POLICY candidate_select_active_session ON interview_sessions_ai_interview
  FOR SELECT
  USING (
    status IN ('invited', 'in_progress', 'completed')
    AND expires_at > now()
  );

CREATE POLICY candidate_update_active_session_status ON interview_sessions_ai_interview
  FOR UPDATE
  USING (
    status IN ('invited', 'in_progress')
    AND expires_at > now()
  )
  WITH CHECK (
    status IN ('in_progress', 'completed')
  );

CREATE POLICY candidate_select_session_questions ON interview_questions_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM interview_sessions_ai_interview s
      WHERE s.id = interview_questions_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

CREATE POLICY candidate_insert_session_answers ON interview_answers_ai_interview
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM interview_sessions_ai_interview s
      WHERE s.id = interview_answers_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

CREATE POLICY candidate_insert_proctoring_events ON proctoring_events_ai_interview
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM interview_sessions_ai_interview s
      WHERE s.id = proctoring_events_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

CREATE POLICY candidate_select_own_candidate_record ON candidates_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM interview_sessions_ai_interview s
      WHERE s.candidate_id = candidates_ai_interview.id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

-- 003: get_sessions_with_candidates function
-- ==========================================================

CREATE OR REPLACE FUNCTION get_sessions_with_candidates()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'id',            s.id,
      'candidate_id',  s.candidate_id,
      'jd_id',         s.jd_id,
      'resume_id',     s.resume_id,
      'status',        s.status,
      'invite_link',   s.invite_link,
      'token_hash',    s.token_hash,
      'expires_at',    s.expires_at,
      'started_at',    s.started_at,
      'completed_at',  s.completed_at,
      'created_by',    s.created_by,
      'created_at',    s.created_at,
      'updated_at',    s.updated_at,
      'candidates',    CASE WHEN c.id IS NOT NULL THEN
        json_build_object(
          'id',           c.id,
          'external_id',  c.external_id,
          'name',         c.name,
          'email',        c.email,
          'phone',        c.phone,
          'created_at',   c.created_at,
          'updated_at',   c.updated_at,
          'metadata',     c.metadata
        )
      ELSE NULL END
    )
    ORDER BY s.created_at DESC
  ) INTO result
  FROM interview_sessions_ai_interview s
  LEFT JOIN candidates_ai_interview c ON c.id = s.candidate_id;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION get_sessions_with_candidates TO anon;
GRANT EXECUTE ON FUNCTION get_sessions_with_candidates TO authenticated;

-- 004: Fix RLS role path
-- ==========================================================

DROP POLICY IF EXISTS hr_select_candidates ON candidates_ai_interview;
CREATE POLICY hr_select_candidates ON candidates_ai_interview FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_insert_candidates ON candidates_ai_interview;
CREATE POLICY hr_insert_candidates ON candidates_ai_interview FOR INSERT
  WITH CHECK (auth.jwt() -> 'app_metadata' ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system')
          OR auth.jwt() -> 'user_metadata' ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system'));

DROP POLICY IF EXISTS hr_update_candidates ON candidates_ai_interview;
CREATE POLICY hr_update_candidates ON candidates_ai_interview FOR UPDATE
  USING (auth.jwt() -> 'app_metadata' ->> 'role' IN ('hr_admin', 'system')
      OR auth.jwt() -> 'user_metadata' ->> 'role' IN ('hr_admin', 'system'));

DROP POLICY IF EXISTS system_all ON candidates_ai_interview;
CREATE POLICY system_all ON candidates_ai_interview FOR ALL
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_select_sessions ON interview_sessions_ai_interview;
CREATE POLICY hr_select_sessions ON interview_sessions_ai_interview FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_insert_sessions ON interview_sessions_ai_interview;
CREATE POLICY hr_insert_sessions ON interview_sessions_ai_interview FOR INSERT
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'system'));

DROP POLICY IF EXISTS hr_update_sessions ON interview_sessions_ai_interview;
CREATE POLICY hr_update_sessions ON interview_sessions_ai_interview FOR UPDATE
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'system'));

DROP POLICY IF EXISTS hr_select_audit ON audit_log_ai_interview;
CREATE POLICY hr_select_audit ON audit_log_ai_interview FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' IN ('hr_admin', 'system')
      OR auth.jwt() -> 'user_metadata' ->> 'role' IN ('hr_admin', 'system'));

DROP POLICY IF EXISTS hr_select_scorecards ON scorecards_ai_interview;
CREATE POLICY hr_select_scorecards ON scorecards_ai_interview FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_select_recordings ON recordings_ai_interview;
CREATE POLICY hr_select_recordings ON recordings_ai_interview FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'system'));

DROP POLICY IF EXISTS hr_select_proctoring ON proctoring_events_ai_interview;
CREATE POLICY hr_select_proctoring ON proctoring_events_ai_interview FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'system'));

-- 005: Live interview (parent_question_id, storage bucket, recording policies)
-- ==========================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interview_questions_ai_interview' AND column_name = 'parent_question_id'
  ) THEN
    ALTER TABLE interview_questions_ai_interview ADD COLUMN parent_question_id UUID REFERENCES interview_questions_ai_interview(id);
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('recordings', 'recordings', false, false, 524288000, ARRAY['video/webm', 'video/mp4', 'audio/webm', 'audio/mp4'])
ON CONFLICT (id) DO NOTHING;

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
          SELECT 1 FROM recordings_ai_interview r
          WHERE r.storage_path = name
        )
      );
  END IF;
END $$;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'candidate_insert_recordings_table' AND tablename = 'recordings_ai_interview'
  ) THEN
    CREATE POLICY candidate_insert_recordings_table ON recordings_ai_interview
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM interview_sessions_ai_interview s
          WHERE s.id = session_id
            AND s.status IN ('invited', 'in_progress')
            AND s.expires_at > now()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'candidate_update_recordings' AND tablename = 'recordings_ai_interview'
  ) THEN
    CREATE POLICY candidate_update_recordings ON recordings_ai_interview
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM interview_sessions_ai_interview s
          WHERE s.id = session_id
            AND s.status IN ('invited', 'in_progress')
            AND s.expires_at > now()
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_questions_parent ON interview_questions_ai_interview(parent_question_id);

-- 006: Fix recordings RLS
-- ==========================================================

DROP POLICY IF EXISTS candidate_update_recordings ON recordings_ai_interview;
CREATE POLICY candidate_update_recordings ON recordings_ai_interview
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = recordings_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

-- 007: Candidate select recordings
-- ==========================================================

DROP POLICY IF EXISTS candidate_select_own_recordings ON recordings_ai_interview;
CREATE POLICY candidate_select_own_recordings ON recordings_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = session_id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

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

-- 008: Fix storage RLS role path
-- ==========================================================

DROP POLICY IF EXISTS hr_select_recordings_storage ON storage.objects;
CREATE POLICY hr_select_recordings_storage ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'recordings'
    AND COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
  );

DROP POLICY IF EXISTS candidate_select_recordings_storage ON storage.objects;
CREATE POLICY candidate_select_recordings_storage ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'recordings'
    AND (storage.foldername(name))[1] = 'sessions'
  );

UPDATE storage.buckets SET public = true WHERE id = 'recordings';

-- 009: Candidate select resumes & JDs
-- ==========================================================

DROP POLICY IF EXISTS candidate_select_resumes ON resumes_ai_interview;
CREATE POLICY candidate_select_resumes ON resumes_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.resume_id = resumes_ai_interview.id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

DROP POLICY IF EXISTS candidate_select_jd ON job_descriptions_ai_interview;
CREATE POLICY candidate_select_jd ON job_descriptions_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.jd_id = job_descriptions_ai_interview.id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

DROP POLICY IF EXISTS candidate_insert_session_questions ON interview_questions_ai_interview;
CREATE POLICY candidate_insert_session_questions ON interview_questions_ai_interview
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = interview_questions_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

DROP POLICY IF EXISTS candidate_delete_session_questions ON interview_questions_ai_interview;
CREATE POLICY candidate_delete_session_questions ON interview_questions_ai_interview
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = interview_questions_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

DROP POLICY IF EXISTS hr_select_resumes ON resumes_ai_interview;
CREATE POLICY hr_select_resumes ON resumes_ai_interview
  FOR SELECT
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
  );

DROP POLICY IF EXISTS hr_select_jd ON job_descriptions_ai_interview;
CREATE POLICY hr_select_jd ON job_descriptions_ai_interview
  FOR SELECT
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
  );

DROP POLICY IF EXISTS hr_insert_resumes ON resumes_ai_interview;
CREATE POLICY hr_insert_resumes ON resumes_ai_interview FOR INSERT
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'system'));

DROP POLICY IF EXISTS hr_insert_jd ON job_descriptions_ai_interview;
CREATE POLICY hr_insert_jd ON job_descriptions_ai_interview FOR INSERT
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'system'));

-- 010: Proctoring events policies
-- ==========================================================

DROP POLICY IF EXISTS candidate_insert_proctoring_events ON proctoring_events_ai_interview;
CREATE POLICY candidate_insert_proctoring_events ON proctoring_events_ai_interview
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

DROP POLICY IF EXISTS candidate_select_proctoring_events ON proctoring_events_ai_interview;
CREATE POLICY candidate_select_proctoring_events ON proctoring_events_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = session_id
        AND s.expires_at > now()
    )
  );

DROP POLICY IF EXISTS hr_select_proctoring_events ON proctoring_events_ai_interview;
CREATE POLICY hr_select_proctoring_events ON proctoring_events_ai_interview
  FOR SELECT
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system')
  );

-- 011: HR delete policies
-- ==========================================================

CREATE OR REPLACE FUNCTION public.is_hr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    ''
  ) IN ('hr_admin', 'hr_recruiter', 'system');
$$;

DROP POLICY IF EXISTS hr_delete_candidates ON candidates_ai_interview;
CREATE POLICY hr_delete_candidates ON candidates_ai_interview
  FOR DELETE USING (public.is_hr());

DROP POLICY IF EXISTS hr_delete_resumes ON resumes_ai_interview;
CREATE POLICY hr_delete_resumes ON resumes_ai_interview
  FOR DELETE USING (public.is_hr());

DROP POLICY IF EXISTS hr_delete_job_descriptions ON job_descriptions_ai_interview;
CREATE POLICY hr_delete_job_descriptions ON job_descriptions_ai_interview
  FOR DELETE USING (public.is_hr());

DROP POLICY IF EXISTS hr_delete_sessions ON interview_sessions_ai_interview;
CREATE POLICY hr_delete_sessions ON interview_sessions_ai_interview
  FOR DELETE USING (public.is_hr());

DROP POLICY IF EXISTS hr_delete_questions ON interview_questions_ai_interview;
CREATE POLICY hr_delete_questions ON interview_questions_ai_interview
  FOR DELETE USING (public.is_hr());

DROP POLICY IF EXISTS hr_delete_answers ON interview_answers_ai_interview;
CREATE POLICY hr_delete_answers ON interview_answers_ai_interview
  FOR DELETE USING (public.is_hr());

DROP POLICY IF EXISTS hr_delete_proctoring_events ON proctoring_events_ai_interview;
CREATE POLICY hr_delete_proctoring_events ON proctoring_events_ai_interview
  FOR DELETE USING (public.is_hr());

DROP POLICY IF EXISTS hr_delete_recordings ON recordings_ai_interview;
CREATE POLICY hr_delete_recordings ON recordings_ai_interview
  FOR DELETE USING (public.is_hr());

DROP POLICY IF EXISTS hr_delete_scorecards ON scorecards_ai_interview;
CREATE POLICY hr_delete_scorecards ON scorecards_ai_interview
  FOR DELETE USING (public.is_hr());

-- 012: Raise recordings bucket limit
-- ==========================================================

UPDATE storage.buckets
SET
  file_size_limit = 786432000,
  allowed_mime_types = ARRAY['video/webm', 'video/mp4', 'audio/webm', 'audio/mp4']
WHERE id = 'recordings';

-- 013: HR select interview questions & answers
-- ==========================================================

DROP POLICY IF EXISTS hr_select_questions ON interview_questions_ai_interview;
CREATE POLICY hr_select_questions ON interview_questions_ai_interview
  FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

DROP POLICY IF EXISTS hr_select_answers ON interview_answers_ai_interview;
CREATE POLICY hr_select_answers ON interview_answers_ai_interview
  FOR SELECT
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '') IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

-- ==========================================================
-- 014: Keep recordings available to all HR roles
-- ==========================================================

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

DROP POLICY IF EXISTS candidate_select_session_answers ON interview_answers_ai_interview;
CREATE POLICY candidate_select_session_answers ON interview_answers_ai_interview
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = interview_answers_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress', 'completed')
        AND s.expires_at > now()
    )
  );

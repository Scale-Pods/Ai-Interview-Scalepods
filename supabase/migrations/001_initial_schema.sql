-- ==========================================================
-- AI INTERVIEWER — Initial Schema Migration
-- ==========================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================================
-- CANDIDATE & SESSION MANAGEMENT
-- ==========================================================

CREATE TABLE candidates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT UNIQUE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  metadata      JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE job_descriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID REFERENCES candidates(id) ON DELETE CASCADE,
  raw_text      TEXT NOT NULL,
  parsed_skills TEXT[] DEFAULT '{}',
  parsed_years_experience DECIMAL(4,1),
  parsed_roles  TEXT[] DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resumes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID REFERENCES candidates(id) ON DELETE CASCADE,
  raw_text      TEXT NOT NULL,
  file_url      TEXT,
  parsed_skills TEXT[] DEFAULT '{}',
  parsed_experience JSONB DEFAULT '[]'::jsonb,
  parsed_education JSONB DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE interview_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID REFERENCES candidates(id) ON DELETE CASCADE,
  jd_id           UUID REFERENCES job_descriptions(id),
  resume_id       UUID REFERENCES resumes(id),
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

CREATE TABLE interview_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES interview_sessions(id) ON DELETE CASCADE,
  question_text   TEXT NOT NULL,
  question_type   TEXT DEFAULT 'technical'
                    CHECK (question_type IN ('technical','behavioral',
                                             'situational','cultural')),
  source          TEXT DEFAULT 'ai_generated',
  order_index     INT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE interview_answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID REFERENCES interview_questions(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES interview_sessions(id) ON DELETE CASCADE,
  answer_text     TEXT,
  audio_url       TEXT,
  duration_secs   INT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ==========================================================
-- PROCTORING
-- ==========================================================

CREATE TABLE proctoring_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES interview_sessions(id) ON DELETE CASCADE,
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

-- ==========================================================
-- RECORDINGS
-- ==========================================================

CREATE TABLE recordings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES interview_sessions(id) ON DELETE CASCADE,
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

-- ==========================================================
-- SCORECARDS
-- ==========================================================

CREATE TABLE scorecards (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID REFERENCES interview_sessions(id) ON DELETE CASCADE UNIQUE,
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

-- ==========================================================
-- AUDIT TRAIL
-- ==========================================================

CREATE TABLE audit_log (
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

-- ==========================================================
-- EVENT QUEUE (for failed webhook retries)
-- ==========================================================

CREATE TABLE event_queue (
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

-- ==========================================================
-- INDEXES
-- ==========================================================

CREATE INDEX idx_sessions_status ON interview_sessions(status);
CREATE INDEX idx_sessions_candidate ON interview_sessions(candidate_id);
CREATE INDEX idx_sessions_expires ON interview_sessions(expires_at);
CREATE INDEX idx_proctoring_session ON proctoring_events(session_id, timestamp DESC);
CREATE INDEX idx_proctoring_severity ON proctoring_events(session_id, severity);
CREATE INDEX idx_scorecards_session ON scorecards(session_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_answers_session ON interview_answers(session_id);
CREATE INDEX idx_questions_session ON interview_questions(session_id, order_index);
CREATE INDEX idx_event_queue_status ON event_queue(status, next_retry_at);
CREATE INDEX idx_candidates_email ON candidates(email);

-- ==========================================================
-- ROW LEVEL SECURITY
-- ==========================================================

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_descriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE proctoring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- HR roles: full read access to all tables
CREATE POLICY hr_select_candidates ON candidates FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));
CREATE POLICY hr_insert_candidates ON candidates FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system'));
CREATE POLICY hr_update_candidates ON candidates FOR UPDATE
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'system'));

CREATE POLICY hr_select_sessions ON interview_sessions FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));
CREATE POLICY hr_insert_sessions ON interview_sessions FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system'));
CREATE POLICY hr_update_sessions ON interview_sessions FOR UPDATE
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'system'));

CREATE POLICY hr_select_scorecards ON scorecards FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'hr_viewer', 'system'));

CREATE POLICY hr_select_recordings ON recordings FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'system'));
CREATE POLICY system_manage_recordings ON recordings FOR ALL
  USING (auth.jwt() ->> 'role' = 'system');

CREATE POLICY hr_select_proctoring ON proctoring_events FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'hr_recruiter', 'system'));

CREATE POLICY hr_select_audit ON audit_log FOR SELECT
  USING (auth.jwt() ->> 'role' IN ('hr_admin', 'system'));

-- System role for n8n
CREATE POLICY system_all ON candidates FOR ALL USING (auth.jwt() ->> 'role' = 'system');

-- ==========================================================
-- TRIGGER: updated_at
-- ==========================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_candidates_updated_at
  BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_sessions_updated_at
  BEFORE UPDATE ON interview_sessions FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

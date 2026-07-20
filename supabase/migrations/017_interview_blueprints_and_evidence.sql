-- A durable interview plan makes question selection and scoring traceable.
CREATE TABLE IF NOT EXISTS interview_blueprints_ai_interview (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES interview_sessions_ai_interview(id) ON DELETE CASCADE,
  version TEXT NOT NULL DEFAULT 'v1',
  competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  question_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidate_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  constraints JSONB NOT NULL DEFAULT '{"max_primary_questions":8,"max_follow_ups_per_question":1}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE interview_questions_ai_interview
  ADD COLUMN IF NOT EXISTS plan_item_id TEXT,
  ADD COLUMN IF NOT EXISTS competency_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS decision_rationale TEXT;

ALTER TABLE interview_answers_ai_interview
  ADD COLUMN IF NOT EXISTS ai_assessment JSONB;

CREATE INDEX IF NOT EXISTS idx_interview_blueprints_session
  ON interview_blueprints_ai_interview(session_id);

ALTER TABLE interview_blueprints_ai_interview ENABLE ROW LEVEL SECURITY;

-- Keep the candidate portal consistent with the existing public interview policies:
-- a blueprint is readable only for an active, unexpired interview session.
CREATE POLICY candidate_select_interview_blueprint ON interview_blueprints_ai_interview
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = interview_blueprints_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

CREATE POLICY candidate_insert_interview_blueprint ON interview_blueprints_ai_interview
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = interview_blueprints_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

CREATE POLICY candidate_update_interview_blueprint ON interview_blueprints_ai_interview
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM interview_sessions_ai_interview s
      WHERE s.id = interview_blueprints_ai_interview.session_id
        AND s.status IN ('invited', 'in_progress')
        AND s.expires_at > now()
    )
  );

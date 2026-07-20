-- Add insufficiency_reason to interview_questions_ai_interview
-- Records WHY a follow-up question was inserted, linking it to the diagnostic
-- failure mode detected by analyzeAnswerInRealtime.
-- Valid values mirror AnswerInsufficiencyReason in src/types/index.ts.
ALTER TABLE interview_questions_ai_interview
  ADD COLUMN IF NOT EXISTS insufficiency_reason TEXT
    CHECK (insufficiency_reason IN ('lacks_depth', 'lacks_evidence', 'vague', 'irrelevant'));

COMMENT ON COLUMN interview_questions_ai_interview.insufficiency_reason IS
  'For follow-up questions: the failure mode detected in the parent answer that triggered this follow-up. NULL for primary questions.';

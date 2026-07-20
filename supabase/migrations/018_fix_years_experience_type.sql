-- ==========================================================
-- 018: Fix parsed_years_experience to accept decimal values
-- ==========================================================

ALTER TABLE job_descriptions
  ALTER COLUMN parsed_years_experience TYPE DECIMAL(4,1);

ALTER TABLE job_descriptions_ai_interview
  ALTER COLUMN parsed_years_experience TYPE DECIMAL(4,1);

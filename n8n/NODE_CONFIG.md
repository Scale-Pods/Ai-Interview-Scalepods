# n8n Workflow Node Configuration

## Overview
This directory contains n8n workflow JSON files that handle backend automation for the AI Interviewer application.

## Workflow Files

### 1. `candidate-intake-fixed.json`
- **Webhook**: `POST /webhook/candidate-intake`
- **Flow**: Receive candidate data → Validate → Store candidate → Parse JD + Resume via Groq → Store JD/Resume → Audit log → Respond
- **Parameters pre-filled**: inserts into `candidates_ai_interview` table (name, email), `job_descriptions_ai_interview` table (JD data), `resumes_ai_interview` table (resume data), `audit_log_ai_interview` table

### 2. `session-creation-fixed.json`
- **Webhook**: `POST /webhook/create-session`
- **Flow**: Receive candidate_id → Create session → Generate questions → Store questions → Audit log → Respond
- **Parameters pre-filled**: inserts into `interview_sessions_ai_interview` table with status `invited`, `interview_questions_ai_interview` table

### 3. `scoring-pipeline-fixed.json`
- **Webhook**: `POST /webhook/score-interview`
- **Flow**: Fetch session data → Fetch questions, answers, proctoring events → Compile data → Score via Groq → Extract score → Store scorecard → Update session → Respond
- **Parameters pre-filled**: reads from `interview_sessions_ai_interview`, `interview_questions_ai_interview`, `interview_answers_ai_interview`, `proctoring_events_ai_interview` tables; inserts into `scorecards_ai_interview` table

### 4. `combined-full-workflow.json`
- Combines all three workflows above into a single flow for testing/development
- Includes all nodes from candidate-intake, session-creation, and scoring-pipeline

## Required Credentials

All workflows use:
- **supabaseApi**: "Supabase account 2" - Connected to the Supabase project
- **httpHeaderAuth**: For Groq API calls (uses `VITE_GROQ_API_KEY`)

## Configuration Steps

1. **Import Workflows**: In n8n UI, go to Settings > Import and upload each JSON file
2. **Credentials**: Ensure "Supabase account 2" and "Header Auth account 7" are configured
3. **Webhook URLs**: After import, copy the production webhook URLs and update your `.env`:
   - `VITE_WEBHOOK_CANDIDATE_INTAKE`
   - `VITE_WEBHOOK_SESSION_CREATION`
   - `VITE_WEBHOOK_SCORING_PIPELINE`
4. **JWT Secret**: The `JWT_SECRET` in `.env` must match the Supabase project's JWT secret for system-level operations

# AI Interviewer Platform — Architecture Document

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          React SPA (Vite)                                │
│  ┌──────────────────────┐          ┌────────────────────────────────┐    │
│  │   HR Dashboard       │          │   Candidate Portal             │    │
│  │                      │          │                                │    │
│  │  - Candidate mgmt    │          │  - Device PreCheck             │    │
│  │  - Session manager   │          │  - Camera+Screen sharing       │    │
│  │  - Scorecard viewer  │          │  - Answer recording (audio)    │    │
│  │  - Recording playback│          │  - Real-time STT transcription │    │
│  │  - Proctoring view   │          │  - Proctoring overlay          │    │
│  │  - Timeline          │          │  - Completion screen           │    │
│  └──────────────────────┘          └────────────────────────────────┘    │
│                          │                                                │
│                    ┌─────┴────────────────────────┐                      │
│                    │   Context Providers           │                      │
│                    │  - AuthContext (Supabase Auth) │                      │
│                    │  - InterviewContext (session) │                      │
│                    │  - ProctoringContext (events) │                      │
│                    └───────────────────────────────┘                      │
├──────────────────────────────────────────────────────────────────────────┤
│                        Supabase Backend                                  │
│  ┌──────────────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   PostgreSQL DB      │  │   Auth       │  │   Storage            │   │
│  │                      │  │              │  │                      │   │
│  │ - candidates         │  │ - Email/pwd  │  │ - Recordings bucket  │   │
│  │ - job_descriptions   │  │ - SSO (OIDC) │  │   (camera+screen     │   │
│  │ - resumes            │  │ - JWT tokens │  │    video uploads)    │   │
│  │ - interview_sessions │  │ - RLS        │  │                      │   │
│  │ - interview_questions│  └──────────────┘  └──────────────────────┘   │
│  │ - interview_answers  │                                               │
│  │ - recordings         │                                               │
│  │ - proctoring_events  │                                               │
│  │ - scorecards         │                                               │
│  │ - audit_log          │                                               │
│  └──────────────────────┘                                               │
├──────────────────────────────────────────────────────────────────────────┤
│                     n8n Workflow Engine (Groq AI)                       │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌────────────────┐│
│  │ Candidate Intake     │  │ Session Creation     │  │ Scoring        ││
│  │                      │  │                      │  │ Pipeline       ││
│  │ Parse JD + Resume    │  │ Generate invite link │  │ Fetch Q&A      ││
│  │ Extract structured   │  │ Send email           │  │ Build prompt   ││
│  │ data via Llama 3.3   │  │ Audit log            │  │ Llama 3.3 eval ││
│  └──────────────────────┘  └──────────────────────┘  └────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

## 2. Database Schema

### Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `candidates` | Candidate profiles | `id`, `name`, `email`, `metadata` |
| `job_descriptions` | Parsed JD data | `id`, `candidate_id`, `raw_text`, `parsed_skills`, `parsed_years_experience`, `parsed_roles` |
| `resumes` | Parsed resume data | `id`, `candidate_id`, `raw_text`, `parsed_skills`, `parsed_experience`, `parsed_education` |
| `interview_sessions` | Interview state machine | `id`, `candidate_id`, `jd_id`, `resume_id`, `status` (invited/in_progress/completed/expired/cancelled), `invite_link`, `token_hash`, `expires_at`, `started_at`, `completed_at` |
| `interview_questions` | Pre-generated questions | `id`, `session_id`, `question_text`, `question_type` (technical/behavioral/situational/cultural), `source`, `order_index`, `parent_question_id` |
| `interview_answers` | Candidate answer storage | `id`, `question_id`, `session_id`, `answer_text`, `audio_url`, `duration_secs` |
| `recordings` | Session recording metadata | `id`, `session_id`, `stream_type`, `status` (processing/ready/archived/failed), `storage_path`, `duration_secs`, `file_size_bytes`, `mime_type` |
| `proctoring_events` | Integrity event log | `id`, `session_id`, `event_type`, `severity` (info/warning/critical), `timestamp`, `payload` |
| `scorecards` | AI-generated evaluations | `id`, `session_id`, `technical_score`, `communication_score`, `problem_solving_score`, `cultural_fit_score`, `overall_score`, `strengths[]`, `weaknesses[]`, `recommendation`, `ai_rationale`, `reviewed_by_human` |
| `audit_log` | System audit trail | `id`, `actor_type` (system/hr_user/candidate/api), `action`, `resource_type`, `resource_id`, `details` |

### RLS Strategy

- **Anonymous (candidate) access**: SELECT on `interview_sessions`, `interview_questions`, `candidates`, `scorecards`; UPDATE on `interview_sessions` (status changes); INSERT on `interview_answers`, `recordings`, `proctoring_events`. All enforced via `auth.role() IN ('authenticated', 'anon')` policies.
- **HR (authenticated) access**: Full CRUD on all tables. HR role stored in `app_metadata.role` (not top-level JWT), with custom policies for `hr_admin`, `hr_recruiter`, `hr_viewer`.
- **Storage**: `recordings` bucket has public read access for signed URL fallback; HR SELECT uses `app_metadata.role` path.

## 3. n8n Workflows

### 3.1 Candidate Intake (`/webhook/candidate-intake`)
1. **Webhook** — receives `{ name, email, jobDescription, resume }` from CandidateForm
2. **Validate Inputs** — checks required fields
3. **Store Candidate** — inserts into `candidates` table
4. **Parse JD** + **Parse Resume** — parallel calls to Groq Llama 3.3 70B extracting structured data
5. **Store JD** + **Store Resume** — insert parsed data into respective tables
6. **Audit Log** — logs completion
7. **Respond** — returns `{ candidate_id, jd_id, resume_id }` to frontend

### 3.2 Session Creation (`/webhook/create-session`)
1. **Webhook** — receives `{ candidate_id, jd_id, resume_id }` from frontend after intake
2. **Generate Session** — creates UUID, invite link, expiry (7 days)
3. **Store Session** — inserts into `interview_sessions`
4. **Generate Questions** — calls Groq Llama 3.3 70B to generate 5 questions
5. **Parse Questions** — extracts structured question array
6. **Store Questions** — inserts each into `interview_questions`
7. **Send Email** — sends invite via SMTP
8. **Audit Log** — logs sent invite
9. **Respond** — returns `{ invite_link, session_id }`

### 3.3 Scoring Pipeline (`/webhook/score-interview`)
1. **Webhook** — receives `{ session_id }` from frontend on interview complete
2. **Prep Score** — extracts session_id
3. **Fetch Session/Questions/Proctoring/Answers** — 4 parallel Supabase reads
4. **Merge** — combines all data into one stream
5. **Build Prompt** — assembles Q&A chain + proctoring summary into scoring prompt
6. **AI Scorer** — calls Groq Llama 3.3 70B for structured evaluation
7. **Extract Score** — parses AI response into scorecard fields
8. **Store Scorecard** — inserts into `scorecards` table
9. **Update Session** — sets `status = completed` with timestamp

## 4. React Frontend Architecture

### 4.1 File Structure

```
src/
├── App.tsx                    # Root: routing (/, /login, /interview/:token)
├── main.tsx                   # Entry point
│
├── api/
│   ├── client.ts              # supabase (HR auth) + supabasePublic (anon) clients
│   ├── candidates.ts          # fetchCandidates, createCandidate, fetchDashboardStats
│   ├── sessions.ts            # fetchSession, fetchSessions, createSession, updateSessionStatus
│   ├── recordings.ts          # fetchRecordings, createRecording, updateRecordingStatus
│   ├── scorecards.ts          # fetchScorecard, fetchAllScorecards, markScorecardReviewed
│   ├── proctoring.ts          # fetchProctoringEvents, fetchProctoringSummary
│   ├── transcript.ts          # fetchTranscript (Q&A join for HR)
│   └── websocket.ts           # Realtime subscriptions (proctoring, session status, scorecard)
│
├── hooks/
│   ├── useAuth.ts             # Supabase Auth + SSO + role extraction
│   ├── useMediaRecorder.ts    # MediaRecorder: camera+screen composite recording → Storage
│   ├── useProctoring.ts       # Proctoring event detection → direct Supabase insert
│   ├── useInterviewTimer.ts   # Countdown timer (per-question, 5 min default)
│   └── useRealtime.ts         # Generic Realtime + postgres_changes hooks
│
├── components/
│   ├── common/
│   │   ├── LoadingSpinner.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── Toast.tsx
│   │
│   ├── hr/
│   │   ├── Dashboard.tsx            # Stats overview + recent sessions + charts
│   │   ├── CandidateList.tsx        # Searchable/filterable table
│   │   ├── CandidateForm.tsx        # Intake form (name, email, JD, resume upload)
│   │   ├── CandidateTimeline.tsx    # Consolidated activity timeline
│   │   ├── SessionManager.tsx       # Invite/resend/cancel controls
│   │   ├── ScorecardViewer.tsx      # Detailed scorecard with radar chart
│   │   ├── RecordingPlayer.tsx      # Video playback with signed/public URLs
│   │   ├── InterviewTranscript.tsx  # Q&A transcript viewer
│   │   ├── ProctoringDashboard.tsx  # Live proctoring grid
│   │   └── ProctoringSummary.tsx    # Per-session proctoring breakdown
│   │
│   └── candidate/
│       ├── InterviewRoom.tsx        # Main interview orchestration
│       ├── PreCheck.tsx             # Device check wizard (camera, mic, screen)
│       ├── QuestionDisplay.tsx      # Question text + type badge + read-aloud
│       ├── AnswerRecorder.tsx       # Voice recording + STT + waveform
│       ├── VideoFeed.tsx            # Camera preview component
│       ├── ProctoringOverlay.tsx    # Warning banners + termination screen
│       └── Completion.tsx           # Thank-you with confetti
│
├── context/
│   ├── AuthContext.tsx              # Wraps useAuth
│   ├── InterviewContext.tsx         # Session state, questions, recording control
│   └── ProctoringContext.tsx        # Proctoring event state
│
├── utils/
│   ├── tts.ts                      # useTTSEngine: Web Speech API TTS
│   ├── mediaHelpers.ts             # getCameraStream, getScreenStream, createCompositeStream
│   ├── scoringHelpers.ts           # Score display helpers (color, label, aggregate)
│   ├── formatDate.ts               # Date formatting
│   └── validation.ts               # Form validation
│
└── types/
    └── index.ts                    # All TypeScript interfaces
```

### 4.2 Interview Flow

1. **Candidate clicks invite link** → `/interview/:token`
2. **PreCheck** → device testing (camera, mic, screen share) + consent checkbox
3. **Start** → acquires MediaStreams, starts recording (camera+screen composite via canvas), starts proctoring, updates session to `in_progress`
4. **Question loop** → displays pre-generated questions one at a time, candidate records audio answer via `AnswerRecorder`, transcript generated via Web Speech API, answer stored to Supabase
5. **Completion** → stops recording, uploads blob to Storage, updates session to `completed`, triggers n8n scoring webhook
6. **Scoring (async)** → n8n fetches all Q&A + proctoring events, calls Groq for evaluation, stores scorecard

### 4.3 Proctoring

All proctoring events inserted **directly into Supabase** (bypass n8n) via `supabasePublic.from('proctoring_events').insert(...)`:

- Tab switch / window blur detection (Page Visibility API)
- Face presence detection (FaceDetector API, interval polling)
- Audio silence monitoring (AnalyserNode)
- Fullscreen enforcement
- Keyboard shortcut blocking
- Copy/paste prevention
- Context menu disable

## 5. Recording Pipeline

1. Camera + Screen streams obtained via `getUserMedia` / `getDisplayMedia`
2. Independent audio stream with echo cancellation
3. Canvas compositing via `createCompositeStream()`: screen as full background, camera as picture-in-picture
4. Composite stream recorded via `MediaRecorder` (VP9/Opus codec in WebM container)
5. On stop: full blob uploaded to Supabase Storage at `recordings/sessions/{sessionId}/recording_{uuid}.webm`
6. Recording metadata inserted into `recordings` table with `status: 'ready'`

## 6. Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Speech-to-Text** | Web Speech API (`webkitSpeechRecognition`) | Built into Chrome, no API cost |
| **Text-to-Speech** | Web Speech API (`speechSynthesis`) | Browser-native, no API cost |
| **Session recording** | MediaRecorder → Supabase Storage | Single upload on stop (no chunked) |
| **Proctoring events** | Direct Supabase insert | Bypass n8n for reliability |
| **Scoring** | n8n → Groq Llama 3.3 70B | Async pipeline, no frontend blocking |
| **Questions** | Pre-generated by n8n via Groq | Fixed 5 questions per session |
| **AI model** | Groq Llama 3.3 70B | Fast inference, JSON mode support |
| **Auth** | Supabase Auth + RLS | Built-in, no custom backend |

## 7. Environment Variables

```
VITE_SUPABASE_URL              Supabase project URL
VITE_SUPABASE_ANON_KEY         Supabase anon public key
VITE_WEBHOOK_CANDIDATE_INTAKE  n8n webhook path for candidate intake
VITE_WEBHOOK_SESSION_CREATION  n8n webhook path for session creation
VITE_WEBHOOK_SCORING_PIPELINE  n8n webhook path for scoring
VITE_WEBHOOK_PROCTORING_EVENT  n8n webhook path for proctoring (unused — direct insert)
VITE_API_BASE                  API base path
```

## 8. Current Limitations

- **Fixed 5 questions** — pre-generated at session creation, no dynamic follow-ups
- **No AI voice** — questions are text-only with optional TTS read-aloud button
- **Text + voice input** — candidate can type or speak answers
- **Per-question timer** (5 min) — no global 20-min timer
- **n8n required for intake** — candidate creation depends on n8n webhook being active
- **No resume file upload** — resume accepted as text paste only
- **Per-question recording** — answer audio stored per-question, not continuous
- **Question navigation** — previous/next/skip buttons for pre-generated questions

## 9. Supabase Migrations

| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | Core tables: candidates, sessions, questions, answers, scorecards, audit_log |
| `002_public_interview_policies.sql` | RLS policies for anon candidate access |
| `003_get_sessions_with_candidates.sql` | Helper function for session+candidate join |
| `004_fix_rls_role_path.sql` | Fix HR role extraction from app_metadata |
| `005_live_interview.sql` | Add proctoring_events, recordings tables |
| `006_fix_recordings_rls.sql` | Fix RLS for recordings table |
| `007_candidate_select_recordings.sql` | Add SELECT policy for anon on recordings |
| `008_fix_storage_rls_role_path.sql` | Fix storage bucket RLS for HR role path, make bucket public |

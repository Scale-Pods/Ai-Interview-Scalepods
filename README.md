# AI Interviewer Platform

A conversational AI interview platform with voice capabilities, proctoring, and HR dashboard analytics.

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:5173`.

## Features

### Candidate Experience
- **Device PreCheck** — camera, microphone, and screen sharing verification
- **Camera+Screen Recording** — composite video with picture-in-picture
- **Voice Answering** — speech-to-text transcription via Web Speech API
- **Live Waveform** — audio level visualization during recording
- **Proctoring** — tab switch, face detection, audio silence, fullscreen enforcement
- **Progress Tracking** — question navigation with timer

### HR Dashboard
- **Analytics** — average scores, score distribution, funnel metrics
- **Candidate Management** — search, filter, create invites
- **Scorecard Viewer** — radar chart, strengths/weaknesses, recommendation
- **Recording Playback** — signed URL + public URL fallback
- **Proctoring Review** — per-session event summary and live dashboard
- **Timeline** — consolidated activity view

### Technical
- **Supabase** — PostgreSQL, Auth, RLS, Storage, Realtime
- **Web Speech API** — speech recognition (STT) and synthesis (TTS)
- **n8n Workflows** — candidate intake, session creation, scoring pipeline
- **Groq Llama 3.3 70B** — JD parsing, resume parsing, question generation, scoring
- **Canvas Compositing** — screen + camera picture-in-picture recording

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React SPA     │───▶│   Supabase      │◀───│   n8n Engine    │
│  (Vite + TS)    │    │  (DB + Auth +   │    │  (Groq AI)      │
│                 │    │   Storage +     │    │                 │
│  Candidate UI   │    │   Realtime)     │    │  Candidate      │
│  HR Dashboard   │    │                 │    │  Intake         │
│                 │    │   PostgreSQL    │    │  Session Create │
│  Proctoring     │    │   RLS Policies  │    │  Scoring Eval   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Project Structure

```
src/
├── api/               # Supabase client + data access functions
├── components/
│   ├── candidate/     # InterviewRoom, PreCheck, AnswerRecorder, etc.
│   ├── hr/            # Dashboard, CandidateList, ScorecardViewer, etc.
│   └── common/        # LoadingSpinner, ErrorBoundary, Toast, etc.
├── context/           # AuthContext, InterviewContext, ProctoringContext
├── hooks/             # useAuth, useMediaRecorder, useProctoring, etc.
├── utils/             # TTS, media helpers, scoring helpers, formatting
├── types/             # TypeScript interfaces
├── App.tsx            # Routing (/, /login, /interview/:token)
└── main.tsx           # Entry point
n8n/
└── workflows/         # n8n workflow JSON exports
supabase/
└── migrations/        # SQL migrations (001 through 008)
```

## Environment Variables

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_WEBHOOK_CANDIDATE_INTAKE=/webhook/candidate-intake
VITE_WEBHOOK_SESSION_CREATION=/webhook/create-session
VITE_WEBHOOK_SCORING_PIPELINE=/webhook/score-interview
VITE_WEBHOOK_PROCTORING_EVENT=/webhook/proctoring-event
VITE_API_BASE=/api/v1
```

## Setup

1. Create a Supabase project and get credentials
2. Copy `.env.example` to `.env` and fill in values
3. Run migrations in order from `supabase/migrations/` in Supabase SQL Editor
4. Import n8n workflows from `n8n/workflows/` and configure credentials
5. Run `npm install && npm run dev`

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Backend | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| AI | Groq Llama 3.3 70B |
| Automation | n8n |
| Icons | Lucide React |
| Charts | Recharts |
| Voice | Web Speech API |

## Migrations

Run in order in Supabase SQL Editor:

| # | File | Purpose |
|---|------|---------|
| 001 | `initial_schema.sql` | Core tables |
| 002 | `public_interview_policies.sql` | Anon RLS policies |
| 003 | `get_sessions_with_candidates.sql` | Helper function |
| 004 | `fix_rls_role_path.sql` | HR role fix |
| 005 | `live_interview.sql` | Proctoring + recordings |
| 006 | `fix_recordings_rls.sql` | Recordings RLS fix |
| 007 | `candidate_select_recordings.sql` | Anon SELECT policy |
| 008 | `fix_storage_rls_role_path.sql` | Storage RLS fix |

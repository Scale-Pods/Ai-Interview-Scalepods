# AI Interviewer Platform

A conversational AI interview platform with voice capabilities, real-time proctoring, and an HR analytics dashboard. Candidates receive a personalised invite link and complete a fully automated, adaptive interview powered by n8n + Groq.

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:5173`.

## Features

### Candidate Experience
- **Device Pre-Check** — camera, microphone, and screen sharing verification before the interview starts
- **Camera + Screen Recording** — composite picture-in-picture video stored in Supabase Storage
- **Voice Answering** — real-time speech-to-text transcription via Web Speech API
- **Live Waveform** — audio level visualisation during recording
- **AI Interviewer (Alex)** — conversational turn-by-turn interview with warm acknowledgements and targeted follow-ups
- **Proctoring** — tab switch, face detection (multiple / absent), audio silence, fullscreen enforcement
- **Progress Tracking** — question progress bar with countdown timer

### HR Dashboard
- **Candidate Intake** — upload JD + resume, n8n parses and pre-generates interview questions
- **Analytics** — average scores, score distribution, funnel metrics (invited → started → completed → scored)
- **Candidate Management** — search, filter, invite management
- **Scorecard Viewer** — radar chart, strengths / weaknesses, recommendation, resume-vs-reality analysis
- **Recording Playback** — signed URL + public URL fallback
- **Proctoring Review** — per-session event summary and live dashboard
- **Timeline** — consolidated activity view per candidate

### Technical
- **Supabase** — PostgreSQL, Auth, RLS, Storage, Realtime
- **n8n Workflows** — candidate intake, session + question creation, interview engine (turn generation, answer analysis, follow-up), candidate analysis, scoring pipeline
- **Groq Llama 3.3 70B** — all LLM inference via n8n (JD/resume parsing, question generation, answer analysis, scoring)
- **Web Speech API** — speech recognition (STT) and synthesis (TTS)
- **Canvas Compositing** — screen + camera picture-in-picture recording

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌──────────────────────┐
│   React SPA     │───▶│   Supabase      │◀───│   n8n Engine         │
│  (Vite + TS)    │    │  (DB + Auth +   │    │  (Groq Llama 3.3 70B)│
│                 │    │   Storage +     │    │                      │
│  Candidate UI   │    │   Realtime)     │    │  Candidate Intake    │
│  HR Dashboard   │    │                 │    │  Session Creation    │
│  Proctoring     │    │  PostgreSQL     │    │  Interview Engine    │
│                 │    │  RLS Policies   │    │  Candidate Analysis  │
│  Webhooks ──────┼────┼─────────────────┼───▶│  Scoring Pipeline   │
└─────────────────┘    └─────────────────┘    └──────────────────────┘
```

### Data Flow
1. **HR creates candidate** → `CandidateForm` calls n8n `/webhook/candidate-intake` → Groq parses JD + resume, stores structured data in Supabase
2. **HR creates session** → n8n `/webhook/create-session` → generates 10 pre-planned questions, sends invite email
3. **Candidate starts interview** → React SPA reads questions from Supabase, runs real-time interview loop via `/webhook/interview-engine`
4. **After each answer** → n8n analyzes the answer, decides follow-up, generates Alex's next turn
5. **Interview completes** → SPA fires `/webhook/score-interview` → n8n scores the full transcript via Groq, writes scorecard to Supabase

## Project Structure

```
src/
├── api/               # Supabase client + typed data-access functions
│   ├── client.ts      # Supabase client instances (supabase + supabasePublic)
│   ├── candidates.ts  # Candidate CRUD, dashboard stats
│   ├── sessions.ts    # Session fetch / status / expiry management
│   ├── scorecards.ts  # Scorecard read + reviewed flag
│   ├── recordings.ts  # Recording metadata + upload URL
│   ├── proctoring.ts  # Proctoring events fetch + realtime subscription
│   ├── transcript.ts  # Q&A transcript builder
│   ├── interviewBlueprints.ts  # Blueprint fetch + upsert
│   └── websocket.ts   # Supabase Realtime subscriptions
├── components/
│   ├── candidate/     # InterviewRoom, PreCheck, AnswerRecorder, QuestionDisplay, etc.
│   ├── hr/            # Dashboard, CandidateForm, CandidateList, ScorecardViewer, etc.
│   └── common/        # LoadingSpinner, ErrorBoundary, Toast, ConfirmDialog, etc.
├── context/           # AuthContext, InterviewContext, ProctoringContext, ThemeContext
├── hooks/             # useAuth, useMediaRecorder, useProctoring, useInterviewTimer, useRealtime
├── utils/
│   ├── llm.ts         # n8n webhook callers + local LLM fallbacks for blueprint generation
│   ├── interviewOrchestrator.ts  # Blueprint plan item selection + follow-up policy
│   ├── tts.ts         # Web Speech API TTS engine
│   ├── mediaHelpers.ts # Camera / screen / audio stream helpers
│   ├── scoringHelpers.ts  # Score display utilities (color, label, aggregation)
│   ├── speechNormalizer.ts  # STT output cleanup
│   └── formatDate.ts  # Date formatting helpers
├── types/             # TypeScript interfaces for all domain objects
├── App.tsx            # Routing (/, /login, /interview/:token)
└── main.tsx           # Entry point
n8n/
├── workflows/         # n8n workflow JSON exports (import into your n8n instance)
│   ├── candidate-intake-fixed.json       # JD + resume parsing, candidate storage
│   ├── session-creation-fixed.json       # Session creation, question generation, email invite
│   ├── interview-engine-combined.json    # Answer analysis, turn generation, targeted follow-up
│   ├── candidate-analysis-fixed.json     # Fit analysis, truth audit, draft questions (HR panel)
│   ├── scoring-pipeline-fixed.json       # Post-interview scoring via Groq
│   └── combined-full-workflow.json       # Single-file reference containing all workflows
└── NODE_CONFIG.md     # n8n node-level configuration reference
supabase/
└── migrations/        # SQL migration files (run in order)
```

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `VITE_WEBHOOK_CANDIDATE_INTAKE` | n8n webhook for candidate intake |
| `VITE_WEBHOOK_SESSION_CREATION` | n8n webhook for session + question creation |
| `VITE_WEBHOOK_INTERVIEW_ENGINE` | n8n webhook for interview engine (analyze-answer, generate-turn, targeted-followup) |
| `VITE_WEBHOOK_ANALYZE_CANDIDATE` | n8n webhook for HR candidate analysis panel |
| `VITE_WEBHOOK_SCORING_PIPELINE` | n8n webhook for post-interview scoring |
| `VITE_WEBHOOK_AUDIT_RESUME_TRUTHFULNESS` | n8n webhook for resume truth audit |
| `VITE_WEBHOOK_ANALYZE_CANDIDATE_FIT` | n8n webhook for candidate fit analysis (interview fallback) |
| `VITE_DEEPGRAM_API_KEY` | Deepgram API key for real-time speech-to-text (Nova-2) |

## Setup

1. **Supabase** — create a project, copy URL and anon key to `.env`
2. **Database** — run migrations in order from `supabase/migrations/` in the Supabase SQL Editor
3. **n8n** — import workflows from `n8n/workflows/`, assign Supabase and Groq credentials
4. **Webhooks** — set n8n webhook URLs in your `.env`
5. **Run** — `npm install && npm run dev`

See [SETUP.md](./SETUP.md) for detailed step-by-step instructions.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite |
| Styling | Vanilla CSS (custom design system) |
| Backend / DB | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| AI Orchestration | n8n |
| LLM | Groq Llama 3.3 70B |
| Icons | Lucide React |
| Charts | Recharts |
| Voice | Web Speech API |

## Database Setup

The full schema (tables, indexes, RLS policies, storage bucket, helper functions) is consolidated in a single idempotent file:

**[`supabase/DATABASE_SETUP.sql`](./supabase/DATABASE_SETUP.sql)**

Copy its contents into the Supabase SQL Editor and click **Run**.


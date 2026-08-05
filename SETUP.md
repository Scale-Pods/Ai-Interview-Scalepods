# AI Interviewer Platform — Setup Guide

Step-by-step instructions for setting up the AI Interviewer Platform from scratch.

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install](#2-clone--install)
3. [Supabase Setup](#3-supabase-setup)
4. [Database Migrations](#4-database-migrations)
5. [n8n Workflow Setup](#5-n8n-workflow-setup)
6. [Environment Configuration](#6-environment-configuration)
7. [Running Locally](#7-running-locally)
8. [Deployment](#8-deployment)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 18.0.0 | [nodejs.org](https://nodejs.org/) |
| npm | bundled with Node | or Yarn |
| Browser | Chrome (recommended) | Best Web Speech API support |
| Supabase account | — | [supabase.com](https://supabase.com) |
| n8n instance | ≥ 1.x | Self-hosted or [n8n.cloud](https://n8n.cloud) |
| Groq API key | — | [console.groq.com](https://console.groq.com) |

> **Hardware**: Microphone + camera required for the candidate interview experience. Recommend Chrome on desktop.

---

## 2. Clone & Install

```bash
git clone https://github.com/your-username/ai-interviewer.git
cd ai-interviewer
npm install
```

---

## 3. Supabase Setup

### Create a project
1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Choose a region close to your users
3. Save your **Database Password** securely

### Get your API keys
1. In the dashboard go to **Settings → API**
2. Copy **Project URL** and **anon public** key — you'll need these in `.env`

### Enable extensions
In **Database → Extensions**, enable:
- `uuid-ossp`
- `pgcrypto`

### Enable Storage
1. Go to **Storage → Create a new bucket**
2. Name it `recordings`
3. Set it to **Public** (or configure signed URLs as preferred)

---

## 4. Database Setup

The entire schema, indexes, RLS policies, storage bucket, and helper functions are consolidated in a single file:

**[`supabase/DATABASE_SETUP.sql`](./supabase/DATABASE_SETUP.sql)**

### How to run
1. In your Supabase dashboard, go to **SQL Editor → New query**
2. Open `supabase/DATABASE_SETUP.sql`, copy the entire contents
3. Paste into the SQL Editor and click **Run**

The script is idempotent — all `CREATE TABLE`, `CREATE POLICY`, and `CREATE INDEX` statements use `IF NOT EXISTS` or `DROP ... IF EXISTS` first, so it is safe to re-run.

### Enable Realtime
In **Database → Replication**, confirm these tables are added to the `supabase_realtime` publication (the setup script does this, but verify):
- `interview_sessions_ai_interview`
- `scorecards_ai_interview`
- `proctoring_events_ai_interview`

---

## 5. n8n Workflow Setup

The platform uses n8n for all AI processing. The frontend calls n8n webhooks; n8n calls Groq and writes results to Supabase.

### Import workflows
1. Open your n8n instance
2. Go to **Workflows → Import from File**
3. Import each JSON from `n8n/workflows/` in this order:

| File | Webhook Path | Purpose |
|------|-------------|---------|
| `candidate-intake-fixed.json` | `/webhook/candidate-intake` | Parse JD + resume via Groq, store candidate data |
| `session-creation-fixed.json` | `/webhook/create-session` | Create session, generate 10 questions, send invite email |
| `interview-engine-combined.json` | `/webhook/interview-engine` | Answer analysis, turn generation, targeted follow-up |
| `candidate-analysis-fixed.json` | `/webhook/analyze-candidate` | Fit analysis, truth audit, draft questions (HR panel) |
| `scoring-pipeline-fixed.json` | `/webhook/score-interview` | Score full transcript after interview completes |

> The `combined-full-workflow.json` is a single-file reference — you do not need to import it separately if you've imported all five above.

### Assign credentials
After importing, nodes with a yellow triangle need credentials. You'll need to create:

| Credential Type | Used By | Details |
|-----------------|---------|---------|
| **Supabase API** | All database read/write nodes | Host = your Supabase URL, Service Role Key from Settings → API |
| **HTTP Header Auth** | All Groq HTTP Request nodes | Name: `Authorization`, Value: `Bearer gsk_your-groq-api-key` |
| **SMTP** | Send Email node (session creation) | Your email provider SMTP settings |

### Activate workflows
Toggle each imported workflow to **Active** so the webhooks respond to requests.

### Get your webhook URLs
For each active workflow, click the **Webhook** trigger node to see its full production URL. These go into your `.env` file.

---

## 6. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Supabase
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key

# n8n Webhook URLs (use full URLs in production; relative paths use Vite proxy in dev)
VITE_WEBHOOK_CANDIDATE_INTAKE=https://your-n8n.com/webhook/candidate-intake
VITE_WEBHOOK_SESSION_CREATION=https://your-n8n.com/webhook/create-session
VITE_WEBHOOK_INTERVIEW_ENGINE=https://your-n8n.com/webhook/interview-engine
VITE_WEBHOOK_ANALYZE_CANDIDATE=https://your-n8n.com/webhook/analyze-candidate
VITE_WEBHOOK_SCORING_PIPELINE=https://your-n8n.com/webhook/score-interview
VITE_WEBHOOK_AUDIT_RESUME_TRUTHFULNESS=https://your-n8n.com/webhook/audit-resume-truthfulness
VITE_WEBHOOK_ANALYZE_CANDIDATE_FIT=https://your-n8n.com/webhook/analyze-candidate-fit
```

> **Note**: `VITE_GROQ_API_KEY` is configured directly in n8n as a Header Auth credential — it does not need to be in `.env` unless your n8n nodes read it from an environment variable.

### Local development proxy
During local development, you can use relative paths (`/webhook/...`) and configure Vite to proxy them to your n8n instance. In `vite.config.ts`, add a proxy:

```ts
server: {
  proxy: {
    '/webhook': 'https://your-n8n.com'
  }
}
```

---

## 7. Running Locally

```bash
npm run dev
```

Visit `http://localhost:5173`.

### HR workflow
1. Login at `/login` with your Supabase auth user
2. Go to **Candidates → New Candidate** to add a candidate and upload JD + resume
3. After submission, n8n generates questions and the AI analysis panel appears
4. Copy the invite link and send it to the candidate

### Candidate workflow
1. Open the invite link in Chrome
2. Allow camera, microphone, and screen sharing when prompted
3. Complete the interview — Alex (AI interviewer) will guide through questions
4. On completion, n8n automatically scores the transcript

---

## 8. Deployment

### Vercel (recommended)

```bash
npm i -g vercel
vercel
```

Set these environment variables in the Vercel dashboard (Settings → Environment Variables):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_WEBHOOK_CANDIDATE_INTAKE
VITE_WEBHOOK_SESSION_CREATION
VITE_WEBHOOK_INTERVIEW_ENGINE
VITE_WEBHOOK_ANALYZE_CANDIDATE
VITE_WEBHOOK_SCORING_PIPELINE
VITE_WEBHOOK_AUDIT_RESUME_TRUTHFULNESS
VITE_WEBHOOK_ANALYZE_CANDIDATE_FIT
```

The `vercel.json` in the project root already handles SPA routing.

### Netlify

```bash
npm run build
# Upload dist/ to Netlify or use Netlify CLI
netlify deploy --prod --dir dist
```

Set the same environment variables under **Site Settings → Build & Deploy → Environment**.

---

## 9. Troubleshooting

### "Failed to load session" error
- Check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct
- Verify the session token in the URL is valid and not expired
- Check Supabase project is active and migrations have run

### Interview questions not loading
- Verify `session-creation-fixed.json` n8n workflow is active
- Check Supabase `interview_questions_ai_interview` table has rows for the session
- Open browser devtools → Network to see which requests are failing

### n8n webhook returns 404 or timeout
- Ensure the workflow is set to **Active** in n8n
- Confirm the webhook URL in `.env` matches exactly the URL shown in the n8n Webhook node
- Check n8n execution logs for errors (Executions tab in n8n)

### Voice / microphone not working
- Must be served over **HTTPS** or **localhost** — Web Speech API requires a secure context
- Use Chrome for best compatibility
- Check browser permissions for microphone and camera

### Scoring not appearing after interview
- Check n8n Executions for the `scoring-pipeline` workflow for any errors
- Ensure Groq API key has credits and the model name matches (`llama-3.3-70b-versatile`)
- Scorecard data is written to `scorecards_ai_interview` table — check it directly in Supabase

### Email invite not sending
- Open n8n and check executions for the `session-creation` workflow
- Confirm SMTP credentials are correct and the email provider is not blocking outgoing mail
- Test SMTP credentials in n8n using the built-in credential test feature

---

## Maintenance

- **Dependency updates**: `npm update` — check for breaking changes in Supabase JS client
- **Database backups**: Enable Point-in-Time Recovery in Supabase (Pro plan) or schedule pg_dump
- **n8n updates**: Keep n8n updated for security patches; test workflows after updating
- **Groq model**: If `llama-3.3-70b-versatile` is deprecated, update the model name in all n8n HTTP Request nodes
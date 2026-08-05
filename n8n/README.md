# n8n Workflows

## Workflow Files

| File | Webhook Path | Purpose |
|------|-------------|---------|
| `candidate-intake-fixed.json` | `/webhook/candidate-intake` | Parse JD + resume via Groq, store structured candidate data |
| `session-creation-fixed.json` | `/webhook/create-session` | Create session, generate 10 planned questions, send invite email |
| `interview-engine-combined.json` | `/webhook/interview-engine` | Interview engine: answer analysis, turn generation, targeted follow-up (action param dispatches) |
| `candidate-analysis-fixed.json` | `/webhook/analyze-candidate` | Candidate fit analysis + resume truth audit + draft questions (HR panel) |
| `scoring-pipeline-fixed.json` | `/webhook/score-interview` | Post-interview scoring — fetches full transcript, scores via Groq, writes scorecard |
| `combined-full-workflow.json` | — | Single-file reference containing all workflows (for reference only) |

## Import

1. Open n8n UI → **Workflows** → **Import from File**
2. Import each file **individually** (do not import `combined-full-workflow.json` unless you want a single reference file)
3. After import, click each **yellow triangle** node to assign credentials
4. **Activate** each workflow (toggle in the top-right of the editor)

## Required Credentials

| Type | Used By | How to Configure |
|------|---------|-----------------|
| **Supabase API** | All database nodes | Host = your Supabase project URL, Key = Service Role key (Settings → API) |
| **HTTP Header Auth** | All Groq HTTP Request nodes | Name: `Authorization`, Value: `Bearer gsk_your-groq-api-key` |
| **SMTP** | Send Email node (session-creation) | Your email provider SMTP host, port, user, password |

## Webhook Endpoints

| Path | Workflow | Triggered By |
|------|----------|-------------|
| `/webhook/candidate-intake` | candidate-intake | HR CandidateForm after form submit |
| `/webhook/create-session` | session-creation | HR CandidateForm after intake succeeds |
| `/webhook/interview-engine` | interview-engine-combined | InterviewContext after each candidate answer (action: `analyze-answer`, `generate-turn`, `targeted-followup`) |
| `/webhook/analyze-candidate` | candidate-analysis | HR CandidateForm AI intelligence panel |
| `/webhook/score-interview` | scoring-pipeline | InterviewContext on interview completion |
| `/webhook/audit-resume-truthfulness` | interview-engine-combined | InterviewContext at interview start (optional) |
| `/webhook/analyze-candidate-fit` | interview-engine-combined | InterviewContext fallback if no blueprint found |

## interview-engine-combined Action Dispatch

The `interview-engine-combined` workflow handles multiple operations via an `action` field in the request body:

| `action` value | What n8n does |
|----------------|--------------|
| `analyze-answer` | Scores depth, authenticity, flags insufficiency, suggests follow-up direction |
| `generate-turn` | Generates Alex's natural conversational response + next question |
| `targeted-followup` | Generates a precise follow-up question targeting the specific gap identified |

## Groq Model

All Groq calls use `llama-3.3-70b-versatile`. To change the model, update the HTTP Request body in each node that calls `https://api.groq.com/openai/v1/chat/completions`.

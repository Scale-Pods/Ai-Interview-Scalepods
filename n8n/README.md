# n8n Workflows

## Files

| File | Description |
|------|-------------|
| `candidate-intake-fixed.json` | Parses JD + resume via Groq, stores candidate data |
| `session-creation-fixed.json` | Creates session, generates 5 questions, sends email |
| `scoring-pipeline-fixed.json` | Fetches Q&A + proctoring, scores via Groq, stores scorecard |
| `combined-full-workflow.json` | Single-file reference containing all 3 workflows |

## Import

1. Open n8n UI → **Workflows** → **Import from File**
2. Select each file individually
3. After import, assign credentials to nodes with yellow triangles

## Required Credentials

| Type | Used By | Details |
|------|---------|---------|
| **Supabase API** | All Store/Fetch nodes | Host + Service Role Key |
| **Header Auth** | Groq HTTP nodes | Name: `Authorization`, Value: `Bearer gsk_...` |
| **SMTP** | Send Email node | Email provider SMTP settings |

## Webhook Endpoints

| Path | Workflow | Purpose |
|------|----------|---------|
| `/webhook/candidate-intake` | candidate-intake | Receive candidate form data |
| `/webhook/create-session` | session-creation | Generate invite link |
| `/webhook/score-interview` | scoring-pipeline | Trigger scoring after completion |

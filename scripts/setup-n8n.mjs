#!/usr/bin/env node
/**
 * n8n Workflow Setup Script
 *
 * Creates all 3 AI Interviewer workflows via the n8n REST API.
 * Run after n8n is started:
 *
 *   n8n start
 *   node scripts/setup-n8n.mjs
 *
 * Requires environment variables (or edit defaults below):
 *   N8N_URL     — default http://localhost:5678
 *   N8N_API_KEY — your n8n API key
 */

const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

async function createWorkflow(name, nodes, connections) {
  const body = {
    name,
    nodes,
    connections,
    settings: {
      timezone: 'UTC',
      saveManualExecutions: true,
    },
    staticData: null,
    tags: ['ai-interviewer'],
  };

  const res = await fetch(`${N8N_URL}/rest/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(N8N_API_KEY ? { 'X-N8N-API-KEY': N8N_API_KEY } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create workflow "${name}": ${res.status} ${err}`);
  }

  const data = await res.json();
  console.log(`✓ Created workflow: ${name} (id: ${data.data.id})`);
  return data.data;
}

// ─── Node factory helpers ──────────────────────────────────────

function webhookNode(name, path, pos) {
  return {
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 1,
    position: pos,
    parameters: {
      path,
      httpMethod: 'POST',
      responseMode: 'onReceived',
      options: {},
    },
  };
}

function codeNode(name, code, pos) {
  return {
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: pos,
    parameters: { language: 'javascript', code },
  };
}

function supabaseNode(name, operation, tableId, pos, dataOrWhere) {
  const params =
    operation === 'insert'
      ? { operation, tableId, data: dataOrWhere }
      : { operation, tableId, where: { conditions: dataOrWhere } };
  return {
    name,
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position: pos,
    parameters: params,
    credentials: { supabaseApi: { id: '__DEFAULT__', name: 'Supabase' } },
  };
}

function httpNode(name, url, method, pos, body) {
  return {
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: pos,
    parameters: {
      url,
      method,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      body,
      options: {},
    },
    credentials: { httpHeaderAuth: { id: '__DEFAULT__', name: 'OpenAI' } },
  };
}

function emailNode(name, fromEmail, toEmail, subject, text, pos) {
  return {
    name,
    type: 'n8n-nodes-base.emailSend',
    typeVersion: 1,
    position: pos,
    parameters: { fromEmail, toEmail, subject, text, options: {} },
    credentials: { smtp: { id: '__DEFAULT__', name: 'SMTP' } },
  };
}

function mergeNode(name, pos) {
  return {
    name,
    type: 'n8n-nodes-base.merge',
    typeVersion: 2,
    position: pos,
    parameters: { mode: 'combine', combinationMode: 'mergeByPosition' },
  };
}

// ─── Connection helper ─────────────────────────────────────────

function edge(from, to, outputIndex = 0, inputIndex = 0) {
  return [{ node: to, type: 'main', index: inputIndex }];
}

// ================================================================
// WORKFLOW 1: Candidate Intake Pipeline
// ================================================================

const intakeNodes = [
  webhookNode('Webhook', 'candidate-intake', [250, 300]),
  codeNode(
    'Validate Inputs',
    `const { name, email, jobDescription, resume } = $input.body;
if (!name || !email || !jobDescription || !resume)
  throw new Error('Missing required fields');
return { name, email, jobDescription, resume };`,
    [450, 300]
  ),
  supabaseNode('Check Duplicate', 'select', 'candidates', [650, 300], [
    { field: 'email', operator: 'eq', value: '={{ $json.email }}' },
  ]),
  httpNode(
    'Parse JD',
    'https://api.openai.com/v1/chat/completions',
    'POST',
    [850, 200],
    {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'Extract structured data from this job description. Return JSON only: { skills: string[], yearsExperience: number, roles: string[], summary: string }',
        },
        { role: 'user', content: '={{ $json.jobDescription }}' },
      ],
      response_format: { type: 'json_object' },
    }
  ),
  httpNode(
    'Parse Resume',
    'https://api.openai.com/v1/chat/completions',
    'POST',
    [850, 400],
    {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'Extract structured data from this resume. Return JSON only: { skills: string[], experience: [{ title: string, company: string, duration: string, highlights: string[] }], education: [{ degree: string, institution: string, year: string }] }',
        },
        { role: 'user', content: '={{ $json.resume }}' },
      ],
      response_format: { type: 'json_object' },
    }
  ),
  supabaseNode('Store Candidate', 'insert', 'candidates', [1100, 300], {
    name: '={{ $json.name }}',
    email: '={{ $json.email }}',
  }),
  supabaseNode('Store JD', 'insert', 'job_descriptions', [1300, 200], {
    candidate_id: '={{ $json.candidate_id }}',
    raw_text: '={{ $json.jobDescription }}',
    parsed_skills: '={{ $json.jd_parsed.skills }}',
    parsed_years_experience: '={{ $json.jd_parsed.yearsExperience }}',
    parsed_roles: '={{ $json.jd_parsed.roles }}',
  }),
  supabaseNode('Store Resume', 'insert', 'resumes', [1300, 400], {
    candidate_id: '={{ $json.candidate_id }}',
    raw_text: '={{ $json.resume }}',
    parsed_skills: '={{ $json.resume_parsed.skills }}',
    parsed_experience: '={{ $json.resume_parsed.experience }}',
    parsed_education: '={{ $json.resume_parsed.education }}',
  }),
  supabaseNode('Audit Log Intake', 'insert', 'audit_log', [1500, 300], {
    actor_type: 'system',
    action: 'candidate_intake_complete',
    resource_type: 'candidates',
    resource_id: '={{ $json.candidate_id }}',
    details: '={{ { email: $json.email } }}',
  }),
];

const intakeConnections = {
  Webhook: { main: [edge('Validate Inputs')] },
  'Validate Inputs': { main: [edge('Check Duplicate')] },
  'Check Duplicate': {
    main: [edge('Parse JD'), edge('Parse Resume')],
  },
  'Parse JD': { main: [edge('Store Candidate')] },
  'Parse Resume': { main: [edge('Store Candidate')] },
  'Store Candidate': { main: [edge('Store JD'), edge('Store Resume')] },
  'Store JD': { main: [edge('Audit Log Intake')] },
  'Store Resume': { main: [edge('Audit Log Intake')] },
};

// ================================================================
// WORKFLOW 2: Interview Session Creation
// ================================================================

const sessionNodes = [
  webhookNode('Webhook', 'create-session', [250, 300]),
  codeNode(
    'Generate Session',
    `const crypto = require('crypto');
const sessionId = crypto.randomUUID();
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const token = crypto.randomBytes(32).toString('hex');
const inviteLink = \`https://ai-interviewer.example.com/interview/\${token}\`;
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
return {
  ...$input.body,
  session_id: sessionId,
  invite_link: inviteLink,
  token_hash: tokenHash,
  expires_at: expiresAt.toISOString()
};`,
    [450, 300]
  ),
  supabaseNode('Store Session', 'insert', 'interview_sessions', [650, 300], {
    id: '={{ $json.session_id }}',
    candidate_id: '={{ $json.candidate_id }}',
    jd_id: '={{ $json.jd_id }}',
    resume_id: '={{ $json.resume_id }}',
    status: 'invited',
    invite_link: '={{ $json.invite_link }}',
    token_hash: '={{ $json.token_hash }}',
    expires_at: '={{ $json.expires_at }}',
  }),
  emailNode(
    'Send Email',
    'interviews@example.com',
    '={{ $json.candidate_email }}',
    'Your AI Interview Invitation',
    'Hello {{ $json.candidate_name }},\n\nYou have been invited to complete an AI-powered interview.\n\nStart here: {{ $json.invite_link }}\n\nExpires: {{ $json.expires_at }}',
    [1250, 300]
  ),
  supabaseNode('Audit Log Session', 'insert', 'audit_log', [1450, 300], {
    actor_type: 'system',
    action: 'interview_invite_sent',
    resource_type: 'interview_sessions',
    resource_id: '={{ $json.session_id }}',
    details: '={{ { email: $json.candidate_email } }}',
  }),
];

const sessionConnections = {
  Webhook: { main: [edge('Generate Session')] },
  'Generate Session': { main: [edge('Store Session')] },
  'Store Session': { main: [edge('Send Email')] },
  'Send Email': { main: [edge('Audit Log Session')] },
};

// ================================================================
// WORKFLOW 3: Scoring Pipeline
// ================================================================

const scoringNodes = [
  webhookNode('Webhook', 'score-interview', [250, 300]),
  supabaseNode('Fetch Session', 'select', 'interview_sessions', [450, 200], [
    { field: 'id', operator: 'eq', value: '={{ $json.session_id }}' },
  ]),
  supabaseNode('Fetch Questions', 'select', 'interview_questions', [450, 350], [
    { field: 'session_id', operator: 'eq', value: '={{ $json.session_id }}' },
  ]),
  supabaseNode('Fetch Proctoring', 'select', 'proctoring_events', [450, 500], [
    { field: 'session_id', operator: 'eq', value: '={{ $json.session_id }}' },
  ]),
  mergeNode('Merge Data', [650, 350]),
  codeNode(
    'Build Prompt',
    `const session = $json.session[0];
const questions = $json.questions;
const proctoringEvents = $json.proctoring;

const qa = questions.map((q, i) => ({
  question: q.question_text,
  type: q.question_type,
  answer: '[see recording]'
}));

const summary = {
  totalEvents: proctoringEvents.length,
  criticalEvents: proctoringEvents.filter(e => e.severity === 'critical').length,
  tabSwitches: proctoringEvents.filter(e => e.event_type === 'tab_switch').length,
  faceAbsences: proctoringEvents.filter(e => e.event_type === 'face_absent').length
};

return { session_id: session.id, qa, proctoringSummary: summary };`,
    [850, 350]
  ),
  httpNode(
    'AI Scorer',
    'https://api.openai.com/v1/chat/completions',
    'POST',
    [1050, 350],
    {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'Score candidate 0-100 on: technical_score, communication_score, problem_solving_score, cultural_fit_score, overall_score. Provide strengths (array), weaknesses (array), recommendation (strong_hire|hire|consider|no_go), ai_rationale (string). Return valid JSON.',
        },
        {
          role: 'user',
          content:
            'Evaluate: Q&A={{ JSON.stringify($json.qa) }}, Proctoring={{ JSON.stringify($json.proctoringSummary) }}',
        },
      ],
      response_format: { type: 'json_object' },
    }
  ),
  supabaseNode('Store Scorecard', 'insert', 'scorecards', [1250, 350], {
    session_id: '={{ $json.session_id }}',
    technical_score: '={{ $json.ai_response.technical_score }}',
    communication_score: '={{ $json.ai_response.communication_score }}',
    problem_solving_score: '={{ $json.ai_response.problem_solving_score }}',
    cultural_fit_score: '={{ $json.ai_response.cultural_fit_score }}',
    overall_score: '={{ $json.ai_response.overall_score }}',
    strengths: '={{ $json.ai_response.strengths }}',
    weaknesses: '={{ $json.ai_response.weaknesses }}',
    recommendation: '={{ $json.ai_response.recommendation }}',
    ai_rationale: '={{ $json.ai_response.ai_rationale }}',
    scoring_model_version: 'gpt-4o-2024-11-20',
  }),
  supabaseNode('Update Session', 'update', 'interview_sessions', [1450, 350], [
    { field: 'id', operator: 'eq', value: '={{ $json.session_id }}' },
  ]),
];

const scoringConnections = {
  Webhook: {
    main: [edge('Fetch Session'), edge('Fetch Questions'), edge('Fetch Proctoring')],
  },
  'Fetch Session': { main: [edge('Merge Data', 0)] },
  'Fetch Questions': { main: [edge('Merge Data', 1)] },
  'Fetch Proctoring': { main: [edge('Merge Data', 2)] },
  'Merge Data': { main: [edge('Build Prompt')] },
  'Build Prompt': { main: [edge('AI Scorer')] },
  'AI Scorer': { main: [edge('Store Scorecard')] },
  'Store Scorecard': { main: [edge('Update Session')] },
};

// ─── Run ────────────────────────────────────────────────────────

async function main() {
  console.log(`Connecting to n8n at ${N8N_URL}...\n`);

  try {
    await createWorkflow('AI Interviewer — Candidate Intake', intakeNodes, intakeConnections);
    await createWorkflow('AI Interviewer — Session Creation', sessionNodes, sessionConnections);
    await createWorkflow('AI Interviewer — Scoring Pipeline', scoringNodes, scoringConnections);
    console.log('\n✅ All 3 workflows created.');
    console.log('   Open n8n UI to configure credentials (Supabase, OpenAI, SMTP).');
    console.log('   Click each node with a yellow triangle to assign credentials.\n');
  } catch (err) {
    console.error('\n❌', err.message);
    console.log('\nMake sure n8n is running and accessible.\n');
    process.exit(1);
  }
}

main();

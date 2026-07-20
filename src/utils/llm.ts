// Unified Client-Side LLM Helper for Dynamic Interview Questions
import type { LiveAssessmentNote, AuthenticitySignal, InterviewerTurn, InterviewerTurnType, InterviewBlueprint, InterviewPlanItem, AnswerInsufficiencyReason, JdTool } from '@/types'

function extractJSON(raw: string): string {
  const noFences = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const match = noFences.match(/\{[\s\S]*\}/)
  if (match) return match[0]
  const arrMatch = noFences.match(/\[[\s\S]*\]/)
  if (arrMatch) return arrMatch[0]
  return noFences
}

const truncate = (text: string, max: number) => text.length > max ? text.slice(0, max) + '...[truncated]' : text

interface HistoryItem {
  question: string
  answer: string
  type: string
}

interface QuestionResponse {
  question_text: string
  question_type: 'technical' | 'behavioral' | 'situational' | 'cultural'
  follow_up_reason: string
}

interface SkillAssessment {
  skill: string
  // where this skill came from
  source: 'jd_required' | 'resume_claimed' | 'both'
  // match: candidate claims it and JD needs it -> verify depth
  // gap: JD needs it, resume gives no evidence of it -> probe cautiously to see if they know it anyway
  // strength: candidate has it, JD doesn't ask for it -> optional bonus probe
  status: 'match' | 'gap' | 'strength'
  // short paraphrase of where/how it shows up in the resume, if it does
  evidence: string
  // 1 = most important to verify, higher numbers = lower priority
  priority: number
}

interface ProjectMapping {
  resumeProject: string
  relatedJdRequirement: string
  notes: string
}

export interface CandidateAnalysis {
  skills: SkillAssessment[]
  projectMappings: ProjectMapping[]
  summary: string
  /** Named tools/technologies extracted directly from the JD. Populated by extractJdToolsAndTech(). */
  extractedTools?: JdTool[]
}

function fallbackBlueprint(sessionId: string, analysis: CandidateAnalysis): InterviewBlueprint {
  // Prefer named tools extracted from the JD; fall back to skills from the fit analysis.
  const tools = analysis.extractedTools || []
  const sourceItems = tools.length > 0
    ? tools.slice(0, 6).map((t, i) => ({
        id: `competency-${i + 1}`,
        name: t.name,
        weight: t.importance === 'must_have' ? Math.max(3, 5 - i) : Math.max(1, 3 - i),
        description: `Assess practical capability in ${t.name}.`,
        expected_evidence: ['A concrete example', 'Specific usage details', 'Decision context']
      }))
    : analysis.skills.slice(0, 6).map((skill, index) => ({
        id: `competency-${index + 1}`,
        name: skill.skill || `Role competency ${index + 1}`,
        weight: Math.max(1, 6 - index),
        description: skill.evidence || `Assess practical capability in ${skill.skill}.`,
        expected_evidence: ['A concrete example', 'Personal contribution', 'Decision-making and trade-offs']
      }))
  const safeCompetencies = sourceItems.length > 0 ? sourceItems : [{
    id: 'role-fit', name: 'Role fit', weight: 5,
    description: 'Ability to perform the core responsibilities of the role.',
    expected_evidence: ['Relevant experience', 'Reasoning', 'Concrete outcomes']
  }]
  const types: InterviewPlanItem['question_type'][] = ['technical', 'technical', 'situational', 'behavioral', 'technical', 'cultural']
  return {
    session_id: sessionId,
    version: 'v1',
    competencies: safeCompetencies,
    question_plan: safeCompetencies.slice(0, 6).map((competency, index) => {
      const tool = tools[index]
      return {
        id: `plan-${index + 1}`,
        competency_ids: [competency.id],
        target_tool: tool?.name || competency.name,
        verification_mode: (tool ? (tool.mentioned_in_resume ? 'verify_claim' : 'baseline_check') : 'baseline_check') as 'verify_claim' | 'baseline_check',
        objective: `Collect evidence for ${competency.name}: ${competency.description}`,
        question_type: types[index] || 'technical',
        difficulty: (index < 3 ? 'foundation' : 'applied') as 'foundation' | 'applied'
      }
    }),
    candidate_summary: {
      strengths: analysis.skills.filter(s => s.status === 'match' || s.status === 'strength').slice(0, 3).map(s => s.skill),
      gaps: analysis.skills.filter(s => s.status === 'gap').slice(0, 3).map(s => s.skill),
      claims_to_validate: analysis.projectMappings.slice(0, 3).map(p => p.resumeProject)
    },
    constraints: { max_primary_questions: 8, max_follow_ups_per_question: 1 }
  }
}

export async function generateInterviewBlueprint(sessionId: string, resumeText: string, jdText: string, analysis: CandidateAnalysis): Promise<InterviewBlueprint> {
  const fallback = fallbackBlueprint(sessionId, analysis)
  const extractedTools = analysis.extractedTools || []

  const toolsContext = extractedTools.length > 0
    ? `\nExtracted JD tools/technologies (6-10 specific named tools pulled from the JD):\n${JSON.stringify(extractedTools, null, 2)}\n\nIMPORTANT: Map competencies DIRECTLY to these named tools (e.g. competency name = "React" or "React + TypeScript", NOT "Frontend Development"). Each plan item MUST have target_tool set to one of these exact tool names.`
    : ''

  const prompt = `You are designing a focused, practical screening interview plan. This is an EASY-TO-MEDIUM round — not a senior systems design or internals deep-dive. Return ONLY JSON matching this schema:
{"competencies":[{"id":"short-kebab-id","name":"SPECIFIC TOOL NAME (e.g. React, PostgreSQL)","weight":1,"description":"string","expected_evidence":["string"]}],"question_plan":[{"id":"plan-1","competency_ids":["competency-id"],"target_tool":"React","verification_mode":"verify_claim|baseline_check","objective":"string","question_type":"technical|behavioral|situational|cultural","difficulty":"foundation|applied"}],"candidate_summary":{"strengths":["string"],"gaps":["string"],"claims_to_validate":["string"]},"constraints":{"max_primary_questions":8,"max_follow_ups_per_question":1}}

RULES:
1. Create 4-6 competencies named after SPECIFIC tools (e.g. "React", "Docker", "REST APIs") — NOT abstract categories like "Frontend Development" or "DevOps".
2. Create 6-8 plan items, each testing a specific tool.
3. For each plan item set:
   - target_tool: exact tool name from the extracted tools list.
   - verification_mode: "verify_claim" if the tool appears in the candidate's resume (we validate their stated experience), or "baseline_check" if it's JD-only (we check basic awareness only).
   - difficulty: ONLY "foundation" or "applied" — NEVER "advanced", "expert", or "senior". This is a screening round.
4. A plan item objective must be concrete evidence-seeking, not a generic topic.
5. Do not infer protected traits or cultural similarity.${toolsContext}
Job description:\n${truncate(jdText, 3000)}
Resume:\n${truncate(resumeText, 3000)}
Fit analysis:\n${JSON.stringify({ summary: analysis.summary, skills: analysis.skills.slice(0, 10) })}`
  try {
    const parsed = JSON.parse(extractJSON(await generateCompletion(prompt)))
    if (!Array.isArray(parsed.competencies) || !Array.isArray(parsed.question_plan)) return fallback
    return {
      ...fallback,
      competencies: parsed.competencies,
      question_plan: parsed.question_plan,
      candidate_summary: parsed.candidate_summary || fallback.candidate_summary,
      constraints: { ...fallback.constraints, ...(parsed.constraints || {}) }
    }
  } catch (error) {
    console.warn('[generateInterviewBlueprint] Falling back to deterministic blueprint:', error)
    return fallback
  }
}

const TOTAL_WANTED_JOB_QUESTIONS = 10

const FALLBACK_QUESTIONS: Array<Pick<QuestionResponse, 'question_text' | 'question_type'>> = [
  {
    question_text: "What is a fundamental concept from this role's core technology and why is it important?",
    question_type: "technical"
  },
  {
    question_text: "Compare two approaches or tools used in this domain — what are the tradeoffs and when would you pick each?",
    question_type: "technical"
  },
  {
    question_text: "Explain a design pattern or architectural principle relevant to this role and describe a situation where you applied it.",
    question_type: "technical"
  },
  {
    question_text: "Walk me through how you would approach building a feature or solving a real-world problem in this role's primary technology.",
    question_type: "technical"
  },
  {
    question_text: "Describe a time you debugged a complex issue — what was your process and how did you identify the root cause?",
    question_type: "situational"
  },
  {
    question_text: "Which project or experience on your resume best matches this job description, and what was your exact contribution to it?",
    question_type: "technical"
  },
  {
    question_text: "Looking at your resume against this job description, which missing or lighter experience area would you prioritize improving first, and how would you do it?",
    question_type: "situational"
  },
  {
    question_text: "Pick one resume project or past role that relates to a JD requirement and explain how that experience would transfer to this position.",
    question_type: "technical"
  },
  {
    question_text: "How do you prefer to collaborate with teammates, handle disagreements, and give or receive feedback?",
    question_type: "cultural"
  },
  {
    question_text: "What kind of team culture helps you do your best work, and how do you contribute to that environment?",
    question_type: "cultural"
  }
]

const INTERVIEW_PLAN: Array<{
  category: string
  instruction: string
  questionType: QuestionResponse['question_type']
}> = [
  {
    category: 'Conceptual 1 of 3',
    instruction: 'Test core conceptual understanding of the primary skill or technology for this role. Ask about foundational concepts, theory, or first principles — not how-to implementation. Verify the candidate truly understands the fundamentals.',
    questionType: 'technical'
  },
  {
    category: 'Conceptual 2 of 3',
    instruction: 'Test deeper conceptual knowledge of a related technology, framework, or tool. Ask about tradeoffs, comparisons, or underlying mechanisms. Go beyond surface-level definitions.',
    questionType: 'technical'
  },
  {
    category: 'Conceptual 3 of 3',
    instruction: 'Test conceptual understanding of design patterns, architecture decisions, or principles relevant to the role. Ask about why certain approaches are chosen over others — focus on reasoning, not memorization.',
    questionType: 'technical'
  },
  {
    category: 'Applied 1 of 2',
    instruction: 'Pose a real-world practical problem or scenario tied to the role. Ask how the candidate would implement, design, or build something. Focus on their hands-on problem-solving process — steps, tools, considerations.',
    questionType: 'technical'
  },
  {
    category: 'Applied 2 of 2',
    instruction: 'Ask a debugging, optimization, or troubleshooting question based on a realistic situation. Test their ability to diagnose issues, weigh tradeoffs, and apply best practices under constraints.',
    questionType: 'situational'
  },
  {
    category: 'Role fit / gaps 1 of 3',
    instruction: 'Compare the resume with the JD. Point to a specific resume project, role, or experience and ask how it maps to a JD requirement. Assess what the candidate personally contributed and how that experience transfers.',
    questionType: 'technical'
  },
  {
    category: 'Role fit / gaps 2 of 3',
    instruction: 'Identify a gap, missing skill, or lighter experience area between the resume and JD. Ask how the candidate would compensate, learn, or bridge that gap. Gauge self-awareness and growth mindset.',
    questionType: 'situational'
  },
  {
    category: 'Role fit / gaps 3 of 3',
    instruction: 'Deep dive into a resume project or past experience that relates to the role. Validate whether the candidate\'s claimed work genuinely transfers to this position\'s requirements. Probe for specifics — their role, decisions, outcomes.',
    questionType: 'technical'
  },
  {
    category: 'Cultural fit 1 of 2',
    instruction: 'Ask about teamwork, communication style, or collaboration. Understand how they work with others, handle feedback, and contribute to team dynamics.',
    questionType: 'cultural'
  },
  {
    category: 'Cultural fit 2 of 2',
    instruction: 'Ask about values, work style, ownership, or professional growth. Gauge alignment with the company\'s culture and what environment helps them do their best work.',
    questionType: 'cultural'
  }
]

function normalizeQuestion(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
}

export function isSimilarQuestion(a: string, b: string): boolean {
  const normalizedA = normalizeQuestion(a)
  const normalizedB = normalizeQuestion(b)
  if (!normalizedA || !normalizedB) return false
  if (normalizedA === normalizedB) return true
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return true

  const importantWordsA = normalizedA.split(' ').filter(word => word.length > 3)
  const importantWordsB = new Set(normalizedB.split(' ').filter(word => word.length > 3))
  if (importantWordsA.length === 0 || importantWordsB.size === 0) return false

  const overlap = importantWordsA.filter(word => importantWordsB.has(word)).length
  return overlap / Math.min(importantWordsA.length, importantWordsB.size) >= 0.7
}

export function hasSimilarQuestionBeenAsked(question: string, existingQuestions: string[]): boolean {
  return existingQuestions.some(item => isSimilarQuestion(item, question))
}

export function getFallbackQuestion(totalQuestions: number, existingQuestions: string[], reason: string): QuestionResponse {
  const preferredIndex = Math.max(0, Math.min(totalQuestions, FALLBACK_QUESTIONS.length - 1))
  const orderedFallbacks = [
    ...FALLBACK_QUESTIONS.slice(preferredIndex),
    ...FALLBACK_QUESTIONS.slice(0, preferredIndex)
  ]
  const fallback = orderedFallbacks.find(q => !hasSimilarQuestionBeenAsked(q.question_text, existingQuestions)) || FALLBACK_QUESTIONS[preferredIndex]

  return {
    ...fallback,
    follow_up_reason: reason
  }
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const model = import.meta.env.VITE_GEMINI_MODEL || 'gemini-1.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 1.0,
        topP: 0.95
      }
    })
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`)
  }
  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Invalid response format from Gemini')
  return text
}

async function callGroq(prompt: string, apiKey: string): Promise<string> {
  const model = import.meta.env.VITE_GROQ_MODEL || 'llama-3.3-70b-versatile'
  const url = 'https://api.groq.com/openai/v1/chat/completions'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 1.0,
      top_p: 0.95
    })
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Groq API error: ${response.status} - ${errorText}`)
  }
  const data = await response.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('Invalid response from Groq')
  return text
}

async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const model = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini'
  const url = 'https://api.openai.com/v1/chat/completions'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 1.0,
      top_p: 0.95
    })
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
  }
  const data = await response.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('Invalid response from OpenAI')
  return text
}

export async function generateCompletion(prompt: string): Promise<string> {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  const groqKey = import.meta.env.VITE_GROQ_API_KEY
  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY

  if (geminiKey) {
    return callGemini(prompt, geminiKey)
  } else if (groqKey) {
    return callGroq(prompt, groqKey)
  } else if (openaiKey && openaiKey !== 'sk-your-key-here') {
    return callOpenAI(prompt, openaiKey)
  } else {
    throw new Error('No LLM API key configured')
  }
}

// -------------------------------------------------------------------
// Real-time answer analysis — called after every candidate answer.
// Determines if the answer is genuine/deep or vague/suspicious and
// optionally returns a follow-up probe question.
// -------------------------------------------------------------------
export async function analyzeAnswerInRealtime(
  question: string,
  answer: string,
  resumeText: string,
  jdText: string,
  history: HistoryItem[],
  questionId: string,
  blueprint?: InterviewBlueprint | null,
  competencyIds: string[] = [],
  questionType: string = 'technical'
): Promise<LiveAssessmentNote> {
  const fallback: LiveAssessmentNote = {
    question_id: questionId,
    authenticity_signal: 'genuine',
    depth_signal: 'surface',
    red_flags: [],
    note: 'Analysis unavailable.',
    follow_up_prompted: false,
    insufficiency_reason: null
  }

  if (!answer || answer.trim().length < 10) {
    return {
      ...fallback,
      authenticity_signal: 'vague',
      depth_signal: 'empty',
      note: 'Candidate gave a very short or empty answer.',
      red_flags: ['Answer too short to evaluate']
    }
  }

  // Hard gate: follow-up is never allowed for non-technical questions.
  // Return immediately without an LLM call so we don't waste tokens and
  // so the analysis can still run for scoring (depth/authenticity signals).
  const isTechnical = questionType === 'technical'

  const historyText = history.slice(-4).map((h, i) =>
    `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer || '(no answer)'}`
  ).join('\n\n')

  const targetedCompetencies = blueprint?.competencies.filter(competency => competencyIds.includes(competency.id)) || []

  // Failure-mode definitions used in the prompt and in the priority resolution below.
  // Priority (most severe → least): irrelevant > lacks_evidence > lacks_depth > vague
  const failureModeInstructions = isTechnical ? `
FOLLOW-UP FAILURE-MODE EVALUATION (technical questions only):
Evaluate whether the candidate's answer has one of these failure modes, in priority order (stop at the first one that applies):
1. irrelevant   — the answer doesn't actually address what was asked; candidate talked around the question
2. lacks_evidence — candidate makes a claim but provides zero concrete proof: no number, no project name, no specific example
3. lacks_depth  — candidate describes WHAT they did but not HOW or WHY; no mechanism, reasoning, or trade-off explained
4. vague        — hedgy, buzzword-heavy, or non-committal; could apply to any candidate

If a failure mode applies, set:
  "recommended_action": "follow_up"
  "follow_up_prompted": true
  "insufficiency_reason": <the most severe applicable failure mode from the list above>
  "follow_up_direction": a single focused sentence describing exactly what evidence is missing (NOT the question itself — just the gap)

If NO failure mode applies (answer is specific, evidenced, and on-topic):
  "recommended_action": "advance"
  "follow_up_prompted": false
  "insufficiency_reason": null
  "follow_up_direction": null
` : `
FOLLOW-UP RULES (non-technical questions):
You MUST set "recommended_action" to "advance", "follow_up_prompted" to false, "insufficiency_reason" to null, and "follow_up_direction" to null.
No follow-up is ever allowed for non-technical questions regardless of answer quality.
`

  const prompt = `You are a skeptical senior technical recruiter conducting a live interview. Your job is to catch candidates who sound competent but are actually vague or exaggerating.

Resume:
"""
${resumeText || 'Not provided'}
"""

Job Description:
"""
${jdText || 'Not provided'}
"""

Recent Interview History:
${historyText || 'No prior history.'}

Current Question (type: ${questionType}):
${question}

Target competencies and expected evidence:
${JSON.stringify(targetedCompetencies)}

Candidate's Answer:
${answer}

${failureModeInstructions}

ADDITIONAL EVALUATION RULES:
- DEFAULT to "vague" authenticity signal if the answer lacks specific details (tools, versions, commands, API names, project names, team sizes, numbers, or concrete decisions with reasoning). "I have experience with X" is NOT enough.
- A LONG answer that stays at a high level with buzzwords and no specifics is still "vague". Length ≠ depth.
- Mark "suspicious" if the resume claims concrete experience but the answer has NO specifics to back it up.
- Mark "inconsistent" if the answer contradicts what the resume says.
- The note should be a blunt, useful 2-3 sentence assessment for HR, calling out exactly what was missing.

Return ONLY this JSON:
{
  "authenticity_signal": "genuine" | "vague" | "suspicious" | "inconsistent",
  "depth_signal": "deep" | "surface" | "empty",
  "red_flags": ["specific red flag"],
  "note": "blunt 2-3 sentence recruiter note",
  "follow_up_prompted": true | false,
  "insufficiency_reason": "lacks_depth" | "lacks_evidence" | "vague" | "irrelevant" | null,
  "follow_up_direction": "one sentence describing the specific gap to probe, or null",
  "recommended_action": "advance" | "follow_up" | "revisit_later",
  "confidence": 0-100,
  "competency_evidence": [{"competency_id":"string", "rating":"insufficient" | "developing" | "adequate" | "strong", "evidence":"string", "missing_evidence":"string"}]
}`

  try {
    const raw = await generateCompletion(prompt)
    const cleaned = extractJSON(raw)
    const parsed = JSON.parse(cleaned)

    // Resolve insufficiency_reason — enforce priority order and type gate in code.
    // The LLM output is the starting point; we sanitize it here.
    const PRIORITY: AnswerInsufficiencyReason[] = ['irrelevant', 'lacks_evidence', 'lacks_depth', 'vague']
    const rawReason = parsed.insufficiency_reason as string | null | undefined
    const insufficiencyReason: AnswerInsufficiencyReason | null =
      isTechnical && PRIORITY.includes(rawReason as AnswerInsufficiencyReason)
        ? (rawReason as AnswerInsufficiencyReason)
        : null

    // If analysis says follow_up but question is non-technical, hard-override to advance.
    const rawAction = parsed.recommended_action
    const followUpIntended = rawAction === 'follow_up' && isTechnical && insufficiencyReason !== null
    const recommendedAction = followUpIntended ? 'follow_up' : (
      ['advance', 'revisit_later'].includes(rawAction) ? rawAction : 'advance'
    ) as LiveAssessmentNote['recommended_action']

    return {
      question_id: questionId,
      authenticity_signal: parsed.authenticity_signal || 'genuine',
      depth_signal: parsed.depth_signal || 'surface',
      red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags : [],
      note: parsed.note || '',
      follow_up_prompted: followUpIntended,
      // follow_up_question will be populated by generateTargetedFollowUp in InterviewContext
      // after this function returns — we store the direction here as a bridge.
      follow_up_question: followUpIntended ? (parsed.follow_up_direction || undefined) : undefined,
      insufficiency_reason: followUpIntended ? insufficiencyReason : null,
      recommended_action: recommendedAction,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      competency_evidence: Array.isArray(parsed.competency_evidence) ? parsed.competency_evidence : []
    }
  } catch (err) {
    console.warn('[analyzeAnswerInRealtime] Failed, returning fallback:', err)
    return fallback
  }
}

// -------------------------------------------------------------------
// Targeted follow-up question generator — called AFTER analyzeAnswerInRealtime
// confirms a follow-up is warranted (follow_up_prompted === true, technical question).
// Generates the actual follow-up question text based on the specific failure mode,
// so the question targets the exact gap rather than being a generic "tell me more".
// -------------------------------------------------------------------
export async function generateTargetedFollowUp(
  originalQuestion: string,
  candidateAnswer: string,
  insufficiencyReason: AnswerInsufficiencyReason,
  gapDirection: string,  // the follow_up_direction from analyzeAnswerInRealtime
  resumeText: string,
  jdText: string
): Promise<string> {
  const gapStrategy: Record<AnswerInsufficiencyReason, string> = {
    lacks_depth:
      'The candidate described WHAT happened but not HOW or WHY. Ask for the underlying mechanism, reasoning, or trade-off — e.g. "Why did you choose that approach over alternatives?" or "What specifically made X the right decision here?"',
    lacks_evidence:
      'The candidate made a claim with no concrete proof. Ask for a specific metric, number, project name, or verifiable example — e.g. "What was the before/after measurement?" or "Can you give me a specific project where you applied that?"',
    vague:
      'The candidate was hedgy, generic, or buzzword-heavy. Ask for a single, specific named instance — a tool name, a command, a team size, a decision, a number — something only someone who actually did it could provide.',
    irrelevant:
      'The candidate\'s answer did not address the question. Gently redirect by rephrasing the original question more concretely, zeroing in on the specific capability you were testing.'
  }

  const prompt = `You are Alex, a warm but sharp senior technical recruiter. The candidate just gave a technically insufficient answer that requires a targeted follow-up probe.

Original question you asked:
"${originalQuestion}"

Candidate's answer:
"${candidateAnswer}"

Failure mode detected: ${insufficiencyReason}
Gap to probe: ${gapDirection}
Strategy for this failure mode: ${gapStrategy[insufficiencyReason]}

Resume excerpt (for context):
${resumeText?.slice(0, 400) || 'Not available'}

Generate a single follow-up question that:
1. References a specific detail from their answer (not generic — something they actually said)
2. Directly targets the gap described above using the strategy for this failure mode
3. Sounds natural and conversational — curious, not accusatory
4. Is concise: one clear question, no sub-questions

Return ONLY this JSON:
{
  "question_text": "The follow-up question (just the question, no preamble)"
}`

  try {
    const raw = await generateCompletion(prompt)
    const cleaned = extractJSON(raw)
    const parsed = JSON.parse(cleaned)
    return parsed.question_text || gapDirection || 'Could you share a specific example that illustrates that?'
  } catch {
    // Fallback: use the gap direction from the analysis as a plain question
    return gapDirection || 'Could you walk me through a specific example of that?'
  }
}

// -------------------------------------------------------------------
// Resume truthfulness audit — runs once alongside analyzeCandidateFit.
// Returns a list of specific resume claims to probe for authenticity.
// -------------------------------------------------------------------
export interface ResumeClaim {
  claim: string
  source: string // where in the resume (e.g. "ScalePods project" or "Skills section")
  suspicion_level: 'low' | 'medium' | 'high'
  probe_question: string // a verification question specifically for this claim
  rationale: string
}

export interface ResumeTruthAudit {
  claims: ResumeClaim[]
  summary: string
}

export async function auditResumeTruthfulness(
  resumeText: string,
  jdText: string
): Promise<ResumeTruthAudit> {
  if (!resumeText) return { claims: [], summary: '' }

  const truncate = (text: string, max: number) => text.length > max ? text.slice(0, max) + '...[truncated]' : text

  const buildPrompt = (r: string, j: string) => `
You are a senior technical recruiter with years of experience spotting resume exaggerations. Analyze this resume and identify claims that are common targets for exaggeration or embellishment in technical hiring.

Job Description:
"""
${j || 'Not provided'}
"""

Resume:
"""
${r}
"""

Identify 4-6 specific, concrete resume claims that:
1. Could easily be exaggerated (e.g. "Led a team" with no team size, "Built X" without specifying their exact contribution, vague year ranges, generic skill list items)
2. Are particularly important to verify given the JD requirements
3. Are commonly inflated in the industry

For each claim, provide a targeted probe question that would immediately reveal if the candidate actually has that experience — a question where someone who truly did it would answer easily with specifics, but someone who didn't would struggle.

Return ONLY this JSON:
{
  "claims": [
    {
      "claim": "Exact text or paraphrase of the resume claim",
      "source": "Where in the resume (e.g. 'ScalePods project bullet point' or 'Skills section')",
      "suspicion_level": "low" | "medium" | "high",
      "probe_question": "A specific, targeted verification question",
      "rationale": "Why this claim warrants scrutiny"
    }
  ],
  "summary": "1-2 sentence overview of overall resume credibility"
}
`

  const parseResult = (raw: string): ResumeTruthAudit => {
    const cleaned = extractJSON(raw)
    const parsed = JSON.parse(cleaned)
    const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : []
    const claims = rawClaims.map((c: Record<string, unknown>) => ({
      claim: String(c.claim || ''),
      source: String(c.source || ''),
      suspicion_level: (String(c.suspicion_level || 'medium').toLowerCase() as 'low' | 'medium' | 'high'),
      probe_question: String(c.probe_question || c.probeQuestion || c.probe || ''),
      rationale: String(c.rationale || '')
    }))
    return { claims, summary: parsed.summary || '' }
  }

  try {
    const raw = await generateCompletion(buildPrompt(truncate(resumeText, 3000), truncate(jdText || 'Not provided', 3000)))
    return parseResult(raw)
  } catch {
    console.warn('[auditResumeTruthfulness] First attempt failed, retrying with shorter text')
    try {
      const raw = await generateCompletion(buildPrompt(truncate(resumeText, 3000), truncate(jdText || 'Not provided', 3000)))
      return parseResult(raw)
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2)
      console.warn('[auditResumeTruthfulness] Both attempts failed, returning empty audit:', msg)
      return { claims: [], summary: `Resume truth audit unavailable${msg ? ` (${msg})` : ''}.` }
    }
  }
}

// Runs once at the start of an interview. Extracts the actual skills, tools, and
// languages named or implied by the JD and the resume, decides which are matches,
// which are gaps (JD wants it, resume shows no evidence), and which are bonus
// strengths, and maps specific resume projects to specific JD requirements.
// Cache/store the result on the caller's side (e.g. in the interview session record)
// and pass it into generateNextInterviewQuestion for every question in that interview
// — don't call this more than once per interview.
export async function analyzeCandidateFit(resumeText: string, jdText: string): Promise<CandidateAnalysis> {
  const truncate = (text: string, max: number) => text.length > max ? text.slice(0, max) + '...[truncated]' : text
  const jdTrimmed = truncate(jdText || 'No job description provided.', 2000)
  const resumeTrimmed = truncate(resumeText || 'No resume provided.', 2000)

  const prompt = `
You are a technical recruiter analyzing a candidate before an interview. Read the job description and resume closely and extract concrete, specific skills, tools, languages, frameworks, and methodologies — not vague categories.

Job Description:
"""
${jdTrimmed}
"""

Candidate Resume:
"""
${resumeTrimmed}
"""

Do the following:
1. List every specific skill, tool, language, framework, or technique that the JD requires or strongly implies (e.g. "Python", "REST APIs", "n8n", "Meta Graph API", "SQL", not vague things like "technical skills").
2. For each one, check whether the resume gives real evidence the candidate has used it (a named project, a role, a specific claim) — not just a keyword dropped in a skills list.
3. Classify each skill as:
   - "match": JD needs it AND resume shows real evidence of it.
   - "gap": JD needs it AND resume shows no real evidence of it (or only a bare keyword mention with no substance).
   - "strength": resume shows strong evidence of it but the JD doesn't ask for it — a bonus.
4. Assign a priority from 1 (most important to verify in the interview) to 5 (least important), based on how central the skill is to the JD.
5. Separately, find 3-4 specific resume projects, roles, or experiences that most plausibly relate to specific JD requirements, and map each one to the JD requirement it relates to, with a short note on why.
6. Write a 2-3 sentence overall summary of the candidate's fit: their strongest overlaps and their biggest gaps.

Return ONLY JSON matching this schema, nothing else:
{
  "skills": [
    { "skill": "string", "source": "jd_required" | "resume_claimed" | "both", "status": "match" | "gap" | "strength", "evidence": "short paraphrase, or empty string if none", "priority": 1 }
  ],
  "projectMappings": [
    { "resumeProject": "string", "relatedJdRequirement": "string", "notes": "string" }
  ],
  "summary": "string"
}
`

  try {
    const raw = await generateCompletion(prompt)
    const cleaned = extractJSON(raw)
    const parsed = JSON.parse(cleaned) as CandidateAnalysis
    const rawSkills = Array.isArray(parsed.skills) ? parsed.skills : []
    const skills = rawSkills.map(s => ({
      skill: String(s.skill || ''),
      source: (String(s.source || 'jd_required') as SkillAssessment['source']),
      status: (String(s.status || 'match').toLowerCase() as SkillAssessment['status']),
      evidence: String(s.evidence || ''),
      priority: Number(s.priority) || 5
    }))
    return {
      skills,
      projectMappings: Array.isArray(parsed.projectMappings) ? parsed.projectMappings : [],
      summary: parsed.summary || ''
    }
  } catch (err) {
    console.warn('[analyzeCandidateFit] Failed, retrying with shorter text:', err)
    try {
      const shorter = `
You are a technical recruiter. From the job description and resume below, extract skills and classify each as "match" (resume shows evidence), "gap" (JD requires, resume lacks evidence), or "strength" (resume shows it, JD doesn't require).

JD:
${truncate(jdText || 'N/A', 1500)}

Resume:
${truncate(resumeText || 'N/A', 1500)}

Return ONLY JSON: { "skills": [{ "skill": "...", "source": "jd_required"|"resume_claimed"|"both", "status": "match"|"gap"|"strength", "evidence": "...", "priority": 1 }], "projectMappings": [{ "resumeProject": "...", "relatedJdRequirement": "...", "notes": "..." }], "summary": "..." }`
      const raw2 = await generateCompletion(shorter)
      const cleaned2 = extractJSON(raw2)
      const parsed2 = JSON.parse(cleaned2) as CandidateAnalysis
      const rawSkills2 = Array.isArray(parsed2.skills) ? parsed2.skills : []
      const skills2 = rawSkills2.map(s => ({
        skill: String(s.skill || ''),
        source: (String(s.source || 'jd_required') as SkillAssessment['source']),
        status: (String(s.status || 'match').toLowerCase() as SkillAssessment['status']),
        evidence: String(s.evidence || ''),
        priority: Number(s.priority) || 5
      }))
      return {
        skills: skills2,
        projectMappings: Array.isArray(parsed2.projectMappings) ? parsed2.projectMappings : [],
        summary: parsed2.summary || ''
      }
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2)
      console.warn('[analyzeCandidateFit] Both attempts failed, returning minimal fallback:', msg)
      return {
        skills: [],
        projectMappings: [],
        summary: `Skill analysis unavailable${msg ? ` (${msg})` : ''}.`
      }
    }
  }
}

// Runs alongside analyzeCandidateFit. Extracts a hard list of 6-10 specific named
// tools/technologies from the JD (not abstract categories) and checks whether each
// appears in the candidate's resume with its exact usage context.
// Result is merged into CandidateAnalysis.extractedTools by the caller.
export async function extractJdToolsAndTech(resumeText: string, jdText: string): Promise<JdTool[]> {
  const prompt = `You are a technical recruiting assistant. Analyze the Job Description (JD) and Candidate Resume to extract 6-10 specific, named tools, technologies, languages, frameworks, or protocols that the JD requires.

IMPORTANT — extract CONCRETE tools only. Do NOT extract abstract categories:
✅ GOOD: "React", "PostgreSQL", "Docker", "REST APIs", "TypeScript", "Python", "Redis", "Kubernetes"
❌ BAD: "frontend development", "agile", "communication", "databases", "cloud", "APIs" (too vague)

For each extracted tool, provide:
1. name: The exact tool/technology name (e.g. "React", "PostgreSQL")
2. category: Tech category (e.g. "Frontend", "Backend", "Database", "DevOps", "API", "Language")
3. importance: "must_have" if the JD marks it as required/essential, or "nice_to_have" if preferred/plus
4. mentioned_in_resume: true if the tool appears anywhere in the candidate's resume, false otherwise
5. resume_context: If mentioned_in_resume is true, the exact sentence or phrase from the resume where it appears. If false, set to null.

Job Description:
"""
${truncate(jdText || 'Not provided', 3000)}
"""

Candidate Resume:
"""
${truncate(resumeText || 'Not provided', 3000)}
"""

Return ONLY valid JSON in this exact format:
{
  "tools": [
    {
      "name": "React",
      "category": "Frontend",
      "importance": "must_have",
      "mentioned_in_resume": true,
      "resume_context": "Built reusable UI components using React and TypeScript at Acme Corp"
    }
  ]
}`

  try {
    const raw = await generateCompletion(prompt)
    const cleaned = extractJSON(raw)
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed.tools)) return []
    return parsed.tools.map((t: Record<string, unknown>) => ({
      name: String(t.name || ''),
      category: String(t.category || 'General'),
      importance: (String(t.importance || 'nice_to_have') as JdTool['importance']),
      mentioned_in_resume: Boolean(t.mentioned_in_resume),
      resume_context: t.resume_context ? String(t.resume_context) : null
    }))
  } catch (err) {
    console.warn('[extractJdToolsAndTech] Failed to extract JD tools, returning empty list:', err)
    return []
  }
}

// Maximum depth of answer history to include in the prompt to stay within token limits
const MAX_HISTORY_TURNS = 6

// -------------------------------------------------------------------
// Unified conversational interviewer-turn generator.
// Called after each candidate answer. The LLM acts as "Alex", a warm
// but sharp senior technical recruiter who acknowledges the
// candidate's last answer naturally and then either asks the next
// question, probes deeper, transitions, or closes the interview.
// -------------------------------------------------------------------
export async function generateInterviewerTurn(
  resumeText: string,
  jdText: string,
  history: HistoryItem[],
  totalQuestions: number,
  analysis: CandidateAnalysis | null,
  authenticitySignals: AuthenticitySignal[],
  lastAssessmentNote: LiveAssessmentNote | null,
  followUpCount: number,
  pendingQuestions: string[],
  allowFollowUp: boolean,
  planItem?: InterviewPlanItem | null,
  maxPrimaryQuestions = TOTAL_WANTED_JOB_QUESTIONS,
  maxFollowUps = 1,
  targetQuestion?: string
): Promise<InterviewerTurn> {
  if (totalQuestions >= maxPrimaryQuestions && pendingQuestions.length === 0 && !targetQuestion) {
    return {
      interviewer_text: "That brings us to the end of the interview. Thank you so much for your time and for sharing your experience. Your responses have been successfully recorded. It is now safe to exit the interview and close this tab.",
      turn_type: 'closing' as InterviewerTurnType,
      should_continue: false
    }
  }

  // Follow-up path: note.follow_up_question was already computed by generateTargetedFollowUp
  // in InterviewContext (called after analyzeAnswerInRealtime resolved). We only need to wrap
  // the pre-computed question with Alex's natural acknowledgment via the main prompt below.
  // The allowFollowUp check and count enforcement happen in InterviewContext before we arrive here.
  const shouldFollowUp =
    allowFollowUp &&
    lastAssessmentNote?.follow_up_prompted &&
    lastAssessmentNote?.follow_up_question &&
    followUpCount < maxFollowUps

  if (shouldFollowUp && lastAssessmentNote) {
    // Re-use the main generateInterviewerTurn prompt path with the follow-up as targetQuestion.
    // This gives us Alex's warm acknowledgment for free, without a separate LLM call.
    // We fall through to the main prompt below with targetQuestion set.
    const followUpTurn = await generateInterviewerTurn(
      resumeText, jdText, history, totalQuestions, analysis, authenticitySignals,
      null,          // clear lastAssessmentNote so the main path doesn't re-enter this branch
      followUpCount, // keep count for context
      pendingQuestions,
      false,         // allowFollowUp = false so recursive call goes to main path
      planItem, maxPrimaryQuestions, maxFollowUps,
      lastAssessmentNote.follow_up_question  // wrap the pre-computed question with acknowledgment
    )
    return {
      ...followUpTurn,
      turn_type: 'follow_up',
      question_type: 'technical'
    }
  }


  // Build interview stage context
  const stageIndex = Math.max(0, Math.min(totalQuestions, TOTAL_WANTED_JOB_QUESTIONS - 1))
  const interviewStage = INTERVIEW_PLAN[stageIndex]
  const stageFocus = pickStageFocus(stageIndex, analysis)
  const extractedTools = analysis?.extractedTools || []

  let focusInstruction: string
  if (planItem) {
    // Build a rich, tool-grounded focus instruction from the plan item's target_tool and verification_mode
    const tool = planItem.target_tool || 'the required skill'
    const mode = planItem.verification_mode || 'baseline_check'
    const matchingToolObj = extractedTools.find(t => t.name.toLowerCase() === tool.toLowerCase())
    const resumeContext = matchingToolObj?.resume_context || ''

    if (mode === 'verify_claim') {
      focusInstruction = `VERIFICATION MODE: verify_claim — the candidate claims experience with "${tool}"${resumeContext ? ` (from their resume: "${resumeContext}")` : ' (mentioned in resume)'}. Ask them to explain THEIR OWN specific, practical usage of "${tool}" — actual decisions made, projects it was used in, how they configured or applied it. Do NOT ask for textbook definitions or generic descriptions. The question MUST explicitly name "${tool}".\nObjective: ${planItem.objective}\nDifficulty limit: ${planItem.difficulty}`
    } else {
      focusInstruction = `VERIFICATION MODE: baseline_check — "${tool}" is required by the JD but is not clearly shown on the candidate's resume. Ask a simple, baseline awareness question about "${tool}" (e.g. what it's used for, what problem it solves, when a developer would reach for it). Keep it strictly foundational — no advanced internals, no performance-at-scale, no edge cases. The question MUST explicitly name "${tool}".\nObjective: ${planItem.objective}\nDifficulty limit: ${planItem.difficulty}`
    }
  } else {
    focusInstruction = buildFocusInstruction(stageFocus, interviewStage.instruction, extractedTools)
  }

  // Build authenticity context
  const recentAuthSignals = authenticitySignals.slice(-3)
  const hasRecentRedFlags = recentAuthSignals.some(s => s.signal === 'suspicious' || s.signal === 'inconsistent')
  const hasRecentVague = recentAuthSignals.some(s => s.signal === 'vague')
  const authenticityContext = recentAuthSignals.length > 0
    ? `\nRecent answer quality signals from live analysis:\n${recentAuthSignals.map(s =>
        `- Signal: ${s.signal} / Depth: ${s.depth}`
      ).join('\n')}\n${hasRecentRedFlags ? '⚠️ IMPORTANT: Recent answers showed suspicious or inconsistent signals. Probe for SPECIFIC details.' : ''}${hasRecentVague ? '\nℹ️ Recent answers were vague. Aim for more targeted questions.' : ''}`
    : ''

  const alreadyAskedQText = history
    .map((h, i) => `${i + 1}. ${h.question}`)
    .join('\n') || 'None yet.'

  const lastAnswer = history[history.length - 1]?.answer || ''

  const lastAnswerContext = history.length > 0
    ? `\nThe candidate's most recent answer:\n"${lastAnswer}"`
    : ''

  const pendingContext = pendingQuestions.length > 0
    ? `\nPending pre-generated questions in the session:\n${pendingQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`
    : ''

  const targetQuestionContext = targetQuestion
    ? `\nREQUIRED NEXT QUESTION: "${targetQuestion}"\nYou MUST ask this specific question next. Do not change its core meaning, but prefix it with a warm, natural acknowledgment of the candidate's last answer, making the transition smooth and seamless.`
    : ''

  const prompt = `
You are Alex, a warm but sharp senior technical recruiter conducting a live interview. You have read the candidate's resume and the job description closely. Your goal is to have a natural, engaging conversation that assesses the candidate's fit — not to read from a script.

PERSONALITY:
- Warm, curious, and genuinely interested in the candidate
- Sharp — you notice vague answers and probe for specifics
- Conversational — you reference details from the candidate's last answer, resume, or the JD
- Not a robot — vary your sentence structure, acknowledge their answers naturally, sound human

⚡ SCREENING DIFFICULTY CEILING (MANDATORY — DO NOT VIOLATE):
- This is an EASY-TO-MEDIUM practical screening round. Its sole purpose is to confirm genuine, day-to-day familiarity — not deep expertise.
- A candidate with real hands-on experience should be able to answer comfortably in 30-60 seconds.
- NEVER ask about performance-at-scale, obscure framework internals, low-level implementation details, memory management, distributed systems edge cases, or algorithmic gotchas.
- ALWAYS explicitly name the specific tool or technology (e.g. say "React", "Docker", "PostgreSQL") in the question itself — never ask about "your frontend framework" or "your database" in the abstract.
- STRICTLY follow the VERIFICATION MODE in the "Specific focus for this question" field:
  • verify_claim → ask the candidate to explain their OWN specific usage of that named tool (their project, decisions, context)
  • baseline_check → ask a simple "what is it / what is it used for / when would you use it" awareness question only

Job Description:
"""
${truncate(jdText || 'Not provided', 3000)}
"""

Candidate Resume:
"""
${truncate(resumeText || 'Not provided', 3000)}
"""

Interview History (most recent first):
${history.slice(-MAX_HISTORY_TURNS).map((h, i) => `
Step ${i + 1} (Type: ${h.type}):
AI: ${h.question}
Candidate: ${h.answer || '(no response)'}
`).join('\n')}
${lastAnswerContext}

Already asked questions — do NOT repeat or rephrase these:
${alreadyAskedQText}

${pendingContext}
${targetQuestionContext}

We have asked ${totalQuestions} job-related questions so far (target is ${TOTAL_WANTED_JOB_QUESTIONS} questions).
This is question number ${Math.min(totalQuestions + 1, TOTAL_WANTED_JOB_QUESTIONS)} of ${TOTAL_WANTED_JOB_QUESTIONS}.

Interview structure:
- Questions 1-3 (Conceptual): Test core understanding — foundational concepts, theory, and principles.
- Questions 4-5 (Applied): Test practical problem-solving — real-world scenarios, debugging, implementation.
- Questions 6-8 (Gaps): Assess how fit the candidate is for the role — match against JD requirements, probe gaps.
- Questions 9-10 (Cultural fit): Evaluate teamwork, communication, values, work style.

${analysis && (analysis.skills.length > 0 || analysis.projectMappings.length > 0) ? `Candidate fit analysis:
- Summary: ${analysis.summary || 'n/a'}
- Skills: ${analysis.skills.map(s => `${s.skill} [${s.status}]`).join('; ') || 'none'}
` : ''}${authenticityContext}

Current stage:
- Category: ${interviewStage.category}
- Specific focus for this question: ${focusInstruction}
- Required type: ${interviewStage.questionType}

INSTRUCTIONS:
1. ACKNOWLEDGE the candidate's last answer naturally — reference a specific detail they shared. Do NOT use generic acknowledgments like "Great answer" or "Thanks".
2. Ask the REQUIRED NEXT QUESTION if one is provided in the context above. If it is not provided, use one of the pre-generated questions or ask a new one based on the stage focus.
3. Make sure the transition is warm and smooth. Sound like a human recruiter, Alex, conducting a natural live conversation.
4. Keep it tight — one clear question per turn, no stacked sub-questions.
5. If a follow-up is needed, address the specific missing detail.
6. For closing questions (cultural fit, last in stage), you may briefly transition: "We've covered the technical side well. Let me ask about your work style..."

Return ONLY this JSON:
{
  "interviewer_text": "Your full conversational utterance — acknowledgment followed by the question or transition",
  "question_text": "Just the question part (without the acknowledgment) — used for display and storage",
  "turn_type": "question" | "follow_up" | "transition" | "closing",
  "question_type": "technical" | "behavioral" | "situational" | "cultural",
  "should_continue": true
}`

  try {
    const raw = await generateCompletion(prompt)
    const cleaned = extractJSON(raw)
    const parsed = JSON.parse(cleaned) as import('@/types').InterviewerTurn
    const questionText = parsed.question_text || parsed.interviewer_text

    // When wrapping a targetQuestion, skip deduplication — we MUST ask this specific
    // pre-generated question. Repetition check is irrelevant here.
    if (!targetQuestion) {
      const allSessionQuestions = [
        ...history.map(h => h.question),
        ...pendingQuestions
      ]

      if (hasSimilarQuestionBeenAsked(questionText, allSessionQuestions)) {
        const fallback = getFallbackQuestion(totalQuestions, allSessionQuestions, "LLM returned a repeated question")
        return {
          interviewer_text: fallback.question_text,
          question_text: fallback.question_text,
          turn_type: 'question' as InterviewerTurnType,
          question_type: fallback.question_type,
          should_continue: true
        }
      }
    }

    return {
      interviewer_text: parsed.interviewer_text || questionText,
      question_text: targetQuestion || questionText,
      turn_type: parsed.turn_type || 'question',
      question_type: parsed.question_type || interviewStage.questionType,
      should_continue: parsed.should_continue !== false
    }
  } catch (err) {
    console.error('[generateInterviewerTurn] Failed, using fallback:', err)
    // When wrapping a targetQuestion, use it directly so TTS speaks the correct question
    if (targetQuestion) {
      return {
        interviewer_text: targetQuestion,
        question_text: targetQuestion,
        turn_type: 'question' as InterviewerTurnType,
        question_type: interviewStage.questionType,
        should_continue: true
      }
    }
    const allSessionQuestions = [
      ...history.map(h => h.question),
      ...pendingQuestions
    ]
    const fallback = getFallbackQuestion(totalQuestions, allSessionQuestions, "LLM unavailable or returned invalid JSON")
    return {
      interviewer_text: fallback.question_text,
      question_text: fallback.question_text,
      turn_type: 'question' as InterviewerTurnType,
      question_type: fallback.question_type,
      should_continue: true
    }
  }
}

// Picks which skill or project mapping this stage index should probe, cycling
// through the analysis if there are fewer entries than question slots.
function pickStageFocus(
  index: number,
  analysis: CandidateAnalysis | null
): { kind: 'skill'; data: SkillAssessment } | { kind: 'project'; data: ProjectMapping } | null {
  if (!analysis) return null

  if (index < 5) {
    // Conceptual (index 0-2) and Applied (index 3-4): prioritize gaps and
    // matches over strengths, lowest priority first.
    const candidates = [...analysis.skills].sort((a, b) => {
      const rank = (s: SkillAssessment) => (s.status === 'strength' ? 1 : 0)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      return (a.priority ?? 5) - (b.priority ?? 5)
    })
    if (candidates.length === 0) return null
    return { kind: 'skill', data: candidates[index % candidates.length] }
  }

  if (index < 8) {
    // Role fit / gaps (index 5-7): use project mappings
    const projectIndex = index - 5
    if (analysis.projectMappings.length === 0) return null
    return { kind: 'project', data: analysis.projectMappings[projectIndex % analysis.projectMappings.length] }
  }

  // Cultural fit (index 8-9): no analysis-driven focus
  return null
}

function buildFocusInstruction(
  focus: ReturnType<typeof pickStageFocus>,
  fallbackInstruction: string,
  extractedTools: JdTool[] = []
): string {
  if (!focus) return fallbackInstruction

  if (focus.kind === 'skill') {
    const s = focus.data
    // Look for a matching JdTool to get the verification mode and exact resume context
    const matchingTool = extractedTools.find(t => t.name.toLowerCase() === s.skill.toLowerCase())
    const toolName = matchingTool?.name || s.skill
    const resumeContext = matchingTool?.resume_context || s.evidence || ''
    const isClaimed = matchingTool ? matchingTool.mentioned_in_resume : (s.status === 'match' || s.status === 'strength')

    if (isClaimed) {
      // verify_claim: candidate listed this tool — confirm their stated hands-on experience is real
      return `VERIFICATION MODE: verify_claim — the candidate claims experience with "${toolName}"${resumeContext ? ` (from their resume: "${resumeContext}")` : ' (mentioned in resume)'}. You MUST ask them to explain their OWN specific, practical usage of "${toolName}" — actual decisions made, projects it was used in, how they configured or applied it. Do NOT ask for textbook definitions or generic descriptions. The question must explicitly name "${toolName}". This is a screening round, so keep it practical and answerable in 30-60 seconds.`
    } else {
      // baseline_check: JD requires it but resume doesn't show it — check basic awareness
      return `VERIFICATION MODE: baseline_check — "${toolName}" is required by the JD but is not clearly demonstrated in the candidate's resume. Ask a simple, baseline awareness question (e.g. what is "${toolName}" used for, what problem does it solve, or when would a developer reach for it). Keep it strictly foundational — do NOT ask about advanced internals, performance tuning, or edge cases. The question must explicitly name "${toolName}".`
    }
  }

  const p = focus.data
  return `The resume project/experience "${p.resumeProject}" relates to the JD requirement "${p.relatedJdRequirement}" (${p.notes || 'no additional notes'}). Ask a question that references this specific project and requirement, and tests what the candidate actually contributed and how it transfers to this role.`
}


export async function generateNextInterviewQuestion(
  resumeText: string,
  jdText: string,
  history: HistoryItem[],
  totalQuestions: number,
  analysis: CandidateAnalysis | null = null,
  skill: string = '',
  candidateLevel: string = '',
  roleTitle: string = '',
  authenticitySignals: AuthenticitySignal[] = [],
  forceFollowUp?: { question: string; reason: string }
): Promise<QuestionResponse> {
  if (totalQuestions >= TOTAL_WANTED_JOB_QUESTIONS) {
    return {
      question_text: "Thank you so much for sharing that. This brings us to the end of our interview today. I really appreciate your time and detailed answers. The HR team will review your application and get back to you soon. Have a wonderful day!",
      question_type: "cultural",
      follow_up_reason: "Interview limit reached. Closing statement."
    }
  }

  // If a forced follow-up is requested (triggered by vague/suspicious answer detection)
  if (forceFollowUp) {
    const followUpPrompt = `
You are a senior technical recruiter conducting a live interview. The candidate just gave a vague or suspicious answer and you need to ask a targeted follow-up to get specifics.

Context:
- Reason for follow-up: ${forceFollowUp.reason}
- Suggested follow-up direction: ${forceFollowUp.question}

Resume excerpt: ${resumeText?.slice(0, 800) || 'Not available'}

Interview history so far:
${history.slice(-3).map(h => `Q: ${h.question}\nA: ${h.answer || '(no response)'}`).join('\n\n')}

Write a single, direct follow-up question that:
1. Specifically targets the vague claim or missing detail
2. Asks for concrete specifics: numbers, tool names, project names, exact decisions made
3. Sounds natural and professional, not accusatory
4. Is concise — one question, no sub-questions

Return ONLY this JSON:
{
  "follow_up_reason": "Why this follow-up was triggered",
  "question_type": "technical" | "behavioral" | "situational" | "cultural",
  "question_text": "The follow-up question"
}
`
    try {
      const raw = await generateCompletion(followUpPrompt)
      const cleaned = extractJSON(raw)
      const parsed = JSON.parse(cleaned) as QuestionResponse
      return {
        question_text: parsed.question_text || forceFollowUp.question,
        question_type: parsed.question_type || 'technical',
        follow_up_reason: parsed.follow_up_reason || forceFollowUp.reason
      }
    } catch {
      return {
        question_text: forceFollowUp.question,
        question_type: 'technical',
        follow_up_reason: forceFollowUp.reason
      }
    }
  }

  const alreadyAskedQuestions = history
    .map((h, i) => `${i + 1}. ${h.question}`)
    .join('\n') || 'None yet.'

  const stageIndex = Math.max(0, Math.min(totalQuestions, TOTAL_WANTED_JOB_QUESTIONS - 1))
  const interviewStage = INTERVIEW_PLAN[stageIndex]
  const stageFocus = pickStageFocus(stageIndex, analysis)
  const extractedTools = analysis?.extractedTools || []
  const focusInstruction = buildFocusInstruction(stageFocus, interviewStage.instruction, extractedTools)

  // Build authenticity context for the prompt
  const recentAuthSignals = authenticitySignals.slice(-3)
  const hasRecentRedFlags = recentAuthSignals.some(s => s.signal === 'suspicious' || s.signal === 'inconsistent')
  const hasRecentVague = recentAuthSignals.some(s => s.signal === 'vague')
  const authenticityContext = recentAuthSignals.length > 0
    ? `\nRecent answer quality signals from live analysis:\n${recentAuthSignals.map(s =>
        `- Signal: ${s.signal} / Depth: ${s.depth}`
      ).join('\n')}\n${hasRecentRedFlags ? '⚠️ IMPORTANT: Recent answers showed suspicious or inconsistent signals. If this question relates to a claimed skill, probe for SPECIFIC details — tool names, numbers, exact outcomes. Do not accept generic answers.' : ''}${hasRecentVague ? '\nℹ️ Recent answers were vague. Aim for more targeted, specific questions.' : ''}`
    : ''

  const prompt = `
You are an expert technical interviewer assessing a candidate's proficiency in ${skill || 'the required skills'}. Candidate's claimed level: ${candidateLevel || 'Not specified'}. Role they are applying for: ${roleTitle || 'Not specified'}.

You are warm, sharp, and genuinely curious about the candidate — not a form-filling bot reading from a script. You have read the resume and JD closely and you ask questions the way a real hiring manager would: grounded in specifics, not generic templates. Assess their ACTUAL proficiency through targeted questions.

⚡ SCREENING DIFFICULTY CEILING (MANDATORY — DO NOT VIOLATE):
This is an EASY-TO-MEDIUM practical screening round. Its sole purpose is to confirm genuine, day-to-day familiarity — not deep expertise or internals knowledge.
- A candidate with real hands-on experience should answer comfortably in 30-60 seconds.
- NEVER ask about performance-at-scale, obscure framework internals, memory management, distributed systems gotchas, or algorithmic edge cases.
- ALWAYS explicitly name the specific tool or technology in the question (e.g. say "React", "Docker") — never ask about "your framework" or "your database" abstractly.
- STRICTLY follow the VERIFICATION MODE in the focus instruction:
  • verify_claim → ask the candidate to explain their OWN specific usage of the named tool
  • baseline_check → ask only a simple awareness/usage question

⚡ SENIOR RECRUITER MODE — AUTHENTICITY PROBING:
Your primary goal is to distinguish genuine experience from inflated resume claims. Ask questions that expose the difference:
- Genuine candidates can name specific tools, commands, team sizes, project outcomes, decisions made
- Candidates bluffing will give vague, generic answers — "I worked with Docker", "I led the team", "We used Agile"
- Ask HOW, not just WHAT: "How did you handle X?" not "Did you do X?"
- When probing a resume skill, ask about the specific detail that someone who actually used it would know immediately

Sound like a real person talking, not a quiz generator:
- Reference a SPECIFIC detail from the resume, JD, or the candidate's last answer whenever possible (a tool name, a project name, a company, a number, a claim they made) instead of asking in the abstract.
- Vary sentence structure between questions. Do not start every question the same way.
- A brief, specific, content-tied acknowledgment of their last answer is good and human. A generic, content-free acknowledgment ("Great answer," "Okay, thanks,") is NOT allowed.
- Keep it tight: one clear question per turn, no stacked sub-questions.

Job Description:
"""
${truncate(jdText || 'No job description provided.', 3000)}
"""

Candidate Resume:
"""
${truncate(resumeText || 'No resume provided.', 3000)}
"""

Interview History so far (in chronological order):
${history.map((h, i) => `
Step ${i} (Question Type: ${h.type}):
AI Question: ${h.question}
Candidate Answer: ${h.answer || '(No response or silent)'}
`).join('\n')}

Already asked questions. Do not repeat, rephrase, or ask a near-duplicate of any of these:
${alreadyAskedQuestions}

We have asked ${totalQuestions} job-related questions so far (target is ${TOTAL_WANTED_JOB_QUESTIONS} questions).
This is question number ${totalQuestions + 1} of ${TOTAL_WANTED_JOB_QUESTIONS}.
Interview structure:
- Questions 1-3 (Conceptual): Test core understanding — foundational concepts, theory, and principles. Verify the candidate truly understands the fundamentals.
- Questions 4-5 (Applied): Test practical problem-solving — real-world scenarios, debugging, implementation, and hands-on skills.
- Questions 6-8 (Gaps): Assess how fit the candidate is for the role — match their experience against JD requirements, probe gaps, evaluate transferable skills.
- Questions 9-10 (Cultural fit): Evaluate cultural alignment — teamwork, communication, values, work style, and growth mindset.

${analysis && (analysis.skills.length > 0 || analysis.projectMappings.length > 0) ? `Candidate fit analysis (from comparing this resume against this JD):
- Overall summary: ${analysis.summary || 'n/a'}
- Skills to be aware of: ${analysis.skills.map(s => `${s.skill} [${s.status}${s.evidence ? `, evidence: ${s.evidence}` : ''}]`).join('; ') || 'none extracted'}
` : ''}${extractedTools.length > 0 ? `
Extracted JD tools (specific tools this role requires):
${extractedTools.map(t => `- ${t.name} [${t.importance}${t.mentioned_in_resume ? ', on resume' : ', NOT on resume'}${t.resume_context ? `: "${t.resume_context}"` : ''}]`).join('\n')}
` : ''}${authenticityContext}
Current required stage:
- Category: ${interviewStage.category}
- Specific focus for THIS question: ${focusInstruction}
- Required question_type: ${interviewStage.questionType}

Instructions:
1. Analyze the candidate's latest answer.
2. Stay within the current required stage and its specific focus above.
3. You may ask a follow-up only if it still satisfies the current required stage and focus.
4. Build the question directly out of the "Specific focus for THIS question" field above.
5. If no specific focus was given (analysis unavailable), fall back to a generic but still JD/resume-grounded question.
6. For questions 1-3 (Conceptual), focus on foundational concepts, theory, principles — not implementation steps. Verify depth of understanding.
7. For questions 4-5 (Applied), pose real-world scenarios, debugging situations, or implementation challenges. Assess hands-on problem-solving.
8. For questions 6-8 (Gaps), tie questions directly to specific resume projects and JD requirements.
9. For questions 9-10 (Cultural fit), focus on teamwork, communication, feedback, ownership, values, and work style.
10. Avoid generic questions. Always tie to a specific JD requirement, skill, or resume project.
11. VERIFICATION MODE: If the focus instruction says "verify_claim", ask the candidate to explain their own specific usage of the named tool (not a textbook definition). If it says "baseline_check", ask a simple awareness question only. Either way, name the tool explicitly in your question.
12. The question must be spoken aloud, so keep it clear, concise, conversational, and direct.
13. Pull at least one concrete, specific detail (a name, tool, number, or claim) from the resume, the JD, or the candidate's last answer into the question itself.
14. Return your response in JSON format matching this schema:
{
  "follow_up_reason": "Explain if this is a follow-up question or a new topic, and why.",
  "question_type": "technical" | "behavioral" | "situational" | "cultural",
  "question_text": "The question to show and read aloud."
}
`

  try {
    const rawResult = await generateCompletion(prompt)
    // Clean JSON markdown blocks if outputted
    const cleaned = extractJSON(rawResult)
    const parsed = JSON.parse(cleaned) as QuestionResponse
    const questionText = parsed.question_text || "Can you tell me more about your background?"
    const existingQuestions = history.map(h => h.question)
    if (hasSimilarQuestionBeenAsked(questionText, existingQuestions)) {
      return getFallbackQuestion(totalQuestions, existingQuestions, "LLM returned a repeated or near-duplicate question, so a fallback question was selected.")
    }

    return {
      question_text: questionText,
      question_type: parsed.question_type || interviewStage.questionType,
      follow_up_reason: parsed.follow_up_reason || "Fallback due to missing keys"
    }
  } catch (err) {
    console.error("Failed to generate question via LLM, using fallback:", err)
    const existingQuestions = history.map(h => h.question)
    return getFallbackQuestion(totalQuestions, existingQuestions, "LLM unavailable or returned invalid JSON, so a fallback question was selected.")
  }
}

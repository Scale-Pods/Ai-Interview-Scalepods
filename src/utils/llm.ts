// Unified Client-Side LLM Helper for Dynamic Interview Questions
import type { LiveAssessmentNote, AuthenticitySignal, InterviewerTurn, InterviewerTurnType, InterviewBlueprint, InterviewPlanItem, AnswerInsufficiencyReason, JdTool, ResumeJdAlignment, FlaggedGap, PlanItemCategory } from '@/types'

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
  id?: string
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
  /** Resume vs JD alignment analysis (domain alignment, experience gaps, flagged gaps). */
  alignment?: ResumeJdAlignment
}

// -------------------------------------------------------------------
// Resume & JD Alignment Analyzer
// Runs once per session to identify domain mismatches, experience gaps,
// and specific flagged gaps that require empathetic recruiter probing.
// -------------------------------------------------------------------
export async function analyzeResumeJdAlignment(
  resumeText: string,
  jdText: string
): Promise<ResumeJdAlignment> {
  const fallback: ResumeJdAlignment = {
    domain_alignment: 'aligned',
    domain_reasoning: 'Standard alignment check.',
    experience_gap: {
      jd_required_years: null,
      candidate_years: null,
      status: 'aligned',
      reasoning: 'No clear experience gap identified.'
    },
    flagged_gaps: []
  }

  if (!resumeText || !jdText) return fallback

  const webhookUrl = import.meta.env.VITE_WEBHOOK_INTERVIEW_ENGINE || '/webhook/interview-engine'
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analyze-alignment', resumeText, jdText })
    })
    if (!response.ok) throw new Error(`n8n analyze-alignment failed: ${response.status}`)
    const parsed = await response.json() as any
    return {
      domain_alignment: parsed.domain_alignment || 'aligned',
      domain_reasoning: parsed.domain_reasoning || '',
      experience_gap: {
        jd_required_years: parsed.experience_gap?.jd_required_years ?? null,
        candidate_years: parsed.experience_gap?.candidate_years ?? null,
        status: parsed.experience_gap?.status || 'aligned',
        reasoning: parsed.experience_gap?.reasoning || ''
      },
      flagged_gaps: Array.isArray(parsed.flagged_gaps) ? parsed.flagged_gaps : []
    }
  } catch (err) {
    console.warn('[analyzeResumeJdAlignment] n8n call failed, returning fallback:', err)
    return fallback
  }
}

function fallbackBlueprint(sessionId: string, analysis: CandidateAnalysis): InterviewBlueprint {
  const tools = analysis.extractedTools || []
  const alignment = analysis.alignment
  const flaggedGaps = alignment?.flagged_gaps || []

  // Build competencies
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

  // Check resume-only skills
  const resumeOnlySkill = analysis.skills.find(s => s.status === 'strength' || (s.source === 'resume_claimed' && s.status !== 'match'))
  const hasResumeOnly = Boolean(resumeOnlySkill)

  // Composition calculation for 10 primary questions:
  // - 4 technical_jd (base)
  // - 1 technical_resume (if available, else convert to technical_jd)
  // - Up to 2 gap_probe (from real flagged gaps; convert unused slots to technical_jd)
  // - 1 problem_solving (case scenario)
  // - 2 cultural
  const actualGapProbes = flaggedGaps.slice(0, 2)
  const numGapSlots = actualGapProbes.length
  const unusedGapSlots = 2 - numGapSlots
  const unusedResumeSlots = hasResumeOnly ? 0 : 1

  const numTechJdNeeded = 4 + unusedGapSlots + unusedResumeSlots

  const planItems: InterviewPlanItem[] = []
  let planIdCounter = 1

  // (A) technical_jd questions
  for (let i = 0; i < numTechJdNeeded; i++) {
    const tool = tools[i % tools.length]
    const compId = safeCompetencies[i % safeCompetencies.length]?.id || 'role-fit'
    planItems.push({
      id: `plan-${planIdCounter++}`,
      category: 'technical_jd',
      competency_ids: [compId],
      target_tool: tool?.name || safeCompetencies[i % safeCompetencies.length]?.name || 'Core Skill',
      verification_mode: (tool ? (tool.mentioned_in_resume ? 'verify_claim' : 'baseline_check') : 'baseline_check'),
      objective: `Evaluate core JD technical capability in ${tool?.name || 'the required tool'}.`,
      question_type: 'technical',
      difficulty: i < 2 ? 'foundation' : 'applied'
    })
  }

  // (B) technical_resume question (if available)
  if (hasResumeOnly) {
    const compId = safeCompetencies[0]?.id || 'role-fit'
    planItems.push({
      id: `plan-${planIdCounter++}`,
      category: 'technical_resume',
      competency_ids: [compId],
      target_tool: resumeOnlySkill?.skill || 'Claimed Skill',
      verification_mode: 'verify_claim',
      objective: `Validate hands-on depth in candidate's claimed resume skill: ${resumeOnlySkill?.skill}`,
      question_type: 'technical',
      difficulty: 'applied'
    })
  }

  // (C) gap_probe questions (up to 2, only from real flagged gaps)
  for (let i = 0; i < actualGapProbes.length; i++) {
    const gap = actualGapProbes[i]
    planItems.push({
      id: `plan-${planIdCounter++}`,
      category: 'gap_probe',
      competency_ids: [safeCompetencies[0]?.id || 'role-fit'],
      objective: `Probe flagged alignment gap: ${gap.description}`,
      question_type: 'situational',
      difficulty: 'applied',
      gap_ref: gap
    })
  }

  // (D) problem_solving question (1 scenario case question)
  planItems.push({
    id: `plan-${planIdCounter++}`,
    category: 'problem_solving',
    competency_ids: [safeCompetencies[0]?.id || 'role-fit'],
    objective: 'Test practical scenario-based problem solving, trade-off analysis, and technical reasoning.',
    question_type: 'situational',
    difficulty: 'applied'
  })

  // (E) cultural questions (2 items)
  planItems.push({
    id: `plan-${planIdCounter++}`,
    category: 'cultural',
    competency_ids: [safeCompetencies[0]?.id || 'role-fit'],
    objective: 'Evaluate teamwork, communication, handling disagreements, and feedback.',
    question_type: 'cultural',
    difficulty: 'foundation'
  })
  planItems.push({
    id: `plan-${planIdCounter++}`,
    category: 'cultural',
    competency_ids: [safeCompetencies[0]?.id || 'role-fit'],
    objective: 'Assess work style preferences, adaptability, and team environment fit.',
    question_type: 'cultural',
    difficulty: 'foundation'
  })

  return {
    session_id: sessionId,
    version: 'v1',
    competencies: safeCompetencies,
    question_plan: planItems,
    candidate_summary: {
      strengths: analysis.skills.filter(s => s.status === 'match' || s.status === 'strength').slice(0, 3).map(s => s.skill),
      gaps: analysis.skills.filter(s => s.status === 'gap').slice(0, 3).map(s => s.skill),
      claims_to_validate: analysis.projectMappings.slice(0, 3).map(p => p.resumeProject)
    },
    constraints: { max_primary_questions: 10, max_follow_ups_per_question: 1 }
  }
}

export async function generateInterviewBlueprint(sessionId: string, resumeText: string, jdText: string, analysis: CandidateAnalysis): Promise<InterviewBlueprint> {
  const fallback = fallbackBlueprint(sessionId, analysis)

  const webhookUrl = import.meta.env.VITE_WEBHOOK_INTERVIEW_ENGINE || '/webhook/interview-engine'
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generate-blueprint',
        sessionId,
        resumeText,
        jdText,
        extractedTools: analysis.extractedTools || [],
        flaggedGaps: analysis.alignment?.flagged_gaps || []
      })
    })
    if (!response.ok) throw new Error(`n8n generate-blueprint failed: ${response.status}`)
    const parsed = await response.json() as any
    if (!Array.isArray(parsed.competencies) || !Array.isArray(parsed.question_plan)) return fallback
    return {
      ...fallback,
      competencies: parsed.competencies,
      question_plan: parsed.question_plan.map((item: any, idx: number) => ({
        ...item,
        category: item.category || fallback.question_plan[idx]?.category || 'technical_jd'
      })),
      candidate_summary: parsed.candidate_summary || fallback.candidate_summary,
      constraints: { ...fallback.constraints, max_primary_questions: 10, max_follow_ups_per_question: 1 }
    }
  } catch (error) {
    console.warn('[generateInterviewBlueprint] n8n call failed, using deterministic fallback:', error)
    return fallback
  }
}

const TOTAL_WANTED_JOB_QUESTIONS = 10

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

export function getDynamicCandidateQuestion(
  totalQuestions: number,
  existingQuestions: string[],
  analysis: CandidateAnalysis | null,
  planItem?: InterviewPlanItem | null,
  reason: string = "Dynamic candidate question"
): QuestionResponse {
  // 1. If planItem is provided, construct a question from its target_tool, gap_ref, or objective
  if (planItem) {
    if (planItem.target_tool && !hasSimilarQuestionBeenAsked(planItem.target_tool, existingQuestions)) {
      const mode = planItem.verification_mode || 'verify_claim'
      const text = mode === 'verify_claim'
        ? `Could you share a practical example of how you used ${planItem.target_tool} in your recent work, focusing on your specific contribution?`
        : `Could you explain what problem ${planItem.target_tool} solves and when you would recommend using it?`
      return {
        question_text: text,
        question_type: planItem.question_type || 'technical',
        follow_up_reason: reason
      }
    }
    if (planItem.category === 'gap_probe' && planItem.gap_ref?.description) {
      return {
        question_text: `Regarding your background: ${planItem.gap_ref.probe_direction || planItem.gap_ref.description}. Could you explain how your experience transfers here?`,
        question_type: 'situational',
        follow_up_reason: reason
      }
    }
    if (planItem.objective && !hasSimilarQuestionBeenAsked(planItem.objective, existingQuestions)) {
      return {
        question_text: `To evaluate ${planItem.objective.toLowerCase()}, could you walk me through your approach and key considerations?`,
        question_type: planItem.question_type || 'technical',
        follow_up_reason: reason
      }
    }
  }

  // 2. Inspect extracted tools from candidate analysis
  const tools = analysis?.extractedTools || []
  const unaskedTool = tools.find(t => t.name && !hasSimilarQuestionBeenAsked(t.name, existingQuestions))
  if (unaskedTool) {
    const text = unaskedTool.mentioned_in_resume
      ? `Your resume references experience with ${unaskedTool.name}. Could you detail how you applied ${unaskedTool.name} in your projects and the outcomes achieved?`
      : `This position utilizes ${unaskedTool.name}. How familiar are you with ${unaskedTool.name}, and how would you apply your technical knowledge to adopt it?`
    return {
      question_text: text,
      question_type: 'technical',
      follow_up_reason: reason
    }
  }

  // 3. Inspect flagged gaps from alignment analysis
  const flaggedGaps = analysis?.alignment?.flagged_gaps || []
  const unaskedGap = flaggedGaps.find(g => g.description && !hasSimilarQuestionBeenAsked(g.description, existingQuestions))
  if (unaskedGap) {
    return {
      question_text: `Looking at the role requirements versus your background: ${unaskedGap.probe_direction || unaskedGap.description}. How do you plan to address this in this role?`,
      question_type: 'situational',
      follow_up_reason: reason
    }
  }

  // 4. Inspect candidate skills
  const skills = analysis?.skills || []
  const unaskedSkill = skills.find(s => s.skill && !hasSimilarQuestionBeenAsked(s.skill, existingQuestions))
  if (unaskedSkill) {
    return {
      question_text: `How have you applied ${unaskedSkill.skill} in your past roles, and what key trade-offs or decisions did you handle?`,
      question_type: 'technical',
      follow_up_reason: reason
    }
  }

  // 5. Inspect project mappings
  const projects = analysis?.projectMappings || []
  const unaskedProject = projects.find(p => p.resumeProject && !hasSimilarQuestionBeenAsked(p.resumeProject, existingQuestions))
  if (unaskedProject) {
    return {
      question_text: `Can you elaborate on your contribution to ${unaskedProject.resumeProject} and how that experience transfers to ${unaskedProject.relatedJdRequirement}?`,
      question_type: 'technical',
      follow_up_reason: reason
    }
  }

  // 6. Dynamic candidate role synthesis based on candidate summary or stage index
  const stageIndex = Math.max(0, Math.min(totalQuestions, 9))
  const stageTypes: QuestionResponse['question_type'][] = ['technical', 'technical', 'technical', 'technical', 'situational', 'technical', 'situational', 'technical', 'cultural', 'cultural']
  const stageTopics = [
    "foundational technical architecture and design principles",
    "core technology implementation choices and trade-offs",
    "technical decision-making under constraints",
    "practical hands-on engineering challenges and solutions",
    "debugging, root cause analysis, and system troubleshooting",
    "mapping past technical achievements to core job requirements",
    "adapting skills to new project domain requirements",
    "deep technical execution on past key projects",
    "collaboration style, feedback, and cross-functional communication",
    "work style preferences, ownership, and engineering culture"
  ]

  const topic = stageTopics[stageIndex] || "technical problem-solving and implementation"
  const qType = stageTypes[stageIndex] || "technical"
  const summaryContext = analysis?.summary ? `Based on your candidate profile: ` : ''

  return {
    question_text: `${summaryContext}Could you walk me through a specific experience from your background related to ${topic}, highlighting your personal role and key outcomes?`,
    question_type: qType,
    follow_up_reason: reason
  }
}


// All LLM calls are routed through n8n webhooks.
// Direct browser-to-LLM API calls have been removed — API keys live in n8n only.

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

  const isTechnical = questionType === 'technical'
  const webhookUrl = import.meta.env.VITE_WEBHOOK_INTERVIEW_ENGINE || '/webhook/interview-engine'

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'analyze-answer',
        question,
        answer,
        resumeText,
        jdText,
        history,
        questionId,
        blueprint,
        competencyIds,
        questionType
      })
    })

    if (!response.ok) throw new Error(`n8n analyze-answer failed: ${response.status}`)
    const parsed = await response.json() as any

    // Resolve insufficiency_reason — enforce priority order and type gate in code.
    const PRIORITY: AnswerInsufficiencyReason[] = ['irrelevant', 'lacks_evidence', 'lacks_depth', 'vague']
    const rawReason = parsed.insufficiency_reason as string | null | undefined
    const insufficiencyReason: AnswerInsufficiencyReason | null =
      isTechnical && PRIORITY.includes(rawReason as AnswerInsufficiencyReason)
        ? (rawReason as AnswerInsufficiencyReason)
        : null

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
      follow_up_question: followUpIntended ? (parsed.follow_up_direction || undefined) : undefined,
      insufficiency_reason: followUpIntended ? insufficiencyReason : null,
      recommended_action: recommendedAction,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      competency_evidence: Array.isArray(parsed.competency_evidence) ? parsed.competency_evidence : []
    }
  } catch (err) {
    console.warn('[analyzeAnswerInRealtime] n8n call failed, returning fallback:', err)
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
  const webhookUrl = import.meta.env.VITE_WEBHOOK_INTERVIEW_ENGINE || '/webhook/interview-engine'
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'targeted-followup',
        originalQuestion,
        candidateAnswer,
        insufficiencyReason,
        gapDirection,
        resumeText,
        jdText
      })
    })

    if (!response.ok) throw new Error(`n8n targeted-followup failed: ${response.status}`)
    const parsed = await response.json() as any
    return parsed.question_text || gapDirection || 'Could you share a specific example that illustrates that?'
  } catch (err) {
    console.warn('[generateTargetedFollowUp] n8n call failed, returning fallback:', err)
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

  const webhookUrl = import.meta.env.VITE_WEBHOOK_INTERVIEW_ENGINE || '/webhook/interview-engine'
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'audit-resume', resumeText, jdText })
    })
    if (!response.ok) throw new Error(`n8n audit-resume failed: ${response.status}`)
    const parsed = await response.json() as any
    const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : []
    const claims = rawClaims.map((c: any) => ({
      claim: String(c.claim || ''),
      source: String(c.source || ''),
      suspicion_level: (String(c.suspicion_level || 'medium').toLowerCase() as 'low' | 'medium' | 'high'),
      probe_question: String(c.probe_question || c.probeQuestion || c.probe || ''),
      rationale: String(c.rationale || '')
    }))
    return { claims, summary: parsed.summary || '' }
  } catch (err) {
    console.warn('[auditResumeTruthfulness] n8n call failed, returning empty audit:', err)
    return { claims: [], summary: 'Resume truth audit unavailable.' }
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
  const webhookUrl = import.meta.env.VITE_WEBHOOK_INTERVIEW_ENGINE || '/webhook/interview-engine'
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analyze-fit', resumeText, jdText })
    })
    if (!response.ok) throw new Error(`n8n analyze-fit failed: ${response.status}`)
    const parsed = await response.json() as any
    const rawSkills = Array.isArray(parsed.skills) ? parsed.skills : []
    const skills = rawSkills.map((s: any) => ({
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
    console.warn('[analyzeCandidateFit] n8n call failed, returning empty analysis:', err)
    return { skills: [], projectMappings: [], summary: 'Skill analysis unavailable.' }
  }
}

// Runs alongside analyzeCandidateFit. Extracts a hard list of 6-10 specific named
// tools/technologies from the JD (not abstract categories) and checks whether each
// appears in the candidate's resume with its exact usage context.
// Result is merged into CandidateAnalysis.extractedTools by the caller.
export async function extractJdToolsAndTech(resumeText: string, jdText: string): Promise<JdTool[]> {
  const webhookUrl = import.meta.env.VITE_WEBHOOK_INTERVIEW_ENGINE || '/webhook/interview-engine'
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'extract-tools', resumeText, jdText })
    })
    if (!response.ok) throw new Error(`n8n extract-tools failed: ${response.status}`)
    const parsed = await response.json() as any
    if (!Array.isArray(parsed.tools)) return []
    return parsed.tools.map((t: Record<string, unknown>) => ({
      name: String(t.name || ''),
      category: String(t.category || 'General'),
      importance: (String(t.importance || 'nice_to_have') as JdTool['importance']),
      mentioned_in_resume: Boolean(t.mentioned_in_resume),
      resume_context: t.resume_context ? String(t.resume_context) : null
    }))
  } catch (err) {
    console.warn('[extractJdToolsAndTech] n8n call failed, returning empty list:', err)
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
    !targetQuestion && // wrapping a targetQuestion must NEVER trigger recursive follow-up
    lastAssessmentNote?.follow_up_prompted &&
    lastAssessmentNote?.follow_up_question &&
    followUpCount < maxFollowUps

  if (shouldFollowUp && lastAssessmentNote) {
    // Re-use the main generateInterviewerTurn prompt path with the follow-up as targetQuestion.
    // This gives us Alex's warm acknowledgment for free, without a separate LLM call.
    // We fall through to the main prompt below with targetQuestion set.
    const followUpTurn = await generateInterviewerTurn(
      resumeText, jdText, history, totalQuestions, analysis, authenticitySignals,
      lastAssessmentNote, // pass note through so acknowledgment context retains recruiter note
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


  const webhookUrl = import.meta.env.VITE_WEBHOOK_INTERVIEW_ENGINE || '/webhook/interview-engine'
  const stageIndex = Math.max(0, Math.min(totalQuestions, TOTAL_WANTED_JOB_QUESTIONS - 1))
  const interviewStage = INTERVIEW_PLAN[stageIndex]

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generate-turn',
        resumeText,
        jdText,
        history,
        totalQuestions,
        analysis,
        authenticitySignals,
        lastAssessmentNote,
        followUpCount,
        pendingQuestions,
        allowFollowUp,
        planItem,
        maxPrimaryQuestions,
        maxFollowUps,
        targetQuestion
      })
    })

    if (!response.ok) throw new Error(`n8n generate-turn failed: ${response.status}`)
    const parsed = await response.json() as any
    const questionText = parsed.question_text || parsed.interviewer_text || 'Could you elaborate on that?'

    if (!targetQuestion) {
      const allSessionQuestions = [
        ...history.map(h => h.question),
        ...pendingQuestions
      ]

      if (hasSimilarQuestionBeenAsked(questionText, allSessionQuestions)) {
        const fallback = getDynamicCandidateQuestion(totalQuestions, allSessionQuestions, analysis, planItem, "n8n returned a repeated question")
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
    console.error('[generateInterviewerTurn] n8n call failed, using dynamic candidate question:', err)
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
    const fallback = getDynamicCandidateQuestion(totalQuestions, allSessionQuestions, analysis, planItem, "n8n call failed")
    return {
      interviewer_text: fallback.question_text,
      question_text: fallback.question_text,
      turn_type: 'question' as InterviewerTurnType,
      question_type: fallback.question_type,
      should_continue: true
    }
  }
}

export interface DraftQuestion {
  question_text: string
  question_type: 'technical' | 'behavioral' | 'situational' | 'cultural'
  strategy: string
}

export interface ConsolidatedAnalysisResult {
  fitAnalysis: CandidateAnalysis
  truthAudit: ResumeTruthAudit
  draftQuestions: DraftQuestion[]
}

// Consolidates candidate fit analysis + resume truth audit + draft question generation
// into a single n8n call. Used by the HR CandidateForm after intake to pre-generate
// interview questions and surface potential probe areas before the session is sent.
export async function analyzeCandidate(
  resumeId: string,
  jdId: string
): Promise<ConsolidatedAnalysisResult> {
  const webhookUrl = import.meta.env.VITE_WEBHOOK_ANALYZE_CANDIDATE || '/webhook/analyze-candidate'
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeId, jdId })
    })

    if (!response.ok) throw new Error(`n8n analyze-candidate failed: ${response.status}`)
    return await response.json() as ConsolidatedAnalysisResult
  } catch (err) {
    console.warn('[analyzeCandidate] n8n call failed, returning fallback empty:', err)
    return {
      fitAnalysis: { skills: [], projectMappings: [], summary: 'Analysis failed.' },
      truthAudit: { claims: [], summary: 'Truth audit failed.' },
      draftQuestions: []
    }
  }
}

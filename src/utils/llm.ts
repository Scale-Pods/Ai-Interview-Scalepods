// Unified Client-Side LLM Helper for Dynamic Interview Questions

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

interface CandidateAnalysis {
  skills: SkillAssessment[]
  projectMappings: ProjectMapping[]
  summary: string
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

function isSimilarQuestion(a: string, b: string): boolean {
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

function hasSimilarQuestionBeenAsked(question: string, history: HistoryItem[]): boolean {
  return history.some(item => isSimilarQuestion(item.question, question))
}

function getFallbackQuestion(totalQuestions: number, history: HistoryItem[], reason: string): QuestionResponse {
  const preferredIndex = Math.max(0, Math.min(totalQuestions, FALLBACK_QUESTIONS.length - 1))
  const orderedFallbacks = [
    ...FALLBACK_QUESTIONS.slice(preferredIndex),
    ...FALLBACK_QUESTIONS.slice(0, preferredIndex)
  ]
  const fallback = orderedFallbacks.find(q => !hasSimilarQuestionBeenAsked(q.question_text, history)) || FALLBACK_QUESTIONS[preferredIndex]

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
      response_format: { type: 'json_object' },
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
      response_format: { type: 'json_object' },
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

// Runs once at the start of an interview. Extracts the actual skills, tools, and
// languages named or implied by the JD and the resume, decides which are matches,
// which are gaps (JD wants it, resume shows no evidence), and which are bonus
// strengths, and maps specific resume projects to specific JD requirements.
// Cache/store the result on the caller's side (e.g. in the interview session record)
// and pass it into generateNextInterviewQuestion for every question in that interview
// — don't call this more than once per interview.
export async function analyzeCandidateFit(resumeText: string, jdText: string): Promise<CandidateAnalysis> {
  const prompt = `
You are a technical recruiter analyzing a candidate before an interview. Read the job description and resume closely and extract concrete, specific skills, tools, languages, frameworks, and methodologies — not vague categories.

Job Description:
"""
${jdText || 'No job description provided.'}
"""

Candidate Resume:
"""
${resumeText || 'No resume provided.'}
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
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned) as CandidateAnalysis
    return {
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      projectMappings: Array.isArray(parsed.projectMappings) ? parsed.projectMappings : [],
      summary: parsed.summary || ''
    }
  } catch (err) {
    console.error('Failed to analyze candidate fit, proceeding without analysis:', err)
    return { skills: [], projectMappings: [], summary: '' }
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
  fallbackInstruction: string
): string {
  if (!focus) return fallbackInstruction

  if (focus.kind === 'skill') {
    const s = focus.data
    if (s.status === 'gap') {
      return `The JD requires "${s.skill}", but the resume shows no real evidence of it${s.evidence ? ` (only: ${s.evidence})` : ''}. Ask a question that tests whether the candidate actually understands or has used "${s.skill}" despite it not appearing clearly on their resume. Don't accuse them of lying — just probe their real depth on it.`
    }
    if (s.status === 'match') {
      return `The candidate's resume shows evidence of "${s.skill}" (${s.evidence || 'mentioned in resume'}), and the JD requires it. Ask a question that verifies real depth on "${s.skill}" — go beyond surface familiarity and test whether they actually understand how and when to use it.`
    }
    return `The candidate's resume shows a bonus strength in "${s.skill}" which the JD doesn't explicitly require (${s.evidence || 'mentioned in resume'}). Briefly probe this as extra context on their range.`
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
  roleTitle: string = ''
): Promise<QuestionResponse> {
  if (totalQuestions >= TOTAL_WANTED_JOB_QUESTIONS) {
    return {
      question_text: "Thank you so much for sharing that. This brings us to the end of our interview today. I really appreciate your time and detailed answers. The HR team will review your application and get back to you soon. Have a wonderful day!",
      question_type: "cultural",
      follow_up_reason: "Interview limit reached. Closing statement."
    }
  }

  const alreadyAskedQuestions = history
    .map((h, i) => `${i + 1}. ${h.question}`)
    .join('\n') || 'None yet.'

  const stageIndex = Math.max(0, Math.min(totalQuestions, TOTAL_WANTED_JOB_QUESTIONS - 1))
  const interviewStage = INTERVIEW_PLAN[stageIndex]
  const stageFocus = pickStageFocus(stageIndex, analysis)
  const focusInstruction = buildFocusInstruction(stageFocus, interviewStage.instruction)

  const prompt = `
You are an expert technical interviewer assessing a candidate's proficiency in ${skill || 'the required skills'}. Candidate's claimed level: ${candidateLevel || 'Not specified'}. Role they are applying for: ${roleTitle || 'Not specified'}.

You are warm, sharp, and genuinely curious about the candidate — not a form-filling bot reading from a script. You have read the resume and JD closely and you ask questions the way a real hiring manager would: grounded in specifics, not generic templates. Assess their ACTUAL proficiency through targeted questions.

Sound like a real person talking, not a quiz generator:
- Reference a SPECIFIC detail from the resume, JD, or the candidate's last answer whenever possible (a tool name, a project name, a company, a number, a claim they made) instead of asking in the abstract.
- Vary sentence structure between questions. Do not start every question the same way (e.g. don't let every technical question begin with "What is the difference between..."). Mix direct questions, scenario framing ("Say you're debugging X and..."), and specific call-backs ("You mentioned building the CPL watchdog pipeline — walk me through...").
- A brief, specific, content-tied acknowledgment of their last answer is good and human (e.g. "Interesting that you used a state machine there instead of trusting the LLM directly —"). A generic, content-free acknowledgment ("Great answer," "Okay, thanks," "That's good to hear") is NOT allowed — it adds nothing and sounds robotic.
- Keep it tight: one clear question per turn, no stacked sub-questions, no over-explaining before you ask it.

Examples of the difference:
- Robotic: "What is the difference between a list and a tuple?"
  Human: "Your resume lists Python — quick one: when would you actually reach for a tuple over a list in your own code?"
- Robotic: "Tell me about a project on your resume that matches this JD."
  Human: "The JD wants someone who's built CRM-to-ad-platform integrations. Your ScalePods offline conversion pipeline looks close — what did you actually own in that build?"
- Robotic: "What is one core concept from this role's main technology stack?"
  Human: "This role leans heavily on n8n and webhook-driven flows. What's one thing that trips people up the first time they build a multi-step workflow like that?"

Your goal is to ask relevant questions based on the candidate's resume and the job description, and also ask natural follow-up questions when appropriate.

Job Description:
"""
${jdText || 'No job description provided.'}
"""

Candidate Resume:
"""
${resumeText || 'No resume provided.'}
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
` : ''}
Current required stage:
- Category: ${interviewStage.category}
- Specific focus for THIS question: ${focusInstruction}
- Required question_type: ${interviewStage.questionType}

Instructions:
1. Analyze the candidate's latest answer.
2. Stay within the current required stage and its specific focus above. Do not ask a question from a later or earlier section.
3. You may ask a follow-up only if it still satisfies the current required stage and focus. Otherwise, introduce a new question for this stage using the specific focus given.
4. Build the question directly out of the "Specific focus for THIS question" field above — don't substitute a generic question if a specific skill or project focus was given.
5. If no specific focus was given (analysis unavailable), fall back to a generic but still JD/resume-grounded question for this stage's category.
6. For questions 1-3 (Conceptual), focus on foundational concepts, theory, principles — not implementation steps. Verify depth of understanding.
7. For questions 4-5 (Applied), pose real-world scenarios, debugging situations, or implementation challenges. Assess hands-on problem-solving.
8. For questions 6-8 (Gaps), tie questions directly to specific resume projects and JD requirements. Evaluate fit, transferability, and self-awareness about gaps.
9. For questions 9-10 (Cultural fit), focus on teamwork, communication, feedback, ownership, values, and work style. Assess alignment with team culture.
10. Avoid generic questions like "tell me about your experience" unless they are tied to a specific JD requirement, skill, or resume project.
11. Return the required question_type for this stage unless there is a strong reason not to.
12. The question must be spoken aloud, so keep it clear, concise, conversational, and direct. Do not use generic, content-free filler like "Great," "Okay," "Awesome," or "For my next question..." A short acknowledgment is only allowed if it references something specific the candidate actually said or something specific from the resume/JD — otherwise skip straight to the question. The question_text must be exactly what is displayed on the screen and spoken.
13. Look at how previous questions in this interview were phrased (see history above) and make sure this one opens differently — don't reuse the same sentence structure or opening words two turns in a row.
14. Pull at least one concrete, specific detail (a name, tool, number, or claim) from the resume, the JD, or the candidate's last answer into the question itself, rather than asking generically.
15. Return your response in JSON format matching this schema:
{
  "follow_up_reason": "Explain if this is a follow-up question or a new topic, and why.",
  "question_type": "technical" | "behavioral" | "situational" | "cultural",
  "question_text": "The question to show and read aloud."
}
`

  try {
    const rawResult = await generateCompletion(prompt)
    // Clean JSON markdown blocks if outputted
    const cleaned = rawResult.replace(/```json/gi, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned) as QuestionResponse
    const questionText = parsed.question_text || "Can you tell me more about your background?"
    if (hasSimilarQuestionBeenAsked(questionText, history)) {
      return getFallbackQuestion(totalQuestions, history, "LLM returned a repeated or near-duplicate question, so a fallback question was selected.")
    }

    return {
      question_text: questionText,
      question_type: parsed.question_type || interviewStage.questionType,
      follow_up_reason: parsed.follow_up_reason || "Fallback due to missing keys"
    }
  } catch (err) {
    console.error("Failed to generate question via LLM, using fallback:", err)
    return getFallbackQuestion(totalQuestions, history, "LLM unavailable or returned invalid JSON, so a fallback question was selected.")
  }
}
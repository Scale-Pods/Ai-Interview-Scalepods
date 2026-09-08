import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { InterviewSession, InterviewQuestion, Scorecard, LiveAssessmentNote, AuthenticitySignal, InterviewerTurn, InterviewBlueprint } from '@/types'
import { fetchSession, fetchQuestions, updateSessionStatusPublic } from '@/api/sessions'
import { fetchScorecard } from '@/api/scorecards'
import { supabasePublic } from '@/api/client'
import { fetchInterviewBlueprint, saveInterviewBlueprint } from '@/api/interviewBlueprints'
import { useMediaRecorder } from '@/hooks/useMediaRecorder'
import { analyzeCandidateFit, generateInterviewerTurn, analyzeAnswerInRealtime, generateInterviewBlueprint, generateTargetedFollowUp, extractJdToolsAndTech, analyzeResumeJdAlignment } from '@/utils/llm'
import { selectNextPlanItem, shouldAskFollowUp } from '@/utils/interviewOrchestrator'
import type { CandidateAnalysis } from '@/utils/llm'

interface InterviewContextType {
  session: InterviewSession | null
  questions: InterviewQuestion[]
  currentTurn: InterviewerTurn | null
  currentQuestionIndex: number
  currentQuestionId: string
  scorecard: Scorecard | null
  loading: boolean
  loadError: string
  isGeneratingTurn: boolean
  isAnalyzingAnswer: boolean
  liveAssessmentNotes: LiveAssessmentNote[]
  authenticitySignals: AuthenticitySignal[]
  blueprint: InterviewBlueprint | null
  resumeText: string
  jdText: string
  avStream: MediaStream | null
  audioStream: MediaStream | null
  screenStream: MediaStream | null
  recordingDuration: number
  recordingStatus: string
  recordingError: string | null
  setMediaStreams: (av: MediaStream | null, audio: MediaStream | null, screen: MediaStream | null) => void
  loadSession: (id: string) => Promise<void>
  submitAnswer: (questionId: string, answerText: string, audioUrl?: string) => Promise<void>
  generateNextTurn: () => Promise<void>
  markInterviewStarted: () => Promise<void>
  startRecording: (sessionId: string, streams: { camera: MediaStream; screen?: MediaStream | null; audio?: MediaStream }) => Promise<void>
  completeInterview: () => Promise<void>
}

const InterviewContext = createContext<InterviewContextType | null>(null)
const INTRO_QUESTION_TEXT = "Hello! I am your AI Interviewer today. Welcome to your interview. To start off, how are you doing today?"
const OPENING_ACKNOWLEDGMENT = "Hello, and thank you for joining today. I'm Alex, and I'll be guiding the interview."

function normalizeQuestionType(type?: string): 'technical' | 'behavioral' | 'situational' | 'cultural' {
  const t = String(type || '').toLowerCase().trim()
  if (t === 'behavioral') return 'behavioral'
  if (t === 'situational' || t === 'gap_probe') return 'situational'
  if (t === 'cultural') return 'cultural'
  return 'technical'
}

export function InterviewProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [currentTurn, setCurrentTurn] = useState<InterviewerTurn | null>(null)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [currentQuestionId, setCurrentQuestionId] = useState('')
  const [scorecard, setScorecard] = useState<Scorecard | null>(null)
  const [loading, setLoading] = useState(false)
  const [isGeneratingTurn, setIsGeneratingTurn] = useState(false)
  const [isAnalyzingAnswer, setIsAnalyzingAnswer] = useState(false)
  const [liveAssessmentNotes, setLiveAssessmentNotes] = useState<LiveAssessmentNote[]>([])
  const [authenticitySignals, setAuthenticitySignals] = useState<AuthenticitySignal[]>([])
  const [blueprint, setBlueprint] = useState<InterviewBlueprint | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [jdText, setJdText] = useState('')

  const [avStream, setAvStream] = useState<MediaStream | null>(null)
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)

  const recorder = useMediaRecorder()
  const recorderStopRef = useRef(recorder.stop)
  const candidateAnalysisRef = useRef<CandidateAnalysis | null>(null)
  const authenticitySignalsRef = useRef<AuthenticitySignal[]>([])
  const liveAssessmentNotesRef = useRef<LiveAssessmentNote[]>([])
  const followUpCountRef = useRef<Record<string, number>>({})
  const lastAssessmentNoteRef = useRef<LiveAssessmentNote | null>(null)
  const lastTurnQuestionIdRef = useRef<string>('')
  const generateNextTurnRef = useRef<() => Promise<void>>(async () => {})
  const isGeneratingTurnRef = useRef(false)
  const answeredQuestionIdsRef = useRef<Set<string>>(new Set())
  const localAnswersMapRef = useRef<Map<string, string>>(new Map())
  recorderStopRef.current = recorder.stop

  const setMediaStreams = useCallback((av: MediaStream | null, audio: MediaStream | null, screen: MediaStream | null) => {
    setAvStream(av)
    setAudioStream(audio)
    setScreenStream(screen)
  }, [])

  const [loadError, setLoadError] = useState('')

  const loadSession = useCallback(async (id: string) => {
    setLoading(true)
    setLoadError('')
    candidateAnalysisRef.current = null
    setLiveAssessmentNotes([])
    liveAssessmentNotesRef.current = []
    setAuthenticitySignals([])
    authenticitySignalsRef.current = []
    followUpCountRef.current = {}
    lastAssessmentNoteRef.current = null
    answeredQuestionIdsRef.current.clear()
    localAnswersMapRef.current.clear()
    setCurrentTurn(null)
    setCurrentQuestionId('')
    try {
      const [sessionData, questionsData, scorecardData, blueprintData] = await Promise.all([
        fetchSession(id),
        fetchQuestions(id),
        fetchScorecard(id),
        fetchInterviewBlueprint(id)
      ])
      if (!sessionData) {
        setLoadError('Interview session not found. The link may be expired or invalid.')
        setLoading(false)
        return
      }
      setSession(sessionData)
      setQuestions(questionsData)
      setScorecard(scorecardData)
      setBlueprint(blueprintData)
      candidateAnalysisRef.current = null
      authenticitySignalsRef.current = []

      // Fetch JD and Resume text if available
      if (sessionData.resume_id || sessionData.jd_id) {
        const fetches = []
        if (sessionData.resume_id) {
          fetches.push(
            supabasePublic
              .from('resumes_ai_interview')
              .select('raw_text')
              .eq('id', sessionData.resume_id)
              .maybeSingle()
              .then(res => res.data?.raw_text || '')
          )
        } else {
          fetches.push(Promise.resolve(''))
        }

        if (sessionData.jd_id) {
          fetches.push(
            supabasePublic
              .from('job_descriptions_ai_interview')
              .select('raw_text')
              .eq('id', sessionData.jd_id)
              .maybeSingle()
              .then(res => res.data?.raw_text || '')
          )
        } else {
          fetches.push(Promise.resolve(''))
        }

        const [resumeRaw, jdRaw] = await Promise.all(fetches)
        setResumeText(resumeRaw)
        setJdText(jdRaw)
      }

      if (sessionData.status === 'in_progress') {
        const { data: answers } = await supabasePublic
          .from('interview_answers_ai_interview')
          .select('question_id, answer_text, ai_live_note')
          .eq('session_id', id)
        if (answers) {
          for (const a of answers) {
            answeredQuestionIdsRef.current.add(a.question_id)
            if (a.answer_text) {
              localAnswersMapRef.current.set(a.question_id, a.answer_text)
            }
          }
        }
        const persistedNotes = (answers || [])
          .map(answer => answer.ai_live_note as LiveAssessmentNote | null)
          .filter((note): note is LiveAssessmentNote => Boolean(note))
        const persistedSignals = persistedNotes.map(note => ({
          question_id: note.question_id,
          signal: note.authenticity_signal,
          depth: note.depth_signal,
          follow_up_count: 0
        }))
        setLiveAssessmentNotes(persistedNotes)
        liveAssessmentNotesRef.current = persistedNotes
        setAuthenticitySignals(persistedSignals)
        authenticitySignalsRef.current = persistedSignals
        const answeredCount = Math.max(answers ? answers.length : 0, answeredQuestionIdsRef.current.size)
        setCurrentQuestionIndex(Math.min(answeredCount, questionsData.length > 0 ? questionsData.length - 1 : 0))
      }
    } catch (err) {
      console.warn('Failed to load interview session:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const submitAnswer = useCallback(async (questionId: string, answerText: string, audioUrl?: string) => {
    if (!session) return

    const { error } = await supabasePublic
      .from('interview_answers_ai_interview')
      .insert({
        question_id: questionId,
        session_id: session.id,
        answer_text: answerText,
        audio_url: audioUrl
      })

    if (error) {
      console.warn('Failed to persist answer:', error)
      throw error
    }

    // Add to local tracking immediately so client-side orchestrator can progress
    // even if candidate lacks RLS SELECT permission on answers
    answeredQuestionIdsRef.current.add(questionId)
    localAnswersMapRef.current.set(questionId, answerText)

    const currentQuestions = questions
    const currentQuestion = currentQuestions.find(q => q.id === questionId)

    if (!currentQuestion || !answerText || !resumeText) return

    const isAlreadyFollowUp = currentQuestion.source === 'llm_ts_followup'

    // ----- STEP 1: AWAIT the LLM analysis (all question types) -----
    // n8n returns a strict action. This keeps follow-up eligibility in one place.
    lastAssessmentNoteRef.current = null
    setIsAnalyzingAnswer(true)

    let completedNote: LiveAssessmentNote | null = null
    try {
      const { data: priorAnswers } = await supabasePublic
        .from('interview_answers_ai_interview')
        .select('question_id, answer_text')
        .eq('session_id', session.id)
      const answerByQuestion = new Map((priorAnswers || []).map(answer => [answer.question_id, answer.answer_text || '']))
      const historyMap = currentQuestions
        .filter(q => q.order_index < currentQuestion.order_index)
        .map(q => ({ question: q.question_text, answer: answerByQuestion.get(q.id) || '', type: q.source === 'llm_ts_followup' ? 'follow_up' : q.question_type }))

      const note = await analyzeAnswerInRealtime(
        currentQuestion.question_text, answerText, resumeText, jdText,
        historyMap, questionId, blueprint, currentQuestion.competency_ids || [],
        currentQuestion.question_type,
        isAlreadyFollowUp
      )

      if (note.recommended_action === 'follow_up' && note.insufficiency_reason) {
        try {
          const targetedQuestion = await generateTargetedFollowUp(
            currentQuestion.question_text,
            answerText,
            note.insufficiency_reason,
            note.follow_up_question || '',
            resumeText,
            jdText
          )
          note.follow_up_question = targetedQuestion
        } catch (followUpErr) {
          console.warn('[submitAnswer] generateTargetedFollowUp failed, keeping gap direction:', followUpErr)
        }
      } else if (note.recommended_action === 'rephrase_primary') {
        try {
          note.rephrased_question = await generateTargetedFollowUp(
            currentQuestion.question_text,
            answerText,
            'irrelevant',
            note.rephrased_question || 'Restate the original question in simpler, concrete language.',
            resumeText,
            jdText,
            'rephrase_primary'
          )
        } catch (rephraseErr) {
          console.warn('[submitAnswer] Could not rephrase primary question:', rephraseErr)
        }
      } else {
        note.follow_up_prompted = false
        note.follow_up_question = undefined
        note.rephrased_question = undefined
        note.insufficiency_reason = null
      }

      completedNote = note
      lastAssessmentNoteRef.current = note
      setLiveAssessmentNotes(prev => [...prev, note])
      liveAssessmentNotesRef.current = [...liveAssessmentNotesRef.current, note]

      const signal: AuthenticitySignal = {
        question_id: questionId,
        signal: note.authenticity_signal,
        depth: note.depth_signal,
        follow_up_count: 0
      }
      authenticitySignalsRef.current = [...authenticitySignalsRef.current, signal]
      setAuthenticitySignals(prev => [...prev, signal])
    } catch (err) {
      console.warn('[submitAnswer] Live analysis failed:', err)
    } finally {
      setIsAnalyzingAnswer(false)
    }

    // ----- STEP 3: Fire-and-forget — persist the note to DB for scoring -----
    // This does NOT block generateNextTurn; the note is already in the ref above.
    if (completedNote) {
      const noteToSave = completedNote
      ;(async () => {
        try {
          const { error: noteError } = await supabasePublic
            .from('interview_answers_ai_interview')
            .update({ ai_live_note: noteToSave, ai_assessment: noteToSave })
            .eq('session_id', session.id)
            .eq('question_id', questionId)
          if (noteError) console.warn('[submitAnswer] Could not persist live assessment:', noteError)
        } catch (persistErr) {
          console.warn('[submitAnswer] Could not persist note to DB:', persistErr)
        }
      })()
    }
  }, [session, questions, resumeText, jdText, blueprint])

  // Determines follow-up count for the last answer
  const getFollowUpCount = useCallback((latestQuestions: InterviewQuestion[], lastNote: LiveAssessmentNote | null): number => {
    if (!lastNote) return 0
    const currentQInDb = latestQuestions.find(q => q.id === lastNote.question_id)
    const trackingKey = currentQInDb?.source === 'llm_ts_followup' && currentQInDb.parent_question_id
      ? currentQInDb.parent_question_id
      : (currentQInDb?.id || lastNote.question_id || '')
    return latestQuestions.filter(question =>
      question.source === 'llm_ts_followup' && question.parent_question_id === trackingKey
    ).length
  }, [])

  const generateNextTurn = useCallback(async () => {
    if (!session || isGeneratingTurnRef.current) return
    isGeneratingTurnRef.current = true
    setIsGeneratingTurn(true)
    try {
      const [latestQuestions, answersResult] = await Promise.all([
        fetchQuestions(session.id),
        supabasePublic
          .from('interview_answers_ai_interview')
          .select('*')
          .eq('session_id', session.id)
          .order('created_at', { ascending: true })
      ])

      if (answersResult.error) throw answersResult.error

      const answersMap = new Map<string, string>([
        ...Array.from(localAnswersMapRef.current.entries()),
        ...(answersResult.data || []).map(a => [a.question_id, a.answer_text] as [string, string])
      ])
      const answeredIds = new Set<string>([
        ...Array.from(answeredQuestionIdsRef.current),
        ...(answersResult.data || []).map(a => a.question_id)
      ])
      const history = latestQuestions.filter(q => answeredIds.has(q.id)).map(q => ({
        id: q.id,
        question: q.question_text,
        answer: answersMap.get(q.id) || '',
        type: q.source === 'llm_ts_followup' ? 'follow_up' : q.question_type
      }))

      // Count only answered job-related questions — excludes intro questions (dynamic or
      // hr_reviewed) and follow-ups, which should not advance the stage index.
      const jobQuestionsAsked = latestQuestions.filter(
        question =>
          question.source !== 'llm_ts_dynamic_intro' &&
          question.source !== 'hr_reviewed_intro' &&
          question.source !== 'llm_ts_followup' &&
          answeredIds.has(question.id)
      ).length



      let activeBlueprint = blueprint
      if (!activeBlueprint && !candidateAnalysisRef.current && (resumeText || jdText)) {
        console.info('[InterviewContext] Running fallback candidate fit analysis + JD tool extraction + alignment analysis in parallel.')
        const [analysis, extractedTools, alignment] = await Promise.all([
          analyzeCandidateFit(resumeText, jdText),
          extractJdToolsAndTech(resumeText, jdText),
          analyzeResumeJdAlignment(resumeText, jdText)
        ])
        candidateAnalysisRef.current = { ...analysis, extractedTools, alignment }
      }

      if (!activeBlueprint && candidateAnalysisRef.current) {
        const generatedBlueprint = await generateInterviewBlueprint(session.id, resumeText, jdText, candidateAnalysisRef.current)
        activeBlueprint = await saveInterviewBlueprint(generatedBlueprint)
        setBlueprint(activeBlueprint)
      }

      // Compute the maximum number of primary questions to ask:
      // Keep it at least equal to the number of primary questions already present/pre-generated in the database,
      // so we do not end the interview early if more questions were generated.
      const totalPrimaryQuestionsInDb = latestQuestions.filter(
        question =>
          question.source !== 'llm_ts_dynamic_intro' &&
          question.source !== 'hr_reviewed_intro' &&
          question.source !== 'llm_ts_followup'
      ).length

      const maxPrimaryQuestions = Math.max(
        activeBlueprint?.constraints.max_primary_questions || 10,
        totalPrimaryQuestionsInDb
      )

      // Find pending pre-generated questions in queue
      const pendingQuestionRows = latestQuestions.filter(question => !answeredIds.has(question.id))
      const nextPendingQuestion = pendingQuestionRows[0]
      const pendingQuestions = pendingQuestionRows.map(question => question.question_text)

      // 1. Identify the last answered question from DB / live answered state
      const answeredQuestions = latestQuestions.filter(q => answeredIds.has(q.id))
      const lastAnsweredQuestion = answeredQuestions[answeredQuestions.length - 1] || null
      const lastAnswerText = lastAnsweredQuestion ? (answersMap.get(lastAnsweredQuestion.id) || '') : ''

      // 2. Resolve the matching LiveAssessmentNote for the last answered question.
      // Priority: (a) in-memory ref if matching, (b) liveAssessmentNotesRef array, (c) fresh Supabase DB data
      let lastNote: LiveAssessmentNote | null = null
      if (lastAnsweredQuestion) {
        if (lastAssessmentNoteRef.current?.question_id === lastAnsweredQuestion.id) {
          lastNote = lastAssessmentNoteRef.current
        } else {
          lastNote = liveAssessmentNotesRef.current.find(n => n.question_id === lastAnsweredQuestion.id) || null
        }
        if (!lastNote && answersResult.data) {
          const dbRow = answersResult.data.find(a => a.question_id === lastAnsweredQuestion.id)
          if (dbRow?.ai_live_note) {
            lastNote = dbRow.ai_live_note as LiveAssessmentNote
          } else if (dbRow?.ai_assessment) {
            lastNote = dbRow.ai_assessment as LiveAssessmentNote
          }
        }
      }

      // Safeguard & assertions: Log and verify context alignment
      console.info('[InterviewContext] Resolved turn acknowledgment context:', {
        lastQuestionId: lastAnsweredQuestion?.id || null,
        lastQuestionText: lastAnsweredQuestion?.question_text.slice(0, 60) || 'None',
        lastAnswerText: lastAnswerText.slice(0, 60),
        noteQuestionId: lastNote?.question_id || null,
        isAligned: Boolean(lastAnsweredQuestion && lastNote?.question_id === lastAnsweredQuestion.id)
      })

      if (lastNote && lastAnsweredQuestion && lastNote.question_id !== lastAnsweredQuestion.id) {
        console.warn('[InterviewContext] Mismatch detected: lastNote belongs to question', lastNote.question_id, 'but expected', lastAnsweredQuestion.id, '— clearing stale note.')
        lastNote = null
      }

      const lastQuestion = lastAnsweredQuestion
      const lastAnswerWasFollowUp = lastQuestion?.source === 'llm_ts_followup'
      const followUpCount = getFollowUpCount(latestQuestions, lastNote)
      const nextPlanItem = selectNextPlanItem(activeBlueprint, latestQuestions, liveAssessmentNotesRef.current)

      // Compute enriched context for the LLM turn generator
      const lastAnswerWordCount            = lastAnswerText.trim().split(/\s+/).filter(Boolean).length
      const isTechnicalQuestion            = lastQuestion?.question_type === 'technical'

      // A primary technical question may create one adaptive turn: a targeted
      // follow-up or a simpler rephrasing. Follow-ups and non-technical questions always advance.
      const maxFollowUps = (isTechnicalQuestion && !lastAnswerWasFollowUp) ? 1 : 0
      const allowPolicyFollowUp = shouldAskFollowUp(lastNote, followUpCount, maxFollowUps)
      const needsPrimaryRephrase = Boolean(
        (lastNote?.recommended_action === 'rephrase_primary' || lastNote?.requested_clarification) &&
        !lastAnswerWasFollowUp &&
        isTechnicalQuestion
      )
      const needsAdaptiveQuestion = allowPolicyFollowUp || needsPrimaryRephrase

      if (!needsAdaptiveQuestion && jobQuestionsAsked >= maxPrimaryQuestions && !nextPendingQuestion) {
        setCurrentTurn({
          interviewer_text: "That brings us to the end of the interview. Thank you so much for your time and for sharing your experience. Your responses have been successfully recorded. It is now safe to exit the interview and close this tab.",
          question_text: '',
          turn_type: 'closing',
          question_type: 'cultural',
          should_continue: false
        })
        return
      }

      console.info('[InterviewContext] Generating next interviewer turn', {
        sessionId: session.id,
        jobQuestionsAsked,
        pendingCount: pendingQuestions.length,
        followUpCount
      })

      const turn = await generateInterviewerTurn(
        resumeText,
        jdText,
        history,
        jobQuestionsAsked,
        candidateAnalysisRef.current,
        authenticitySignalsRef.current,
        lastNote,
        followUpCount,
        pendingQuestions,
        allowPolicyFollowUp,
        nextPlanItem,
        maxPrimaryQuestions,
        maxFollowUps,
        needsPrimaryRephrase
          ? (lastNote?.rephrased_question || `Could you clarify or simplify the question: "${lastQuestion?.question_text}"?`)
          : allowPolicyFollowUp
            ? lastNote?.follow_up_question
            : nextPendingQuestion?.question_text,
        Boolean(needsPrimaryRephrase || lastNote?.requested_clarification || lastNote?.recommended_action === 'rephrase_primary'),
        lastAnswerWordCount,
        isTechnicalQuestion,
        false
      )

      if (needsPrimaryRephrase && turn) {
        turn.turn_type = 'follow_up'
      }

      // If this turn includes a question, store it in the DB
      if ((turn.turn_type === 'question' || turn.turn_type === 'follow_up') && turn.question_text) {
        const isFollowUp = turn.turn_type === 'follow_up' || needsPrimaryRephrase

        if (isFollowUp) {
          const insertionIndex = lastQuestion ? lastQuestion.order_index + 1 : latestQuestions.length
          const questionsToShift = latestQuestions
            .filter(question => question.order_index >= insertionIndex)
            .sort((a, b) => b.order_index - a.order_index)
          for (const question of questionsToShift) {
            const { error: shiftError } = await supabasePublic
              .from('interview_questions_ai_interview')
              .update({ order_index: question.order_index + 1 })
              .eq('id', question.id)
            if (shiftError) throw shiftError
          }

          const { data: insertedQuestion, error: insertError } = await supabasePublic
            .from('interview_questions_ai_interview')
            .insert({
              session_id: session.id,
              question_text: turn.question_text,
              question_type: 'technical',
              order_index: insertionIndex,
              source: 'llm_ts_followup',
              parent_question_id: lastNote?.question_id || null,
              plan_item_id: lastQuestion?.plan_item_id || null,
              competency_ids: lastQuestion?.competency_ids || [],
              decision_rationale: lastNote?.note || (needsPrimaryRephrase ? 'Primary question rephrased after clarification request.' : 'Targeted evidence follow-up.'),
              // Record WHY this follow-up was triggered for scoring and audit
              insufficiency_reason: lastNote?.insufficiency_reason || null
            })
            .select()
            .single()
          if (insertError) throw insertError

          const questionsData = await fetchQuestions(session.id)
          setQuestions(questionsData)
          lastTurnQuestionIdRef.current = insertedQuestion.id
          setCurrentQuestionId(insertedQuestion.id)
          setCurrentQuestionIndex(questionsData.findIndex(question => question.id === insertedQuestion.id))
        } else if (nextPendingQuestion) {
          setQuestions(latestQuestions)
          lastTurnQuestionIdRef.current = nextPendingQuestion.id
          setCurrentQuestionId(nextPendingQuestion.id)
          setCurrentQuestionIndex(latestQuestions.findIndex(question => question.id === nextPendingQuestion.id))
        } else {
          // Dynamic new question — append at the end
          const safeType = normalizeQuestionType(turn.question_type)
          const insertionIndex = latestQuestions.length
          const { data: insertedQuestion, error: insertError } = await supabasePublic
            .from('interview_questions_ai_interview')
            .insert({
              session_id: session.id,
              question_text: turn.question_text,
              question_type: safeType,
              order_index: insertionIndex,
              source: 'llm_ts_dynamic',
              plan_item_id: nextPlanItem?.id || null,
              competency_ids: nextPlanItem?.competency_ids || [],
              decision_rationale: nextPlanItem?.objective || 'Continue structured interview coverage.'
            })
            .select()
            .single()
          if (insertError) throw insertError

          const questionsData = await fetchQuestions(session.id)
          setQuestions(questionsData)
          lastTurnQuestionIdRef.current = insertedQuestion.id
          setCurrentQuestionId(insertedQuestion.id)
          setCurrentQuestionIndex(questionsData.findIndex(question => question.id === insertedQuestion.id))
        }
      }

      // Track the one permitted adaptive turn for this primary question.
      if ((turn.turn_type === 'follow_up' || needsPrimaryRephrase) && lastNote) {
        const trackingKey = lastQuestion?.parent_question_id || lastNote.question_id
        followUpCountRef.current[trackingKey] = followUpCount + 1
      }

      setCurrentTurn(turn)
    } catch (err) {
      console.error('[InterviewContext] Failed to generate next turn:', err)
    } finally {
      isGeneratingTurnRef.current = false
      setIsGeneratingTurn(false)
    }
  }, [session, resumeText, jdText, getFollowUpCount, blueprint])
  // Keep the ref in sync so markInterviewStarted can call it without ordering issues
  generateNextTurnRef.current = generateNextTurn

  const resetToDynamicIntro = useCallback(async (sessionId: string) => {
    const { error: deleteError } = await supabasePublic
      .from('interview_questions_ai_interview')
      .delete()
      .eq('session_id', sessionId)

    if (deleteError) throw deleteError

    answeredQuestionIdsRef.current.clear()
    localAnswersMapRef.current.clear()

    const { error: insertError } = await supabasePublic
      .from('interview_questions_ai_interview')
      .insert({
        session_id: sessionId,
        question_text: INTRO_QUESTION_TEXT,
        question_type: 'cultural',
        order_index: 0,
        source: 'llm_ts_dynamic_intro'
      })

    if (insertError) throw insertError

    const questionsData = await fetchQuestions(sessionId)
    setQuestions(questionsData)
    setCurrentQuestionIndex(0)
    lastTurnQuestionIdRef.current = questionsData[0]?.id || ''
    setCurrentQuestionId(questionsData[0]?.id || '')
  }, [])

  const markInterviewStarted = useCallback(async () => {
    if (!session) return
    if (session.status !== 'in_progress') {
      await updateSessionStatusPublic(session.id, 'in_progress')
    }

    const [latestQuestions, answersResult] = await Promise.all([
      fetchQuestions(session.id),
      supabasePublic
        .from('interview_answers_ai_interview')
        .select('question_id')
        .eq('session_id', session.id)
    ])

    const answeredIds = new Set<string>([
      ...Array.from(answeredQuestionIdsRef.current),
      ...(answersResult.data || []).map(a => a.question_id)
    ])
    const answerCount = answeredIds.size
    const isResuming = session.status === 'in_progress'
    if (answerCount === 0 && latestQuestions.length === 0) {
      await resetToDynamicIntro(session.id)
      const introQuestion = (await fetchQuestions(session.id))[0]
      if (introQuestion) {
        lastTurnQuestionIdRef.current = introQuestion.id
        setCurrentQuestionId(introQuestion.id)
        const greetingQuestionText = (introQuestion.question_text.toLowerCase().includes('hello') || introQuestion.question_text.toLowerCase().includes('welcome'))
          ? introQuestion.question_text
          : `${OPENING_ACKNOWLEDGMENT} ${introQuestion.question_text}`
        setCurrentTurn({
          interviewer_text: '',
          question_text: greetingQuestionText,
          turn_type: 'question',
          question_type: introQuestion.question_type,
          should_continue: true
        })
      }
    } else {
      setQuestions(latestQuestions)
      const idx = Math.min(answerCount, latestQuestions.length > 0 ? latestQuestions.length - 1 : 0)
      setCurrentQuestionIndex(idx)
      // If interview is resuming, set up current turn from the last question
      if (latestQuestions.length > 0 && isResuming) {
        const lastQ = latestQuestions[latestQuestions.length - 1]
        if (lastQ) {
          // Check if all questions are answered — if so, generate next turn
          const pendingQuestion = latestQuestions.find(q => !answeredIds.has(q.id))
          if (pendingQuestion) {
            lastTurnQuestionIdRef.current = pendingQuestion.id
            setCurrentQuestionId(pendingQuestion.id)
            setCurrentTurn({
              interviewer_text: '',
              question_text: pendingQuestion.question_text,
              turn_type: 'question',
              question_type: pendingQuestion.question_type,
              should_continue: true
            })
          } else if (generateNextTurnRef.current) {
            await generateNextTurnRef.current()
          }
        }
      } else if (latestQuestions.length > 0) {
        // Build an initial turn from the first question
        const firstQ = latestQuestions[0]
        lastTurnQuestionIdRef.current = firstQ.id
        setCurrentQuestionId(firstQ.id)
        const greetingQuestionText = (firstQ.question_text.toLowerCase().includes('hello') || firstQ.question_text.toLowerCase().includes('welcome'))
          ? firstQ.question_text
          : `${OPENING_ACKNOWLEDGMENT} ${firstQ.question_text}`
        setCurrentTurn({
          interviewer_text: '',
          question_text: greetingQuestionText,
          turn_type: 'question',
          question_type: firstQ.question_type,
          should_continue: true
        })
      }
    }

    setSession(prev => prev ? {
      ...prev,
      status: 'in_progress',
      started_at: prev.started_at || new Date().toISOString()
    } : null)
  }, [session, resetToDynamicIntro])

  const startRecording = useCallback(async (sid: string, streams: { camera: MediaStream; screen?: MediaStream | null; audio?: MediaStream }) => {
    await recorder.start(sid, streams)
  }, [recorder])

  const completeInterview = useCallback(async () => {
    if (!session) return

    await recorderStopRef.current()
    setMediaStreams(null, null, null)

    try {
      await updateSessionStatusPublic(session.id, 'completed')
    } catch {}
    setSession(prev => prev ? {
      ...prev,
      status: 'completed',
      completed_at: prev.completed_at || new Date().toISOString()
    } : null)

    const webhookUrl = import.meta.env.VITE_WEBHOOK_SCORING_PIPELINE || '/webhook/score-interview'
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session.id })
    }).catch(err => console.error('Scoring webhook failed:', err))
  }, [session, setMediaStreams])

  useEffect(() => {
    return () => {
      avStream?.getTracks().forEach(track => track.stop())
      audioStream?.getTracks().forEach(track => track.stop())
      screenStream?.getTracks().forEach(track => track.stop())
    }
  }, [avStream, audioStream, screenStream])

  return (
    <InterviewContext.Provider value={{
      session, questions, currentTurn, currentQuestionIndex,
      currentQuestionId,
      scorecard, loading, loadError,
      isGeneratingTurn, isAnalyzingAnswer, liveAssessmentNotes, authenticitySignals, blueprint,
      resumeText, jdText,
      avStream, audioStream, screenStream,
      recordingDuration: recorder.duration, recordingStatus: recorder.status, recordingError: recorder.error,
      setMediaStreams,
      loadSession, submitAnswer, generateNextTurn,
      completeInterview,
      markInterviewStarted, startRecording
    }}>
      {children}
    </InterviewContext.Provider>
  )
}

export function useInterviewContext() {
  const ctx = useContext(InterviewContext)
  if (!ctx) throw new Error('useInterviewContext must be used within InterviewProvider')
  return ctx
}

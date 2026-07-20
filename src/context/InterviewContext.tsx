import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { InterviewSession, InterviewQuestion, Scorecard, LiveAssessmentNote, AuthenticitySignal, InterviewerTurn, InterviewBlueprint } from '@/types'
import { fetchSession, fetchQuestions, updateSessionStatusPublic } from '@/api/sessions'
import { fetchScorecard } from '@/api/scorecards'
import { supabasePublic } from '@/api/client'
import { fetchInterviewBlueprint, saveInterviewBlueprint } from '@/api/interviewBlueprints'
import { useMediaRecorder } from '@/hooks/useMediaRecorder'
import { analyzeCandidateFit, generateInterviewerTurn, generateNextInterviewQuestion, analyzeAnswerInRealtime, generateInterviewBlueprint, generateTargetedFollowUp, extractJdToolsAndTech } from '@/utils/llm'
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

    const isTechnicalQuestion = currentQuestion.question_type === 'technical'

    // If it's not a technical question, we do not call the LLM for evaluation or follow-up
    if (!isTechnicalQuestion) {
      const note: LiveAssessmentNote = {
        question_id: questionId,
        authenticity_signal: 'genuine',
        depth_signal: 'surface',
        red_flags: [],
        note: 'Non-technical question skipped realtime analysis.',
        follow_up_prompted: false,
        insufficiency_reason: null
      }
      lastAssessmentNoteRef.current = note
      setLiveAssessmentNotes(prev => [...prev, note])
      liveAssessmentNotesRef.current = [...liveAssessmentNotesRef.current, note]

      const signal: AuthenticitySignal = {
        question_id: questionId,
        signal: 'genuine',
        depth: 'surface',
        follow_up_count: 0
      }
      authenticitySignalsRef.current = [...authenticitySignalsRef.current, signal]
      setAuthenticitySignals(prev => [...prev, signal])

      // Persist placeholder note to DB for scorecard consistency
      ;(async () => {
        try {
          await supabasePublic
            .from('interview_answers_ai_interview')
            .update({ ai_live_note: note, ai_assessment: note })
            .eq('session_id', session.id)
            .eq('question_id', questionId)
        } catch (persistErr) {
          console.warn('[submitAnswer] Could not persist placeholder note:', persistErr)
        }
      })()

      return
    }

    // ----- STEP 1: AWAIT the analysis (Technical questions only) -----
    // We must have the note BEFORE generateNextTurn runs so the follow-up decision
    // is based on the answer that was just submitted — not the previous one.
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
        .map(q => ({ question: q.question_text, answer: answerByQuestion.get(q.id) || '', type: q.question_type }))

      const note = await analyzeAnswerInRealtime(
        currentQuestion.question_text, answerText, resumeText, jdText,
        historyMap, questionId, blueprint, currentQuestion.competency_ids || [],
        currentQuestion.question_type
      )

      // ----- STEP 2: If follow-up warranted on a technical question, generate the targeted question -----
      // Hard enforcement: follow-ups are only for technical questions, max 1 per parent question.
      // The insufficiency_reason from the analysis drives gap-specific question generation.
      const isAlreadyFollowUp = currentQuestion.source === 'llm_ts_followup'

      if (
        note.follow_up_prompted &&
        note.insufficiency_reason &&
        !isAlreadyFollowUp   // follow-up questions must not generate more follow-ups
      ) {
        try {
          const targetedQuestion = await generateTargetedFollowUp(
            currentQuestion.question_text,
            answerText,
            note.insufficiency_reason,
            note.follow_up_question || '',  // gap direction from analysis
            resumeText,
            jdText
          )
          // Overwrite follow_up_question with the specific, gap-targeted text
          note.follow_up_question = targetedQuestion
        } catch (followUpErr) {
          console.warn('[submitAnswer] generateTargetedFollowUp failed, keeping gap direction:', followUpErr)
          // Keep the gap direction from the analysis as a fallback question
        }
      } else {
        // Clear any follow-up intent if conditions aren't met (non-technical or already a follow-up)
        note.follow_up_prompted = false
        note.follow_up_question = undefined
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
        question: q.question_text,
        answer: answersMap.get(q.id) || '',
        type: q.question_type
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

      if (!candidateAnalysisRef.current && (resumeText || jdText)) {
        console.info('[InterviewContext] Running candidate fit analysis + JD tool extraction in parallel.')
        const [analysis, extractedTools] = await Promise.all([
          analyzeCandidateFit(resumeText, jdText),
          extractJdToolsAndTech(resumeText, jdText)
        ])
        candidateAnalysisRef.current = { ...analysis, extractedTools }
      }

      let activeBlueprint = blueprint
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

      // Early return: if we have reached the maximum number of primary questions
      // AND there are no more pending pre-generated questions to ask,
      // transition immediately to the closing statement.
      if (jobQuestionsAsked >= maxPrimaryQuestions && !nextPendingQuestion) {
        setCurrentTurn({
          interviewer_text: "That brings us to the end of the interview. Thank you so much for your time and for sharing your experience. Your responses have been successfully recorded. It is now safe to exit the interview and close this tab.",
          question_text: '',
          turn_type: 'closing',
          question_type: 'cultural',
          should_continue: false
        })
        return
      }

      const lastNote = lastAssessmentNoteRef.current
      const lastQuestion = latestQuestions.find(question => question.id === lastNote?.question_id)
      const lastAnswerWasFollowUp = lastQuestion?.source === 'llm_ts_followup'
      const followUpCount = getFollowUpCount(latestQuestions, lastNote)
      const nextPlanItem = selectNextPlanItem(activeBlueprint, latestQuestions, liveAssessmentNotesRef.current)

      // Compute constraints for follow-up.
      // Belt-and-suspenders: always 0 for non-technical questions — this is enforced
      // in submitAnswer before the note is created, but we re-check here so the
      // orchestrator is correct even if a stale note somehow has follow_up_prompted=true.
      const isTechnicalQuestion = lastQuestion?.question_type === 'technical'
      const maxFollowUps = (isTechnicalQuestion && !lastAnswerWasFollowUp) ? 1 : 0
      const allowPolicyFollowUp = shouldAskFollowUp(lastNote, followUpCount, maxFollowUps)

      // If a pre-generated question is waiting AND no follow-up is required,
      // generate a natural conversational acknowledgment via LLM but do NOT
      // touch the DB (candidates have no UPDATE RLS policy on questions).
      if (!allowPolicyFollowUp && nextPendingQuestion) {
        setQuestions(latestQuestions)
        const pendingIdx = latestQuestions.findIndex(q => q.id === nextPendingQuestion.id)
        setCurrentQuestionIndex(pendingIdx)
        lastTurnQuestionIdRef.current = nextPendingQuestion.id
        setCurrentQuestionId(nextPendingQuestion.id)

        // For non-technical questions (behavioral, situational, cultural fit), bypass the LLM entirely.
        // Just use a simple, warm static acknowledgment and proceed immediately.
        if (nextPendingQuestion.question_type !== 'technical') {
          const staticAcks = [
            "Got it, thank you.",
            "Thanks for sharing that.",
            "That makes sense, thank you.",
            "Appreciate you sharing that.",
            "Thank you."
          ]
          const ackText = staticAcks[nextPendingQuestion.order_index % staticAcks.length]
          setCurrentTurn({
            interviewer_text: `${ackText} ${nextPendingQuestion.question_text}`,
            question_text: nextPendingQuestion.question_text,
            turn_type: 'question',
            question_type: nextPendingQuestion.question_type,
            should_continue: true
          })
          return
        }

        // Try to wrap the pre-generated question with a natural acknowledgment (Technical questions only)
        try {
          const conversationalTurn = await generateInterviewerTurn(
            resumeText,
            jdText,
            history,
            jobQuestionsAsked,
            candidateAnalysisRef.current,
            authenticitySignalsRef.current,
            lastNote,
            followUpCount,
            [],          // pass empty pending list so LLM doesn't confuse them
            false,       // no follow-up allowed here
            nextPlanItem,
            maxPrimaryQuestions,
            0,           // maxFollowUps = 0 for this wrapper call
            nextPendingQuestion.question_text  // targetQuestion to wrap
          )
          if (conversationalTurn.turn_type === 'closing') {
            setCurrentTurn({
              ...conversationalTurn,
              question_text: '',
              should_continue: false
            })
            return
          }
          setCurrentTurn({
            ...conversationalTurn,
            // Always preserve the original question_text so the AnswerRecorder
            // shows the correct stored question, not the full LLM utterance.
            question_text: nextPendingQuestion.question_text,
            turn_type: 'question',
            question_type: nextPendingQuestion.question_type,
            should_continue: true
          })
        } catch {
          // LLM unavailable — fall back to the raw question without acknowledgment
          setCurrentTurn({
            interviewer_text: nextPendingQuestion.question_text,
            question_text: nextPendingQuestion.question_text,
            turn_type: 'question',
            question_type: nextPendingQuestion.question_type,
            should_continue: true
          })
        }
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
        maxFollowUps
      )

      // If this turn includes a question, store it in the DB
      if ((turn.turn_type === 'question' || turn.turn_type === 'follow_up') && turn.question_text) {
        const isFollowUp = turn.turn_type === 'follow_up'

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
              decision_rationale: lastNote?.note || 'Targeted evidence follow-up.',
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
        } else {
          // Dynamic new question — append at the end
          const insertionIndex = latestQuestions.length
          const { data: insertedQuestion, error: insertError } = await supabasePublic
            .from('interview_questions_ai_interview')
            .insert({
              session_id: session.id,
              question_text: turn.question_text,
              question_type: turn.question_type || 'technical',
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

      // Track follow-up count if this turn is a follow-up
      if (turn.turn_type === 'follow_up' && lastNote) {
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
        setCurrentTurn({
          interviewer_text: introQuestion.question_text,
          question_text: introQuestion.question_text,
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
              interviewer_text: pendingQuestion.question_text,
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
        setCurrentTurn({
          interviewer_text: firstQ.question_text,
          question_text: firstQ.question_text,
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

  // Legacy generator retained only for compatibility during an in-flight deployment.
  // It is deliberately not exposed by the context; the conversational turn loop above is the sole active path.
  const _generateAndStoreNextQuestion = useCallback(async () => {
    if (!session || isGeneratingTurnRef.current) return
    isGeneratingTurnRef.current = true
    setIsGeneratingTurn(true)
    try {
      // Always build the prompt from the database, not from a possibly stale React state snapshot.
      const [latestQuestions, answersResult] = await Promise.all([
        fetchQuestions(session.id),
        supabasePublic
          .from('interview_answers_ai_interview')
          .select('*')
          .eq('session_id', session.id)
          .order('created_at', { ascending: true })
      ])

      if (answersResult.error) throw answersResult.error

      const answersMap = new Map((answersResult.data || []).map(a => [a.question_id, a.answer_text]))

      const history = latestQuestions.map(q => ({
        question: q.question_text,
        answer: answersMap.get(q.id) || '',
        type: q.question_type
      }))

      // The count of actual interview questions excludes the intro question
      const jobQuestionsAsked = Math.max(0, latestQuestions.length - 1)

      if (!candidateAnalysisRef.current) {
        console.info('[InterviewContext] Late-init: Running candidate fit analysis + JD tool extraction in parallel.')
        const [analysis, extractedTools] = await Promise.all([
          analyzeCandidateFit(resumeText, jdText),
          extractJdToolsAndTech(resumeText, jdText)
        ])
        candidateAnalysisRef.current = { ...analysis, extractedTools }
      }

      // Check if the last answer triggered a follow-up probe
      const lastSignal = authenticitySignalsRef.current[authenticitySignalsRef.current.length - 1]
      const lastNote = liveAssessmentNotesRef.current[liveAssessmentNotesRef.current.length - 1]
      const MAX_FOLLOW_UPS = 2

      // Find the current question in the database so we can check if it's
      // already a follow-up — follow-ups must not generate more follow-ups.
      const currentQInDb = latestQuestions.find(q => q.id === lastNote?.question_id)
      const isFollowUpQuestion = currentQInDb?.source === 'llm_ts_followup'
      // Track follow-ups by the original (root) question ID so the 2-per-answer
      // limit applies across the entire follow-up chain, not per follow-up.
      const trackingKey = isFollowUpQuestion && currentQInDb?.parent_question_id
        ? currentQInDb.parent_question_id
        : (currentQInDb?.id || lastNote?.question_id || '')
      const followUpCount = followUpCountRef.current[trackingKey] || 0

      let forceFollowUp: { question: string; reason: string } | undefined

      if (
        !isFollowUpQuestion && // follow-up questions must not generate more follow-ups
        lastNote?.follow_up_prompted &&
        lastNote?.follow_up_question &&
        followUpCount < MAX_FOLLOW_UPS &&
        (lastSignal?.signal === 'vague' || lastSignal?.signal === 'suspicious' || lastSignal?.signal === 'inconsistent')
      ) {
        forceFollowUp = {
          question: lastNote.follow_up_question,
          reason: `Candidate's previous answer was ${lastSignal.signal}. ${lastNote.note}`
        }
        followUpCountRef.current[trackingKey] = followUpCount + 1
        console.info('[InterviewContext] Triggering follow-up probe due to signal:', lastSignal?.signal)
      }

      // If no follow-up is needed and there are unanswered questions in the
      // queue (pre-generated by n8n), skip generation entirely.
      if (!forceFollowUp) {
        const answeredIds = new Set((answersResult.data || []).map(a => a.question_id))
        const hasUnansweredQuestions = latestQuestions.some(q => !answeredIds.has(q.id))
        if (hasUnansweredQuestions) {
          console.info('[InterviewContext] Skipping generation — next question already exists and no follow-up needed')
          return
        }
      }

      console.info('[InterviewContext] Generating next question via src/utils/llm.ts', {
        sessionId: session.id,
        jobQuestionsAsked,
        source: forceFollowUp ? 'llm_ts_followup' : 'llm_ts_dynamic',
        authSignals: authenticitySignalsRef.current.length
      })

      const nextQ = await generateNextInterviewQuestion(
        resumeText,
        jdText,
        history,
        jobQuestionsAsked,
        candidateAnalysisRef.current,
        '',
        '',
        '',
        authenticitySignalsRef.current,
        forceFollowUp
      )

      // Store in DB — position depends on whether this is a follow-up
      if (forceFollowUp) {
        // Insert follow-up question right after the current question
        const currentQId = answersResult.data?.[answersResult.data.length - 1]?.question_id
        const currentQ = latestQuestions.find(q => q.id === currentQId)
        const insertIndex = currentQ ? currentQ.order_index + 1 : latestQuestions.length

        // Shift existing questions that come after the insert position to make room
        const questionsToShift = latestQuestions.filter(q => q.order_index >= insertIndex && q.id !== currentQ?.id)
        await Promise.all(
          questionsToShift.map(q =>
            supabasePublic
              .from('interview_questions_ai_interview')
              .update({ order_index: q.order_index + 1 })
              .eq('id', q.id)
          )
        )

        const { error: insertError } = await supabasePublic
          .from('interview_questions_ai_interview')
          .insert({
            session_id: session.id,
            question_text: nextQ.question_text,
            question_type: nextQ.question_type,
            order_index: insertIndex,
            source: 'llm_ts_followup',
            parent_question_id: currentQInDb?.id || null
          })
        if (insertError) throw insertError
      } else {
        // Append regular dynamic question at the end
        const { error: insertError } = await supabasePublic
          .from('interview_questions_ai_interview')
          .insert({
            session_id: session.id,
            question_text: nextQ.question_text,
            question_type: nextQ.question_type,
            order_index: latestQuestions.length,
            source: 'llm_ts_dynamic'
          })
        if (insertError) throw insertError
      }

      const questionsData = await fetchQuestions(session.id)
      setQuestions(questionsData)
    } catch (err) {
      console.error('Failed to generate and store next question:', err)
    } finally {
      isGeneratingTurnRef.current = false
      setIsGeneratingTurn(false)
    }
  }, [session, resumeText, jdText])

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
    }).catch(err => console.error('Scoring webhook failed (verify n8n is running and VITE_WEBHOOK_SCORING_PIPELINE is correct):', err))
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

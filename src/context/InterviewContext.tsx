import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { InterviewSession, InterviewQuestion, Scorecard } from '@/types'
import { fetchSession, fetchQuestions, updateSessionStatusPublic } from '@/api/sessions'
import { fetchScorecard } from '@/api/scorecards'
import { supabasePublic } from '@/api/client'
import { useMediaRecorder } from '@/hooks/useMediaRecorder'
import { analyzeCandidateFit, generateNextInterviewQuestion } from '@/utils/llm'
import type { CandidateAnalysis } from '@/utils/llm'

interface InterviewContextType {
  session: InterviewSession | null
  questions: InterviewQuestion[]
  currentQuestionIndex: number
  scorecard: Scorecard | null
  loading: boolean
  loadError: string
  isGeneratingQuestion: boolean
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
  nextQuestion: () => void
  previousQuestion: () => void
  resetQuestions: () => void
  markInterviewStarted: () => Promise<void>
  startRecording: (sessionId: string, streams: { camera: MediaStream; screen?: MediaStream | null; audio?: MediaStream }) => Promise<void>
  completeInterview: () => Promise<void>
  generateAndStoreNextQuestion: () => Promise<void>
}

const InterviewContext = createContext<InterviewContextType | null>(null)
const INTRO_QUESTION_TEXT = "Hello! I am your AI Interviewer today. Welcome to your interview. To start off, how are you doing today?"

export function InterviewProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [scorecard, setScorecard] = useState<Scorecard | null>(null)
  const [loading, setLoading] = useState(false)
  const [isGeneratingQuestion, setIsGeneratingQuestion] = useState(false)
  const [resumeText, setResumeText] = useState('')
  const [jdText, setJdText] = useState('')

  const [avStream, setAvStream] = useState<MediaStream | null>(null)
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)

  const recorder = useMediaRecorder()
  const recorderStopRef = useRef(recorder.stop)
  const candidateAnalysisRef = useRef<CandidateAnalysis | null>(null)
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
    try {
      const [sessionData, questionsData, scorecardData] = await Promise.all([
        fetchSession(id),
        fetchQuestions(id),
        fetchScorecard(id)
      ])
      if (!sessionData) {
        setLoadError('Interview session not found. The link may be expired or invalid.')
        setLoading(false)
        return
      }
      setSession(sessionData)
      setQuestions(questionsData)
      setScorecard(scorecardData)
      candidateAnalysisRef.current = null

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
        // Find how many questions have already been answered
        const { data: answers } = await supabasePublic
          .from('interview_answers_ai_interview')
          .select('question_id')
          .eq('session_id', id)
        const answeredCount = answers ? answers.length : 0
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
  }, [session])

  const resetToDynamicIntro = useCallback(async (sessionId: string) => {
    const { error: deleteError } = await supabasePublic
      .from('interview_questions_ai_interview')
      .delete()
      .eq('session_id', sessionId)

    if (deleteError) throw deleteError

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
        .select('id')
        .eq('session_id', session.id)
    ])

    if (answersResult.error) throw answersResult.error

    const answerCount = answersResult.data?.length || 0
    if (answerCount === 0 && latestQuestions.length === 0) {
      await resetToDynamicIntro(session.id)
    } else {
      setQuestions(latestQuestions)
      setCurrentQuestionIndex(Math.min(answerCount, latestQuestions.length > 0 ? latestQuestions.length - 1 : 0))
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

  const nextQuestion = useCallback(() => {
    setCurrentQuestionIndex(prev => prev + 1)
  }, [])

  const previousQuestion = useCallback(() => {
    setCurrentQuestionIndex(prev => Math.max(prev - 1, 0))
  }, [])

  const resetQuestions = useCallback(() => {
    setCurrentQuestionIndex(0)
  }, [])

  const generateAndStoreNextQuestion = useCallback(async () => {
    if (!session) return
    setIsGeneratingQuestion(true)
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
        console.info('[InterviewContext] Running llm.ts candidate fit analysis for dynamic questions.')
        candidateAnalysisRef.current = await analyzeCandidateFit(resumeText, jdText)
      }

      console.info('[InterviewContext] Generating next question via src/utils/llm.ts', {
        sessionId: session.id,
        jobQuestionsAsked,
        source: 'llm_ts_dynamic'
      })

      const nextQ = await generateNextInterviewQuestion(
        resumeText,
        jdText,
        history,
        jobQuestionsAsked,
        candidateAnalysisRef.current,
        '',
        '',
        ''
      )

      // Store in DB
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

      const questionsData = await fetchQuestions(session.id)
      setQuestions(questionsData)
    } catch (err) {
      console.error('Failed to generate and store next question:', err)
    } finally {
      setIsGeneratingQuestion(false)
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
      session, questions, currentQuestionIndex, scorecard, loading, loadError,
      isGeneratingQuestion, resumeText, jdText,
      avStream, audioStream, screenStream,
      recordingDuration: recorder.duration, recordingStatus: recorder.status, recordingError: recorder.error,
      setMediaStreams,
      loadSession, submitAnswer, nextQuestion, previousQuestion, resetQuestions, completeInterview,
      markInterviewStarted, startRecording, generateAndStoreNextQuestion
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

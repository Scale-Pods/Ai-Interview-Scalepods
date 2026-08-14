import { useEffect, useCallback, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, CheckCircle, Clock, Monitor, Upload, Loader2, PhoneOff } from 'lucide-react'

import { useInterviewContext } from '@/context/InterviewContext'
import { useProctoringContext } from '@/context/ProctoringContext'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { getCameraStream, getScreenStream, getAudioStream } from '@/utils/mediaHelpers'
import { useTTSEngine } from '@/utils/tts'
import { useInterviewTimer } from '@/hooks/useInterviewTimer'
import { AnswerRecorder } from './AnswerRecorder'
import type { AnswerRecorderState } from './AnswerRecorder'
import { Completion } from './Completion'
import { PreCheck } from './PreCheck'
import { extractLeadIn } from './QuestionDisplay'
import { VideoFeed } from './VideoFeed'
import { ProctoringOverlay } from './ProctoringOverlay'
import { RecruiterPersona } from './RecruiterPersona'
import { ChatBubble, TypingBubble } from './ChatBubble'
import type { ChatMessage } from './ChatBubble'
import { ChatInputBar } from './ChatInputBar'

const INTERVIEW_TIME_MINUTES = 25
const DEFAULT_TARGET_QUESTIONS = 11

export function InterviewRoom() {
  const { token } = useParams<{ token: string }>()
  const {
    session,
    questions,
    currentTurn,
    currentQuestionIndex,
    currentQuestionId,
    loading,
    loadError,
    loadSession,
    avStream,
    audioStream,
    screenStream,
    setMediaStreams,
    submitAnswer,
    generateNextTurn,
    completeInterview,
    markInterviewStarted,
    startRecording,
    recordingDuration,
    recordingStatus,
    recordingError,
    isGeneratingTurn,
    isAnalyzingAnswer,
    liveAssessmentNotes
  } = useInterviewContext()
  const { violations, startProctoring, stopProctoring } = useProctoringContext()
  const startingRef = useRef(false)
  const completionStartedRef = useRef(false)
  const { speak, cancel } = useTTSEngine()
  const [answerState, setAnswerState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastError, setLastError] = useState('')
  const [isAiSpeaking, setIsAiSpeaking] = useState(false)
  const isAiSpeakingRef = useRef(false)
  const [endEarly, setEndEarly] = useState(false)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [completingError, setCompletingError] = useState('')
  const globalTimer = useInterviewTimer(INTERVIEW_TIME_MINUTES)
  const turnIdRef = useRef<string | undefined>(undefined)
  // Tracks what text the AI is currently reading aloud
  const [currentlySpeakingText, setCurrentlySpeakingText] = useState('')
  const [speakingPhase, setSpeakingPhase] = useState<'acknowledgment' | 'question' | null>(null)
  const [activeVideoTab, setActiveVideoTab] = useState<'camera' | 'screen'>('camera')

  // ── Chat UI state ─────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [recorderState, setRecorderState] = useState<AnswerRecorderState>({
    transcript: '', isThinking: false, silenceCountdown: 40, countdownTenths: 40,
    thinkingCountdown: 250, thinkingCountdownTenths: 250, isRecording: false
  })

  const chatFeedRef = useRef<HTMLDivElement>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
  // Used to trigger manual submit from ChatInputBar → AnswerRecorder
  const stopAndSubmitRef = useRef<(() => void) | null>(null)
  // Track the ID of the current Alex bubble so we can update its status
  const currentAlexBubbleIdRef = useRef<string | null>(null)

  const TURN_GEN_MESSAGES = [
    { text: 'Reviewing your answer details...', detail: 'Processing key points & practical evidence' },
    { text: 'Evaluating technical depth & relevance...', detail: 'Checking response alignment against role expectations' },
    { text: 'Preparing Alex\'s next question...', detail: 'Formulating targeted follow-up or next competency topic' }
  ]
  const [turnGenStep, setTurnGenStep] = useState(0)

  useEffect(() => {
    if (!isGeneratingTurn) {
      setTurnGenStep(0)
      return
    }
    let step = 0
    const timer = setInterval(() => {
      step = Math.min(step + 1, TURN_GEN_MESSAGES.length - 1)
      setTurnGenStep(step)
      // Stop ticking once we've reached the final step
      if (step >= TURN_GEN_MESSAGES.length - 1) {
        clearInterval(timer)
      }
    }, 2500)
    return () => clearInterval(timer)
  }, [isGeneratingTurn])

  useEffect(() => {
    if (token) loadSession(token)
  }, [token, loadSession])

  useEffect(() => {
    completionStartedRef.current = false
  }, [token])

  const [startError, setStartError] = useState('')

  const handleStart = useCallback(async () => {
    if (startingRef.current) return
    startingRef.current = true
    setStartError('')
    try {
      console.log('handleStart: requesting camera stream...')
      const av = await getCameraStream()
      console.log('handleStart: camera stream obtained')
      let audio: MediaStream | null = null
      try {
        console.log('handleStart: requesting audio stream...')
        audio = await getAudioStream()
        console.log('handleStart: audio stream obtained')
      } catch (audioErr) {
        console.warn('Audio stream not available, continuing without it:', audioErr)
      }
      let screen: MediaStream | null = null
      try {
        console.log('handleStart: requesting screen stream...')
        screen = await getScreenStream()
        console.log('handleStart: screen stream obtained')
      } catch (screenErr) {
        console.warn('Screen sharing not available, continuing without it:', screenErr)
      }
      console.log('handleStart: marking interview started...')
      await markInterviewStarted()
      console.log('handleStart: interview marked started')
      setMediaStreams(av, audio, screen)
      if (session) {
        console.log('handleStart: starting recording...')
        await startRecording(session.id, { camera: av, screen: screen ?? undefined, audio: audio ?? undefined })
        console.log('handleStart: recording started')
      }
      if (session) {
        console.log('handleStart: starting proctoring...')
        startProctoring(session.id, audio ?? undefined, isAiSpeakingRef)
      }
      console.log('handleStart: done')
    } catch (err) {
      console.error('Failed to get media streams:', err)
      setStartError((err as Error).message || 'Camera permission was denied. Please allow camera access to proceed.')
      startingRef.current = false
    }
  }, [session, markInterviewStarted, setMediaStreams, startRecording, startProctoring])

  const finishInterview = useCallback(async () => {
    if (completionStartedRef.current || session?.status === 'completed') return
    completionStartedRef.current = true
    setCompleting(true)
    setCompletingError('')
    stopProctoring()
    try {
      await completeInterview()
    } catch (err) {
      setCompletingError((err as Error).message || 'Failed to complete interview')
    } finally {
      setCompleting(false)
    }
  }, [completeInterview, session?.status, stopProctoring])

  // After the AI finishes speaking, decide what to do next
  const onSpeakCompleteRef = useRef<() => void>(undefined)
  onSpeakCompleteRef.current = () => {
    isAiSpeakingRef.current = false
    setIsAiSpeaking(false)
    setCurrentlySpeakingText('')
    setSpeakingPhase(null)
    if (currentTurn?.turn_type === 'closing' && !completionStartedRef.current) {
      // Natural closing — give the candidate a moment then end
      setTimeout(() => {
        if (!completionStartedRef.current) finishInterview()
      }, 3000)
    }
  }

  // Speak the interviewer's current turn when it changes.
  // We split into two sequential utterances:
  //   1. Acknowledgment / lead-in (if present)
  //   2. The question itself
  // This guarantees the question is always spoken even if the acknowledgment
  // causes the browser TTS engine to silently drop the tail of a long string.
  useEffect(() => {
    if (currentTurn && avStream && !completionStartedRef.current) {
      const fullText = currentTurn.interviewer_text
      const questionText = currentTurn.question_text || fullText
      const acknowledgment = extractLeadIn(fullText, questionText)

      const turnId = `${currentTurn.turn_type}-${fullText.slice(0, 40)}-${Date.now()}`
      turnIdRef.current = turnId
      isAiSpeakingRef.current = true
      setIsAiSpeaking(true)

      const speakQuestion = () => {
        if (turnIdRef.current !== turnId) return
        setSpeakingPhase('question')
        setCurrentlySpeakingText(questionText)
        speak(questionText, () => {
          if (turnIdRef.current === turnId) {
            onSpeakCompleteRef.current?.()
          }
        })
      }

      if (acknowledgment) {
        // Phase 1: speak acknowledgment
        setSpeakingPhase('acknowledgment')
        setCurrentlySpeakingText(acknowledgment)
        speak(acknowledgment, () => {
          // After acknowledgment finishes, speak the question
          if (turnIdRef.current === turnId) {
            // Small pause between acknowledgment and question
            setTimeout(speakQuestion, 400)
          }
        })
      } else {
        // No acknowledgment — go straight to question
        speakQuestion()
      }
    }
    return () => {
      cancel()
      // Only clear speaking state if a new turn is incoming (not on unmount)
    }
  }, [currentTurn, avStream, cancel, speak])

  // ── Build chat message history ─────────────────────────────────────────
  // When a new turn arrives, push an Alex bubble; when TTS ends, mark it done.
  useEffect(() => {
    if (!currentTurn || !avStream) return
    const questionText = currentTurn.question_text || currentTurn.interviewer_text
    const bubbleId = `alex-${currentTurn.turn_type}-${Date.now()}`
    currentAlexBubbleIdRef.current = bubbleId

    const newMsg: ChatMessage = {
      id: bubbleId,
      role: 'alex',
      text: questionText,
      phase: currentTurn.turn_type === 'closing' ? 'closing' : 'question',
      questionType: (currentTurn.question_type as ChatMessage['questionType']) || 'technical',
      isFollowUp: currentTurn.turn_type === 'follow_up',
      status: 'speaking',
      timestamp: Date.now(),
    }
    setChatMessages(prev => [...prev, newMsg])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTurn?.interviewer_text, avStream])

  // Auto-scroll chat to bottom on every new message
  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight
    }
  }, [chatMessages])

  // Update onSpeakCompleteRef to also mark the current Alex bubble as done
  onSpeakCompleteRef.current = () => {
    isAiSpeakingRef.current = false
    setIsAiSpeaking(false)
    setCurrentlySpeakingText('')
    setSpeakingPhase(null)
    // Mark the bubble done
    const bid = currentAlexBubbleIdRef.current
    if (bid) {
      setChatMessages(prev => prev.map(m => m.id === bid ? { ...m, status: 'done' } : m))
    }
    if (currentTurn?.turn_type === 'closing' && !completionStartedRef.current) {
      setTimeout(() => {
        if (!completionStartedRef.current) finishInterview()
      }, 3000)
    }
  }

  useEffect(() => {
    if (globalTimer.isExpired && session?.status !== 'completed' && !completionStartedRef.current) {
      speak("Your time has expired. We are wrapping up the interview now. Thank you for your time.", () => {
        finishInterview()
      })
    }
  }, [globalTimer.isExpired, session?.status, speak, finishInterview])

  const endEarlyRef = useRef(endEarly)
  endEarlyRef.current = endEarly
  useEffect(() => {
    if (!endEarly || completionStartedRef.current) return
    const timer = setTimeout(() => {
      if (endEarlyRef.current && !completionStartedRef.current) {
        finishInterview()
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [endEarly, finishInterview])

  const handleAnswerComplete = useCallback(async (text: string, audioBlob?: Blob) => {
    if (!currentQuestionId) {
      setAnswerState('error')
      setLastError('The active question was not ready. Please wait for the interviewer to repeat it.')
      return
    }

    // Append candidate bubble to chat immediately
    const candidateBubble: ChatMessage = {
      id: `candidate-${Date.now()}`,
      role: 'candidate',
      text: text || 'Candidate responded via voice.',
      answerStatus: 'submitted',
      timestamp: Date.now(),
    }
    setChatMessages(prev => [...prev, candidateBubble])

    setAnswerState('saving')
    setLastError('')

    try {
      const qId = currentQuestionId
      const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : undefined
      await submitAnswer(qId, text, audioUrl)
      setAnswerState('saved')

      if (endEarly || currentTurn?.turn_type === 'closing') {
        setEndEarly(false)
        setTimeout(() => finishInterview(), 1500)
        return
      }

      // Yield to the event loop before generating the next turn.
      // React 18 automatic batching keeps all state updates in a single
      // continuous async chain batched into one paint.  submitAnswer sets
      // setLiveAssessmentNotes (the feedback note) and generateNextTurn sets
      // setCurrentQuestionId / setCurrentTurn (the next question).  Without
      // this yield both land in the same render, so the candidate never sees
      // the feedback note *before* the next question appears.  Scheduling
      // generateNextTurn as a new macrotask lets React flush the note first.
      await new Promise<void>(resolve => setTimeout(resolve, 0))

      // Generate the next conversational turn
      await generateNextTurn()
      setAnswerState('idle')
    } catch (err) {
      setAnswerState('error')
      setLastError((err as Error).message || 'Unable to save this answer')
    }
  }, [currentQuestionId, currentTurn, submitAnswer, generateNextTurn, endEarly, finishInterview])



  if (loading || !session) {
    if (!loading && !session) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-md text-center">
            <AlertCircle size={40} className="mx-auto mb-4" style={{ color: 'var(--red)' }} />
            <p className="font-medium text-lg mb-2" style={{ color: 'var(--label-primary)' }}>Session Not Found</p>
            <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>{loadError || 'Unable to load your interview session. Please check your invite link or contact the recruiter.'}</p>
          </div>
        </div>
      )
    }
    return <LoadingSpinner text="Loading interview room parameters..." />
  }

  if (completing || session.status === 'completed') {
    if (!completing && session.status === 'completed') {
      return <Completion />
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 mx-auto mb-6 relative">
            <div className="absolute inset-0 rounded-full opacity-20 animate-ping" style={{ background: 'var(--blue)' }} />
            <div className="relative w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'var(--blue)' }}>
              <Upload size={32} className="text-white" />
            </div>
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--label-primary)' }}>Completing Your Interview</h2>
          <p className="text-sm mb-6 max-w-sm mx-auto" style={{ color: 'var(--label-secondary)' }}>
            Please wait while we securely save your responses and finalize the recording.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm mt-4" style={{ color: 'var(--blue)' }}>
            <Loader2 size={18} className="animate-spin" />
            <span>Processing...</span>
          </div>
          {completingError && (
            <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)' }}>
              <AlertCircle size={14} className="shrink-0" style={{ color: 'var(--red)' }} />
              <p className="text-sm" style={{ color: 'var(--red)' }}>{completingError}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!avStream) {
    return (
      <div className="space-y-4">
        {startError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl animate-fade-in max-w-lg"
            style={{ background: 'color-mix(in srgb, var(--red) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)' }}>
            <AlertCircle size={16} className="shrink-0" style={{ color: 'var(--red)' }} />
            <p className="text-sm" style={{ color: 'var(--red)' }}>{startError}</p>
          </div>
        )}
        <PreCheck
          key={String(startError)}
          onComplete={handleStart}
          session={session}
        />
      </div>
    )
  }

  const timerColor = globalTimer.isExpired ? 'var(--red)' : globalTimer.isWarning ? 'var(--orange)' : 'var(--label-secondary)'

  // Progress bar: track only PRIMARY questions (excludes follow-ups and intro)
  // so that follow-up questions don't cause the bar to jump backward or stall.
  const primaryQuestions = questions.filter(
    q => q.source !== 'llm_ts_followup' &&
         q.source !== 'llm_ts_dynamic_intro' &&
         q.source !== 'hr_reviewed_intro'
  )
  const progressTarget = Math.max(
    primaryQuestions.length > 0 ? primaryQuestions.length : DEFAULT_TARGET_QUESTIONS,
    1
  )

  // Find which primary question we're currently on (or just answered)
  const currentQuestion = questions.find(q => q.id === currentQuestionId)
  const isCurrentFollowUp = currentQuestion?.source === 'llm_ts_followup'
  // The primary question index for progress = how many primary questions have been reached
  const primaryQuestionsAnsweredOrActive = questions.filter(
    (q, idx) => (
      q.source !== 'llm_ts_followup' &&
      q.source !== 'llm_ts_dynamic_intro' &&
      q.source !== 'hr_reviewed_intro'
    ) && idx <= currentQuestionIndex
  ).length
  // 0-based index into the primary question bar
  const primaryBarIndex = Math.max(0, primaryQuestionsAnsweredOrActive - 1)

  const isClosingTurn = currentTurn?.turn_type === 'closing'

  return (
    <div className="min-h-screen flex flex-col" style={{ height: '100dvh', overflow: 'hidden' }}>
      {session && <ProctoringOverlay violations={violations} sessionId={session.id} />}

      {/* ─── Header ──────────────────────────────────────────────── */}
      <header style={{ borderBottom: '1px solid var(--separator)', background: 'rgba(28,28,30,0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }} className="sticky top-0 z-30 shrink-0">
        <div className="px-4 sm:px-5 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--blue)' }}>
                <Monitor size={16} className="text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold" style={{ color: 'var(--label-primary)' }}>AI Interview</h1>
                <p className="text-[10px]" style={{ color: 'var(--label-tertiary)' }}>{session.candidates_ai_interview?.name || 'Candidate'}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-sm font-mono font-bold" style={{ color: timerColor }}>
                <Clock size={14} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{globalTimer.formatted}</span>
                {globalTimer.isWarning && !globalTimer.isExpired && (
                  <span className="text-[10px] font-normal ml-1" style={{ color: 'color-mix(in srgb, var(--orange) 70%, transparent)' }}>Warning</span>
                )}
              </div>

              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-medium badge-red">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--red)' }} />
                <span className="font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}</span>
              </div>
              {recordingError && (
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--red)' }}>
                  <AlertCircle size={12} />
                  {recordingError}
                </div>
              )}
            </div>
          </div>


          {/* Progress bar */}
          <div>
            <div className="flex items-center gap-1">
              {Array.from({ length: progressTarget }).map((_, i) => {
                const isActive = i === primaryBarIndex && !isClosingTurn
                const isDone = i < primaryBarIndex || isClosingTurn
                return (
                  <div key={i} className="flex items-center gap-1 flex-1">
                    <div className="w-full h-1 rounded-full transition-all duration-500" style={{
                      background: isActive ? 'var(--blue)' : isDone ? 'var(--green)' : 'var(--fill-tertiary)',
                    }} />
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-center gap-2 mt-1">
              <p className="text-[10px]" style={{ color: 'var(--label-tertiary)' }}>
                Question {Math.min(primaryBarIndex + 1, progressTarget)} of {progressTarget}
              </p>
              {isCurrentFollowUp && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider" style={{
                  background: 'color-mix(in srgb, var(--purple) 15%, transparent)',
                  color: 'var(--purple)',
                  border: '1px solid color-mix(in srgb, var(--purple) 25%, transparent)'
                }}>
                  Follow-up
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Main chat layout ─────────────────────────────────────── */}
      <div className="interview-chat-layout flex-1">

        {/* Chat column */}
        <div className="chat-column">
          {/* Scrollable chat feed */}
          <div className="chat-feed" ref={chatFeedRef}>
            {chatMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 py-12 opacity-40">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--fill-quaternary)' }}>
                  <Monitor size={20} style={{ color: 'var(--label-tertiary)' }} />
                </div>
                <p className="text-sm" style={{ color: 'var(--label-tertiary)' }}>Interview starting…</p>
              </div>
            )}

            {chatMessages.map(msg => (
              <ChatBubble key={msg.id} message={msg} />
            ))}

            {/* Typing indicator while generating next question */}
            {isGeneratingTurn && <TypingBubble />}

            {/* Timer expired notice */}
            {globalTimer.isExpired && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl animate-fade-in self-center" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)' }}>
                <AlertCircle size={16} className="shrink-0" style={{ color: 'var(--red)' }} />
                <p className="text-sm" style={{ color: 'var(--red)' }}>Time's up! The interview is ending.</p>
              </div>
            )}

            {/* Save state feedback inside chat */}
            {(answerState === 'saving' || answerState === 'saved' || answerState === 'error') && (
              <div className="flex justify-center animate-fade-in">
                <div className="text-xs px-3 py-1.5 rounded-full" style={{
                  background: answerState === 'error' ? 'color-mix(in srgb, var(--red) 12%, transparent)' : 'var(--fill-quaternary)',
                  border: '1px solid var(--separator)',
                  color: answerState === 'saving' ? 'var(--blue)' : answerState === 'saved' ? 'var(--green)' : 'var(--red)'
                }}>
                  {answerState === 'saving' && (
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={11} className="animate-spin" /> Saving response…
                    </span>
                  )}
                  {answerState === 'saved' && (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle size={11} /> Response saved
                    </span>
                  )}
                  {answerState === 'error' && (
                    <span className="flex items-center gap-1.5">
                      <AlertCircle size={11} /> {lastError}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Closing message */}
            {isClosingTurn && !isAiSpeaking && (
              <div className="flex flex-col items-center gap-2 py-6 animate-fade-in">
                <CheckCircle size={32} style={{ color: 'var(--green)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--label-secondary)' }}>
                  Thank you! Your responses have been recorded.
                </p>
              </div>
            )}
          </div>

          {/* ── Fixed bottom input bar ────────────────────────────── */}
          <ChatInputBar
            recorderState={recorderState}
            isAiSpeaking={isAiSpeaking}
            isGeneratingTurn={isGeneratingTurn}
            isAnalyzingAnswer={isAnalyzingAnswer}
            onManualSubmit={() => stopAndSubmitRef.current?.()}
            canvasRef={waveformCanvasRef}
          />

          {/* Hidden AnswerRecorder — all logic runs here, UI is suppressed */}
          {currentTurn && !isClosingTurn && (
            <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden>
              <AnswerRecorder
                key={currentQuestionId}
                onAnswerComplete={handleAnswerComplete}
                onStateChange={setRecorderState}
                externalCanvasRef={waveformCanvasRef}
                isAiSpeaking={isAiSpeaking}
                expired={globalTimer.isExpired}
                endEarly={endEarly}
                audioStream={audioStream}
              />
            </div>
          )}
        </div>

        {/* ─── Right sidebar ────────────────────────────────────── */}
        <aside className="interview-sidebar">
          <RecruiterPersona
            isAiSpeaking={isAiSpeaking}
            isAnalyzingAnswer={isAnalyzingAnswer}
            isGeneratingTurn={isGeneratingTurn}
            liveAssessmentNotes={liveAssessmentNotes}
            currentQuestionIndex={currentQuestionIndex}
            currentQuestionId={currentQuestionId || ''}
            speakingPhase={speakingPhase}
          />

          <div
            className="rounded-2xl p-3 space-y-3"
            style={{
              background: 'rgba(28,28,30,0.6)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.07)'
            }}
          >
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold" style={{ color: 'var(--label-secondary)' }}>
                Your Video Feed
              </span>
              {screenStream && (
                <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--fill-tertiary)' }}>
                  <button
                    onClick={() => setActiveVideoTab('camera')}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                      activeVideoTab === 'camera'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Camera
                  </button>
                  <button
                    onClick={() => setActiveVideoTab('screen')}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                      activeVideoTab === 'screen'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Screen
                  </button>
                </div>
              )}
            </div>

            {activeVideoTab === 'camera' || !screenStream ? (
              <VideoFeed stream={avStream} muted label="Camera" className="aspect-video rounded-xl overflow-hidden shadow-inner" />
            ) : (
              <VideoFeed stream={screenStream} muted mirrored={false} label="Screen" className="aspect-video rounded-xl overflow-hidden shadow-inner" />
            )}
          </div>

          {!showEndConfirm ? (
            <button
              onClick={() => setShowEndConfirm(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                color: 'var(--red)',
                background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 25%, transparent)'
              }}
            >
              <PhoneOff size={14} />
              <span>End Interview</span>
            </button>
          ) : (
            <div
              className="w-full p-3.5 rounded-xl flex flex-col gap-2.5 animate-fade-in text-center"
              style={{
                background: 'color-mix(in srgb, var(--red) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)'
              }}
            >
              <div className="flex items-center justify-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--red)' }}>
                <PhoneOff size={14} />
                <span>End interview early?</span>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--label-secondary)' }}>
                Are you sure you want to end the session now?
              </p>
              <div className="flex items-center justify-center gap-2 pt-0.5">
                <button
                  onClick={() => { setShowEndConfirm(false); setEndEarly(true) }}
                  className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white transition-all shadow-sm active:scale-95"
                  style={{ background: 'var(--red)' }}
                >
                  Yes, End
                </button>
                <button
                  onClick={() => setShowEndConfirm(false)}
                  className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all active:scale-95"
                  style={{ color: 'var(--label-primary)', background: 'var(--fill-tertiary)', border: '1px solid var(--separator)' }}
                >
                  No
                </button>
              </div>
            </div>
          )}
        </aside>

      </div>
    </div>
  )
}

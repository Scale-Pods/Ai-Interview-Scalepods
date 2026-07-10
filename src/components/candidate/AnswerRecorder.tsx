import { useState, useRef, useEffect, useCallback } from 'react'
import { getAudioStream } from '@/utils/mediaHelpers'

const SILENCE_TIMEOUT_MS = 4000
const COUNTDOWN_TENTHS = Math.floor(SILENCE_TIMEOUT_MS / 100)

interface AnswerRecorderProps {
  onAnswerComplete: (text: string, audioBlob?: Blob) => void
  isAiSpeaking: boolean
  expired?: boolean
  endEarly?: boolean
  audioStream?: MediaStream | null
}

export function AnswerRecorder({ onAnswerComplete, isAiSpeaking, expired, endEarly, audioStream }: AnswerRecorderProps) {
  const [duration, setDuration] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [silenceCountdown, setSilenceCountdown] = useState(COUNTDOWN_TENTHS)

  const isRecordingRef = useRef(false)
  const transcriptRef = useRef('')
  const audioBlobRef = useRef<Blob | null>(null)
  const submittedRef = useRef(false)
  const shouldSubmitRef = useRef(false)
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const generationRef = useRef(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recognitionRef = useRef<any>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)

  const clearCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
    setSilenceCountdown(COUNTDOWN_TENTHS)
  }, [])

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    analyser.getByteTimeDomainData(dataArray)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(44, 44, 46, 0.3)'
    ctx.fillRect(0, 0, w, h)
    ctx.lineWidth = 2
    ctx.strokeStyle = 'var(--blue)'
    ctx.beginPath()
    const sliceWidth = w / bufferLength
    let x = 0
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0
      const y = (v * h) / 2
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
      x += sliceWidth
    }
    ctx.stroke()
    rafRef.current = requestAnimationFrame(drawWaveform)
  }, [])

  const doSubmit = useCallback((text: string, blob?: Blob) => {
    if (submittedRef.current) return
    submittedRef.current = true

    onAnswerComplete(text || 'Candidate responded via voice.', blob)
    
    // Reset state for next question
    setTranscript('')
    transcriptRef.current = ''
    setDuration(0)
    audioBlobRef.current = null
  }, [onAnswerComplete])

  const stopAndSubmit = useCallback(() => {
    if (!isRecordingRef.current) return
    shouldSubmitRef.current = true

    clearCountdown()

    isRecordingRef.current = false

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null

    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    recognitionRef.current = null

    if (intervalRef.current) clearInterval(intervalRef.current)
    cancelAnimationFrame(rafRef.current)
  }, [clearCountdown])

  const stopRecordingSilently = useCallback(() => {
    shouldSubmitRef.current = false
    clearCountdown()
    isRecordingRef.current = false
    setTranscript('')
    transcriptRef.current = ''
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    recognitionRef.current = null
    if (intervalRef.current) clearInterval(intervalRef.current)
    cancelAnimationFrame(rafRef.current)
  }, [clearCountdown])

  const startCountdown = useCallback(() => {
    clearCountdown()
    if (!isRecordingRef.current) return
    silenceTimeoutRef.current = setTimeout(() => {
      if (transcriptRef.current.trim().length > 0) {
        stopAndSubmit()
      }
    }, SILENCE_TIMEOUT_MS)
    countdownIntervalRef.current = setInterval(() => {
      setSilenceCountdown(prev => {
        if (prev <= 0) return 0
        return prev - 1
      })
    }, 100)
  }, [clearCountdown, stopAndSubmit])

  const startRecording = async () => {
    if (isRecordingRef.current) return
    
    // Only start if the interview isn't already submitted
    if (submittedRef.current) return

    const gen = ++generationRef.current

    shouldSubmitRef.current = false
    // Defensively clear any leftover state from previous recordings
    clearCountdown()
    setTranscript('')
    transcriptRef.current = ''
    audioBlobRef.current = null
    try {
      const stream = audioStream || await getAudioStream()
      if (!stream) {
        console.warn('No audio stream available — submitting placeholder answer')
        doSubmit('Candidate was unable to provide audio response (no microphone).', undefined)
        return
      }

      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        // Ignore stale handler from a previous generation
        if (gen !== generationRef.current) return

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        audioBlobRef.current = blob
        audioCtx.close()
        analyserRef.current = null
        cancelAnimationFrame(rafRef.current)

        if (shouldSubmitRef.current) {
          shouldSubmitRef.current = false
          doSubmit(transcriptRef.current, blob)
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      isRecordingRef.current = true
      setDuration(0)

      setTimeout(() => {
        drawWaveform()
      }, 50)

      intervalRef.current = setInterval(() => setDuration(prev => prev + 1), 1000)

      const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognitionAPI) {
        const recognition = new SpeechRecognitionAPI()
        recognition.continuous = true
        recognition.interimResults = true

        recognition.onresult = (event: any) => {
          // Ignore stale handler from a previous generation
          if (gen !== generationRef.current) return

          let final = ''
          for (let i = 0; i < event.results.length; i++) {
            final += event.results[i][0].transcript
          }
          
          setTranscript(final)
          transcriptRef.current = final

          // Voice Activity / Silence detection: Reset countdown every time speech is detected
          if (final.trim().length > 0) {
            startCountdown()
          } else {
            clearCountdown()
          }
        }

        recognition.onend = () => {
          // Ignore stale handler from a previous generation
          if (gen !== generationRef.current) return

          // If the recognition stopped but we are still recording, and have transcript, submit!
          if (isRecordingRef.current) {
            if (transcriptRef.current.trim().length > 0) {
              stopAndSubmit()
            } else {
              // Restart if empty transcript to keep listening
              try {
                recognition.start()
              } catch {}
            }
          }
        }

        recognition.start()
        recognitionRef.current = recognition
      }
    } catch (err) {
      console.error('Failed to start recording stream:', err)
    }
  }

  // Effect: Auto trigger start/stop based on AI speaking status
  useEffect(() => {
    if (!isAiSpeaking) {
      startRecording()
    } else {
      stopRecordingSilently()
    }
  }, [isAiSpeaking])

  // Effect: Auto-submit on global timer expiry
  useEffect(() => {
    if (expired && isRecordingRef.current) {
      stopAndSubmit()
    }
  }, [expired, stopAndSubmit])

  // Effect: Submit and end interview early
  useEffect(() => {
    if (endEarly && isRecordingRef.current) {
      stopAndSubmit()
    }
  }, [endEarly, stopAndSubmit])

  // Reset submitted flag whenever the parent component resets or updates callbacks
  useEffect(() => {
    submittedRef.current = false
  }, [onAnswerComplete])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Bump generation so pending stale handlers see a mismatch and bail
      generationRef.current += 1
      shouldSubmitRef.current = false
      isRecordingRef.current = false
      clearCountdown()
      mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      recognitionRef.current?.stop()
      recognitionRef.current = null
      if (intervalRef.current) clearInterval(intervalRef.current)
      cancelAnimationFrame(rafRef.current)
    }
  }, [clearCountdown])

  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60

  return (
    <div className="w-full space-y-4 animate-fade-in">
      <div className="card p-5 space-y-4 min-h-[140px]">
        {isAiSpeaking ? (
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <div className="flex items-center gap-1.5 h-8">
              <span className="w-1.5 h-4 rounded-full animate-bounce" style={{ background: 'var(--blue)', animationDelay: '0ms' }} />
              <span className="w-1.5 h-7 rounded-full animate-bounce" style={{ background: 'var(--blue)', animationDelay: '150ms' }} />
              <span className="w-1.5 h-3 rounded-full animate-bounce" style={{ background: 'var(--blue)', animationDelay: '300ms' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--label-secondary)' }}>AI is speaking... Please listen carefully.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full animate-ping" style={{ background: 'var(--green)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--green)' }}>Listening</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <svg width="16" height="16" viewBox="0 0 16 16" className="transform -rotate-90">
                    <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--fill-tertiary)" strokeWidth="2" />
                    <circle
                      cx="8" cy="8" r="6.5" fill="none"
                      stroke={silenceCountdown < 5 ? 'var(--red)' : silenceCountdown < 12 ? 'var(--orange)' : 'var(--blue)'}
                      strokeWidth="2"
                      strokeDasharray={`${(silenceCountdown / COUNTDOWN_TENTHS) * 40.84} 40.84`}
                      strokeLinecap="round"
                      className="transition-all duration-100"
                    />
                  </svg>
                  <span className="text-[10px] font-mono font-bold"
                    style={{ color: silenceCountdown < 5 ? 'var(--red)' : silenceCountdown < 12 ? 'var(--orange)' : 'var(--label-secondary)' }}>
                    {(silenceCountdown / 10).toFixed(1)}s
                  </span>
                </div>
                <span className="text-xs font-mono font-bold" style={{ color: 'var(--label-secondary)' }}>
                  {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
                </span>
              </div>
            </div>

            <canvas
              ref={canvasRef}
              width={600}
              height={60}
              className="w-full h-14 rounded-lg"
              style={{ background: 'var(--fill-quaternary)' }}
            />

            <div className="rounded-xl p-4 min-h-[50px]" style={{ background: 'var(--fill-quaternary)' }}>
              {transcript ? (
                <p className="text-sm leading-relaxed font-medium" style={{ color: 'var(--label-primary)' }}>{transcript}</p>
              ) : (
                <p className="text-sm italic" style={{ color: 'var(--label-tertiary)' }}>Speak your response now...</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px]" style={{ color: 'var(--label-tertiary)' }}>
                Auto-submits after {(SILENCE_TIMEOUT_MS / 1000).toFixed(0)}s of silence
              </p>
              <button
                onClick={stopAndSubmit}
                disabled={!transcript.trim()}
                className="px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 disabled:cursor-not-allowed"
                style={{
                  background: transcript.trim() ? 'var(--blue)' : 'var(--fill-tertiary)',
                  color: transcript.trim() ? 'white' : 'var(--label-tertiary)'
                }}
              >
                Submit Answer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

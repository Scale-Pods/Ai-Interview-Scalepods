import { useState, useRef, useEffect, useCallback } from 'react'
import type React from 'react'

import { getAudioStream } from '@/utils/mediaHelpers'
import { normalizeTechnicalSpeech } from '@/utils/speechNormalizer'
import { DeepgramSTT } from '@/utils/deepgram'

const SILENCE_TIMEOUT_MS = 4000
const COUNTDOWN_TENTHS = Math.floor(SILENCE_TIMEOUT_MS / 100)
const THINKING_TIMEOUT_MS = 25000 // 25 seconds max preparation / thinking limit
const THINKING_TENTHS = Math.floor(THINKING_TIMEOUT_MS / 100)
const VOICE_ACTIVITY_THRESHOLD = 2.5

export interface AnswerRecorderState {
  transcript: string
  isThinking: boolean
  silenceCountdown: number
  countdownTenths: number
  thinkingCountdown: number
  thinkingCountdownTenths: number
  isRecording: boolean
}

interface AnswerRecorderProps {
  onAnswerComplete: (text: string, audioBlob?: Blob) => void
  onStateChange?: (state: AnswerRecorderState) => void
  /** If provided, AnswerRecorder draws the waveform onto this external canvas (used by ChatInputBar) */
  externalCanvasRef?: React.RefObject<HTMLCanvasElement | null>
  isAiSpeaking: boolean
  expired?: boolean
  endEarly?: boolean
  audioStream?: MediaStream | null
  stopAndSubmitRef?: React.MutableRefObject<(() => void) | null>
}

export function AnswerRecorder({ onAnswerComplete, onStateChange, externalCanvasRef, isAiSpeaking, expired, endEarly, audioStream, stopAndSubmitRef }: AnswerRecorderProps) {
  const [duration, setDuration] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [silenceCountdown, setSilenceCountdown] = useState(COUNTDOWN_TENTHS)
  const [thinkingCountdown, setThinkingCountdown] = useState(THINKING_TENTHS)
  const [isThinking, setIsThinking] = useState(false)
  const [sttProvider, setSttProvider] = useState<'deepgram' | 'webspeech' | 'none'>('none')

  const isRecordingRef = useRef(false)
  const transcriptRef = useRef('')
  const audioBlobRef = useRef<Blob | null>(null)
  const submittedRef = useRef(false)
  const shouldSubmitRef = useRef(false)
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const thinkingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isThinkingRef = useRef(false)
  const generationRef = useRef(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recognitionRef = useRef<any>(null)
  const deepgramRef = useRef<DeepgramSTT | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)
  const audioActivityIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isVoiceActiveRef = useRef(false)
  const isCountdownActiveRef = useRef(false)

  const clearAudioActivityMonitor = useCallback(() => {
    if (audioActivityIntervalRef.current) {
      clearInterval(audioActivityIntervalRef.current)
      audioActivityIntervalRef.current = null
    }
    isVoiceActiveRef.current = false
  }, [])

  const clearThinkingTimer = useCallback(() => {
    if (thinkingTimeoutRef.current) {
      clearTimeout(thinkingTimeoutRef.current)
      thinkingTimeoutRef.current = null
    }
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current)
      thinkingIntervalRef.current = null
    }
    isThinkingRef.current = false
    setIsThinking(false)
    setThinkingCountdown(THINKING_TENTHS)
  }, [])

  const clearCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
    isCountdownActiveRef.current = false
    setSilenceCountdown(COUNTDOWN_TENTHS)
  }, [])

  const drawWaveform = useCallback(() => {
    const canvas = externalCanvasRef?.current ?? canvasRef.current
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
  // externalCanvasRef intentionally omitted — it's a stable ref object
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const stopSTTEngines = useCallback(() => {
    if (deepgramRef.current) {
      deepgramRef.current.stop()
      deepgramRef.current = null
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {}
      recognitionRef.current = null
    }
  }, [])

  const stopAndSubmit = useCallback(() => {
    if (submittedRef.current) return
    shouldSubmitRef.current = true

    clearThinkingTimer()
    clearCountdown()
    isRecordingRef.current = false

    if (!transcriptRef.current.trim()) {
      transcriptRef.current = 'Candidate submitted response.'
      setTranscript(transcriptRef.current)
    }

    const activeRecorder = mediaRecorderRef.current
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      mediaRecorderRef.current = null
      activeRecorder.stop()
    } else {
      mediaRecorderRef.current = null
      shouldSubmitRef.current = false
      doSubmit(transcriptRef.current, audioBlobRef.current || undefined)
    }

    stopSTTEngines()

    if (intervalRef.current) clearInterval(intervalRef.current)
    clearAudioActivityMonitor()
    cancelAnimationFrame(rafRef.current)
  }, [clearAudioActivityMonitor, clearCountdown, clearThinkingTimer, doSubmit, stopSTTEngines])

  useEffect(() => {
    if (stopAndSubmitRef) {
      stopAndSubmitRef.current = stopAndSubmit
    }
    return () => {
      if (stopAndSubmitRef) {
        stopAndSubmitRef.current = null
      }
    }
  }, [stopAndSubmitRef, stopAndSubmit])

  const stopRecordingSilently = useCallback(() => {
    shouldSubmitRef.current = false
    clearThinkingTimer()
    clearCountdown()
    isRecordingRef.current = false
    setTranscript('')
    transcriptRef.current = ''
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null

    stopSTTEngines()

    if (intervalRef.current) clearInterval(intervalRef.current)
    clearAudioActivityMonitor()
    cancelAnimationFrame(rafRef.current)
  }, [clearAudioActivityMonitor, clearCountdown, clearThinkingTimer, stopSTTEngines])

  const startThinkingTimer = useCallback(() => {
    clearThinkingTimer()
    if (!isRecordingRef.current) return

    isThinkingRef.current = true
    setIsThinking(true)
    setThinkingCountdown(THINKING_TENTHS)

    thinkingTimeoutRef.current = setTimeout(() => {
      if (isThinkingRef.current && isRecordingRef.current) {
        console.warn('Thinking time expired (25s) — auto submitting question')
        clearThinkingTimer()
        if (!transcriptRef.current.trim()) {
          transcriptRef.current = 'No response provided within the 25-second thinking limit.'
          setTranscript(transcriptRef.current)
        }
        stopAndSubmit()
      }
    }, THINKING_TIMEOUT_MS)

    thinkingIntervalRef.current = setInterval(() => {
      setThinkingCountdown(prev => {
        if (prev <= 1) return 0
        return prev - 1
      })
    }, 100)
  }, [clearThinkingTimer, stopAndSubmit])

  const startCountdown = useCallback(() => {
    // If candidate starts speaking or countdown begins, cancel thinking timer
    if (isThinkingRef.current) {
      clearThinkingTimer()
    }

    // If countdown is already active, do NOT reset or restart it
    if (isCountdownActiveRef.current) return
    if (!isRecordingRef.current) return
    if (transcriptRef.current.trim().length === 0) return

    isCountdownActiveRef.current = true
    setSilenceCountdown(COUNTDOWN_TENTHS)

    silenceTimeoutRef.current = setTimeout(() => {
      if (transcriptRef.current.trim().length > 0) {
        stopAndSubmit()
      }
    }, SILENCE_TIMEOUT_MS)

    countdownIntervalRef.current = setInterval(() => {
      setSilenceCountdown(prev => {
        if (prev <= 1) return 0
        return prev - 1
      })
    }, 100)
  }, [clearThinkingTimer, stopAndSubmit])

  const startWebSpeechFallback = useCallback((gen: number) => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SpeechRecognitionAPI) {
      setSttProvider('webspeech')
      const recognition = new SpeechRecognitionAPI()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = navigator.language || 'en-US'

      recognition.onresult = (event: any) => {
        if (gen !== generationRef.current) return

        let final = ''
        for (let i = 0; i < event.results.length; i++) {
          final += event.results[i][0].transcript
        }
        
        const normalized = normalizeTechnicalSpeech(final)
        const prevTranscript = transcriptRef.current
        setTranscript(normalized)
        transcriptRef.current = normalized

        if (final.trim().length > 0 && isThinkingRef.current) {
          clearThinkingTimer()
        }

        // New words arriving = candidate is actively speaking → always reset the countdown
        const newWordsAdded = normalized.trim().length > prevTranscript.trim().length
        if (isVoiceActiveRef.current || newWordsAdded) {
          clearCountdown()
        } else if (final.trim().length > 0) {
          startCountdown()
        }
      }

      recognition.onend = () => {
        if (gen !== generationRef.current) return
        if (isRecordingRef.current) {
          try {
            recognition.start()
          } catch {}
        }
      }

      recognition.start()
      recognitionRef.current = recognition
    } else {
      setSttProvider('none')
    }
  }, [clearCountdown, clearThinkingTimer, startCountdown])

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return
    
    submittedRef.current = false

    const gen = ++generationRef.current

    shouldSubmitRef.current = false
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

      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      const audioCtx = new AudioCtxClass()
      if (audioCtx.state === 'suspended') {
        void audioCtx.resume().catch(() => {})
      }
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {})
      }

      const source = audioCtx.createMediaStreamSource(stream)
      
      // Highpass Filter at 85Hz: Cuts out ambient low-frequency rumble, AC/fan hum, traffic, and desk bumps
      const highpassFilter = audioCtx.createBiquadFilter()
      highpassFilter.type = 'highpass'
      highpassFilter.frequency.setValueAtTime(85, audioCtx.currentTime)
      highpassFilter.Q.setValueAtTime(0.7, audioCtx.currentTime)

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      
      source.connect(highpassFilter)
      highpassFilter.connect(analyser)
      analyserRef.current = analyser

      const freqData = new Uint8Array(analyser.frequencyBinCount)
      let ambientNoiseFloor = 0 // Calibrates to actual room mic noise baseline
      let calibrationTicks = 0
      let speechStreak = 0
      clearAudioActivityMonitor()
      
      setTimeout(() => {
        if (gen !== generationRef.current || !isRecordingRef.current) return
        audioActivityIntervalRef.current = setInterval(() => {
          analyser.getByteFrequencyData(freqData)

          // Human speech frequency band: Bins 2 to 18 (~375Hz to ~3375Hz)
          let vocalBandSum = 0
          const vocalBinsCount = 17
          for (let i = 2; i <= 18; i++) {
            vocalBandSum += freqData[i]
          }
          const vocalEnergy = vocalBandSum / vocalBinsCount

          // Startup Calibration (first 10 ticks = 1s): sample room's initial fan/AC ambient noise baseline
          if (calibrationTicks < 10) {
            calibrationTicks++
            ambientNoiseFloor = ambientNoiseFloor === 0
              ? vocalEnergy
              : Math.max(ambientNoiseFloor, vocalEnergy)
            return
          }

          // Dynamic Noise Floor Tracking
          if (vocalEnergy < ambientNoiseFloor) {
            ambientNoiseFloor = ambientNoiseFloor * 0.8 + vocalEnergy * 0.2
          } else {
            ambientNoiseFloor = ambientNoiseFloor * 0.992 + vocalEnergy * 0.008
          }

          // Voice activity detected when speech energy rises distinctly above room noise floor
          const speechThreshold = Math.max(ambientNoiseFloor * 1.6, ambientNoiseFloor + 12.0)
          const isSpeaking = vocalEnergy > speechThreshold
          isVoiceActiveRef.current = isSpeaking

          if (isSpeaking) {
            speechStreak++
            clearCountdown()
          } else {
            speechStreak = 0
            if (transcriptRef.current.trim().length > 0) {
              if (isThinkingRef.current) {
                clearThinkingTimer()
              }
              startCountdown()
            }
          }

          // Human speech confirmed: either STT produced words OR 3 consecutive speech ticks (300ms)
          const isConfirmedSpeech = speechStreak >= 3 || transcriptRef.current.trim().length > 0
          if (isConfirmedSpeech && isThinkingRef.current) {
            clearThinkingTimer()
          }
        }, 100)
      }, 300)

      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        if (gen !== generationRef.current) return

        const actualType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: actualType })
        audioBlobRef.current = blob
        clearAudioActivityMonitor()
        void audioCtx.close().catch(() => {})
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

      // Start 15-second Thinking Time Limit
      startThinkingTimer()

      setTimeout(() => {
        drawWaveform()
      }, 50)

      intervalRef.current = setInterval(() => setDuration(prev => prev + 1), 1000)

      // Start Deepgram STT if configured; fallback to Web Speech API if unconfigured or on error
      if (DeepgramSTT.isConfigured()) {
        try {
          const deepgram = new DeepgramSTT({
            onTranscript: (rawText) => {
              if (gen !== generationRef.current) return
              const normalized = normalizeTechnicalSpeech(rawText)
              const prevTranscript = transcriptRef.current
              setTranscript(normalized)
              transcriptRef.current = normalized

              if (rawText.trim().length > 0 && isThinkingRef.current) {
                clearThinkingTimer()
              }

              // New words arriving = candidate is actively speaking → always reset the countdown
              const newWordsAdded = normalized.trim().length > prevTranscript.trim().length
              if (isVoiceActiveRef.current || newWordsAdded) {
                clearCountdown()
              } else if (rawText.trim().length > 0) {
                startCountdown()
              }
            },
            onError: (err) => {
              console.warn('Deepgram WebSocket error, falling back to Web Speech API:', err)
              startWebSpeechFallback(gen)
            }
          })
          deepgramRef.current = deepgram
          await deepgram.start(stream)
          setSttProvider('deepgram')
        } catch (err) {
          console.warn('Deepgram initialization failed, falling back to Web Speech API:', err)
          startWebSpeechFallback(gen)
        }
      } else {
        startWebSpeechFallback(gen)
      }
    } catch (err) {
      console.error('Failed to start recording stream:', err)
    }
  }, [audioStream, clearAudioActivityMonitor, clearCountdown, doSubmit, drawWaveform, startCountdown, startThinkingTimer, startWebSpeechFallback])

  // Effect: Auto trigger start/stop based on AI speaking status
  useEffect(() => {
    if (!isAiSpeaking) {
      startRecording()
    } else {
      stopRecordingSilently()
    }
  }, [isAiSpeaking, startRecording, stopRecordingSilently])

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      generationRef.current += 1
      shouldSubmitRef.current = false
      isRecordingRef.current = false
      clearCountdown()
      mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      stopSTTEngines()
      if (intervalRef.current) clearInterval(intervalRef.current)
      clearAudioActivityMonitor()
      cancelAnimationFrame(rafRef.current)
    }
  }, [clearAudioActivityMonitor, clearCountdown, stopSTTEngines])

  // Auto-expand response textarea based on content length
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const newHeight = Math.max(70, Math.min(textareaRef.current.scrollHeight, 400))
      textareaRef.current.style.height = `${newHeight}px`
    }
  }, [transcript])

  // Propagate live state to parent (for ChatInputBar / chat history)
  useEffect(() => {
    onStateChange?.({
      transcript,
      isThinking,
      silenceCountdown,
      countdownTenths: COUNTDOWN_TENTHS,
      thinkingCountdown,
      thinkingCountdownTenths: THINKING_TENTHS,
      isRecording: isRecordingRef.current && !isAiSpeaking,
    })
  }, [transcript, isThinking, silenceCountdown, thinkingCountdown, isAiSpeaking, onStateChange])


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
                {isThinking ? (
                  <>
                    <span className="w-2 h-2 rounded-full animate-ping" style={{ background: 'var(--orange)' }} />
                    <span className="text-xs font-semibold" style={{ color: 'var(--orange)' }}>Thinking Time</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full animate-ping" style={{ background: 'var(--green)' }} />
                    <span className="text-xs font-semibold" style={{ color: 'var(--green)' }}>Listening</span>
                  </>
                )}
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-md flex items-center gap-1"
                  style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    color: 'var(--green)'
                  }}
                  title="Hardware & WebAudio noise suppression, echo cancellation, & highpass filter active"
                >
                  <span className="w-1 h-1 rounded-full bg-emerald-400" />
                  Noise Filtered
                </span>
                {sttProvider === 'deepgram' && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-md flex items-center gap-1.5"
                    style={{
                      background: 'rgba(147, 51, 234, 0.12)',
                      border: '1px solid rgba(147, 51, 234, 0.3)',
                      color: '#c084fc'
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    Deepgram Nova-2
                  </span>
                )}
                {sttProvider === 'webspeech' && (
                  <span className="px-2 py-0.5 text-[10px] font-medium rounded-md text-xs"
                    style={{
                      background: 'var(--fill-tertiary)',
                      border: '1px solid var(--separator)',
                      color: 'var(--label-secondary)'
                    }}>
                    Web Speech API
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {isThinking ? (
                  <div className="flex items-center gap-1.5" title="Time remaining to begin speaking or typing your response">
                    <svg width="16" height="16" viewBox="0 0 16 16" className="transform -rotate-90">
                      <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--fill-tertiary)" strokeWidth="2" />
                      <circle
                        cx="8" cy="8" r="6.5" fill="none"
                        stroke={thinkingCountdown < 30 ? 'var(--red)' : thinkingCountdown < 70 ? 'var(--orange)' : 'var(--blue)'}
                        strokeWidth="2"
                        strokeDasharray={`${(thinkingCountdown / THINKING_TENTHS) * 40.84} 40.84`}
                        strokeLinecap="round"
                        className="transition-all duration-100"
                      />
                    </svg>
                    <span className="text-[10px] font-mono font-bold"
                      style={{ color: thinkingCountdown < 30 ? 'var(--red)' : thinkingCountdown < 70 ? 'var(--orange)' : 'var(--label-secondary)' }}>
                      {(thinkingCountdown / 10).toFixed(1)}s limit
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5" title="Silence countdown before auto-submission">
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
                )}
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

            <textarea
              ref={textareaRef}
              value={transcript}
              onChange={(e) => {
                const val = e.target.value
                setTranscript(val)
                transcriptRef.current = val
                if (isThinkingRef.current) {
                  clearThinkingTimer()
                }
                if (isVoiceActiveRef.current) {
                  clearCountdown()
                } else if (val.trim().length > 0) {
                  startCountdown()
                }
              }}
              placeholder={isThinking ? "Speak your response now (you have 25s to begin speaking)..." : "Speak your response now (you can also edit or type words here)..."}
              className="w-full text-sm leading-relaxed font-medium rounded-xl p-3 min-h-[70px] max-h-[400px] overflow-y-auto transition-all duration-150 resize-none"
              style={{
                background: 'var(--fill-quaternary)',
                border: '1px solid var(--separator)',
                color: 'var(--label-primary)'
              }}
            />

            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px]" style={{ color: 'var(--label-tertiary)' }}>
                {isThinking
                  ? "Start speaking within 25s | Auto-submits after 4s of silence once spoken"
                  : `Auto-submits after ${(SILENCE_TIMEOUT_MS / 1000).toFixed(0)}s of silence`}
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

import { useState, useCallback, useEffect, useRef } from 'react'
import { supabasePublic } from '@/api/client'
import { getAudioStream } from '@/utils/mediaHelpers'
import { detectFaces, disposeFaceDetector } from '@/utils/mediapipeFaceDetector'
import { detectBehavior, disposeLandmarker } from '@/utils/mediapipeLandmarker'
import type { ProctoringEvent, ProctoringEventType, ProctoringSeverity } from '@/types'

interface ProctoringState {
  violations: ProctoringEvent[]
  isSecure: boolean
  recentEvent: ProctoringEvent | null
}

function closeAudioContext(audioContextRef: { current: AudioContext | null }) {
  const audioContext = audioContextRef.current
  // Clear the ref before closing: stop(), effect cleanup, and unmount cleanup
  // can all run for the same interview lifecycle.
  audioContextRef.current = null

  if (!audioContext || audioContext.state === 'closed') return
  void audioContext.close().catch(error => {
    if ((error as DOMException).name !== 'InvalidStateError') {
      console.warn('Failed to close audio monitoring context:', error)
    }
  })
}

export function useProctoring(sessionId: string) {
  const [state, setState] = useState<ProctoringState>({
    violations: [],
    isSecure: true,
    recentEvent: null
  })

  // Track activation state cleanly
  const [isActive, setIsActive] = useState(false)

  const audioContextRef = useRef<AudioContext | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioExternallyManaged = useRef(false)
  const activeSessionIdRef = useRef(sessionId)
  const isStoppingRef = useRef(false)
  const faceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const silentFramesRef = useRef(0)

  const faceAbsentStrikesRef = useRef(0)
  const faceMultipleStrikesRef = useRef(0)
  const gazeAwayStrikesRef = useRef(0)
  const headDownStrikesRef = useRef(0)
  const lastEmitTimesRef = useRef<Map<ProctoringEventType, number>>(new Map())
  const lastTabSwitchTimeRef = useRef(0)

  const proctoringStartTimeRef = useRef<number>(0)
  const externalAiSpeakingRef = useRef<React.MutableRefObject<boolean> | null>(null)
  const audioStartTimeRef = useRef<number>(0)

  useEffect(() => {
    activeSessionIdRef.current = sessionId
  }, [sessionId])

  const canEmit = useCallback((eventType: ProctoringEventType, cooldownMs: number): boolean => {
    const lastTime = lastEmitTimesRef.current.get(eventType) || 0
    const now = Date.now()
    if (now - lastTime < cooldownMs) {
      return false
    }
    lastEmitTimesRef.current.set(eventType, now)
    return true
  }, [])

  const pastGrace = useCallback((graceMs: number): boolean => {
    return Date.now() - proctoringStartTimeRef.current > graceMs
  }, [])

  const emitEvent = useCallback(async (
    eventType: ProctoringEventType,
    severity: ProctoringSeverity,
    payload?: Record<string, unknown>
  ) => {
    if (isStoppingRef.current) return
    const activeSessionId = activeSessionIdRef.current || sessionId
    if (!activeSessionId) {
      console.warn('[Proctoring] emitEvent called with no active sessionId — event dropped:', eventType)
      return
    }

    const event: Omit<ProctoringEvent, 'id' | 'timestamp'> = {
      session_id: activeSessionId,
      event_type: eventType,
      severity,
      payload
    }
    console.info('[Proctoring Event Triggered]:', eventType, severity, payload)
    setState(prev => ({
      ...prev,
      isSecure: severity !== 'critical',
      violations: [...prev.violations, event as ProctoringEvent],
      recentEvent: event as ProctoringEvent
    }))
    try {
      await supabasePublic
        .from('proctoring_events_ai_interview')
        .insert({
          session_id: activeSessionId,
          event_type: eventType,
          severity,
          payload
        })
    } catch (err) {
      console.warn('[Proctoring] Failed to save event to Supabase:', err)
    }
  }, [sessionId])

  const start = useCallback(async (sid?: string, audioStream?: MediaStream, aiSpeakingRef?: React.MutableRefObject<boolean>) => {
    isStoppingRef.current = false
    proctoringStartTimeRef.current = Date.now()
    if (sid) activeSessionIdRef.current = sid
    if (audioStream) {
      audioStreamRef.current = audioStream
      audioExternallyManaged.current = true
    }
    if (aiSpeakingRef) {
      externalAiSpeakingRef.current = aiSpeakingRef
    }
    setIsActive(true)
    try {
      const doc = document as any
      const fullElem = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement
      if (!fullElem) {
        const elem = doc.documentElement
        const req = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.mozRequestFullScreen || elem.msRequestFullscreen
        if (req) await req.call(elem).catch(() => {})
      }
    } catch (err) {
      console.warn("Fullscreen request failed:", err)
    }
  }, [])

  const stop = useCallback(() => {
    isStoppingRef.current = true
    setIsActive(false)
    if (faceIntervalRef.current) clearInterval(faceIntervalRef.current)
    if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current)
    
    if (!audioExternallyManaged.current) {
      audioStreamRef.current?.getTracks().forEach(track => track.stop())
    }
    closeAudioContext(audioContextRef)
    
    const doc = document as any
    const fullElem = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement
    if (fullElem) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen
      if (exit) exit.call(doc).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!isActive) return

    const handleVisibility = () => {
      if (document.hidden) {
        lastTabSwitchTimeRef.current = Date.now()
        if (canEmit('tab_switch', 3000)) {
          emitEvent('tab_switch', 'warning')
        }
      }
    }

    let blurTimer: ReturnType<typeof setTimeout> | null = null
    const handleBlur = () => {
      if (blurTimer) clearTimeout(blurTimer)
      if (document.hidden) return
      blurTimer = setTimeout(() => {
        const now = Date.now()
        if (!document.hasFocus() && !document.hidden && (now - lastTabSwitchTimeRef.current > 1000)) {
          if (canEmit('window_blur', 5000)) {
            emitEvent('window_blur', 'warning')
          }
        }
      }, 600)
    }
    const handleFocus = () => {
      if (blurTimer) clearTimeout(blurTimer)
    }
    
    let lastWidth = window.innerWidth
    const handleResize = () => {
      const change = Math.abs(window.innerWidth - lastWidth)
      if (change > 80 && canEmit('browser_resize', 5000)) {
        emitEvent('browser_resize', 'info', { from: lastWidth, to: window.innerWidth })
      }
      lastWidth = window.innerWidth
    }

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isActive && !isStoppingRef.current) {
        if (canEmit('fullscreen_exit', 5000)) {
          emitEvent('fullscreen_exit', 'warning')
        }
        document.documentElement.requestFullscreen().catch(() => {})
      }
    }

    const blockedKeys = ['F12', 'Control+R', 'Control+Shift+I', 'Control+Shift+J', 'Control+Shift+C']
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = [e.ctrlKey ? 'Control' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : '', e.metaKey ? 'Meta' : '', e.key].filter(Boolean).join('+')
      if (blockedKeys.includes(key)) {
        e.preventDefault()
        e.stopPropagation()
        if (canEmit('keyboard_shortcut', 3000)) {
          emitEvent('keyboard_shortcut', 'warning', { key })
        }
      }
    }

    const handleCopy = (e: Event) => {
      e.preventDefault()
      if (canEmit('copy_paste', 3000)) emitEvent('copy_paste', 'warning', { action: 'copy' })
    }
    const handlePaste = (e: Event) => {
      e.preventDefault()
      if (canEmit('copy_paste', 3000)) emitEvent('copy_paste', 'warning', { action: 'paste' })
    }
    const handleCut = (e: Event) => {
      e.preventDefault()
      if (canEmit('copy_paste', 3000)) emitEvent('copy_paste', 'warning', { action: 'cut' })
    }
    const handleContextMenu = (e: Event) => e.preventDefault()

    const findVideo = () => (document.getElementById('camera-feed') || document.querySelector('video')) as HTMLVideoElement | null

    faceIntervalRef.current = setInterval(async () => {
      const video = findVideo()
      if (!video || video.readyState < 2 || video.paused) return

      // Run both detectors in parallel — they share the same video frame timestamp
      const [mpCount, behavior] = await Promise.all([
        detectFaces(video),
        detectBehavior(video),
      ])

      // ── Face Absent / Multiple (BlazeFace) ──────────────────────────────
      if (mpCount !== -1) {
        if (mpCount === 0) {
          faceAbsentStrikesRef.current++
          faceMultipleStrikesRef.current = 0
          if (faceAbsentStrikesRef.current >= 2 && canEmit('face_absent', 5000)) {
            emitEvent('face_absent', 'warning', { reason: 'no_face_detected', detector: 'mediapipe' })
          }
        } else if (mpCount > 1) {
          faceMultipleStrikesRef.current++
          faceAbsentStrikesRef.current = 0
          if (faceMultipleStrikesRef.current >= 2 && canEmit('face_multiple', 5000)) {
            emitEvent('face_multiple', 'warning', { count: mpCount, detector: 'mediapipe' })
          }
        } else {
          faceAbsentStrikesRef.current = 0
          faceMultipleStrikesRef.current = 0
        }
      }

      // ── Gaze Away (FaceLandmarker) ──────────────────────────────────────
      if (behavior !== null) {
        if (behavior.gazeAway) {
          gazeAwayStrikesRef.current++
          if (gazeAwayStrikesRef.current >= 2 && canEmit('gaze_away', 5000)) {
            emitEvent('gaze_away', 'warning', {
              yawDeg: Math.round(behavior.yawDeg),
              detector: 'mediapipe-landmarker'
            })
          }
        } else {
          gazeAwayStrikesRef.current = 0
        }

        // ── Head Down (FaceLandmarker) ────────────────────────────────────
        const aiSpeaking = externalAiSpeakingRef.current?.current === true
        if (behavior.headDown && !aiSpeaking) {
          headDownStrikesRef.current++
          if (headDownStrikesRef.current >= 2 && canEmit('head_down', 5000)) {
            emitEvent('head_down', 'warning', {
              pitchDeg: Math.round(behavior.pitchDeg),
              detector: 'mediapipe-landmarker'
            })
          }
        } else {
          headDownStrikesRef.current = 0
        }
      }
    }, 1000)


    async function initAudio() {
      const stream = audioStreamRef.current || await getAudioStream()
      if (!stream) {
        console.warn("Audio monitoring not available — skipping")
        return
      }
      audioStreamRef.current = stream
      audioStartTimeRef.current = Date.now()
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
        if (!AudioCtxClass) return
        const audioContext = new AudioCtxClass()
        if (audioContext.state === 'suspended') {
          void audioContext.resume().catch(() => {})
        }
        const analyser = audioContext.createAnalyser()
        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)
        analyser.fftSize = 256
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        audioContextRef.current = audioContext

        silenceIntervalRef.current = setInterval(() => {
          if (Date.now() - audioStartTimeRef.current < 15000) return
          if (externalAiSpeakingRef.current?.current === true) {
            silentFramesRef.current = 0
            return
          }

          analyser.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength
          if (average < 4) {
            silentFramesRef.current++
            if (silentFramesRef.current >= 60) {
              if (canEmit('audio_silence', 30000)) {
                emitEvent('audio_silence', 'warning', { silentDurationSecs: silentFramesRef.current })
              }
              silentFramesRef.current = 0
            }
          } else {
            silentFramesRef.current = 0
          }
        }, 1000)
      } catch (err) {
        console.error("Audio monitoring setup failed", err)
      }
    }
    
    initAudio()

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('resize', handleResize)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('copy', handleCopy)
    document.addEventListener('paste', handlePaste)
    document.addEventListener('cut', handleCut)
    document.addEventListener('contextmenu', handleContextMenu)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('copy', handleCopy)
      document.removeEventListener('paste', handlePaste)
      document.removeEventListener('cut', handleCut)
      document.removeEventListener('contextmenu', handleContextMenu)
      
      if (faceIntervalRef.current) clearInterval(faceIntervalRef.current)
      if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current)
      if (!audioExternallyManaged.current) {
        audioStreamRef.current?.getTracks().forEach(track => track.stop())
      }
      closeAudioContext(audioContextRef)
      // Release both MediaPipe WASM models when proctoring deactivates
      disposeFaceDetector()
      disposeLandmarker()
    }
  }, [isActive, emitEvent, canEmit, pastGrace])

  useEffect(() => {
    return () => stop()
  }, [stop])

  return { ...state, start, stop, emitEvent }
}

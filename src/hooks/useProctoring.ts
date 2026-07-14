import { useState, useCallback, useEffect, useRef } from 'react'
import { supabasePublic } from '@/api/client'
import { getAudioStream } from '@/utils/mediaHelpers'
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

  useEffect(() => {
    activeSessionIdRef.current = sessionId
  }, [sessionId])

  const emitEvent = useCallback(async (
    eventType: ProctoringEventType,
    severity: ProctoringSeverity,
    payload?: Record<string, unknown>
  ) => {
    const activeSessionId = activeSessionIdRef.current || sessionId
    if (!activeSessionId) return

    const event: Omit<ProctoringEvent, 'id' | 'timestamp'> = {
      session_id: activeSessionId,
      event_type: eventType,
      severity,
      payload
    }
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
    } catch {}
  }, [sessionId])

  // Explicit activation action — accepts optional shared audio stream
  const start = useCallback(async (sid?: string, audioStream?: MediaStream) => {
    isStoppingRef.current = false
    if (sid) activeSessionIdRef.current = sid
    if (audioStream) {
      audioStreamRef.current = audioStream
      audioExternallyManaged.current = true
    }
    setIsActive(true)
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
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
    
    // Stop audio tracks only if we acquired them internally
    if (!audioExternallyManaged.current) {
      audioStreamRef.current?.getTracks().forEach(track => track.stop())
    }
    closeAudioContext(audioContextRef)
    
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
  }, [])

  // Manage all event bindings & peripheral loops dynamically based on `isActive`
  useEffect(() => {
    if (!isActive) return

    // 1. Tab / Visibility Observers
    const handleVisibility = () => {
      if (document.hidden) emitEvent('tab_switch', 'warning')
    }
    const handleBlur = () => emitEvent('window_blur', 'warning')
    
    let lastWidth = window.innerWidth
    const handleResize = () => {
      const change = Math.abs(window.innerWidth - lastWidth)
      if (change > 100) emitEvent('browser_resize', 'info', { from: lastWidth, to: window.innerWidth })
      lastWidth = window.innerWidth
    }

    // 2. Fullscreen Enforcer 
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isActive && !isStoppingRef.current) {
        emitEvent('fullscreen_exit', 'critical')
        document.documentElement.requestFullscreen().catch(() => {})
      }
    }

    // 3. Key Blocks
    const blockedKeys = ['F12', 'Escape', 'Control+R', 'Control+Shift+I', 'Control+Shift+J']
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = [e.ctrlKey ? 'Control' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : '', e.metaKey ? 'Meta' : '', e.key].filter(Boolean).join('+')
      if (blockedKeys.includes(key)) {
        e.preventDefault()
        e.stopPropagation()
        emitEvent('keyboard_shortcut', 'warning', { key })
      }
    }

    // 4. Clipboard Blocks
    const handleCopy = (e: Event) => { e.preventDefault(); emitEvent('copy_paste', 'info', { action: 'copy' }) }
    const handlePaste = (e: Event) => { e.preventDefault(); emitEvent('copy_paste', 'info', { action: 'paste' }) }
    const handleCut = (e: Event) => { e.preventDefault(); emitEvent('copy_paste', 'info', { action: 'cut' }) }
    const handleContextMenu = (e: Event) => e.preventDefault()

    // 5. Face Detection Loop
    const video = document.getElementById('camera-feed') as HTMLVideoElement | null
    if (video && 'FaceDetector' in window) {
      const detector = new (window as any).FaceDetector()
      faceIntervalRef.current = setInterval(async () => {
        try {
          const faces = await detector.detect(video)
          if (faces.length === 0) emitEvent('face_absent', 'warning')
          else if (faces.length > 1) emitEvent('face_multiple', 'critical')
        } catch {}
      }, 3000)
    }

    // 6. Audio Monitor Loop — use shared stream if provided, otherwise acquire
    async function initAudio() {
      const stream = audioStreamRef.current || await getAudioStream()
      if (!stream) {
        console.warn("Audio monitoring not available — skipping")
        return
      }
      audioStreamRef.current = stream
      try {
        const audioContext = new AudioContext()
        const analyser = audioContext.createAnalyser()
        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)
        analyser.fftSize = 256
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        audioContextRef.current = audioContext

        silenceIntervalRef.current = setInterval(() => {
          analyser.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength
          if (average < 5) {
            silentFramesRef.current++
            if (silentFramesRef.current >= 10) {
              emitEvent('audio_silence', 'warning', { silentDurationSecs: silentFramesRef.current })
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

    // Attach Listeners safely
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('resize', handleResize)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('copy', handleCopy)
    document.addEventListener('paste', handlePaste)
    document.addEventListener('cut', handleCut)
    document.addEventListener('contextmenu', handleContextMenu)

    // CLEANUP EVERYTHING ON UNMOUNT OR DEACTIVATION
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleBlur)
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
    }
  }, [isActive, emitEvent])

  // Global unmount catchall fallback
  useEffect(() => {
    return () => stop()
  }, [stop])

  return { ...state, start, stop, emitEvent }
}

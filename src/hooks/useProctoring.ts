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
    // Do not emit events after proctoring has been stopped
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
    
    // Stop audio tracks only if we acquired them internally
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

  // Manage all event bindings & peripheral loops dynamically based on `isActive`
  useEffect(() => {
    if (!isActive) return

    // 1. Tab / Visibility Observers
    const handleVisibility = () => {
      if (document.hidden) emitEvent('tab_switch', 'warning')
    }

    // Debounce window_blur — 50ms ensures Alt-Tab or clicking outside window fires immediately
    let blurTimer: ReturnType<typeof setTimeout> | null = null
    const handleBlur = () => {
      if (blurTimer) clearTimeout(blurTimer)
      blurTimer = setTimeout(() => {
        if (!document.hasFocus()) emitEvent('window_blur', 'warning')
      }, 50)
    }
    const handleFocus = () => {
      if (blurTimer) clearTimeout(blurTimer)
    }
    
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
    const handleCopy = (e: Event) => { e.preventDefault(); emitEvent('copy_paste', 'warning', { action: 'copy' }) }
    const handlePaste = (e: Event) => { e.preventDefault(); emitEvent('copy_paste', 'warning', { action: 'paste' }) }
    const handleCut = (e: Event) => { e.preventDefault(); emitEvent('copy_paste', 'warning', { action: 'cut' }) }
    const handleContextMenu = (e: Event) => e.preventDefault()

    // 5. Universal Face & Multi-Face Detection Loop
    const findVideo = () => (document.getElementById('camera-feed') || document.querySelector('video')) as HTMLVideoElement | null

    faceIntervalRef.current = setInterval(async () => {
      const video = findVideo()
      if (!video || video.readyState < 2 || video.paused) return

      // Try Chrome Shape Detection API if available
      if ('FaceDetector' in window) {
        try {
          const detector = new (window as any).FaceDetector()
          const faces = await detector.detect(video)
          if (faces.length === 0) {
            emitEvent('face_absent', 'warning', { reason: 'no_face_detected' })
          } else if (faces.length > 1) {
            emitEvent('face_multiple', 'critical', { count: faces.length })
          }
          return
        } catch {}
      }

      // Universal Canvas Multi-Blob Face & Skin Density Detector (works in all browsers)
      try {
        const canvas = document.createElement('canvas')
        const width = 160
        const height = 120
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.drawImage(video, 0, 0, width, height)
        const frameData = ctx.getImageData(0, 0, width, height)
        const pixels = frameData.data

        let totalSkinPixels = 0
        const columnCounts = new Array(width).fill(0)

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4
            const r = pixels[idx]
            const g = pixels[idx + 1]
            const b = pixels[idx + 2]

            // Universal skin-tone color model in RGB space
            const isSkin = (
              r > 40 && g > 25 && b > 15 &&
              r > g && r > b &&
              Math.max(r, g, b) - Math.min(r, g, b) > 12 &&
              Math.abs(r - g) > 10
            )

            if (isSkin) {
              totalSkinPixels++
              columnCounts[x]++
            }
          }
        }

        const totalPixels = width * height
        const skinPercentage = (totalSkinPixels / totalPixels) * 100

        // 1. Face Absence: Less than 3.5% of frame area contains skin-tone pixels
        if (skinPercentage < 3.5) {
          emitEvent('face_absent', 'warning', { skinPercentage: skinPercentage.toFixed(1) })
          return
        }

        // 2. Multiple Face Detection: Analyze horizontal skin density peaks
        const smoothed = new Array(width).fill(0)
        for (let x = 2; x < width - 2; x++) {
          smoothed[x] = (columnCounts[x - 2] + columnCounts[x - 1] + columnCounts[x] + columnCounts[x + 1] + columnCounts[x + 2]) / 5
        }

        let peakCount = 0
        let inPeak = false
        const peakThreshold = height * 0.12

        for (let x = 5; x < width - 5; x++) {
          if (smoothed[x] > peakThreshold) {
            if (!inPeak) {
              peakCount++
              inPeak = true
            }
          } else if (smoothed[x] < peakThreshold * 0.5) {
            inPeak = false
          }
        }

        if (peakCount >= 2) {
          emitEvent('face_multiple', 'critical', { detectedFaces: peakCount })
        }
      } catch (err) {
        console.warn('[Proctoring] Face detection frame error:', err)
      }
    }, 3000)

    // 6. Audio Monitor Loop — use shared stream if provided, otherwise acquire
    async function initAudio() {
      const stream = audioStreamRef.current || await getAudioStream()
      if (!stream) {
        console.warn("Audio monitoring not available — skipping")
        return
      }
      audioStreamRef.current = stream
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
          analyser.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength
          if (average < 5) {
            silentFramesRef.current++
            // Raise threshold: 15 consecutive silent seconds before flagging
            // This avoids false positives during normal thinking pauses
            if (silentFramesRef.current >= 15) {
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
    window.addEventListener('focus', handleFocus)
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
    }
  }, [isActive, emitEvent])

  // Global unmount catchall fallback
  useEffect(() => {
    return () => stop()
  }, [stop])

  return { ...state, start, stop, emitEvent }
}

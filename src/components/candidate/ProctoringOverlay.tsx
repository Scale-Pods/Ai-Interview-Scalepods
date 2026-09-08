import { useEffect, useState, useRef } from 'react'
import { AlertTriangle, Eye, Monitor, Mic, X, Shield, Info, AlertCircle } from 'lucide-react'
import type { ProctoringEvent, ProctoringSeverity } from '@/types'
import { fetchPublicProctoringSummary } from '@/api/proctoring'

interface ProctoringOverlayProps {
  violations: ProctoringEvent[]
  sessionId: string
}

export function ProctoringOverlay({ violations, sessionId }: ProctoringOverlayProps) {
  const [showWarning, setShowWarning] = useState(false)
  const [warningMessage, setWarningMessage] = useState('')
  const [warningSeverity, setWarningSeverity] = useState<ProctoringSeverity>('warning')
  const [isDisabled, setIsDisabled] = useState(false)
  const [tabSwitchCount, setTabSwitchCount] = useState(0)
  const [totalViolationCount, setTotalViolationCount] = useState(0)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetchPublicProctoringSummary(sessionId).then(s => {
      setTabSwitchCount(s.tabSwitches)
      setTotalViolationCount(s.totalEvents)
    }).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    const last = violations[violations.length - 1]
    if (!last) return

    setTotalViolationCount(violations.length)

    // Only count violations that represent deliberate, intentional actions toward termination.
    // Sensor-based events (face_absent, face_multiple, audio_silence) are excluded because
    // they have high false-positive rates in remote candidate environments (dark rooms,
    // Bluetooth headsets, patterned backgrounds, etc.).
    const INTENTIONAL_TYPES: string[] = ['fullscreen_exit', 'keyboard_shortcut', 'copy_paste', 'tab_switch']
    const intentionalCritical = violations.filter(
      v => v.severity === 'critical' && INTENTIONAL_TYPES.includes(v.event_type)
    ).length

    // Terminate only after 5+ intentional critical violations — prevents false terminations
    // from sensor noise events that were previously critical (now downgraded to warning).
    if (intentionalCritical >= 5) {
      setIsDisabled(true)
      setWarningMessage('Interview terminated due to multiple critical security violations.')
      return
    }

    if (last.event_type === 'tab_switch' || last.event_type === 'window_blur') {
      setTabSwitchCount(prev => prev + 1)
    }

    // Build specific, candidate-friendly warning messages for ALL event types
    let message = ''
    const action = (last.payload?.action as string) || ''
    const key = (last.payload?.key as string) || ''

    switch (last.event_type) {
      case 'tab_switch':
        message = 'Tab switching detected. Please stay focused on the interview window.'
        break
      case 'window_blur':
        message = 'Window focus lost. Please keep the interview window active and visible.'
        break
      case 'browser_resize':
        message = 'Browser window resized. Please keep the interview window maximized.'
        break
      case 'fullscreen_exit':
        message = 'Fullscreen mode exited. Please return to full screen mode to continue.'
        break
      case 'face_absent':
        message = 'Face not detected in camera feed. Please align yourself directly in front of the camera.'
        break
      case 'face_multiple':
        message = 'Multiple faces detected in camera feed. Only the candidate should be in view.'
        break
      case 'face_mismatch':
        message = 'Camera feed mismatch detected. Please remain clearly visible.'
        break
      case 'gaze_away':
        message = 'You appear to be looking away from the screen. Please keep your eyes on the interview window.'
        break
      case 'head_down':
        message = 'Please look at the camera. Looking down for extended periods is not permitted during the interview.'
        break
      case 'audio_silence':
        message = 'No audio input detected for an extended period. Please speak your answer.'
        break
      case 'audio_level':
        message = 'Audio level anomaly detected. Please check your microphone setup.'
        break
      case 'copy_paste':
        if (action === 'paste') message = 'Pasting text is strictly prohibited during the interview.'
        else if (action === 'copy') message = 'Copying text is prohibited during the interview.'
        else message = 'Copying or pasting content is prohibited during the interview.'
        break
      case 'keyboard_shortcut':
        if (key) message = `Keyboard shortcut (${key}) is disabled during the interview.`
        else message = 'Keyboard shortcuts are disabled during the interview.'
        break
      default:
        message = 'Security alert: Please adhere to all interview proctoring guidelines.'
    }

    setWarningMessage(message)
    setWarningSeverity(last.severity)
    setShowWarning(true)

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)

    const duration = last.severity === 'critical' ? 6000 : last.severity === 'warning' ? 5000 : 4000
    dismissTimerRef.current = setTimeout(() => {
      setShowWarning(false)
    }, duration)

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [violations])

  if (isDisabled) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(10px)' }}>
        <div className="text-center max-w-md p-8 rounded-2xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--separator)' }}>
          <AlertTriangle size={64} className="mx-auto mb-4 animate-bounce" style={{ color: 'var(--red)' }} />
          <h2 className="text-2xl font-bold text-white mb-2">Interview Terminated</h2>
          <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>{warningMessage}</p>
        </div>
      </div>
    )
  }

  // Pick banner colors and icon based on severity
  const getBannerStyle = () => {
    switch (warningSeverity) {
      case 'critical':
        return {
          bg: 'rgba(255, 69, 58, 0.95)',
          border: '1px solid rgba(255, 69, 58, 0.5)',
          shadow: '0 8px 32px rgba(255, 69, 58, 0.4)',
          Icon: AlertCircle
        }
      case 'warning':
        return {
          bg: 'rgba(255, 159, 10, 0.95)',
          border: '1px solid rgba(255, 159, 10, 0.5)',
          shadow: '0 8px 32px rgba(255, 159, 10, 0.3)',
          Icon: AlertTriangle
        }
      case 'info':
      default:
        return {
          bg: 'rgba(10, 132, 255, 0.95)',
          border: '1px solid rgba(10, 132, 255, 0.5)',
          shadow: '0 8px 32px rgba(10, 132, 255, 0.3)',
          Icon: Info
        }
    }
  }

  const banner = getBannerStyle()
  const BannerIcon = banner.Icon

  return (
    <>
      {/* Dynamic Warning Toast Banner */}
      {showWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] animate-slide-up max-w-lg w-full px-4">
          <div
            className="text-sm px-5 py-3.5 rounded-xl shadow-2xl flex items-center justify-between gap-3 text-white backdrop-blur-md transition-all duration-300"
            style={{
              background: banner.bg,
              border: banner.border,
              boxShadow: banner.shadow
            }}
          >
            <div className="flex items-center gap-3">
              <BannerIcon size={20} className="shrink-0" />
              <span className="font-medium text-xs sm:text-sm leading-snug">{warningMessage}</span>
            </div>
            <button
              onClick={() => setShowWarning(false)}
              className="p-1 rounded-lg hover:bg-white/20 transition-colors shrink-0"
              title="Dismiss warning"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Top-Right Status Indicators (Positioned below top header to avoid obscuring timer) */}
      <div className="fixed top-16 right-4 z-50 flex items-center gap-2">
        {tabSwitchCount > 0 && (
          <div className="badge-orange flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full shadow-sm" title="Tab switch warnings">
            <Eye size={12} />
            <span>{tabSwitchCount} {tabSwitchCount === 1 ? 'switch' : 'switches'}</span>
          </div>
        )}

        {totalViolationCount > 0 && (
          <div className="badge-grey flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full shadow-sm" title="Total proctoring events recorded">
            <AlertTriangle size={12} style={{ color: 'var(--orange)' }} />
            <span>{totalViolationCount}</span>
          </div>
        )}

        {violations.some(v => v.event_type.startsWith('face')) && (
          <div className="w-7 h-7 rounded-full flex items-center justify-center shadow-sm" style={{ background: 'color-mix(in srgb, var(--orange) 20%, transparent)', border: '1px solid var(--orange)' }} title="Camera/Face warning recorded">
            <Monitor size={13} style={{ color: 'var(--orange)' }} />
          </div>
        )}

        {violations.some(v => v.event_type.startsWith('audio')) && (
          <div className="w-7 h-7 rounded-full flex items-center justify-center shadow-sm" style={{ background: 'color-mix(in srgb, var(--blue) 20%, transparent)', border: '1px solid var(--blue)' }} title="Audio warning recorded">
            <Mic size={13} style={{ color: 'var(--blue)' }} />
          </div>
        )}

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium shadow-sm" style={{ background: 'var(--glass-fill)', border: '1px solid var(--separator)', color: 'var(--label-secondary)', backdropFilter: 'blur(8px)' }}>
          <Shield size={11} style={{ color: 'var(--green)' }} />
          <span>Monitored</span>
        </div>
      </div>
    </>
  )
}

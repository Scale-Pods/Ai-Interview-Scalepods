import { useEffect, useState } from 'react'
import { AlertTriangle, Eye, Monitor, Mic, X, Shield } from 'lucide-react'
import type { ProctoringEvent } from '@/types'
import { fetchPublicProctoringSummary } from '@/api/proctoring'

interface ProctoringOverlayProps {
  violations: ProctoringEvent[]
  sessionId: string
}

export function ProctoringOverlay({ violations, sessionId }: ProctoringOverlayProps) {
  const [showWarning, setShowWarning] = useState(false)
  const [warningMessage, setWarningMessage] = useState('')
  const [isDisabled, setIsDisabled] = useState(false)
  const [tabSwitchCount, setTabSwitchCount] = useState(0)

  useEffect(() => {
    fetchPublicProctoringSummary(sessionId).then(s => {
      setTabSwitchCount(s.tabSwitches)
    }).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    const last = violations[violations.length - 1]
    if (!last) return

    const criticalCount = violations.filter(v => v.severity === 'critical').length

    if (last.severity === 'critical' && criticalCount >= 3) {
      setIsDisabled(true)
      setWarningMessage('Interview terminated due to multiple security violations.')
      return
    }

    if (last.event_type === 'tab_switch' || last.event_type === 'window_blur') {
      setTabSwitchCount(prev => prev + 1)
    }

    if (last.severity === 'critical') {
      setWarningMessage('Critical violation detected. Your interview may be flagged for review.')
      setShowWarning(true)
      setTimeout(() => setShowWarning(false), 5000)
    } else if (last.severity === 'warning') {
      const messages: Record<string, string> = {
        tab_switch: 'Tab switching detected. Stay focused on the interview.',
        window_blur: 'Window focus lost. Please keep this window active.',
        fullscreen_exit: 'Fullscreen mode exited. Please return to fullscreen.',
        face_absent: 'Face not visible. Please position yourself in front of the camera.',
        face_multiple: 'Multiple faces detected. Only the candidate should be visible.',
        audio_silence: 'No audio detected. Please speak your answer.',
        keyboard_shortcut: 'Keyboard shortcuts are disabled during the interview.'
      }
      const message = messages[last.event_type] || 'Warning: Please follow interview guidelines.'

      setWarningMessage(message)
      setShowWarning(true)
      setTimeout(() => setShowWarning(false), 4000)
    }
  }, [violations])

  if (isDisabled) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.9)' }}>
        <div className="text-center max-w-md p-8">
          <AlertTriangle size={64} className="mx-auto mb-4" style={{ color: 'var(--red)' }} />
          <h2 className="text-2xl font-bold text-white mb-2">Interview Terminated</h2>
          <p style={{ color: 'var(--label-secondary)' }}>{warningMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {showWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] animate-slide-up">
          <div className="text-sm px-6 py-3 rounded-lg shadow-lg flex items-center gap-3"
            style={{ background: 'rgba(255,159,10,0.9)', color: 'white' }}>
            <AlertTriangle size={18} />
            <span>{warningMessage}</span>
            <button onClick={() => setShowWarning(false)} className="ml-2 opacity-70 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="fixed top-4 right-4 z-50 flex gap-2">
        {tabSwitchCount > 0 && (
          <div className="badge-orange flex items-center gap-1.5 text-xs">
            <Eye size={12} />
            <span>{tabSwitchCount}</span>
          </div>
        )}

        {violations.some(v => v.event_type.startsWith('face')) && (
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--orange) 20%, transparent)' }} title="Face detection issue">
            <Monitor size={14} style={{ color: 'var(--orange)' }} />
          </div>
        )}
        {violations.some(v => v.event_type.startsWith('audio')) && (
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--orange) 20%, transparent)' }} title="Audio issue">
            <Mic size={14} style={{ color: 'var(--orange)' }} />
          </div>
        )}

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px]" style={{ background: 'var(--glass-fill)', border: '1px solid var(--separator)', color: 'var(--label-secondary)' }}>
          <Shield size={10} style={{ color: 'var(--green)' }} />
          <span>Monitored</span>
        </div>
      </div>
    </>
  )
}

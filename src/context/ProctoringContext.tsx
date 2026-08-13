import { createContext, useContext, useState, useCallback } from 'react'
import { subscribeToProctoring } from '@/api/websocket'
import type { ProctoringEvent, ProctoringEventType, ProctoringSeverity } from '@/types'
import { useProctoring } from '@/hooks/useProctoring'

interface ProctoringContextType {
  violations: ProctoringEvent[]
  isSecure: boolean
  recentEvent: ProctoringEvent | null
  sessionViolations: Map<string, ProctoringEvent[]>
  startProctoring: (sessionId: string, audioStream?: MediaStream, isAiSpeakingRef?: React.MutableRefObject<boolean>) => Promise<void>
  stopProctoring: () => void
  emitEvent: (type: ProctoringEventType, severity: ProctoringSeverity, payload?: Record<string, unknown>) => Promise<void>
  subscribeToSession: (sessionId: string) => () => void
}

const ProctoringContext = createContext<ProctoringContextType | null>(null)

export function ProctoringProvider({ children }: { children: React.ReactNode }) {
  const [sessionViolations, setSessionViolations] = useState<Map<string, ProctoringEvent[]>>(new Map())
  const [sessionId, setSessionId] = useState<string | null>(null)
  const localProctoring = useProctoring(sessionId || '')

  const startProctoring = useCallback(async (sid: string, audioStream?: MediaStream, isAiSpeakingRef?: React.MutableRefObject<boolean>) => {
    // Set sessionId FIRST synchronously via the ref path inside useProctoring,
    // then update React state. This prevents the race condition where events
    // fire before the state update settles, resulting in empty session_ids.
    await localProctoring.start(sid, audioStream, isAiSpeakingRef)
    setSessionId(sid)
  }, [localProctoring])

  const stopProctoring = useCallback(() => {
    localProctoring.stop()
  }, [localProctoring])

  const subscribeToSession = useCallback((sid: string) => {
    setSessionId(sid)
    const unsub = subscribeToProctoring(sid, (event) => {
      setSessionViolations(prev => {
        const next = new Map(prev)
        const existing = next.get(sid) || []
        next.set(sid, [...existing, event])
        return next
      })
    })
    return unsub
  }, [])

  return (
    <ProctoringContext.Provider value={{
      violations: localProctoring.violations,
      isSecure: localProctoring.isSecure,
      recentEvent: localProctoring.recentEvent,
      sessionViolations,
      startProctoring,
      stopProctoring,
      emitEvent: localProctoring.emitEvent,
      subscribeToSession
    }}>
      {children}
    </ProctoringContext.Provider>
  )
}

export function useProctoringContext() {
  const ctx = useContext(ProctoringContext)
  if (!ctx) throw new Error('useProctoringContext must be used within ProctoringProvider')
  return ctx
}

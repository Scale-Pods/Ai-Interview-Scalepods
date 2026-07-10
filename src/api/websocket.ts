import { supabase } from './client'
import type { ProctoringEvent } from '@/types'

type EventHandler = (event: ProctoringEvent) => void

const handlers = new Map<string, Set<EventHandler>>()

export function subscribeToProctoring(
  sessionId: string,
  onEvent: EventHandler
): () => void {
  const channel = supabase
    .channel(`proctoring:${sessionId}`)
    .on(
      'broadcast',
      { event: 'proctoring_event' },
      (payload) => onEvent(payload.data as ProctoringEvent)
    )
    .subscribe()

  if (!handlers.has(sessionId)) {
    handlers.set(sessionId, new Set())
  }
  handlers.get(sessionId)!.add(onEvent)

  return () => {
    handlers.get(sessionId)?.delete(onEvent)
    if (handlers.get(sessionId)?.size === 0) {
      supabase.removeChannel(channel)
      handlers.delete(sessionId)
    }
  }
}

export function subscribeToSessionStatus(
  sessionId: string,
  onStatus: (status: string) => void
): () => void {
  const channel = supabase
    .channel(`session:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'interview_sessions_ai_interview',
        filter: `id=eq.${sessionId}`
      },
      (payload) => onStatus(payload.new.status)
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

export function subscribeToScorecard(
  sessionId: string,
  onScorecard: (data: unknown) => void
): () => void {
  const channel = supabase
    .channel(`scorecard:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'scorecards_ai_interview',
        filter: `session_id=eq.${sessionId}`
      },
      (payload) => onScorecard(payload.new)
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

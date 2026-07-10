import { supabase, supabasePublic } from './client'
import type { ProctoringEvent, ProctoringSummary } from '@/types'

export async function fetchProctoringEvents(sessionId: string): Promise<ProctoringEvent[]> {
  const { data, error } = await supabase
    .from('proctoring_events_ai_interview')
    .select('*')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: false })
    .limit(50)
  if (error) throw error
  return data || []
}

export async function fetchProctoringSummary(sessionId: string): Promise<ProctoringSummary> {
  const { data, error } = await supabase
    .from('proctoring_events_ai_interview')
    .select('event_type, severity')
    .eq('session_id', sessionId)

  if (error) throw error

  const events = data || []
  const summary: ProctoringSummary = {
    totalEvents: events.length,
    criticalEvents: events.filter(e => e.severity === 'critical').length,
    warningEvents: events.filter(e => e.severity === 'warning').length,
    tabSwitches: events.filter(e => e.event_type === 'tab_switch' || e.event_type === 'window_blur').length,
    windowBlurs: events.filter(e => e.event_type === 'window_blur').length,
    faceAbsences: events.filter(e => e.event_type === 'face_absent').length,
    faceMultiple: events.filter(e => e.event_type === 'face_multiple').length,
    silentPeriods: events.filter(e => e.event_type === 'audio_silence').length,
    fullscreenExits: events.filter(e => e.event_type === 'fullscreen_exit').length,
    copyPastes: events.filter(e => e.event_type === 'copy_paste').length,
    keyboardShortcuts: events.filter(e => e.event_type === 'keyboard_shortcut').length,
  }
  return summary
}

export async function fetchPublicProctoringSummary(sessionId: string): Promise<ProctoringSummary> {
  const { data, error } = await supabasePublic
    .from('proctoring_events_ai_interview')
    .select('event_type, severity')
    .eq('session_id', sessionId)

  if (error) throw error

  const events = data || []
  const summary: ProctoringSummary = {
    totalEvents: events.length,
    criticalEvents: events.filter(e => e.severity === 'critical').length,
    warningEvents: events.filter(e => e.severity === 'warning').length,
    tabSwitches: events.filter(e => e.event_type === 'tab_switch' || e.event_type === 'window_blur').length,
    windowBlurs: events.filter(e => e.event_type === 'window_blur').length,
    faceAbsences: events.filter(e => e.event_type === 'face_absent').length,
    faceMultiple: events.filter(e => e.event_type === 'face_multiple').length,
    silentPeriods: events.filter(e => e.event_type === 'audio_silence').length,
    fullscreenExits: events.filter(e => e.event_type === 'fullscreen_exit').length,
    copyPastes: events.filter(e => e.event_type === 'copy_paste').length,
    keyboardShortcuts: events.filter(e => e.event_type === 'keyboard_shortcut').length,
  }
  return summary
}

export async function subscribeToProctoringSummary(
  sessionId: string,
  onUpdate: (summary: ProctoringSummary) => void
): Promise<() => void> {
  const channel = supabase
    .channel(`proctoring-summary:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'proctoring_events_ai_interview',
        filter: `session_id=eq.${sessionId}`
      },
      () => {
        fetchProctoringSummary(sessionId).then(onUpdate).catch(() => {})
      }
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

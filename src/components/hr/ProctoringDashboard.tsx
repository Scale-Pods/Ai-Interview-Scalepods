import { useEffect, useState } from 'react'
import { Shield, AlertTriangle, Eye, Mic, Monitor, AlertCircle } from 'lucide-react'
import { supabase } from '@/api/client'
import type { ProctoringEvent, InterviewSession, ProctoringSummary } from '@/types'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { formatRelativeTime } from '@/utils/formatDate'

const severityColor = (s: string) => {
  const map: Record<string, string> = {
    critical: 'badge-red',
    warning: 'badge-orange',
    info: 'badge-blue'
  }
  return map[s] || 'badge-grey'
}

const eventIcon = (type: string) => {
  if (type.startsWith('tab') || type.startsWith('window')) return Eye
  if (type.startsWith('face') || type.startsWith('fullscreen')) return Monitor
  if (type.startsWith('audio')) return Mic
  return AlertTriangle
}

export function ProctoringDashboard() {
  const [activeSessions, setActiveSessions] = useState<InterviewSession[]>([])
  const [eventsMap, setEventsMap] = useState<Record<string, ProctoringEvent[]>>({})
  const [summaryMap, setSummaryMap] = useState<Record<string, ProctoringSummary>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: sessions } = await supabase
        .from('interview_sessions_ai_interview')
        .select('*, candidates_ai_interview(name, email)')
        .in('status', ['in_progress', 'flagged'])
        .order('created_at', { ascending: false })
      if (sessions) {
        const unlinked = sessions.filter(s => !s.candidates_ai_interview)
        if (unlinked.length > 0) {
          const candidateIds = unlinked.map(s => s.candidate_id).filter(Boolean)
          if (candidateIds.length > 0) {
            const { data: candidates } = await supabase
              .from('candidates_ai_interview')
              .select('id, name, email')
              .in('id', candidateIds)
            const candidateById = new Map((candidates || []).map(c => [c.id, c]))
            sessions.forEach(s => {
              if (!s.candidates_ai_interview && s.candidate_id) {
                s.candidates_ai_interview = candidateById.get(s.candidate_id) || null
              }
            })
          }
        }
        setActiveSessions(sessions)
        sessions.forEach(s => {
          loadEvents(s.id)
          loadSummary(s.id)
        })
      }
      setLoading(false)
    }
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  const loadEvents = async (sessionId: string) => {
    const { data } = await supabase
      .from('proctoring_events_ai_interview')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: false })
      .limit(20)
    if (data) setEventsMap(prev => ({ ...prev, [sessionId]: data }))
  }

  const loadSummary = async (sessionId: string) => {
    const { data } = await supabase
      .from('proctoring_events_ai_interview')
      .select('event_type, severity')
      .eq('session_id', sessionId)

    if (data) {
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
      setSummaryMap(prev => ({ ...prev, [sessionId]: summary }))
    }
  }

  if (loading) return <LoadingSpinner text="Loading proctoring data..." />

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-2">
        <Shield size={24} style={{ color: 'var(--blue)' }} />
        <h1 className="text-2xl font-bold">Proctoring Dashboard</h1>
        <span className="badge-live text-xs"></span>
      </div>

      {activeSessions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card liquid-card-sm" style={{ padding: '16px' }}>
            <p className="text-2xl font-bold" style={{ color: 'var(--label-primary)', fontVariantNumeric: 'tabular-nums' }}>{activeSessions.length}</p>
            <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>Active Sessions</p>
          </div>
          <div className="card liquid-card-sm" style={{ padding: '16px' }}>
            <p className="text-2xl font-bold" style={{ color: 'var(--orange)', fontVariantNumeric: 'tabular-nums' }}>
              {Object.values(summaryMap).reduce((sum, s) => sum + s.tabSwitches, 0)}
            </p>
            <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>Total Tab Switches</p>
          </div>
          <div className="card liquid-card-sm" style={{ padding: '16px' }}>
            <p className="text-2xl font-bold" style={{ color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>
              {Object.values(summaryMap).reduce((sum, s) => sum + s.criticalEvents, 0)}
            </p>
            <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>Critical Events</p>
          </div>
          <div className="card liquid-card-sm" style={{ padding: '16px' }}>
            <p className="text-2xl font-bold" style={{ color: 'var(--orange)', fontVariantNumeric: 'tabular-nums' }}>
              {Object.values(summaryMap).reduce((sum, s) => sum + s.totalEvents, 0)}
            </p>
            <p className="text-xs" style={{ color: 'var(--label-secondary)' }}>Total Events</p>
          </div>
        </div>
      )}

      {activeSessions.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--label-tertiary)' }}>
          <Shield size={48} className="mx-auto mb-4 opacity-30" />
          <p>No active interview sessions</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {activeSessions.map(session => {
            const events = eventsMap[session.id] || []
            const summary = summaryMap[session.id]
            const criticalCount = events.filter(e => e.severity === 'critical').length
            const Icon = session.status === 'flagged' ? AlertCircle : Shield

            return (
              <div key={session.id} className="card" style={{
                border: session.status === 'flagged' ? '1px solid color-mix(in srgb, var(--red) 30%, transparent)' : undefined
              }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold" style={{ color: 'var(--label-primary)' }}>{session.candidates_ai_interview?.name || 'Unknown'}</h3>
                    <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>{session.candidates_ai_interview?.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {criticalCount > 0 && (
                      <span className="badge-red text-xs flex items-center gap-1">
                        <AlertCircle size={12} /> {criticalCount} critical
                      </span>
                    )}
                    <Icon size={18} style={{ color: session.status === 'flagged' ? 'var(--red)' : 'var(--blue)' }} />
                  </div>
                </div>

                {summary && (
                  <div className="mb-4">
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-3">
                      <div className="rounded-lg px-2.5 py-2 text-center" style={{ background: 'color-mix(in srgb, var(--orange) 10%, transparent)' }}>
                        <p className="text-lg font-bold" style={{ color: 'var(--orange)', fontVariantNumeric: 'tabular-nums' }}>{summary.tabSwitches}</p>
                        <p className="text-[10px]" style={{ color: 'var(--label-secondary)' }}>Tab Switches</p>
                      </div>
                      <div className="rounded-lg px-2.5 py-2 text-center" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>
                        <p className="text-lg font-bold" style={{ color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{summary.faceAbsences + summary.faceMultiple}</p>
                        <p className="text-[10px]" style={{ color: 'var(--label-secondary)' }}>Face Issues</p>
                      </div>
                      <div className="rounded-lg px-2.5 py-2 text-center" style={{ background: 'color-mix(in srgb, var(--blue) 10%, transparent)' }}>
                        <p className="text-lg font-bold" style={{ color: 'var(--blue)', fontVariantNumeric: 'tabular-nums' }}>{summary.silentPeriods}</p>
                        <p className="text-[10px]" style={{ color: 'var(--label-secondary)' }}>Silence</p>
                      </div>
                      <div className="rounded-lg px-2.5 py-2 text-center" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)' }}>
                        <p className="text-lg font-bold" style={{ color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{summary.fullscreenExits}</p>
                        <p className="text-[10px]" style={{ color: 'var(--label-secondary)' }}>FS Exits</p>
                      </div>
                      <div className="rounded-lg px-2.5 py-2 text-center" style={{ background: 'color-mix(in srgb, var(--purple) 10%, transparent)' }}>
                        <p className="text-lg font-bold" style={{ color: 'var(--purple)', fontVariantNumeric: 'tabular-nums' }}>{summary.copyPastes}</p>
                        <p className="text-[10px]" style={{ color: 'var(--label-secondary)' }}>Copy/Paste</p>
                      </div>
                      <div className="rounded-lg px-2.5 py-2 text-center" style={{ background: 'color-mix(in srgb, var(--teal) 10%, transparent)' }}>
                        <p className="text-lg font-bold" style={{ color: 'var(--teal)', fontVariantNumeric: 'tabular-nums' }}>{summary.keyboardShortcuts}</p>
                        <p className="text-[10px]" style={{ color: 'var(--label-secondary)' }}>Shortcuts</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs pt-2" style={{ borderTop: '1px solid var(--separator)', color: 'var(--label-tertiary)' }}>
                      <span>Critical: <strong style={{ color: 'var(--red)' }}>{summary.criticalEvents}</strong></span>
                      <span>Warnings: <strong style={{ color: 'var(--orange)' }}>{summary.warningEvents}</strong></span>
                      <span>Total: <strong style={{ color: 'var(--label-primary)' }}>{summary.totalEvents}</strong></span>
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs mb-2 font-medium" style={{ color: 'var(--label-tertiary)' }}>Recent Events</p>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {events.length === 0 ? (
                      <p className="text-xs py-4 text-center" style={{ color: 'var(--label-quaternary)' }}>No events recorded</p>
                    ) : events.map(event => {
                      const EvIcon = eventIcon(event.event_type)
                      return (
                        <div key={event.id} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${severityColor(event.severity)}`}>
                          <EvIcon size={14} />
                          <span className="flex-1">{event.event_type.replace(/_/g, ' ')}</span>
                          <span className="opacity-70">{formatRelativeTime(event.timestamp)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

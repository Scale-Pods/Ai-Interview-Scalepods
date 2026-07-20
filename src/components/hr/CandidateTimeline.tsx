import { useEffect, useState } from 'react'
import {
  Clock, CheckCircle, Send, FileText, XCircle, AlertTriangle,
  Mail, Play, Flag
} from 'lucide-react'
import { supabase } from '@/api/client'
import type { TimelineEvent, InterviewSession } from '@/types'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { formatRelativeTime } from '@/utils/formatDate'

interface CandidateTimelineProps {
  session: InterviewSession
}

interface EventStyle {
  icon: typeof Clock
  color: string
  dotColor: string
  bgColor: string
}

const eventConfig: Record<string, EventStyle> = {
  interview_invite_sent: {
    icon: Mail, color: 'var(--blue)', dotColor: 'var(--blue)', bgColor: 'color-mix(in srgb, var(--blue) 10%, transparent)'
  },
  interview_started: {
    icon: Play, color: 'var(--green)', dotColor: 'var(--green)', bgColor: 'color-mix(in srgb, var(--green) 10%, transparent)'
  },
  interview_completed: {
    icon: CheckCircle, color: 'var(--green)', dotColor: 'var(--green)', bgColor: 'color-mix(in srgb, var(--green) 10%, transparent)'
  },
  scorecard_ready: {
    icon: FileText, color: 'var(--purple)', dotColor: 'var(--purple)', bgColor: 'color-mix(in srgb, var(--purple) 10%, transparent)'
  },
  interview_cancelled: {
    icon: XCircle, color: 'var(--red)', dotColor: 'var(--red)', bgColor: 'color-mix(in srgb, var(--red) 10%, transparent)'
  },
  session_flagged: {
    icon: Flag, color: 'var(--orange)', dotColor: 'var(--orange)', bgColor: 'color-mix(in srgb, var(--orange) 10%, transparent)'
  },
  session_expired: {
    icon: AlertTriangle, color: 'var(--orange)', dotColor: 'var(--orange)', bgColor: 'color-mix(in srgb, var(--orange) 10%, transparent)'
  },
  interview_reinvited: {
    icon: Send, color: 'var(--blue)', dotColor: 'var(--blue)', bgColor: 'color-mix(in srgb, var(--blue) 10%, transparent)'
  }
}

const actionTitleMap: Record<string, string> = {
  interview_invite_sent: 'Invitation Sent',
  interview_started: 'Interview Started',
  interview_completed: 'Interview Completed',
  scorecard_ready: 'Scorecard Generated',
  interview_cancelled: 'Session Cancelled',
  session_flagged: 'Session Flagged',
  session_expired: 'Session Expired',
}

function detectEventType(action: string): string {
  const key = action.toLowerCase().replace(/\s+/g, '_')
  if (eventConfig[key]) return key
  if (key.includes('invite') && key.includes('sent')) return 'interview_invite_sent'
  if (key.includes('cancel')) return 'interview_cancelled'
  if (key.includes('flag')) return 'session_flagged'
  if (key.includes('expir')) return 'session_expired'
  if (key.includes('start') || key.includes('begin')) return 'interview_started'
  if (key.includes('complet') || key.includes('finish')) return 'interview_completed'
  if (key.includes('score') || key.includes('evaluat')) return 'scorecard_ready'
  return 'interview_invite_sent'
}

export function CandidateTimeline({ session }: CandidateTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const timeline: TimelineEvent[] = []

      const { data: auditEvents } = await supabase
        .from('audit_log_ai_interview')
        .select('*')
        .eq('resource_id', session.id)
        .order('created_at', { ascending: true })

      if (auditEvents) {
        auditEvents.forEach(e => {
          const action = (e as any).action || ''
          timeline.push({
            id: (e as any).id,
            type: 'interview_event',
            source: 'ai_interviewer',
            title: actionTitleMap[action] || action.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
            description: (e as any).details ? JSON.stringify((e as any).details) : '',
            timestamp: (e as any).created_at,
            actor: (e as any).actor_type || 'System'
          })
        })
      }

      const sessionEvents: [keyof InterviewSession, string, string][] = [
        ['created_at', 'Session Created', 'Interview session was created'],
        ['started_at', 'Interview Started', 'Candidate began the interview'],
        ['completed_at', 'Interview Completed', 'Candidate finished all questions'],
      ]

      sessionEvents.forEach(([key, title, desc]) => {
        const ts = session[key]
        if (ts) {
          timeline.push({
            id: `${session.id}-${String(key)}`,
            type: 'interview_event',
            source: 'ai_interviewer',
            title,
            description: desc,
            timestamp: ts as string,
            actor: key === 'created_at' ? 'System' : 'Candidate'
          })
        }
      })

      const { data: scorecard } = await supabase
        .from('scorecards_ai_interview')
        .select('overall_score, evaluated_at')
        .eq('session_id', session.id)
        .single()

      if (scorecard) {
        timeline.push({
          id: `${session.id}-scorecard`,
          type: 'interview_event',
          source: 'ai_interviewer',
          title: `Scorecard Ready — ${scorecard.overall_score}/100`,
          description: 'AI evaluation completed',
          timestamp: scorecard.evaluated_at,
          actor: 'AI'
        })
      }

      timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      setEvents(timeline)
      setLoading(false)
    }
    load()
  }, [session])

  if (loading) return <LoadingSpinner text="Loading timeline..." />

  return (
    <div className="space-y-1">
      {events.length === 0 ? (
        <p className="text-center text-sm py-8" style={{ color: 'var(--label-tertiary)' }}>No timeline events</p>
      ) : (
        <div className="relative pl-8">
          <div className="absolute left-[11px] top-3 bottom-3 w-0.5" style={{ background: 'linear-gradient(to bottom, color-mix(in srgb, var(--blue) 50%, transparent), var(--separator))' }} />
          {events.map((event, idx) => {
            const eventType = detectEventType(event.title)
            const config = eventConfig[eventType]
            const Icon = config?.icon || Clock

            return (
              <div key={event.id} className="relative pb-6 last:pb-0 animate-fade-in" style={{ animationDelay: `${idx * 40}ms` }}>
                <div className="absolute -left-[17px] w-[34px] h-[34px] rounded-full border-2 flex items-center justify-center"
                  style={{
                    background: config?.bgColor || 'var(--fill-quaternary)',
                    borderColor: config?.dotColor ? 'color-mix(in srgb, ' + config.dotColor + ' 30%, transparent)' : 'var(--separator)'
                  }}>
                  <Icon size={14} style={{ color: config?.color || 'var(--label-secondary)' }} />
                </div>
                <div className="ml-4 pt-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--label-primary)' }}>{event.title}</p>
                  {event.description && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--label-tertiary)' }}>{event.description}</p>
                  )}
                  <p className="text-[10px] mt-1 flex items-center gap-1.5" style={{ color: 'var(--label-quaternary)' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: config?.dotColor || 'var(--label-tertiary)' }} />
                    {formatRelativeTime(event.timestamp)} — {event.actor}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

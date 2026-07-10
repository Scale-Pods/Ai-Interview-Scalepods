import { useEffect, useState } from 'react'
import { BarChart3, ThumbsUp, ThumbsDown, UserCheck, Brain, MessageSquare, Lightbulb } from 'lucide-react'
import { fetchScorecard, markScorecardReviewed } from '@/api/scorecards'
import type { Scorecard } from '@/types'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { recommendationColor, recommendationLabel, scoreColor, scoreLabel } from '@/utils/scoringHelpers'
import { formatDateTime } from '@/utils/formatDate'
import toast from 'react-hot-toast'

interface ScorecardViewerProps {
  sessionId: string
}

export function ScorecardViewer({ sessionId }: ScorecardViewerProps) {
  const [scorecard, setScorecard] = useState<Scorecard | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    fetchScorecard(sessionId).then(setScorecard).finally(() => setLoading(false))
  }, [sessionId])

  const handleMarkReviewed = async () => {
    if (!scorecard) return
    setReviewing(true)
    try {
      await markScorecardReviewed(scorecard.id)
      setScorecard(prev => prev ? { ...prev, reviewed_by_human: true } : null)
      toast.success('Marked as reviewed')
    } catch { toast.error('Failed to update') }
    finally { setReviewing(false) }
  }

  if (loading) return <LoadingSpinner text="Loading scorecard..." />
  if (!scorecard) return <div className="text-center py-12" style={{ color: 'var(--label-tertiary)' }}>Scorecard not yet available</div>

  const dimensions = [
    { label: 'Technical', score: scorecard.technical_score, icon: Brain },
    { label: 'Communication', score: scorecard.communication_score, icon: MessageSquare },
    { label: 'Problem Solving', score: scorecard.problem_solving_score, icon: Lightbulb },
    { label: 'Cultural Fit', score: scorecard.cultural_fit_score, icon: UserCheck }
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 size={24} style={{ color: 'var(--blue)' }} />
            <div>
              <h2 className="text-xl font-bold">Scorecard</h2>
              <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>Evaluated {formatDateTime(scorecard.evaluated_at)}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold" style={{ color: scoreColor(scorecard.overall_score), fontVariantNumeric: 'tabular-nums' }}>
              {scorecard.overall_score ?? '—'}
            </div>
            <div className="text-xs" style={{ color: 'var(--label-tertiary)' }}>Overall</div>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-6 p-3 rounded-lg" style={{
          background: `${recommendationColor(scorecard.recommendation)}15`,
          border: `1px solid ${recommendationColor(scorecard.recommendation)}30`
        }}>
          <span className="text-sm font-semibold" style={{ color: recommendationColor(scorecard.recommendation) }}>
            {recommendationLabel(scorecard.recommendation)}
          </span>
          <span className="text-xs" style={{ color: 'var(--label-secondary)' }}>Recommendation</span>
          {!scorecard.reviewed_by_human && (
            <button
              onClick={handleMarkReviewed} disabled={reviewing}
              className="ml-auto text-xs px-3 py-1 rounded-lg transition"
              style={{ background: 'var(--fill-tertiary)', color: 'var(--label-secondary)' }}
            >
              {reviewing ? 'Marking...' : 'Mark Reviewed'}
            </button>
          )}
          {scorecard.reviewed_by_human && (
            <span className="ml-auto text-xs flex items-center gap-1" style={{ color: 'var(--green)' }}>
              <UserCheck size={14} /> Reviewed
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {dimensions.map(d => {
            const Icon = d.icon
            return (
              <div key={d.label} className="rounded-lg p-4 text-center" style={{ background: 'var(--fill-quaternary)' }}>
                <Icon size={20} className="mx-auto mb-2" style={{ color: scoreColor(d.score) }} />
                <div className="text-2xl font-bold" style={{ color: scoreColor(d.score), fontVariantNumeric: 'tabular-nums' }}>{d.score}</div>
                <div className="text-xs" style={{ color: 'var(--label-secondary)' }}>{d.label}</div>
                <div className="text-[10px]" style={{ color: 'var(--label-tertiary)' }}>{scoreLabel(d.score)}</div>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="rounded-lg p-4" style={{ background: 'color-mix(in srgb, var(--green) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 20%, transparent)' }}>
            <div className="flex items-center gap-2 mb-3">
              <ThumbsUp size={16} style={{ color: 'var(--green)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--green)' }}>Strengths</span>
            </div>
            <ul className="space-y-1.5">
              {scorecard.strengths.map((s, i) => (
                <li key={i} className="text-sm flex items-start gap-2" style={{ color: 'var(--label-secondary)' }}>
                  <span style={{ color: 'var(--green)' }}>•</span> {s}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg p-4" style={{ background: 'color-mix(in srgb, var(--red) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)' }}>
            <div className="flex items-center gap-2 mb-3">
              <ThumbsDown size={16} style={{ color: 'var(--red)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--red)' }}>Areas for Improvement</span>
            </div>
            <ul className="space-y-1.5">
              {scorecard.weaknesses.map((w, i) => (
                <li key={i} className="text-sm flex items-start gap-2" style={{ color: 'var(--label-secondary)' }}>
                  <span style={{ color: 'var(--red)' }}>•</span> {w}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-lg p-4" style={{ background: 'var(--fill-quaternary)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--label-tertiary)' }}>AI Rationale</p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--label-secondary)' }}>{scorecard.ai_rationale}</p>
        </div>
      </div>
    </div>
  )
}

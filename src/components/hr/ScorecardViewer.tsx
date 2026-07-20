import { useEffect, useState } from 'react'
import { BarChart3, ThumbsUp, ThumbsDown, UserCheck, Brain, MessageSquare, Lightbulb, ShieldAlert, CheckCircle, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'
import { fetchScorecard, markScorecardReviewed } from '@/api/scorecards'
import type { Scorecard } from '@/types'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { recommendationColor, recommendationLabel, scoreColor, scoreLabel } from '@/utils/scoringHelpers'
import { formatDateTime } from '@/utils/formatDate'
import toast from 'react-hot-toast'

interface ScorecardViewerProps {
  sessionId: string
}

function AuthenticityBar({ score }: { score: number }) {
  const color = score >= 75 ? 'var(--green)' : score >= 50 ? '#f59e0b' : 'var(--red)'
  const label = score >= 75 ? 'High Credibility' : score >= 50 ? 'Moderate Concerns' : 'Low Credibility'
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--label-secondary)' }}>Authenticity Score</span>
        <span className="text-xs font-bold" style={{ color }}>{score} — {label}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--fill-tertiary)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: `linear-gradient(90deg, ${color}, ${color}99)` }}
        />
      </div>
    </div>
  )
}

function ClaimStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'verified': return <CheckCircle size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
    case 'suspicious': return <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
    case 'contradicted': return <XCircle size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />
    default: return <HelpCircle size={14} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
  }
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

  const recColor = recommendationColor(scorecard.recommendation)

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Hire / No-Hire Decision Banner */}
      <div
        className="rounded-2xl p-5"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${recColor} 15%, transparent), color-mix(in srgb, ${recColor} 5%, transparent))`,
          border: `1px solid color-mix(in srgb, ${recColor} 35%, transparent)`
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: `color-mix(in srgb, ${recColor} 80%, transparent)` }}>
              AI Recommendation
            </p>
            <h2 className="text-2xl font-bold" style={{ color: recColor }}>
              {recommendationLabel(scorecard.recommendation)}
            </h2>
            <p className="text-sm mt-2 leading-relaxed max-w-lg" style={{ color: 'var(--label-secondary)' }}>
              {scorecard.detailed_rationale || scorecard.ai_rationale}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-4xl font-bold" style={{ color: scoreColor(scorecard.overall_score), fontVariantNumeric: 'tabular-nums' }}>
              {scorecard.overall_score ?? '—'}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--label-tertiary)' }}>Overall Score</div>
          </div>
        </div>

        {!scorecard.reviewed_by_human && (
          <button
            onClick={handleMarkReviewed} disabled={reviewing}
            className="mt-4 text-xs px-4 py-1.5 rounded-lg transition"
            style={{ background: `color-mix(in srgb, ${recColor} 20%, transparent)`, color: recColor, border: `1px solid color-mix(in srgb, ${recColor} 30%, transparent)` }}
          >
            {reviewing ? 'Marking...' : 'Mark as Reviewed'}
          </button>
        )}
        {scorecard.reviewed_by_human && (
          <span className="mt-4 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--green)' }}>
            <UserCheck size={14} /> Reviewed by HR
          </span>
        )}
      </div>

      {/* Score Dimensions */}
      <div className="card">
        <div className="flex items-center gap-3 mb-5">
          <BarChart3 size={20} style={{ color: 'var(--blue)' }} />
          <h3 className="text-base font-bold">Dimension Scores</h3>
          <span className="ml-auto text-xs" style={{ color: 'var(--label-tertiary)' }}>Evaluated {formatDateTime(scorecard.evaluated_at)}</span>
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </div>

      {/* Authenticity Assessment */}
      {(scorecard.authenticity_score !== undefined || (scorecard.red_flags && scorecard.red_flags.length > 0)) && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <ShieldAlert size={20} style={{ color: scorecard.authenticity_score !== undefined && scorecard.authenticity_score < 50 ? 'var(--red)' : '#f59e0b' }} />
            <h3 className="text-base font-bold">Authenticity Assessment</h3>
            {scorecard.red_flag_count !== undefined && scorecard.red_flag_count > 0 && (
              <span
                className="ml-auto text-xs px-2.5 py-1 rounded-full font-semibold"
                style={{
                  background: 'color-mix(in srgb, var(--red) 15%, transparent)',
                  color: 'var(--red)',
                  border: '1px solid color-mix(in srgb, var(--red) 25%, transparent)'
                }}
              >
                {scorecard.red_flag_count} red flag{scorecard.red_flag_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {scorecard.authenticity_score !== undefined && (
            <AuthenticityBar score={scorecard.authenticity_score} />
          )}

          {scorecard.red_flags && scorecard.red_flags.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--label-secondary)' }}>Detected Red Flags</p>
              <ul className="space-y-2">
                {scorecard.red_flags.map((flag, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm p-2.5 rounded-lg"
                    style={{ background: 'color-mix(in srgb, var(--red) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 15%, transparent)' }}
                  >
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--red)' }} />
                    <span style={{ color: 'var(--label-secondary)' }}>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Resume vs Reality */}
      {scorecard.resume_vs_reality && scorecard.resume_vs_reality.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} style={{ color: 'var(--blue)' }} />
            <h3 className="text-base font-bold">Resume vs. Reality</h3>
          </div>

          <div className="space-y-2">
            {scorecard.resume_vs_reality.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{ background: 'var(--fill-quaternary)' }}
              >
                <ClaimStatusIcon status={item.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--label-primary)' }}>{item.claim}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--label-tertiary)' }}>{item.evidence}</p>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0"
                  style={{
                    background: item.status === 'verified'
                      ? 'color-mix(in srgb, var(--green) 15%, transparent)'
                      : item.status === 'suspicious' || item.status === 'unverifiable'
                      ? 'color-mix(in srgb, #f59e0b 15%, transparent)'
                      : 'color-mix(in srgb, var(--red) 15%, transparent)',
                    color: item.status === 'verified' ? 'var(--green)'
                      : item.status === 'suspicious' || item.status === 'unverifiable' ? '#f59e0b'
                      : 'var(--red)'
                  }}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {scorecard.live_notes && scorecard.live_notes.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <MessageSquare size={20} style={{ color: 'var(--blue)' }} />
            <h3 className="text-base font-bold">Interview Dynamics</h3>
          </div>
          <div className="space-y-2">
            {scorecard.live_notes.map((note, index) => (
              <div key={`${note.question_id}-${index}`} className="rounded-lg p-3" style={{ background: 'var(--fill-quaternary)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <p className="text-xs font-semibold" style={{ color: note.authenticity_signal === 'genuine' ? 'var(--green)' : '#f59e0b' }}>
                    Q{index + 1}: {note.authenticity_signal} · {note.depth_signal} depth
                  </p>
                  {note.insufficiency_reason && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider" style={{ background: 'color-mix(in srgb, var(--purple) 15%, transparent)', color: 'var(--purple)', border: '1px solid color-mix(in srgb, var(--purple) 25%, transparent)' }}>
                      Follow-up: {
                        note.insufficiency_reason === 'lacks_depth' ? 'Lacks Depth' :
                        note.insufficiency_reason === 'lacks_evidence' ? 'Lacks Evidence' :
                        note.insufficiency_reason === 'vague' ? 'Vague' :
                        note.insufficiency_reason === 'irrelevant' ? 'Irrelevant' :
                        note.insufficiency_reason
                      }
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--label-secondary)' }}>{note.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Rationale */}
      <div className="card">
        <p className="text-xs mb-2" style={{ color: 'var(--label-tertiary)' }}>AI Rationale</p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--label-secondary)' }}>{scorecard.ai_rationale}</p>
      </div>
    </div>
  )
}

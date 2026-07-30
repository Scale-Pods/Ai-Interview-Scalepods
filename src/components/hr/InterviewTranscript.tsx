import { useEffect, useState, useRef } from 'react'
import { MessageSquare, Sparkles, Brain, MessageCircle, Search, ChevronDown, ChevronUp, CornerDownRight, HelpCircle } from 'lucide-react'
import { fetchTranscript, type TranscriptEntry } from '@/api/transcript'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

interface InterviewTranscriptProps {
  sessionId: string
  onSeekTo?: (questionId: string) => void
  activeQuestionId?: string | null
}

interface GroupedEntry {
  primary: TranscriptEntry
  followUps: TranscriptEntry[]
}

const typeIcons: Record<string, typeof Brain> = {
  technical: Brain,
  behavioral: MessageCircle,
  situational: MessageSquare,
  cultural: Sparkles
}

const typeColors: Record<string, { color: string; bg: string }> = {
  technical: { color: 'var(--blue)', bg: 'color-mix(in srgb, var(--blue) 10%, transparent)' },
  behavioral: { color: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 10%, transparent)' },
  situational: { color: 'var(--purple)', bg: 'color-mix(in srgb, var(--purple) 10%, transparent)' },
  cultural: { color: 'var(--orange)', bg: 'color-mix(in srgb, var(--orange) 10%, transparent)' }
}

const formatReason = (reason?: string | null) => {
  if (!reason) return null
  switch (reason) {
    case 'lacks_depth': return 'Lacks Depth'
    case 'lacks_evidence': return 'Lacks Evidence'
    case 'vague': return 'Vague Answer'
    case 'irrelevant': return 'Irrelevant'
    default: return reason
  }
}

export function InterviewTranscript({ sessionId, onSeekTo, activeQuestionId }: InterviewTranscriptProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedAnswers, setExpandedAnswers] = useState<Set<string>>(new Set())
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchTranscript(sessionId).then(res => {
      setEntries(res)
      // Expand all answers by default so the recruiter sees full responses
      setExpandedAnswers(new Set(res.map(e => e.questionId)))
    }).finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    if (activeQuestionId && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeQuestionId])

  const toggleAnswer = (id: string) => {
    setExpandedAnswers(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Group entries: associate follow-up questions with their parent primary question
  const buildGroupedEntries = (allEntries: TranscriptEntry[]): GroupedEntry[] => {
    const primaryEntries: TranscriptEntry[] = []
    const followUpMap = new Map<string, TranscriptEntry[]>()

    for (const entry of allEntries) {
      if (entry.source === 'llm_ts_followup' && entry.parentQuestionId) {
        const list = followUpMap.get(entry.parentQuestionId) || []
        list.push(entry)
        followUpMap.set(entry.parentQuestionId, list)
      } else if (entry.source === 'llm_ts_followup') {
        const lastPrimary = primaryEntries[primaryEntries.length - 1]
        if (lastPrimary) {
          const list = followUpMap.get(lastPrimary.questionId) || []
          list.push(entry)
          followUpMap.set(lastPrimary.questionId, list)
        } else {
          primaryEntries.push(entry)
        }
      } else {
        primaryEntries.push(entry)
      }
    }

    return primaryEntries.map(primary => ({
      primary,
      followUps: followUpMap.get(primary.questionId) || []
    }))
  }

  const matchesSearch = (entry: TranscriptEntry, q: string) =>
    entry.question.toLowerCase().includes(q) ||
    entry.answer.toLowerCase().includes(q)

  const grouped = buildGroupedEntries(entries)

  const filteredGrouped = search.trim()
    ? grouped.filter(({ primary, followUps }) => {
        const q = search.trim().toLowerCase()
        return matchesSearch(primary, q) || followUps.some(f => matchesSearch(f, q))
      })
    : grouped

  if (loading) return <LoadingSpinner text="Loading transcript..." />

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--label-tertiary)' }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search transcript..."
          className="w-full rounded-lg pl-9 pr-3 py-2 text-sm"
          style={{
            background: 'var(--fill-quaternary)',
            border: '1px solid var(--separator)',
            color: 'var(--label-primary)'
          }}
        />
      </div>

      {filteredGrouped.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--label-tertiary)' }}>
          <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">{search ? 'No matches found' : 'No transcript available'}</p>
        </div>
      ) : (
        <div className="space-y-4 max-h-[650px] overflow-y-auto pr-1">
          {filteredGrouped.map(({ primary, followUps }, pIndex) => {
            const Icon = typeIcons[primary.questionType as keyof typeof typeIcons] || Brain
            const isPrimaryExpanded = expandedAnswers.has(primary.questionId)
            const isPrimaryActive = activeQuestionId === primary.questionId
            const tc = typeColors[primary.questionType as keyof typeof typeColors] || { color: 'var(--label-secondary)', bg: 'var(--fill-quaternary)' }

            return (
              <div
                key={primary.questionId}
                ref={isPrimaryActive ? activeRef : undefined}
                className="rounded-2xl border transition-all duration-200 overflow-hidden"
                style={{
                  borderColor: isPrimaryActive ? 'color-mix(in srgb, var(--blue) 50%, transparent)' : 'var(--separator)',
                  background: isPrimaryActive ? 'color-mix(in srgb, var(--blue) 4%, transparent)' : 'var(--fill-quaternary)'
                }}
              >
                {/* Primary Question Container */}
                <div
                  className="p-4 cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => onSeekTo?.(primary.questionId)}
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center font-mono font-bold text-xs" style={{ background: tc.bg, color: tc.color, border: `1px solid color-mix(in srgb, ${tc.color} 25%, transparent)` }}>
                      Q{pIndex + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md" style={{ background: tc.bg, color: tc.color }}>
                          {primary.questionType}
                        </span>
                        {followUps.length > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold" style={{ background: 'color-mix(in srgb, var(--purple) 15%, transparent)', color: 'var(--purple)', border: '1px solid color-mix(in srgb, var(--purple) 25%, transparent)' }}>
                            {followUps.length} Follow-up{followUps.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold leading-relaxed" style={{ color: 'var(--label-primary)' }}>
                        {primary.question}
                      </p>
                    </div>
                  </div>

                  {/* Primary Candidate Answer */}
                  <div className="mt-3 pl-11">
                    {primary.answer ? (
                      <div>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleAnswer(primary.questionId) }}
                          className="flex items-center gap-1 text-[11px] font-medium transition mb-1"
                          style={{ color: 'var(--label-tertiary)' }}
                        >
                          {isPrimaryExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {isPrimaryExpanded ? 'Hide candidate answer' : 'Show candidate answer'}
                        </button>
                        {isPrimaryExpanded && (
                          <div className="p-3 rounded-xl text-xs leading-relaxed" style={{ background: 'rgba(0,0,0,0.2)', borderLeft: '3px solid var(--blue)', color: 'var(--label-primary)' }}>
                            <span className="font-semibold block mb-0.5 text-[10px] uppercase tracking-wider" style={{ color: 'var(--blue)' }}>Candidate Response</span>
                            {primary.answer}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs italic" style={{ color: 'var(--label-quaternary)' }}>No answer recorded</p>
                    )}
                  </div>
                </div>

                {/* Nested Follow-up Questions Section (Displayed next to/under the primary question) */}
                {followUps.length > 0 && (
                  <div className="px-4 pb-4 pt-1 ml-6 border-l-2 space-y-3" style={{ borderColor: 'color-mix(in srgb, var(--purple) 30%, transparent)' }}>
                    {followUps.map((fu, fuIndex) => {
                      const isFuActive = activeQuestionId === fu.questionId
                      const isFuExpanded = expandedAnswers.has(fu.questionId)
                      const reasonLabel = formatReason(fu.insufficiencyReason)

                      return (
                        <div
                          key={fu.questionId}
                          ref={isFuActive ? activeRef : undefined}
                          className="p-3.5 rounded-xl border transition-all duration-200 cursor-pointer"
                          style={{
                            borderColor: isFuActive ? 'var(--purple)' : 'color-mix(in srgb, var(--purple) 20%, transparent)',
                            background: isFuActive ? 'color-mix(in srgb, var(--purple) 12%, transparent)' : 'color-mix(in srgb, var(--purple) 5%, transparent)'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSeekTo?.(fu.questionId)
                          }}
                        >
                          <div className="flex items-start gap-2.5">
                            <CornerDownRight size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--purple)' }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                <span className="text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider" style={{ background: 'color-mix(in srgb, var(--purple) 20%, transparent)', color: 'var(--purple)', border: '1px solid color-mix(in srgb, var(--purple) 35%, transparent)' }}>
                                  Follow-up Probe {followUps.length > 1 ? `#${fuIndex + 1}` : ''}
                                </span>
                                {reasonLabel && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold" style={{ background: 'color-mix(in srgb, var(--red) 15%, transparent)', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 25%, transparent)' }}>
                                    Trigger: {reasonLabel}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--label-primary)' }}>
                                {fu.question}
                              </p>
                            </div>
                          </div>

                          {/* Follow-up Answer */}
                          <div className="mt-2.5 pl-6">
                            {fu.answer ? (
                              <div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleAnswer(fu.questionId) }}
                                  className="flex items-center gap-1 text-[10px] font-medium transition mb-1"
                                  style={{ color: 'var(--label-tertiary)' }}
                                >
                                  {isFuExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                  {isFuExpanded ? 'Hide follow-up answer' : 'Show follow-up answer'}
                                </button>
                                {isFuExpanded && (
                                  <div className="p-2.5 rounded-lg text-xs leading-relaxed" style={{ background: 'rgba(0,0,0,0.3)', borderLeft: '3px solid var(--purple)', color: 'var(--label-primary)' }}>
                                    <span className="font-semibold block mb-0.5 text-[9px] uppercase tracking-wider" style={{ color: 'var(--purple)' }}>Follow-up Candidate Answer</span>
                                    {fu.answer}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-[11px] italic" style={{ color: 'var(--label-quaternary)' }}>No follow-up answer recorded</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

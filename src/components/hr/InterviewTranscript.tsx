import { useEffect, useState, useRef } from 'react'
import { MessageSquare, Sparkles, Brain, MessageCircle, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { fetchTranscript, type TranscriptEntry } from '@/api/transcript'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

interface InterviewTranscriptProps {
  sessionId: string
  onSeekTo?: (questionId: string) => void
  activeQuestionId?: string | null
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

export function InterviewTranscript({ sessionId, onSeekTo, activeQuestionId }: InterviewTranscriptProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedAnswers, setExpandedAnswers] = useState<Set<string>>(new Set())
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchTranscript(sessionId).then(setEntries).finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    if (activeQuestionId && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeQuestionId])

  const filtered = search.trim()
    ? entries.filter(e =>
        e.question.toLowerCase().includes(search.toLowerCase()) ||
        e.answer.toLowerCase().includes(search.toLowerCase())
      )
    : entries

  const toggleAnswer = (id: string) => {
    setExpandedAnswers(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) return <LoadingSpinner text="Loading transcript..." />

  return (
    <div className="space-y-3">
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

      {filtered.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--label-tertiary)' }}>
          <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">{search ? 'No matches found' : 'No transcript available'}</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {filtered.map(entry => {
            const Icon = typeIcons[entry.questionType as keyof typeof typeIcons] || Brain
            const isExpanded = expandedAnswers.has(entry.questionId)
            const isActive = activeQuestionId === entry.questionId
            const tc = typeColors[entry.questionType as keyof typeof typeColors] || { color: 'var(--label-secondary)', bg: 'var(--fill-quaternary)' }

            return (
              <div
                key={entry.questionId}
                ref={isActive ? activeRef : undefined}
                className="rounded-xl border transition-all duration-200 cursor-default"
                style={{
                  borderColor: isActive ? 'color-mix(in srgb, var(--blue) 50%, transparent)' : 'var(--separator)',
                  background: isActive ? 'color-mix(in srgb, var(--blue) 5%, transparent)' : 'var(--fill-quaternary)'
                }}
                onClick={() => onSeekTo?.(entry.questionId)}
              >
                <div className="p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: tc.bg, color: tc.color }}>
                      <Icon size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug" style={{ color: 'var(--label-primary)' }}>
                        {entry.question}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-[10px] capitalize px-2 py-0.5 rounded-full font-medium" style={{ background: tc.bg, color: tc.color }}>
                          {entry.questionType}
                        </span>
                        {entry.source === 'llm_ts_followup' && (
                          <>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'color-mix(in srgb, var(--purple) 15%, transparent)', color: 'var(--purple)', border: '1px solid color-mix(in srgb, var(--purple) 25%, transparent)' }}>
                              Follow-up
                              {(() => {
                                const parentIndex = entries.findIndex(e => e.questionId === entry.parentQuestionId)
                                return parentIndex !== -1 ? ` to Q${parentIndex + 1}` : ''
                              })()}
                            </span>
                            {entry.insufficiencyReason && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)' }}>
                                Reason: {
                                  entry.insufficiencyReason === 'lacks_depth' ? 'Lacks Depth' :
                                  entry.insufficiencyReason === 'lacks_evidence' ? 'Lacks Evidence' :
                                  entry.insufficiencyReason === 'vague' ? 'Vague Answer' :
                                  entry.insufficiencyReason === 'irrelevant' ? 'Irrelevant' :
                                  entry.insufficiencyReason
                                }
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {entry.answer ? (
                    <div className="ml-9">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleAnswer(entry.questionId) }}
                        className="flex items-center gap-1 text-[11px] transition mb-1"
                        style={{ color: 'var(--label-tertiary)' }}
                      >
                        {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {isExpanded ? 'Hide answer' : 'Show answer'}
                      </button>
                      {isExpanded && (
                        <p className="text-xs leading-relaxed pl-2" style={{ borderLeft: '2px solid var(--separator)', color: 'var(--label-secondary)' }}>
                          {entry.answer}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="ml-9 text-xs italic" style={{ color: 'var(--label-quaternary)' }}>No answer recorded</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

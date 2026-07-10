import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Mail, ExternalLink, Copy, ArrowUpDown, ArrowUp, ArrowDown,
  Users, Filter, ChevronLeft, ChevronRight, Inbox, UserPlus, Trash2
} from 'lucide-react'
import { fetchSessions } from '@/api/sessions'
import { deleteCandidate } from '@/api/candidates'
import type { InterviewSession } from '@/types'
import { TableSkeleton } from '@/components/common/Skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { formatRelativeTime } from '@/utils/formatDate'
import toast from 'react-hot-toast'

interface CandidateListProps {
  onSessionClick: (session: InterviewSession) => void
}

type SortField = 'name' | 'date' | 'status' | 'score'
type SortDir = 'asc' | 'desc'
type StatusTab = 'all' | 'invited' | 'in_progress' | 'completed' | 'flagged'

const PER_PAGE = 50

const statusTabs: { key: StatusTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'invited', label: 'Invited' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'flagged', label: 'Flagged' },
]

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    completed: 'badge-green',
    in_progress: 'badge-blue',
    invited: 'badge-purple',
    pending: 'badge-grey',
    flagged: 'badge-orange',
    expired: 'badge-grey',
    cancelled: 'badge-grey',
  }
  return map[status] || 'badge-grey'
}

export function CandidateList({ onSessionClick }: CandidateListProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusTab>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<InterviewSession | null>(null)
  const queryClient = useQueryClient()

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    staleTime: 0,
  })

  const deleteMutation = useMutation({
    mutationFn: (candidateId: string) => deleteCandidate(candidateId),
    onSuccess: () => {
      toast.success('Candidate deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      setDeleteTarget(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete candidate')
      setDeleteTarget(null)
    }
  })

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
  }

  const filtered = useMemo(() => {
    let list = sessions

    if (statusFilter !== 'all') {
      list = list.filter(s => s.status === statusFilter)
    }

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.candidates_ai_interview?.name?.toLowerCase().includes(q) ||
        s.candidates_ai_interview?.email?.toLowerCase().includes(q)
      )
    }

    list = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name': {
          const na = a.candidates_ai_interview?.name || ''
          const nb = b.candidates_ai_interview?.name || ''
          cmp = na.localeCompare(nb)
          break
        }
        case 'date':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
        case 'score': {
          const sa = a.scorecards_ai_interview?.[0]?.overall_score ?? -1
          const sb = b.scorecards_ai_interview?.[0]?.overall_score ?? -1
          cmp = sa - sb
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [sessions, statusFilter, search, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, totalPages - 1)
  const pageSessions = filtered.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE)

  const handleResend = async (e: React.MouseEvent, session: InterviewSession) => {
    e.stopPropagation()
    if (session.invite_link) {
      await navigator.clipboard.writeText(session.invite_link)
      toast.success('Invite link copied')
    }
  }

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sessions.length }
  sessions.forEach(s => {
    counts[s.status] = (counts[s.status] || 0) + 1
  })
  return counts
  }, [sessions])

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="opacity-30" />
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  }

  if (isLoading) {
    return (
      <div className="p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Candidates</h1>
        </div>
        <TableSkeleton rows={8} />
      </div>
    )
  }

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Users size={24} style={{ color: 'var(--blue)' }} />
          Candidates
          <span className="text-sm font-normal" style={{ color: 'var(--label-tertiary)' }}>({sessions.length})</span>
        </h1>
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--label-secondary)' }} />
          <input
            type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search by name or email..."
            className="input-field pl-9 pr-4"
          />
        </div>
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {statusTabs.map(tab => {
          const count = tabCounts[tab.key === 'all' ? 'all' : tab.key] || 0
          return (
            <button
              key={tab.key}
              onClick={() => { setStatusFilter(tab.key); setPage(0) }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200`}
              style={{
                background: statusFilter === tab.key ? 'color-mix(in srgb, var(--blue) 15%, transparent)' : 'transparent',
                color: statusFilter === tab.key ? 'var(--blue)' : 'var(--label-secondary)',
                border: 'none'
              }}
            >
              <Filter size={12} />
              {tab.label}
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{
                background: statusFilter === tab.key ? 'color-mix(in srgb, var(--blue) 20%, transparent)' : 'var(--fill-tertiary)',
                color: statusFilter === tab.key ? 'var(--blue)' : 'var(--label-tertiary)'
              }}>{count}</span>
            </button>
          )
        })}
      </div>

      {pageSessions.length === 0 ? (
        <div className="card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-4" style={{ color: 'var(--label-quaternary)' }} />
          <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--label-secondary)' }}>No candidates found</h3>
          <p className="text-sm mb-4" style={{ color: 'var(--label-tertiary)' }}>
            {search ? 'Try a different search term' : 'Create a new interview request to get started'}
          </p>
          {!search && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('navigate-view', { detail: { view: 'new' } }))}
              className="btn-primary"
            >
              <UserPlus size={16} /> New Interview Request
            </button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden" style={{ padding: 0 }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs" style={{ borderBottom: '1px solid var(--separator)', color: 'var(--label-tertiary)' }}>
                  <th className="px-4 py-3.5 font-medium cursor-default select-none" onClick={() => toggleSort('name')}>
                    <div className="flex items-center gap-1"><span>Candidate</span> <SortIcon field="name" /></div>
                  </th>
                  <th className="px-4 py-3.5 font-medium cursor-default select-none" onClick={() => toggleSort('status')}>
                    <div className="flex items-center gap-1"><span>Status</span> <SortIcon field="status" /></div>
                  </th>
                  <th className="px-4 py-3.5 font-medium cursor-default select-none hidden md:table-cell" onClick={() => toggleSort('score')}>
                    <div className="flex items-center gap-1"><span>Score</span> <SortIcon field="score" /></div>
                  </th>
                  <th className="px-4 py-3.5 font-medium cursor-default select-none hidden lg:table-cell" onClick={() => toggleSort('date')}>
                    <div className="flex items-center gap-1"><span>Invited</span> <SortIcon field="date" /></div>
                  </th>
                  <th className="px-4 py-3.5 font-medium hidden md:table-cell">Link</th>
                  <th className="px-4 py-3.5 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {pageSessions.map(session => {
                  const score = session.scorecards_ai_interview?.[0]
                  return (
                    <tr
                      key={session.id}
                      onClick={() => onSessionClick(session)}
                      className="cursor-default group"
                      style={{ borderBottom: '1px solid var(--separator)', transition: 'background 130ms ease' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--fill-quaternary)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'var(--blue)', color: 'white' }}>
                            {session.candidates_ai_interview?.name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="text-sm font-medium" style={{ color: 'var(--label-primary)' }}>{session.candidates_ai_interview?.name || 'Unknown'}</p>
                            <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>{session.candidates_ai_interview?.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`${statusBadge(session.status)}`}>
                          {session.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        {score?.overall_score != null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-12 rounded-full overflow-hidden" style={{ background: 'var(--fill-tertiary)' }}>
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${score.overall_score}%`,
                                  backgroundColor: score.overall_score >= 80 ? 'var(--green)' : score.overall_score >= 60 ? 'var(--yellow)' : 'var(--red)'
                                }}
                              />
                            </div>
                            <span className="text-xs font-medium" style={{ color: 'var(--label-secondary)' }}>{score.overall_score}</span>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--label-quaternary)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs hidden lg:table-cell" style={{ color: 'var(--label-tertiary)' }}>
                        {formatRelativeTime(session.created_at)}
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        {session.invite_link && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={e => handleResend(e, session)}
                              className="flex items-center gap-1 text-xs transition"
                              style={{ color: 'var(--blue)' }}
                            >
                              <Copy size={12} /> Copy
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); onSessionClick(session) }}
                            className="transition p-1"
                            style={{ color: 'var(--label-tertiary)' }}
                            title="View details"
                          >
                            <ExternalLink size={15} />
                          </button>
                          {session.candidate_id && (
                            <button
                              onClick={e => { e.stopPropagation(); setDeleteTarget(session) }}
                              className="transition p-1"
                              style={{ color: 'var(--label-tertiary)' }}
                              title="Delete candidate"
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)' }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--label-tertiary)' }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--separator)' }}>
              <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>
                Showing {(safePage * PER_PAGE) + 1}–{Math.min((safePage + 1) * PER_PAGE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="p-1.5 rounded-lg transition disabled:opacity-30"
                  style={{ color: 'var(--label-secondary)' }}
                >
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const start = Math.max(0, Math.min(safePage - 2, totalPages - 5))
                  const p = start + i
                  if (p >= totalPages) return null
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-7 h-7 rounded-lg text-xs font-medium transition`}
                      style={{
                        background: p === safePage ? 'color-mix(in srgb, var(--blue) 20%, transparent)' : 'transparent',
                        color: p === safePage ? 'var(--blue)' : 'var(--label-secondary)'
                      }}
                    >
                      {p + 1}
                    </button>
                  )
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="p-1.5 rounded-lg transition disabled:opacity-30"
                  style={{ color: 'var(--label-secondary)' }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Candidate"
        message={
          deleteTarget
            ? `Are you sure you want to delete ${deleteTarget.candidates_ai_interview?.name || 'this candidate'} and all their data? This includes all interview sessions, recordings, answers, and scores. This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete Forever"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget?.candidate_id) {
            deleteMutation.mutate(deleteTarget.candidate_id)
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

import { useState } from 'react'
import { XCircle, RefreshCw, Copy, Flag, AlertTriangle, ExternalLink, Calendar } from 'lucide-react'
import toast from 'react-hot-toast'
import type { InterviewSession } from '@/types'
import { updateSessionStatus } from '@/api/sessions'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { formatDateTime } from '@/utils/formatDate'

interface SessionManagerProps {
  session: InterviewSession
  onUpdate: () => void
}

export function SessionManager({ session, onUpdate }: SessionManagerProps) {
  const [showCancel, setShowCancel] = useState(false)
  const [showFlag, setShowFlag] = useState(false)
  const [showExtend, setShowExtend] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCancel = async () => {
    setActionLoading(true)
    try {
      await updateSessionStatus(session.id, 'cancelled')
      toast.success('Session cancelled')
      onUpdate()
    } catch { toast.error('Failed to cancel') }
    finally { setActionLoading(false); setShowCancel(false) }
  }

  const handleFlag = async () => {
    setActionLoading(true)
    try {
      await updateSessionStatus(session.id, 'flagged')
      toast.success('Session flagged for review')
      onUpdate()
    } catch { toast.error('Failed to flag') }
    finally { setActionLoading(false); setShowFlag(false) }
  }

  const handleExtend = async () => {
    setActionLoading(true)
    try {
      const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await (await fetch(`/api/v1/sessions/${session.id}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_at: newExpiry })
      })).json()
      toast.success('Session extended by 7 days')
      onUpdate()
    } catch { toast.error('Failed to extend') }
    finally { setActionLoading(false); setShowExtend(false) }
  }

  const copyLink = () => {
    if (session.invite_link) {
      navigator.clipboard.writeText(session.invite_link)
      setCopied(true)
      toast.success('Link copied')
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const canModify = session.status === 'invited' || session.status === 'pending'
  const isActive = session.status === 'in_progress'
  const isTerminal = session.status === 'completed' || session.status === 'cancelled' || session.status === 'expired'

  const statusBadgeClass = {
    completed: 'badge-green',
    in_progress: 'badge-blue',
    invited: 'badge-purple',
    pending: 'badge-grey',
    flagged: 'badge-orange',
    expired: 'badge-grey',
    cancelled: 'badge-grey'
  }[session.status] || 'badge-grey'

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--label-secondary)' }}>
          <Calendar size={14} /> Session Management
        </h3>
        <span className={`${statusBadgeClass}`}>
          {session.status.replace('_', ' ')}
        </span>
      </div>

      <div className="space-y-2.5 text-sm pt-3" style={{ borderTop: '1px solid var(--separator)' }}>
        <div className="flex justify-between">
          <span style={{ color: 'var(--label-secondary)' }}>Created</span>
          <span className="text-xs" style={{ color: 'var(--label-secondary)' }}>{session.created_at ? formatDateTime(session.created_at) : '—'}</span>
        </div>
        {session.created_by && (
          <div className="flex justify-between">
            <span style={{ color: 'var(--label-secondary)' }}>Created by</span>
            <span className="text-xs font-mono" style={{ color: 'var(--label-secondary)' }}>{session.created_by.slice(0, 8)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span style={{ color: 'var(--label-secondary)' }}>Expires</span>
          <span className={`text-xs font-mono ${new Date(session.expires_at) < new Date() ? 'text-red-400' : ''}`} style={new Date(session.expires_at) < new Date() ? {} : { color: 'var(--label-secondary)' }}>
            {session.expires_at ? formatDateTime(session.expires_at) : '—'}
          </span>
        </div>
        {session.started_at && (
          <div className="flex justify-between">
            <span style={{ color: 'var(--label-secondary)' }}>Started</span>
            <span className="text-xs font-mono" style={{ color: 'var(--label-secondary)' }}>{formatDateTime(session.started_at)}</span>
          </div>
        )}
        {session.completed_at && (
          <div className="flex justify-between">
            <span style={{ color: 'var(--label-secondary)' }}>Completed</span>
            <span className="text-xs font-mono" style={{ color: 'var(--label-secondary)' }}>{formatDateTime(session.completed_at)}</span>
          </div>
        )}
      </div>

      {session.invite_link && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--fill-quaternary)' }}>
          <ExternalLink size={12} className="shrink-0" style={{ color: 'var(--label-tertiary)' }} />
          <span className="text-xs flex-1 truncate" style={{ color: 'var(--label-secondary)' }}>{session.invite_link}</span>
          <button onClick={copyLink} className="shrink-0 transition p-1" style={{ color: 'var(--label-tertiary)' }}>
            <Copy size={14} />
          </button>
          {copied && <span className="text-[10px] shrink-0" style={{ color: 'var(--blue)' }}>Copied!</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {canModify && (
          <>
            <button
              onClick={() => setShowExtend(true)}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-xl transition disabled:opacity-50 min-w-0"
              style={{ background: 'var(--fill-tertiary)', color: 'var(--label-secondary)' }}
            >
              <RefreshCw size={14} /> <span className="hidden sm:inline">Extend</span>
            </button>
            <button
              onClick={() => setShowFlag(true)}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-xl transition disabled:opacity-50 min-w-0"
              style={{ background: 'color-mix(in srgb, var(--orange) 10%, transparent)', color: 'var(--orange)' }}
            >
              <Flag size={14} /> <span className="hidden sm:inline">Flag</span>
            </button>
            <button
              onClick={() => setShowCancel(true)}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-xl transition disabled:opacity-50 min-w-0"
              style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}
            >
              <XCircle size={14} /> <span className="hidden sm:inline">Cancel</span>
            </button>
          </>
        )}
        {isActive && (
          <button
            onClick={() => setShowFlag(true)}
            disabled={actionLoading}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-xl transition disabled:opacity-50"
            style={{ background: 'color-mix(in srgb, var(--orange) 10%, transparent)', color: 'var(--orange)' }}
          >
            <Flag size={14} /> Flag Session
          </button>
        )}
        {isTerminal && (
          <p className="text-xs text-center w-full pt-1" style={{ color: 'var(--label-tertiary)' }}>
            <AlertTriangle size={12} className="inline mr-1" />
            This session is {session.status}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={showCancel}
        title="Cancel Interview Session"
        message="This will cancel the interview for this candidate. The invite link will no longer work. Are you sure?"
        variant="danger"
        confirmLabel="Cancel Session"
        onConfirm={handleCancel}
        onCancel={() => setShowCancel(false)}
      />
      <ConfirmDialog
        open={showFlag}
        title="Flag Session for Review"
        message="This will mark the session as flagged. An admin will need to review it. Continue?"
        variant="danger"
        confirmLabel="Flag Session"
        onConfirm={handleFlag}
        onCancel={() => setShowFlag(false)}
      />
      <ConfirmDialog
        open={showExtend}
        title="Extend Session Expiry"
        message="This will extend the session expiry by 7 more days. The candidate will still be able to access the interview."
        confirmLabel="Extend 7 Days"
        onConfirm={handleExtend}
        onCancel={() => setShowExtend(false)}
      />
    </div>
  )
}

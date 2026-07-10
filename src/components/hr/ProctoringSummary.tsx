import { useEffect, useState } from 'react'
import { AlertTriangle, Eye, Monitor, Mic, Copy, Keyboard, Maximize, Shield, AlertCircle } from 'lucide-react'
import type { ProctoringSummary as ProctoringSummaryType } from '@/types'
import { fetchProctoringSummary, subscribeToProctoringSummary } from '@/api/proctoring'

interface ProctoringSummaryProps {
  sessionId: string
  live?: boolean
  compact?: boolean
  onFlagged?: (flagged: boolean) => void
}

const summaryItems = [
  { key: 'tabSwitches' as const, label: 'Tab Switches', icon: Eye, color: 'var(--orange)', bg: 'color-mix(in srgb, var(--orange) 10%, transparent)' },
  { key: 'windowBlurs' as const, label: 'Window Blurs', icon: Eye, color: 'var(--orange)', bg: 'color-mix(in srgb, var(--orange) 10%, transparent)' },
  { key: 'faceAbsences' as const, label: 'Face Absences', icon: Monitor, color: 'var(--red)', bg: 'color-mix(in srgb, var(--red) 10%, transparent)' },
  { key: 'faceMultiple' as const, label: 'Multiple Faces', icon: Monitor, color: 'var(--red)', bg: 'color-mix(in srgb, var(--red) 15%, transparent)' },
  { key: 'silentPeriods' as const, label: 'Silent Periods', icon: Mic, color: 'var(--blue)', bg: 'color-mix(in srgb, var(--blue) 10%, transparent)' },
  { key: 'fullscreenExits' as const, label: 'Fullscreen Exits', icon: Maximize, color: 'var(--red)', bg: 'color-mix(in srgb, var(--red) 10%, transparent)' },
  { key: 'copyPastes' as const, label: 'Copy/Paste', icon: Copy, color: 'var(--purple)', bg: 'color-mix(in srgb, var(--purple) 10%, transparent)' },
  { key: 'keyboardShortcuts' as const, label: 'Keyboard Shortcuts', icon: Keyboard, color: 'var(--teal)', bg: 'color-mix(in srgb, var(--teal) 10%, transparent)' },
]

export function ProctoringSummary({ sessionId, live, compact, onFlagged }: ProctoringSummaryProps) {
  const [summary, setSummary] = useState<ProctoringSummaryType | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchProctoringSummary(sessionId)
        setSummary(data)
        onFlagged?.(data.criticalEvents >= 3)
      } catch {
        setSummary(null)
      } finally {
        setLoading(false)
      }
    }
    load()

    let unsub: (() => void) | undefined
    if (live) {
      subscribeToProctoringSummary(sessionId, (data) => {
        setSummary(data)
        onFlagged?.(data.criticalEvents >= 3)
      }).then(u => { unsub = u })
    }
    return () => unsub?.()
  }, [sessionId, live, onFlagged])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--label-tertiary)' }}>
        <div className="h-3 w-3 rounded-full animate-spin" style={{ border: '2px solid rgba(120,120,128,0.3)', borderTopColor: 'var(--blue)' }} />
        Loading proctoring data...
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="text-sm" style={{ color: 'var(--label-tertiary)' }}>Unable to load proctoring data</div>
    )
  }

  const hasIssues = summary.totalEvents > 0
  const isFlagged = summary.criticalEvents >= 3

  if (compact) {
    const criticalCount = summary.criticalEvents
    const totalWarnings = summary.warningEvents

    return (
      <div className="flex items-center gap-3">
        {criticalCount > 0 && (
          <div className="badge-red flex items-center gap-1.5 text-xs">
            <AlertCircle size={12} />
            {criticalCount} critical
          </div>
        )}
        <div className="badge-orange flex items-center gap-1.5 text-xs">
          <Eye size={12} />
          {summary.tabSwitches} switches
        </div>
        {totalWarnings > 0 && (
          <div className="badge-grey flex items-center gap-1.5 text-xs">
            <AlertTriangle size={12} />
            {totalWarnings} warnings
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {hasIssues && (
        <div className={`px-4 py-3 rounded-xl border text-sm flex items-center gap-3 ${
          isFlagged ? 'badge-red' : 'badge-orange'
        }`}>
          <Shield size={18} />
          <span>
            {isFlagged
              ? 'Interview flagged: multiple critical violations detected'
              : `${summary.totalEvents} proctoring event${summary.totalEvents !== 1 ? 's' : ''} recorded`
            }
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {summaryItems.map(item => {
          const count = summary[item.key]
          const Icon = item.icon
          return (
            <div key={item.key} className="rounded-xl p-3" style={{ background: item.bg, border: '1px solid var(--separator)' }}>
              <div className="flex items-center justify-between mb-1">
                <Icon size={16} style={{ color: item.color }} />
                <span className="text-lg font-bold" style={{ color: 'var(--label-primary)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--label-secondary)' }}>{item.label}</p>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--label-tertiary)' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--green)' }} />
          <span>No issues: {summary.totalEvents === 0 ? 'Yes' : 'No'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--orange)' }} />
          <span>Warnings: {summary.warningEvents}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--red)' }} />
          <span>Critical: {summary.criticalEvents}</span>
        </div>
      </div>
    </div>
  )
}

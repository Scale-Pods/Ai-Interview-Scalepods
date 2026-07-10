function safeDate(dateStr: string | number | undefined | null): Date | null {
  if (dateStr == null || dateStr === '') return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return d
}

export function formatDate(dateStr: string | number | undefined | null): string {
  const d = safeDate(dateStr)
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }).format(d)
}

export function formatDateTime(dateStr: string | number | undefined | null): string {
  const d = safeDate(dateStr)
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(d)
}

export function formatRelativeTime(dateStr: string | number | undefined | null): string {
  const d = safeDate(dateStr)
  if (!d) return '—'
  const ms = Date.now() - d.getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(dateStr)
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIdx = 0
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024
    unitIdx++
  }
  return `${size.toFixed(1)} ${units[unitIdx]}`
}

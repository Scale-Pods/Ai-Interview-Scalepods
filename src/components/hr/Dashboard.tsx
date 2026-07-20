import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell, PieChart, Pie, AreaChart, Area } from 'recharts'
import {
  LayoutDashboard, Users, Clock, TrendingUp, Activity,
  Send, Play, UserPlus, RefreshCw, Sparkles, ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import { fetchDashboardStats } from '@/api/candidates'
import type { DashboardStats } from '@/types'
import { CardSkeleton, TableSkeleton } from '@/components/common/Skeleton'
import { formatRelativeTime } from '@/utils/formatDate'

function StatCard({ label, value, icon: Icon, trend, color, subtitle }: {
  label: string; value: string | number; icon: typeof Users; trend?: number; color: string; subtitle?: string
}) {
  const accentMap: Record<string, string> = {
    blue: 'var(--blue)',
    amber: 'var(--orange)',
    green: 'var(--green)',
    violet: 'var(--purple)',
  }

  return (
    <div className="card card-hover" style={{ '--tile-accent-color': accentMap[color] || 'var(--blue)' } as React.CSSProperties}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--fill-quaternary)' }}>
          <Icon size={18} style={{ color: accentMap[color] || 'var(--blue)' }} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-0.5 text-xs font-medium ${trend >= 0 ? 'trend up' : 'trend down'}`}>
            {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <p className="metric-tile value" style={{ fontSize: '28px', margin: '0 0 2px' }}>{value}</p>
      <p className="label" style={{ fontSize: '13px' }}>{label}</p>
      {subtitle && <p style={{ fontSize: '11px', color: 'var(--label-tertiary)', marginTop: '2px' }}>{subtitle}</p>}
    </div>
  )
}

function FunnelChart({ data }: { data: DashboardStats['funnelCounts'] }) {
  const stages = [
    { key: 'invited', label: 'Invited', count: data.invited, color: 'var(--blue)' },
    { key: 'started', label: 'Started', count: data.started, color: 'var(--purple)' },
    { key: 'completed', label: 'Completed', count: data.completed, color: 'var(--green)' },
    { key: 'scored', label: 'Scored', count: data.scored, color: 'var(--teal)' },
  ]
  const maxCount = Math.max(...stages.map(s => s.count), 1)

  return (
    <div className="card">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--label-secondary)' }}>
        <Activity size={14} /> Completion Funnel
      </h3>
      <div className="space-y-3">
        {stages.map(s => {
          const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span style={{ color: 'var(--label-secondary)' }}>{s.label}</span>
                <span className="font-semibold" style={{ color: 'var(--label-primary)' }}>{s.count}</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--fill-quaternary)' }}>
                <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: s.color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScoreBarChart({ data }: { data: DashboardStats['scoreDistribution'] }) {
  const chartColors = ['var(--red)', 'var(--orange)', 'var(--yellow)', 'var(--green)', 'var(--teal)']

  return (
    <div className="card">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--label-secondary)' }}>
        <TrendingUp size={14} /> Score Distribution
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="range" fontSize={12} axisLine={false} tickLine={false} />
          <YAxis fontSize={12} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: 'var(--glass-fill)',
              backdropFilter: 'blur(40px) saturate(180%)',
              border: 'none',
              borderRadius: '10px',
              color: 'var(--label-primary)',
              fontSize: '12px',
              outline: '1px solid var(--glass-border)',
              boxShadow: 'var(--glass-shadow)'
            }}
            cursor={{ fill: 'rgba(10,132,255,0.08)' }}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
            {data.map((_, idx) => (
              <Cell key={idx} fill={chartColors[idx]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function RecDonut({ data }: { data: DashboardStats['recommendationBreakdown'] }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  const chartData = [
    { name: 'Strong Hire', value: data.strong_hire, color: 'var(--green)' },
    { name: 'Hire', value: data.hire, color: 'var(--teal)' },
    { name: 'Consider', value: data.consider, color: 'var(--orange)' },
    { name: 'No Go', value: data.no_go, color: 'var(--red)' },
  ].filter(d => d.value > 0)

  if (total === 0) {
    return (
      <div className="card">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--label-secondary)' }}>
          <Sparkles size={14} /> Recommendation Breakdown
        </h3>
        <div className="flex items-center justify-center h-[200px] text-sm" style={{ color: 'var(--label-tertiary)' }}>
          No scored interviews yet
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--label-secondary)' }}>
        <Sparkles size={14} /> Recommendation Breakdown
      </h3>
      <div className="flex items-center gap-6">
        <ResponsiveContainer width={160} height={160}>
          <PieChart>
            <Pie
              data={chartData} cx="50%" cy="50%" innerRadius={44} outerRadius={72}
              dataKey="value" paddingAngle={2}
            >
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--glass-fill)',
                backdropFilter: 'blur(40px) saturate(180%)',
                border: 'none',
                borderRadius: '10px',
                color: 'var(--label-primary)',
                fontSize: '12px',
                outline: '1px solid var(--glass-border)',
                boxShadow: 'var(--glass-shadow)'
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-2">
          {chartData.map(d => (
            <div key={d.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span style={{ color: 'var(--label-secondary)' }}>{d.name}</span>
              </div>
              <span className="font-semibold" style={{ color: 'var(--label-primary)' }}>{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MiniAreaChart({ sessions }: { sessions: DashboardStats['recentSessions'] }) {
  const days: Record<string, number> = {}
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days[d.toLocaleDateString('en', { weekday: 'short' })] = 0
  }
  sessions.forEach(s => {
    const d = new Date(s.created_at).toLocaleDateString('en', { weekday: 'short' })
    if (d in days) days[d]++
  })
  const data = Object.entries(days).map(([name, count]) => ({ name, count }))

  return (
    <ResponsiveContainer width="100%" height={60}>
      <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <Area type="monotone" dataKey="count" stroke="var(--blue)" strokeWidth={2} fill="url(#gradient)" />
        <defs>
          <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.35} />
            <stop offset="75%" stopColor="var(--blue)" stopOpacity={0.05} />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity={0} />
          </linearGradient>
        </defs>
      </AreaChart>
    </ResponsiveContainer>
  )
}

function RecentActivity({ sessions, onSessionClick }: {
  sessions: DashboardStats['recentSessions']
  onSessionClick: (id: string) => void
}) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--label-secondary)' }}>
        <Clock size={14} /> Recent Activity
      </h3>
      <div className="space-y-1 max-h-[340px] overflow-y-auto">
        {sessions.length === 0 && (
          <p className="text-sm text-center py-8" style={{ color: 'var(--label-tertiary)' }}>No sessions yet</p>
        )}
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => onSessionClick(s.id)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 text-left group"
            style={{ color: 'var(--label-primary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--fill-quaternary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'var(--blue)', color: 'white' }}>
              {s.candidates_ai_interview?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--label-primary)' }}>
                {s.candidates_ai_interview?.name || 'Unknown Candidate'}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--label-tertiary)' }}>
                {formatRelativeTime(s.created_at)}
              </p>
            </div>
            <span className={`${
              s.status === 'completed' ? 'badge-green' :
              s.status === 'in_progress' ? 'badge-blue' :
              s.status === 'invited' ? 'badge-purple' :
              'badge-grey'
            }`}>
              {s.status.replace('_', ' ')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function QuickActions({ onNewCandidate }: { onNewCandidate: () => void }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--label-secondary)' }}>
        <Send size={14} /> Quick Actions
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onNewCandidate}
          className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200 group"
          style={{ background: 'color-mix(in srgb, var(--blue) 10%, transparent)' }}
        >
          <UserPlus size={20} style={{ color: 'var(--blue)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--blue)' }}>New Candidate</span>
        </button>
        <button
          onClick={() => document.querySelector('[data-view="candidates"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))}
          className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200 group"
          style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)' }}
        >
          <Play size={20} style={{ color: 'var(--green)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--green)' }}>Active Sessions</span>
        </button>
      </div>
    </div>
  )
}

export function Dashboard() {
  const { data: stats, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-2">
          <LayoutDashboard size={24} style={{ color: 'var(--blue)' }} />
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><TableSkeleton rows={4} /></div>
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (isError || !stats) {
    return (
      <div className="p-6 animate-fade-in">
        <div className="card p-8 text-center">
          <p className="mb-2" style={{ color: 'var(--label-secondary)' }}>Failed to load dashboard</p>
          <button onClick={() => window.location.reload()} className="btn-primary text-sm">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <LayoutDashboard size={24} style={{ color: 'var(--blue)' }} />
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>
              Last updated {formatRelativeTime(dataUpdatedAt ?? stats.recentSessions?.[0]?.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--label-tertiary)' }}>
          <RefreshCw size={12} />
          Auto-refreshes every 60s
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Candidates" value={stats.totalCandidates} icon={Users} color="blue" subtitle={`${stats.totalSessions} sessions`} />
        <StatCard label="Invited Today" value={stats.invitedToday} icon={Send} trend={stats.invitedToday > 0 ? stats.invitedToday * 20 : 0} color="amber" subtitle={`${stats.pendingInvites} pending`} />
        <StatCard label="In Progress" value={stats.startedToday} icon={Play} color="violet" subtitle="started today" />
        <StatCard label="Avg Score" value={`${stats.averageScore}%`} icon={TrendingUp} color="green" subtitle={`${stats.completedInterviews} completed`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
        <FunnelChart data={stats.funnelCounts} />
        <div className="xl:col-span-2">
          <ScoreBarChart data={stats.scoreDistribution} />
        </div>
        <RecDonut data={stats.recommendationBreakdown} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          {stats.recentSessions.length > 0 && (
            <RecentActivity
              sessions={stats.recentSessions}
              onSessionClick={(id) => {
                const event = new CustomEvent('navigate-session', { detail: { id } })
                window.dispatchEvent(event)
              }}
            />
          )}
        </div>
        <div className="space-y-6">
          <QuickActions
            onNewCandidate={() => {
              const event = new CustomEvent('navigate-view', { detail: { view: 'new' } })
              window.dispatchEvent(event)
            }}
          />
          <MiniAreaChart sessions={stats.recentSessions} />
        </div>
      </div>
    </div>
  )
}

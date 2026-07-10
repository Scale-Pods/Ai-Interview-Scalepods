import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuthContext } from '@/context/AuthContext'
import { InterviewProvider } from '@/context/InterviewContext'
import { ProctoringProvider } from '@/context/ProctoringContext'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ToastProvider } from '@/components/common/Toast'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { Dashboard } from '@/components/hr/Dashboard'
import { CandidateForm } from '@/components/hr/CandidateForm'
import { CandidateList } from '@/components/hr/CandidateList'
import { ProctoringDashboard } from '@/components/hr/ProctoringDashboard'
import { ProctoringSummary } from '@/components/hr/ProctoringSummary'
import { ScorecardViewer } from '@/components/hr/ScorecardViewer'
import { RecordingPlayer } from '@/components/hr/RecordingPlayer'
import { CandidateTimeline } from '@/components/hr/CandidateTimeline'
import { SessionManager } from '@/components/hr/SessionManager'
import { InterviewTranscript } from '@/components/hr/InterviewTranscript'
import { InterviewRoom } from '@/components/candidate/InterviewRoom'
import {
  LayoutDashboard, Users, UserPlus, Shield, LogOut,
  Bot, ChevronLeft, ChevronRight, Sparkles, Building2,
  Sun, Moon
} from 'lucide-react'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { useState, useEffect } from 'react'
import type { InterviewSession } from '@/types'

const queryClient = new QueryClient()

function HRAppShell() {
  const { user, role, logout } = useAuthContext()
  const { theme, toggleTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedSession, setSelectedSession] = useState<InterviewSession | null>(null)
  const [view, setView] = useState<'dashboard' | 'candidates' | 'new' | 'proctoring' | 'session'>('dashboard')

  useEffect(() => {
    const onNavigateView = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.view) setView(detail.view as typeof view)
    }
    const onNavigateSession = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.id) {
        const s = document.querySelector('[data-session-id]')
        if (s) { s.dispatchEvent(new MouseEvent('click', { bubbles: true })) }
      }
    }
    window.addEventListener('navigate-view', onNavigateView)
    window.addEventListener('navigate-session', onNavigateSession)
    return () => {
      window.removeEventListener('navigate-view', onNavigateView)
      window.removeEventListener('navigate-session', onNavigateSession)
    }
  }, [])

  const navItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'candidates' as const, label: 'Candidates', icon: Users },
    { id: 'new' as const, label: 'New Request', icon: UserPlus },
    { id: 'proctoring' as const, label: 'Proctoring', icon: Shield },
  ]

  return (
    <div className="flex h-screen">
      <aside className={`${sidebarOpen ? 'w-60' : 'w-16'} sidebar flex flex-col transition-all duration-300 ease-in-out relative z-10`}>
        <div className="h-16 flex items-center gap-3 px-4 shrink-0" style={{ borderBottom: '1px solid var(--separator)' }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--blue)' }}>
            <Bot size={18} className="text-white" />
          </div>
          <div className={`overflow-hidden transition-all duration-300 ${sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
            <h1 className="text-sm font-bold leading-tight" style={{ color: 'var(--label-primary)' }}>AI Interviewer</h1>
            <p className="text-[10px] leading-tight" style={{ color: 'var(--label-secondary)' }}>HR Management Suite</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const Icon = item.icon
            const isActive = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => { setView(item.id); setSelectedSession(null) }}
                className={`nav-item w-full ${isActive ? 'active' : ''}`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5" style={{ background: 'var(--blue)', borderRadius: '0 2px 2px 0' }} />
                )}
                <Icon size={18} className="shrink-0" />
                <span className={`overflow-hidden transition-all duration-300 ${sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
                  {item.label}
                </span>
              </button>
            )
          })}
        </nav>

        <div className="p-3 pb-0">
          <button
            onClick={toggleTheme}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all duration-200 mb-1 ${!sidebarOpen && 'justify-center'}`}
            style={{ color: 'var(--label-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--fill-tertiary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span className={`overflow-hidden transition-all duration-300 ${sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </span>
          </button>
        </div>

        <div className="p-3 pt-0 space-y-2" style={{ borderTop: '1px solid var(--separator)' }}>
          <div className={`flex items-center gap-3 px-3 py-2 ${!sidebarOpen && 'justify-center'}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'var(--blue)', color: 'white' }}>
              {user?.email?.[0]?.toUpperCase() || 'H'}
            </div>
            <div className={`overflow-hidden transition-all duration-300 ${sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
              <p className="text-xs font-medium truncate max-w-[140px]" style={{ color: 'var(--label-primary)' }}>{user?.email}</p>
              <p className="text-[10px] capitalize font-medium" style={{ color: 'var(--blue)' }}>{role?.replace('hr_', '') || 'user'}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all duration-200 ${!sidebarOpen && 'justify-center'}`}
            style={{ color: 'var(--label-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'rgba(255,69,58,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--label-secondary)'; e.currentTarget.style.background = 'transparent' }}
          >
            <LogOut size={14} />
            <span className={`overflow-hidden transition-all duration-300 ${sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>Sign Out</span>
          </button>
        </div>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200"
          style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--separator)', color: 'var(--label-secondary)' }}
        >
          {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto scrollbar-thin">
        {view === 'dashboard' && <Dashboard />}
        {view === 'candidates' && (
          selectedSession ? (
            <SessionDetail session={selectedSession} onBack={() => setSelectedSession(null)} />
          ) : (
            <CandidateList onSessionClick={setSelectedSession} />
          )
        )}
        {view === 'new' && <CandidateForm onSuccess={() => setView('candidates')} />}
        {view === 'proctoring' && <ProctoringDashboard />}
        {view === 'session' && selectedSession && (
          <SessionDetail session={selectedSession} onBack={() => setSelectedSession(null)} />
        )}
      </main>
    </div>
  )
}

function SessionDetail({ session, onBack }: { session: InterviewSession; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'scorecard' | 'recordings' | 'timeline' | 'transcript' | 'proctoring'>('overview')

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'scorecard' as const, label: 'Scorecard' },
    { id: 'recordings' as const, label: 'Recordings' },
    { id: 'transcript' as const, label: 'Transcript' },
    { id: 'timeline' as const, label: 'Timeline' },
    { id: 'proctoring' as const, label: 'Proctoring' },
  ]

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="btn-ghost -ml-2">
          ← Back
        </button>
        <h1 className="text-xl font-bold">{session.candidates_ai_interview?.name || 'Session'}</h1>
        <span className={`${
          session.status === 'completed' ? 'badge-green' :
          session.status === 'in_progress' ? 'badge-blue' :
          'badge-grey'
        }`}>{session.status.replace('_', ' ')}</span>
      </div>

      <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--separator)' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-all duration-200`}
            style={{
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--blue)' : 'transparent'}`,
              color: activeTab === tab.id ? 'var(--blue)' : 'var(--label-tertiary)'
            }}
            onMouseEnter={e => { if (activeTab !== tab.id) { e.currentTarget.style.color = 'var(--label-secondary)' } }}
            onMouseLeave={e => { if (activeTab !== tab.id) { e.currentTarget.style.color = 'var(--label-tertiary)' } }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="card">
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--label-secondary)' }}>Candidate Info</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--separator)' }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Name</span>
                  <span className="font-medium">{session.candidates_ai_interview?.name}</span>
                </div>
                <div className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--separator)' }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Email</span>
                  <span>{session.candidates_ai_interview?.email}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span style={{ color: 'var(--label-secondary)' }}>Session ID</span>
                  <span className="font-mono text-xs">{session.id}</span>
                </div>
              </div>
            </div>
          </div>
          <SessionManager session={session} onUpdate={() => {}} />
        </div>
      )}

      {activeTab === 'scorecard' && <ScorecardViewer sessionId={session.id} />}
      {activeTab === 'recordings' && <RecordingPlayer sessionId={session.id} />}
      {activeTab === 'transcript' && <InterviewTranscript sessionId={session.id} />}
      {activeTab === 'timeline' && <CandidateTimeline session={session} />}
      {activeTab === 'proctoring' && (
        <div className="space-y-4">
          <ProctoringSummary sessionId={session.id} />
        </div>
      )}
    </div>
  )
}

function LoginPage() {
  const { user, loginWithSSO, login, signUp } = useAuthContext()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      if (mode === 'signin') {
        await login(email, password)
        navigate('/', { replace: true })
      } else {
        await signUp(email, password, 'hr_admin')
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError((err as Error).message || 'Invalid credentials')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full pointer-events-none" style={{ background: 'var(--blue)', opacity: 0.08, filter: 'blur(64px)' }} />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full pointer-events-none" style={{ background: 'var(--purple)', opacity: 0.06, filter: 'blur(64px)' }} />

      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 w-9 h-9 rounded-lg flex items-center justify-center z-50 transition-all duration-200"
        style={{ background: 'var(--fill-tertiary)', color: 'var(--label-secondary)' }}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <div className="relative w-full max-w-sm animate-slide-up">
        <div className="card liquid-card-lg">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--blue)' }}>
              <Bot size={28} className="text-white" />
            </div>
            <h1 className="text-xl font-bold">AI Interviewer</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--label-secondary)' }}>
              {mode === 'signin' ? 'Sign in to your account' : 'Create a new account'}
            </p>
          </div>

          {error && (
            <div className={`text-sm p-3 rounded-xl mb-4 flex items-center gap-2 ${
              error.startsWith('Account created') ? 'badge-green' : 'badge-red'
            }`}>
              <Sparkles size={14} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--label-secondary)' }}>Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com" required
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--label-secondary)' }}>Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required minLength={6}
                className="input-field"
              />
            </div>
            <button type="submit" className="btn-primary w-full py-2.5">
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs" style={{ color: 'var(--label-tertiary)' }}>
            <div className="flex-1 h-px" style={{ background: 'var(--separator)' }} />
            <span>OR</span>
            <div className="flex-1 h-px" style={{ background: 'var(--separator)' }} />
          </div>

          <button
            onClick={loginWithSSO}
            className="w-full flex items-center justify-center gap-3 py-2.5 rounded-xl font-medium transition-all duration-200 text-sm"
            style={{ background: 'var(--fill-quaternary)', color: 'var(--label-primary)', border: '1px solid var(--separator)' }}
          >
            <Building2 size={16} />
            Sign In with SSO
          </button>

          <p className="mt-5 text-xs text-center" style={{ color: 'var(--label-tertiary)' }}>
            {mode === 'signin' ? (
              <>No account?{' '}
                <button onClick={() => setMode('signup')} className="font-medium transition-colors" style={{ color: 'var(--blue)' }}>
                  Sign up
                </button>
              </>
            ) : (
              <>Already have one?{' '}
                <button onClick={() => setMode('signin')} className="font-medium transition-colors" style={{ color: 'var(--blue)' }}>
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext()
  if (loading) return <LoadingSpinner text="Authenticating..." />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider />
          <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/interview/:token" element={
                <ProctoringProvider>
                  <InterviewProvider>
                    <InterviewRoom />
                  </InterviewProvider>
                </ProctoringProvider>
              } />
              <Route path="/" element={<AuthGuard><HRAppShell /></AuthGuard>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </ThemeProvider>
  )
}

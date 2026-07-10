import { useEffect, useState } from 'react'
import { CheckCircle, Sparkles, Clock, Mail, FileText, ArrowRight } from 'lucide-react'

const ESTIMATED_MINUTES = 5

function ConfettiParticle({ delay, left }: { delay: number; left: number }) {
  const colors = ['var(--blue)', 'var(--green)', 'var(--orange)', 'var(--purple)', 'var(--teal)', 'var(--pink)']
  const color = colors[Math.floor(Math.random() * colors.length)]
  return (
    <div
      className="absolute w-2 h-2 rounded-full opacity-0"
      style={{
        left: `${left}%`,
        top: '-10px',
        animation: `confetti-fall 2.5s ease-out ${delay}s forwards`,
        backgroundColor: color,
      }}
    />
  )
}

export function Completion() {
  const [showContent, setShowContent] = useState(false)
  const [particles] = useState(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      delay: Math.random() * 1.5,
      left: Math.random() * 100,
    }))
  )

  useEffect(() => {
    const t = setTimeout(() => setShowContent(true), 400)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        {particles.map(p => (
          <ConfettiParticle key={p.id} delay={p.delay} left={p.left} />
        ))}
      </div>

      <div className={`max-w-lg w-full text-center transition-all duration-700 ${
        showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}>
        <div className="relative mb-8 inline-block">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
            style={{ background: 'linear-gradient(135deg, var(--green), #34d399)' }}>
            <CheckCircle size={44} className="text-white" />
          </div>
          <div className="absolute -top-1 -right-1">
            <Sparkles size={20} className="animate-pulse" style={{ color: 'var(--orange)' }} />
          </div>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold mb-3" style={{ background: 'linear-gradient(to right, var(--label-primary), var(--label-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Thank You!
        </h1>
        <p className="mb-8 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--label-secondary)' }}>
          Your interview has been submitted successfully. We appreciate the time and effort you put into your responses.
        </p>

        <div className="card p-6 mb-6 text-left animate-fade-in">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--label-primary)' }}>
            <ArrowRight size={14} style={{ color: 'var(--blue)' }} />
            What Happens Next
          </h2>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--blue) 10%, transparent)' }}>
                <FileText size={16} style={{ color: 'var(--blue)' }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--label-primary)' }}>AI Evaluation</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--label-tertiary)' }}>Your responses are analyzed against the job criteria</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)' }}>
                <FileText size={16} style={{ color: 'var(--green)' }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--label-primary)' }}>Scorecard Generated</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--label-tertiary)' }}>A detailed report with strengths, areas for growth, and overall score</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--orange) 10%, transparent)' }}>
                <Mail size={16} style={{ color: 'var(--orange)' }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--label-primary)' }}>HR Review</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--label-tertiary)' }}>The hiring team reviews and follows up with next steps</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl mb-6 animate-fade-in" style={{ background: 'var(--fill-quaternary)' }}>
          <Clock size={14} style={{ color: 'var(--label-secondary)' }} />
          <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>
            Scorecard results typically available in about{' '}
            <span className="font-semibold" style={{ color: 'var(--label-primary)' }}>{ESTIMATED_MINUTES} minutes</span>
          </p>
        </div>

        <p className="text-xs" style={{ color: 'var(--label-quaternary)' }}>
          You may now safely close this window.
        </p>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Brain, Mic, Search, CheckCircle, AlertTriangle } from 'lucide-react'
import type { LiveAssessmentNote } from '@/types'

interface RecruiterPersonaProps {
  isAiSpeaking: boolean
  isAnalyzingAnswer: boolean
  isGeneratingTurn: boolean
  liveAssessmentNotes: LiveAssessmentNote[]
  currentQuestionIndex: number
  currentQuestionId: string
}

type PersonaState = 'idle' | 'speaking' | 'analyzing' | 'generating'

function getSignalColor(signal: LiveAssessmentNote['authenticity_signal']): string {
  switch (signal) {
    case 'genuine': return 'var(--green)'
    case 'vague': return 'var(--orange)'
    case 'suspicious': return 'var(--red)'
    case 'inconsistent': return 'var(--red)'
    default: return 'var(--label-secondary)'
  }
}

function getSignalIcon(signal: LiveAssessmentNote['authenticity_signal']) {
  switch (signal) {
    case 'genuine': return CheckCircle
    case 'vague': return AlertTriangle
    case 'suspicious': return AlertTriangle
    case 'inconsistent': return AlertTriangle
    default: return CheckCircle
  }
}

function getSignalLabel(signal: LiveAssessmentNote['authenticity_signal']): string {
  switch (signal) {
    case 'genuine': return 'Detailed answer'
    case 'vague': return 'Following up...'
    case 'suspicious': return 'Probing deeper'
    case 'inconsistent': return 'Clarifying...'
    default: return ''
  }
}

export function RecruiterPersona({
  isAiSpeaking,
  isAnalyzingAnswer,
  isGeneratingTurn,
  liveAssessmentNotes,
  currentQuestionIndex,
  currentQuestionId
}: RecruiterPersonaProps) {
  const [personaState, setPersonaState] = useState<PersonaState>('idle')
  const [statusText, setStatusText] = useState('Listening...')
  const [pulseKey, setPulseKey] = useState(0)

  // Latest note that is relevant to current question
  const latestNote = liveAssessmentNotes[liveAssessmentNotes.length - 1] || null

  useEffect(() => {
    if (isAiSpeaking) {
      setPersonaState('speaking')
      setStatusText('Speaking...')
    } else if (isAnalyzingAnswer) {
      setPersonaState('analyzing')
      setStatusText('Analyzing response...')
    } else if (isGeneratingTurn) {
      setPersonaState('generating')
      setStatusText('Thinking...')
    } else {
      setPersonaState('idle')
      setStatusText('Listening...')
    }
    setPulseKey(k => k + 1)
  }, [isAiSpeaking, isAnalyzingAnswer, isGeneratingTurn])

  const getAvatarStyle = () => {
    const base = {
      width: 56,
      height: 56,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      position: 'relative' as const,
      transition: 'all 0.3s ease'
    }
    switch (personaState) {
      case 'speaking':
        return { ...base, background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 0 0 3px rgba(99,102,241,0.3)' }
      case 'analyzing':
        return { ...base, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', boxShadow: '0 0 0 3px rgba(245,158,11,0.3)' }
      case 'generating':
        return { ...base, background: 'linear-gradient(135deg, #10b981, #3b82f6)', boxShadow: '0 0 0 3px rgba(16,185,129,0.3)' }
      default:
        return { ...base, background: 'linear-gradient(135deg, #1d4ed8, #6d28d9)' }
    }
  }

  const StateIcon = personaState === 'speaking' ? Mic
    : personaState === 'analyzing' ? Search
    : personaState === 'generating' ? Brain
    : Mic

  return (
    <div
      className="rounded-2xl p-4 space-y-3 animate-fade-in"
      style={{
        background: 'rgba(28,28,30,0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.07)'
      }}
    >
      {/* Avatar row */}
      <div className="flex items-center gap-3">
        <div style={getAvatarStyle()}>
          {/* Pulse ring when active */}
          {personaState !== 'idle' && (
            <div
              key={pulseKey}
              className="absolute inset-0 rounded-full animate-ping opacity-30"
              style={{
                background: personaState === 'speaking' ? '#6366f1'
                  : personaState === 'analyzing' ? '#f59e0b'
                  : '#10b981'
              }}
            />
          )}
          <StateIcon
            size={22}
            className={`relative z-10 text-white ${personaState !== 'idle' ? 'animate-pulse' : ''}`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--label-primary)' }}>
            Alex
          </p>
          <p className="text-xs" style={{ color: 'var(--label-tertiary)' }}>
            AI Technical Recruiter
          </p>
        </div>

        {/* Live activity indicator */}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${personaState !== 'idle' ? 'animate-pulse' : ''}`}
            style={{
              background: personaState === 'speaking' ? '#6366f1'
                : personaState === 'analyzing' ? '#f59e0b'
                : personaState === 'generating' ? '#10b981'
                : 'rgba(255,255,255,0.2)'
            }}
          />
        </div>
      </div>

      {/* Status text */}
      <div
        className="rounded-xl px-3 py-2 text-xs"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          color: 'var(--label-secondary)'
        }}
      >
        <div className="flex items-center gap-2">
          {personaState !== 'idle' && (
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
              style={{
                background: personaState === 'speaking' ? '#6366f1'
                  : personaState === 'analyzing' ? '#f59e0b'
                  : '#10b981'
              }}
            />
          )}
          <span>{statusText}</span>
        </div>
      </div>

      {/* Latest assessment signal — shown after the answer is submitted,
           i.e. when the latest note belongs to a completed (previous) question,
           not the question currently being asked. */}
      {latestNote && latestNote.question_id !== currentQuestionId && (
        <div
          className="rounded-xl px-3 py-2 text-[10px] animate-fade-in"
          style={{
            background: `color-mix(in srgb, ${getSignalColor(latestNote.authenticity_signal)} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${getSignalColor(latestNote.authenticity_signal)} 20%, transparent)`,
          }}
        >
          {(() => {
            const Icon = getSignalIcon(latestNote.authenticity_signal)
            return (
              <div className="flex items-center gap-1.5">
                <Icon size={11} style={{ color: getSignalColor(latestNote.authenticity_signal), flexShrink: 0 }} />
                <span style={{ color: getSignalColor(latestNote.authenticity_signal) }}>
                  {getSignalLabel(latestNote.authenticity_signal)}
                </span>
              </div>
            )
          })()}
        </div>
      )}

      {/* Progress context */}
      <p className="text-[10px] text-center" style={{ color: 'var(--label-quaternary, rgba(255,255,255,0.2))' }}>
        Senior Recruiter Mode · Active
      </p>
    </div>
  )
}

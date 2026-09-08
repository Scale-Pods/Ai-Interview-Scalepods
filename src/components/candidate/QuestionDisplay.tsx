import { Brain, MessageSquare, Users, Lightbulb, Volume2 } from 'lucide-react'
import type { InterviewQuestion } from '@/types'

interface QuestionDisplayProps {
  question: InterviewQuestion | null
  questionNumber: number
  totalQuestions: number
  onSpeakQuestion?: (question: InterviewQuestion) => void
  interviewerLeadIn?: string
  interviewerUtterance?: string
  isAiSpeaking?: boolean
  speakingPhase?: 'acknowledgment' | 'question' | null
}

const TYPE_CONFIG = {
  technical: { icon: Brain, label: 'Technical', color: 'var(--blue)', bg: 'color-mix(in srgb, var(--blue) 10%, transparent)', border: 'color-mix(in srgb, var(--blue) 20%, transparent)' },
  behavioral: { icon: Users, label: 'Behavioral', color: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 10%, transparent)', border: 'color-mix(in srgb, var(--green) 20%, transparent)' },
  situational: { icon: Lightbulb, label: 'Situational', color: 'var(--purple)', bg: 'color-mix(in srgb, var(--purple) 10%, transparent)', border: 'color-mix(in srgb, var(--purple) 20%, transparent)' },
  cultural: { icon: MessageSquare, label: 'Cultural Fit', color: 'var(--orange)', bg: 'color-mix(in srgb, var(--orange) 10%, transparent)', border: 'color-mix(in srgb, var(--orange) 20%, transparent)' },
}

export function QuestionDisplay({ question, questionNumber, totalQuestions, isAiSpeaking, speakingPhase }: QuestionDisplayProps) {
  if (!question) {
    return (
      <div className="text-center p-12 animate-fade-in" style={{ color: 'var(--label-tertiary)' }}>
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl animate-pulse" style={{ background: 'var(--fill-quaternary)' }} />
        <p>Loading question...</p>
      </div>
    )
  }

  const config = TYPE_CONFIG[question.question_type] || TYPE_CONFIG.technical
  const Icon = config.icon

  return (
    <div className="w-full animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: config.bg, border: `1px solid ${config.border}` }}>
            <Icon size={14} style={{ color: config.color }} />
          </div>
          <span className="text-xs font-semibold" style={{ color: config.color }}>
            {config.label}
          </span>
          {question.source === 'llm_ts_followup' && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider" style={{ background: 'color-mix(in srgb, var(--purple) 15%, transparent)', color: 'var(--purple)', border: '1px solid color-mix(in srgb, var(--purple) 25%, transparent)' }}>
              Follow-up
            </span>
          )}
        </div>
      </div>

      <div
        className="card p-6 sm:p-8"
        style={{
          borderLeft: isAiSpeaking && speakingPhase === 'question'
            ? '4px solid var(--purple)'
            : '4px solid color-mix(in srgb, var(--blue) 40%, transparent)',
          boxShadow: isAiSpeaking && speakingPhase === 'question'
            ? '0 0 16px color-mix(in srgb, var(--purple) 15%, transparent)'
            : 'none',
          transition: 'border-color 0.3s ease, box-shadow 0.3s ease'
        }}
      >
        {isAiSpeaking && speakingPhase === 'question' && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--purple)' }}>Reading question aloud</span>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--purple)' }} />
          </div>
        )}
        <p className="text-lg sm:text-xl leading-relaxed font-medium" style={{ color: 'var(--label-primary)' }}>
          {question.question_text}
        </p>
      </div>

      <p className="text-xs text-center mt-3" style={{ color: 'var(--label-tertiary)' }}>
        Listen to the AI's question, then record your response.
      </p>
    </div>
  )
}

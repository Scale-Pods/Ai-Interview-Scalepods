import { Brain, MessageSquare, Users, Lightbulb } from 'lucide-react'
import type { InterviewQuestion } from '@/types'

interface QuestionDisplayProps {
  question: InterviewQuestion | null
  questionNumber: number
  totalQuestions: number
  onSpeakQuestion?: (question: InterviewQuestion) => void
}

const TYPE_CONFIG = {
  technical: { icon: Brain, label: 'Technical', color: 'var(--blue)', bg: 'color-mix(in srgb, var(--blue) 10%, transparent)', border: 'color-mix(in srgb, var(--blue) 20%, transparent)' },
  behavioral: { icon: Users, label: 'Behavioral', color: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 10%, transparent)', border: 'color-mix(in srgb, var(--green) 20%, transparent)' },
  situational: { icon: Lightbulb, label: 'Situational', color: 'var(--purple)', bg: 'color-mix(in srgb, var(--purple) 10%, transparent)', border: 'color-mix(in srgb, var(--purple) 20%, transparent)' },
  cultural: { icon: MessageSquare, label: 'Cultural Fit', color: 'var(--orange)', bg: 'color-mix(in srgb, var(--orange) 10%, transparent)', border: 'color-mix(in srgb, var(--orange) 20%, transparent)' },
}

export function QuestionDisplay({ question, questionNumber, totalQuestions }: QuestionDisplayProps) {
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
  const displayQuestionNumber = Math.min(questionNumber + 1, totalQuestions)

  return (
    <div className="w-full animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: config.bg, border: `1px solid ${config.border}` }}>
            <Icon size={18} style={{ color: config.color }} />
          </div>
          <div>
            <span className="text-xs font-semibold" style={{ color: config.color }}>
              {config.label}
            </span>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--label-tertiary)' }}>
              Question {displayQuestionNumber} of {totalQuestions}
            </p>
          </div>
        </div>
      </div>

      <div className="card p-6 sm:p-8" style={{ borderLeft: '4px solid color-mix(in srgb, var(--blue) 40%, transparent)' }}>
        <p className="text-lg sm:text-xl leading-relaxed font-medium" style={{ color: 'var(--label-primary)' }}>
          {question.question_text}
        </p>
      </div>

      <p className="text-xs text-center mt-3" style={{ color: 'var(--label-tertiary)' }}>
        Listen to the AI's question, then speak your response.
      </p>
    </div>
  )
}

import { Brain, MessageSquare, Users, Lightbulb, Volume2 } from 'lucide-react'
import type { InterviewQuestion } from '@/types'

interface QuestionDisplayProps {
  question: InterviewQuestion | null
  questionNumber: number
  totalQuestions: number
  onSpeakQuestion?: (question: InterviewQuestion) => void
  interviewerLeadIn?: string
  interviewerUtterance?: string
}

const TYPE_CONFIG = {
  technical: { icon: Brain, label: 'Technical', color: 'var(--blue)', bg: 'color-mix(in srgb, var(--blue) 10%, transparent)', border: 'color-mix(in srgb, var(--blue) 20%, transparent)' },
  behavioral: { icon: Users, label: 'Behavioral', color: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 10%, transparent)', border: 'color-mix(in srgb, var(--green) 20%, transparent)' },
  situational: { icon: Lightbulb, label: 'Situational', color: 'var(--purple)', bg: 'color-mix(in srgb, var(--purple) 10%, transparent)', border: 'color-mix(in srgb, var(--purple) 20%, transparent)' },
  cultural: { icon: MessageSquare, label: 'Cultural Fit', color: 'var(--orange)', bg: 'color-mix(in srgb, var(--orange) 10%, transparent)', border: 'color-mix(in srgb, var(--orange) 20%, transparent)' },
}

export function extractLeadIn(fullUtterance?: string, questionText?: string): string | undefined {
  if (!fullUtterance || !questionText) return undefined
  const full = fullUtterance.trim()
  const qText = questionText.trim()

  if (!full || !qText || full === qText) return undefined

  // 1. Exact substring match: question starts at index > 0
  const idx = full.indexOf(qText)
  if (idx > 0) {
    const lead = full.slice(0, idx).trim()
    return lead || undefined
  }

  // 2. Case-insensitive substring match
  const lowerFull = full.toLowerCase()
  const lowerQ = qText.toLowerCase()
  const lowerIdx = lowerFull.indexOf(lowerQ)
  if (lowerIdx > 0) {
    const lead = full.slice(0, lowerIdx).trim()
    return lead || undefined
  }

  // 3. Sentence boundary extraction: if full utterance has multiple sentences and ends with/resembles question
  const sentenceMatches = full.match(/[^.!?]+[.!?]+/g)
  if (sentenceMatches && sentenceMatches.length > 1) {
    const leadSentences = sentenceMatches.slice(0, -1).join(' ').trim()
    if (leadSentences && leadSentences !== full && leadSentences !== qText) {
      return leadSentences
    }
  }

  return undefined
}

export function QuestionDisplay({ question, questionNumber, totalQuestions, interviewerLeadIn, interviewerUtterance }: QuestionDisplayProps) {
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

  const leadText = interviewerLeadIn || extractLeadIn(interviewerUtterance, question.question_text)

  return (
    <div className="w-full animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: config.bg, border: `1px solid ${config.border}` }}>
            <Icon size={18} style={{ color: config.color }} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold" style={{ color: config.color }}>
                {config.label}
              </span>
              {question.source === 'llm_ts_followup' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider" style={{ background: 'color-mix(in srgb, var(--purple) 15%, transparent)', color: 'var(--purple)', border: '1px solid color-mix(in srgb, var(--purple) 25%, transparent)' }}>
                  Follow-up
                </span>
              )}
            </div>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--label-tertiary)' }}>
              Question {displayQuestionNumber} of {totalQuestions}
            </p>
          </div>
        </div>
      </div>

      {leadText && (
        <div className="mb-3 p-3.5 rounded-2xl animate-fade-in" style={{
          background: 'color-mix(in srgb, var(--blue) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--blue) 20%, transparent)',
        }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: 'var(--blue)' }}>
              A
            </div>
            <span className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--blue)' }}>
              <Volume2 size={12} /> Alex (AI Recruiter) Spoken Acknowledgment
            </span>
          </div>
          <p className="text-sm leading-relaxed italic pl-7" style={{ color: 'var(--label-primary)' }}>
            &ldquo;{leadText}&rdquo;
          </p>
        </div>
      )}

      <div className="card p-6 sm:p-8" style={{ borderLeft: '4px solid color-mix(in srgb, var(--blue) 40%, transparent)' }}>
        <p className="text-lg sm:text-xl leading-relaxed font-medium" style={{ color: 'var(--label-primary)' }}>
          {question.question_text}
        </p>
      </div>

      <p className="text-xs text-center mt-3" style={{ color: 'var(--label-tertiary)' }}>
        {leadText ? "Alex is speaking — listen to the full spoken transition, then speak your response." : "Listen to the AI's question, then speak your response."}
      </p>
    </div>
  )
}

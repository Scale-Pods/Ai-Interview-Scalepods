import { CheckCircle, Brain, MessageSquare, Users, Lightbulb } from 'lucide-react'

/* ─── Types ────────────────────────────────────────────────────────────── */

export type ChatMessageRole = 'alex' | 'candidate'
export type ChatMessageStatus = 'speaking' | 'done'
export type AnswerStatus = 'recording' | 'submitted'

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  text: string
  phase?: 'acknowledgment' | 'question' | 'closing'
  questionType?: 'technical' | 'behavioral' | 'situational' | 'cultural'
  isFollowUp?: boolean
  status?: ChatMessageStatus        // alex only
  answerStatus?: AnswerStatus       // candidate only
  timestamp: number
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

const TYPE_CONFIG = {
  technical:   { icon: Brain,         label: 'Technical',    color: 'var(--blue)',   bg: 'rgba(10,132,255,0.18)' },
  behavioral:  { icon: Users,         label: 'Behavioral',   color: 'var(--green)',  bg: 'rgba(48,209,88,0.15)'  },
  situational: { icon: Lightbulb,     label: 'Situational',  color: 'var(--purple)', bg: 'rgba(191,90,242,0.15)' },
  cultural:    { icon: MessageSquare, label: 'Cultural Fit', color: 'var(--orange)', bg: 'rgba(255,159,10,0.15)' },
}

function AvatarRing({ speaking }: { speaking: boolean }) {
  return (
    <div
      className={`bubble-avatar ${speaking ? 'speaking' : ''}`}
      style={{
        background: speaking
          ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
          : 'linear-gradient(135deg, #1d4ed8, #6d28d9)',
      }}
    >
      <span style={{ fontSize: 14 }}>A</span>
    </div>
  )
}

/* ─── Speaking waveform bars ───────────────────────────────────────────── */
function SpeakingBars() {
  return (
    <span className="bubble-speaking-bars">
      {[0, 1, 2, 3].map(i => (
        <span
          key={i}
          className="bubble-speaking-bar"
          style={{ height: `${[55, 100, 75, 45][i]}%`, animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  )
}

/* ─── Typing indicator ─────────────────────────────────────────────────── */
export function TypingBubble() {
  return (
    <div className="chat-bubble-row alex animate-fade-in">
      <AvatarRing speaking={false} />
      <div>
        <div className="bubble-meta">
          <span className="bubble-label-alex">Alex</span>
          <span style={{ color: 'var(--label-tertiary)', fontWeight: 400 }}>· thinking...</span>
        </div>
        <div className="typing-indicator-bubble">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  )
}

/* ─── Main ChatBubble ──────────────────────────────────────────────────── */

export function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'alex') {
    const isSpeaking = message.status === 'speaking'
    const isAcknowledgement = message.phase === 'acknowledgment'
    const typeConf = (!isAcknowledgement && message.questionType) ? TYPE_CONFIG[message.questionType] : null
    const TypeIcon = typeConf?.icon

    return (
      <div className="chat-bubble-row alex bubble-alex">
        <AvatarRing speaking={isSpeaking} />

        <div style={{ maxWidth: '72%' }}>
          {/* Meta row */}
          <div className="bubble-meta">
            <span className="bubble-label-alex">Alex</span>
            {isAcknowledgement && (
              <span style={{ color: 'var(--label-tertiary)', fontWeight: 400 }}>· acknowledging</span>
            )}
            {typeConf && !isAcknowledgement && (
              <span
                className="bubble-type-badge"
                style={{ background: typeConf.bg, color: typeConf.color }}
              >
                {TypeIcon && <TypeIcon size={8} style={{ display: 'inline', marginRight: 2 }} />}
                {typeConf.label}
              </span>
            )}
            {message.isFollowUp && !isAcknowledgement && (
              <span
                className="bubble-type-badge"
                style={{ background: 'rgba(191,90,242,0.15)', color: 'var(--purple)' }}
              >
                Follow-up
              </span>
            )}
          </div>

          {/* Bubble body — acknowledgement gets a muted italic style */}
          {isAcknowledgement ? (
            <div
              className="bubble-body bubble-acknowledgement"
              style={{
                borderLeft: isSpeaking ? '2px solid var(--orange)' : '2px solid rgba(255,159,10,0.35)',
                transition: 'border-color 0.3s ease'
              }}
            >
              {isSpeaking && (
                <div style={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: 'var(--orange)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '0.375rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: 'var(--orange)' }} />
                  Speaking now
                  <SpeakingBars />
                </div>
              )}
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>{message.text}</p>
            </div>
          ) : (
            <div className="bubble-body" style={{
              borderLeft: isSpeaking ? '2px solid var(--purple)' : '2px solid transparent',
              transition: 'border-color 0.3s ease'
            }}>
              {isSpeaking && (
                <div style={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: 'var(--purple)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '0.375rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: 'var(--purple)' }} />
                  Reading aloud
                  <SpeakingBars />
                </div>
              )}
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message.text}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ─── Candidate bubble ──────────────────────────────────────────── */
  return (
    <div className="chat-bubble-row candidate bubble-candidate">
      <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div className="bubble-meta" style={{ justifyContent: 'flex-end' }}>
          {message.answerStatus === 'submitted' && (
            <CheckCircle size={11} style={{ color: 'rgba(48,209,88,0.9)' }} />
          )}
          <span className="bubble-label-candidate">You</span>
        </div>
        <div className="bubble-body">
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message.text}</p>
        </div>
      </div>

      {/* Candidate avatar */}
      <div
        className="bubble-avatar"
        style={{ background: 'linear-gradient(135deg, #374151, #6b7280)', flexShrink: 0 }}
      >
        <span style={{ fontSize: 13 }}>C</span>
      </div>
    </div>
  )
}

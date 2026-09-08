import { Mic, MicOff, Send, Brain, Loader2 } from 'lucide-react'
import type { AnswerRecorderState } from './AnswerRecorder'

interface ChatInputBarProps {
  recorderState: AnswerRecorderState
  isAiSpeaking: boolean
  isGeneratingTurn: boolean
  isAnalyzingAnswer: boolean
  onManualSubmit: () => void
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

const SILENCE_TIMEOUT_SEC = 4

export function ChatInputBar({
  recorderState,
  isAiSpeaking,
  isGeneratingTurn,
  isAnalyzingAnswer,
  onManualSubmit,
  canvasRef,
}: ChatInputBarProps) {
  const { transcript, isThinking, silenceCountdown, countdownTenths, thinkingCountdown, thinkingCountdownTenths, isRecording } = recorderState

  const secondsLeft = (silenceCountdown / 10).toFixed(1)
  const countdownPct = silenceCountdown / countdownTenths
  const thinkingSecondsLeft = (thinkingCountdown / 10).toFixed(1)
  const thinkingPct = thinkingCountdown / (thinkingCountdownTenths || 250)


  /* ─── Placeholder states ─────────────────────────────────────── */
  if (isAiSpeaking) {
    return (
      <div className="chat-input-bar">
        <div className="chat-input-inner" style={{ justifyContent: 'center', opacity: 0.6 }}>
          <div className="flex items-end gap-[3px] h-4">
            {[0,1,2,3].map(i => (
              <span key={i} className="bubble-speaking-bar" style={{
                height: `${[55,100,75,45][i]}%`,
                animationDelay: `${i*0.12}s`,
                background: 'var(--blue)'
              }} />
            ))}
          </div>
          <span className="text-sm" style={{ color: 'var(--label-secondary)' }}>Alex is speaking…</span>
        </div>
      </div>
    )
  }

  if (isGeneratingTurn || isAnalyzingAnswer) {
    return (
      <div className="chat-input-bar">
        <div className="chat-input-inner" style={{ justifyContent: 'center', opacity: 0.6 }}>
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--blue)' }} />
          <span className="text-sm" style={{ color: 'var(--label-secondary)' }}>
            {isAnalyzingAnswer ? 'Analysing your response…' : 'Preparing next question…'}
          </span>
        </div>
      </div>
    )
  }

  /* ─── Active recording bar ───────────────────────────────────── */
  const showCountdown = !isThinking && transcript.trim().length > 0
  const hasTranscript = transcript.trim().length > 0

  return (
    <div className="chat-input-bar">
      <div className="chat-input-inner">

        {/* Mic icon / thinking indicator */}
        <div className="shrink-0 flex items-center justify-center mt-0.5" style={{ width: 28, height: 28 }}>
          {isThinking ? (
            <Brain size={16} className="animate-pulse" style={{ color: 'var(--orange)' }} />
          ) : isRecording ? (
            <Mic size={16} style={{ color: 'var(--green)' }} />
          ) : (
            <MicOff size={16} style={{ color: 'var(--label-tertiary)' }} />
          )}
        </div>

        {/* Waveform canvas */}
        <canvas
          ref={canvasRef}
          width={200}
          height={36}
          className="rounded-lg shrink-0 mt-0.5"
          style={{
            width: 90,
            height: 36,
            background: 'rgba(255,255,255,0.04)',
            display: isRecording ? 'block' : 'none'
          }}
        />


        {/* Live transcript — scrollable so full text is always visible */}
        <div
          className="flex-1 min-w-0 px-1"
          style={{ maxHeight: 72, overflowY: 'auto', alignSelf: 'center' }}
        >
          {transcript ? (
            <p
              className="text-sm leading-snug"
              style={{ color: 'var(--label-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {transcript}
            </p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--label-tertiary)' }}>
              {isThinking
                ? 'Start speaking within 25s…'
                : 'Speak your response…'}
            </p>
          )}
        </div>

        {/* Silence countdown */}
        {showCountdown && (
          <div className="shrink-0 flex items-center gap-1.5 mt-0.5" title="Auto-submits after silence">
            <svg width="20" height="20" viewBox="0 0 20 20" className="transform -rotate-90">
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--fill-tertiary)" strokeWidth="2.5" />
              <circle
                cx="10" cy="10" r="8" fill="none"
                stroke={countdownPct < 0.2 ? 'var(--red)' : countdownPct < 0.45 ? 'var(--orange)' : 'var(--blue)'}
                strokeWidth="2.5"
                strokeDasharray={`${countdownPct * 50.27} 50.27`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.1s linear, stroke 0.3s' }}
              />
            </svg>
            <span
              className="text-[10px] font-mono font-bold"
              style={{ color: countdownPct < 0.2 ? 'var(--red)' : countdownPct < 0.45 ? 'var(--orange)' : 'var(--label-secondary)' }}
            >
              {secondsLeft}s
            </span>
          </div>
        )}

        {isThinking && (
          <div className="shrink-0 flex items-center gap-1.5 mt-0.5" title="Thinking time remaining">
            <svg width="20" height="20" viewBox="0 0 20 20" className="transform -rotate-90">
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--fill-tertiary)" strokeWidth="2.5" />
              <circle
                cx="10" cy="10" r="8" fill="none"
                stroke={thinkingPct < 0.25 ? 'var(--red)' : thinkingPct < 0.5 ? 'var(--orange)' : 'var(--orange)'}
                strokeWidth="2.5"
                strokeDasharray={`${thinkingPct * 50.27} 50.27`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.1s linear, stroke 0.3s' }}
              />
            </svg>
            <span
              className="text-[10px] font-mono font-bold"
              style={{ color: thinkingPct < 0.25 ? 'var(--red)' : 'var(--orange)' }}
            >
              {thinkingSecondsLeft}s
            </span>
          </div>
        )}

        {/* Submit button */}
        {(() => {
          const canSubmit = isRecording || isThinking || hasTranscript
          return (
            <button
              onClick={onManualSubmit}
              disabled={!canSubmit}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 mt-0.5"
              style={{
                background: canSubmit ? 'var(--blue)' : 'var(--fill-tertiary)',
                color: canSubmit ? '#fff' : 'var(--label-quaternary)',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
              title="Submit answer"
            >
              <Send size={14} />
            </button>
          )
        })()}
      </div>

      <p className="text-center mt-1.5" style={{ fontSize: '0.6rem', color: 'var(--label-tertiary)' }}>
        {isThinking
          ? `Start speaking within 25s · Auto-submits after ${SILENCE_TIMEOUT_SEC}s of silence once spoken`
          : `Auto-submits after ${SILENCE_TIMEOUT_SEC}s of silence`}
      </p>
    </div>
  )
}

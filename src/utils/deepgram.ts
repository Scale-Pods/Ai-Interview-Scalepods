/**
 * Deepgram Live Speech-to-Text client.
 * Connects via WebSocket to Deepgram's streaming API (wss://api.deepgram.com/v1/listen)
 * and streams MediaRecorder audio chunks in real-time.
 */

export interface DeepgramSTTOptions {
  apiKey?: string
  model?: string
  language?: string
  onTranscript?: (transcript: string, isFinal: boolean) => void
  onError?: (error: Error) => void
  onOpen?: () => void
  onClose?: () => void
}

export class DeepgramSTT {
  private socket: WebSocket | null = null
  private mediaRecorder: MediaRecorder | null = null
  private apiKey: string
  private model: string
  private language: string
  private onTranscript?: (transcript: string, isFinal: boolean) => void
  private onError?: (error: Error) => void
  private onOpen?: () => void
  private onClose?: () => void

  private isConnected = false
  private accumulatedFinalTranscript = ''

  constructor(options: DeepgramSTTOptions = {}) {
    this.apiKey = options.apiKey || import.meta.env.VITE_DEEPGRAM_API_KEY || ''
    this.model = options.model || import.meta.env.VITE_DEEPGRAM_MODEL || 'nova-2'
    this.language = options.language || 'en-US'
    this.onTranscript = options.onTranscript
    this.onError = options.onError
    this.onOpen = options.onOpen
    this.onClose = options.onClose
  }

  /**
   * Returns true if a Deepgram API Key is set in environment variables.
   */
  public static isConfigured(): boolean {
    const key = import.meta.env.VITE_DEEPGRAM_API_KEY
    return Boolean(key && key.trim().length > 0 && !key.includes('your-deepgram-api-key'))
  }

  /**
   * Starts streaming audio from a MediaStream to Deepgram WebSocket endpoint.
   */
  public async start(stream: MediaStream): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Deepgram API key is missing. Set VITE_DEEPGRAM_API_KEY in your .env file.')
    }

    this.accumulatedFinalTranscript = ''

    const params = new URLSearchParams({
      model: this.model,
      language: this.language,
      punctuate: 'true',
      smart_formatting: 'true',
      interim_results: 'true',
      vad_events: 'true',
      endpointing: '300',
      no_delay: 'true'
    })

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`

    return new Promise<void>((resolve, reject) => {
      try {
        // Deepgram accepts subprotocol ['token', apiKey] for browser WebSockets
        this.socket = new WebSocket(url, ['token', this.apiKey])

        this.socket.onopen = () => {
          this.isConnected = true
          this.onOpen?.()
          this.startAudioStreaming(stream)
          resolve()
        }

        this.socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            const alternative = data.channel?.alternatives?.[0]
            if (!alternative) return

            const text = alternative.transcript || ''
            
            if (data.is_final && text.trim()) {
              this.accumulatedFinalTranscript = (
                this.accumulatedFinalTranscript + ' ' + text.trim()
              ).trim()
              this.onTranscript?.(this.accumulatedFinalTranscript, true)
            } else if (text.trim()) {
              const liveText = (
                this.accumulatedFinalTranscript + ' ' + text.trim()
              ).trim()
              this.onTranscript?.(liveText, false)
            }
          } catch (err) {
            console.error('Error parsing Deepgram socket message:', err)
          }
        }

        this.socket.onerror = (event) => {
          const err = new Error('Deepgram WebSocket connection error')
          console.error('Deepgram WebSocket Error:', event)
          this.onError?.(err)
          if (!this.isConnected) {
            reject(err)
          }
        }

        this.socket.onclose = () => {
          this.isConnected = false
          this.onClose?.()
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.onError?.(error)
        reject(error)
      }
    })
  }

  private startAudioStreaming(stream: MediaStream) {
    try {
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac',
        'audio/wav'
      ]
      let mimeType = ''
      if (typeof MediaRecorder !== 'undefined') {
        for (const candidate of candidates) {
          if (MediaRecorder.isTypeSupported(candidate)) {
            mimeType = candidate
            break
          }
        }
      }

      this.mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      this.mediaRecorder.ondataavailable = async (e) => {
        if (
          e.data.size > 0 &&
          this.socket &&
          this.socket.readyState === WebSocket.OPEN
        ) {
          const buffer = await e.data.arrayBuffer()
          this.socket.send(buffer)
        }
      }

      // Stream slice every 250ms for low-latency live STT
      this.mediaRecorder.start(250)
    } catch (err) {
      console.error('Failed to start MediaRecorder for Deepgram streaming:', err)
      this.onError?.(err instanceof Error ? err : new Error('MediaRecorder streaming failed'))
    }
  }

  /**
   * Stops recording and closes the Deepgram WebSocket connection cleanly.
   */
  public stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop()
      } catch {}
    }
    this.mediaRecorder = null

    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ type: 'CloseStream' }))
          this.socket.close()
        } catch {}
      }
    }
    this.socket = null
    this.isConnected = false
  }
}

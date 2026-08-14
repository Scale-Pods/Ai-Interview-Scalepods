import { useState, useRef, useEffect, useCallback } from 'react'

interface TTSEngine {
  speak: (text: string, onend?: () => void) => void
  cancel: () => void
  isSpeaking: () => boolean
  setVoiceSettings: (rate: number, pitch: number, voiceName?: string) => void
  getVoices: () => SpeechSynthesisVoice[]
}

export function useTTSEngine(): TTSEngine {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const isSpeakingRef = useRef(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const loadVoices = () => {
      if ('speechSynthesis' in window) {
        const availableVoices = speechSynthesis.getVoices()
        setVoices(availableVoices)
        voicesRef.current = availableVoices
      }
    }
    
    loadVoices()
    if ('speechSynthesis' in window) {
      speechSynthesis.onvoiceschanged = loadVoices
    }
    
    return () => {
      if ('speechSynthesis' in window) {
        speechSynthesis.onvoiceschanged = null
      }
    }
  }, [])

  const cancel = useCallback(() => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause()
        currentAudioRef.current.currentTime = 0
      } catch {}
      currentAudioRef.current = null
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    isSpeakingRef.current = false
  }, [])

  const speakWithWebSpeech = useCallback((text: string, onend?: () => void) => {
    if (!('speechSynthesis' in window)) {
      console.warn('SpeechSynthesis not available in this browser')
      if (onend) onend()
      return
    }
    
    cancel()
    
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1
    utterance.volume = 1
    
    const currentVoices = voicesRef.current
    if (currentVoices.length > 0) {
      // Find a natural male voice for Alex
      const maleVoice = currentVoices.find(v => {
        const name = v.name.toLowerCase()
        return (name.includes('male') || name.includes('david') || name.includes('alex') || name.includes('mark') || name.includes('daniel') || name.includes('george') || name.includes('guy') || name.includes('natural')) &&
               (v.lang.includes('en') || v.lang.includes('EN'))
      })
      const fallbackEnglish = currentVoices.find(v => v.lang.includes('en') || v.lang.includes('EN'))
      utterance.voice = maleVoice || fallbackEnglish || currentVoices[0]
    }
    
    utterance.onstart = () => {
      isSpeakingRef.current = true
    }
    
    utterance.onend = () => {
      isSpeakingRef.current = false
      if (onend) onend()
    }
    
    utterance.onerror = (e) => {
      isSpeakingRef.current = false
      if (e.error !== 'interrupted') {
        console.warn('Speech synthesis error:', e)
      }
      if (onend) onend()
    }
    
    try {
      window.speechSynthesis.speak(utterance)
    } catch (err) {
      console.warn('Failed to speak text:', err)
      isSpeakingRef.current = false
      if (onend) onend()
    }
  }, [cancel])

function prepareTextForTTS(text: string): string {
  if (!text) return ''
  let cleaned = text
  const acronyms: Array<[RegExp, string]> = [
    [/\bn8n\b/gi, 'N-8-N'],
    [/\bgrpc\b/gi, 'g-R-P-C'],
    [/\bfastapi\b/gi, 'Fast API'],
    [/\bpostgresql\b/gi, 'Postgres-Q-L'],
    [/\bpostgres\b/gi, 'Postgres'],
    [/\bci\/cd\b/gi, 'C-I C-D'],
    [/\bui\/ux\b/gi, 'U-I U-X'],
    [/\bgraphql\b/gi, 'Graph Q L'],
    [/\b([a-z])8([a-z])\b/gi, '$1 8 $2'], // generic X8Y pattern
  ]
  for (const [pattern, replacement] of acronyms) {
    cleaned = cleaned.replace(pattern, replacement)
  }
  return cleaned
}

  const speakWithDeepgram = useCallback(async (text: string, apiKey: string, onend?: () => void) => {
    try {
      cancel()
      isSpeakingRef.current = true

      // Default to Deepgram's brisk male English voice 'aura-arcas-en' or 'aura-zeus-en'
      const model = import.meta.env.VITE_DEEPGRAM_TTS_MODEL || 'aura-arcas-en'
      const speed = parseFloat(import.meta.env.VITE_DEEPGRAM_TTS_SPEED || '1.1') // 1.1x speed for fast professional pacing

      const preparedText = prepareTextForTTS(text)

      const response = await fetch(`https://api.deepgram.com/v1/speak?model=${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: preparedText })
      })

      if (!response.ok) {
        throw new Error(`Deepgram TTS request failed: ${response.status} ${response.statusText}`)
      }

      const blob = await response.blob()
      const audioUrl = URL.createObjectURL(blob)
      const audio = new Audio(audioUrl)
      audio.playbackRate = isNaN(speed) ? 1.1 : speed // Apply fast professional playback speed
      currentAudioRef.current = audio

      audio.onended = () => {
        isSpeakingRef.current = false
        currentAudioRef.current = null
        URL.revokeObjectURL(audioUrl)
        if (onend) onend()
      }

      audio.onerror = (e) => {
        console.warn('Deepgram Audio playback error:', e)
        isSpeakingRef.current = false
        currentAudioRef.current = null
        URL.revokeObjectURL(audioUrl)
        if (onend) onend()
      }

      await audio.play()
    } catch (err) {
      console.warn('Deepgram TTS failed, falling back to Web Speech API:', err)
      currentAudioRef.current = null
      speakWithWebSpeech(text, onend)
    }
  }, [cancel, speakWithWebSpeech])

  const speak = useCallback((text: string, onend?: () => void) => {
    const apiKey = import.meta.env.VITE_DEEPGRAM_API_KEY
    if (apiKey && apiKey.trim().length > 0 && !apiKey.includes('your-deepgram-api-key')) {
      speakWithDeepgram(text, apiKey, onend)
    } else {
      speakWithWebSpeech(text, onend)
    }
  }, [speakWithDeepgram, speakWithWebSpeech])
  
  const isSpeaking = useCallback(() => isSpeakingRef.current, [])
  
  const setVoiceSettings = useCallback((rate: number, pitch: number, voiceName?: string) => {
    cancel()
  }, [cancel])
  
  const getVoices = useCallback(() => voices, [voices])
  
  return { speak, cancel, isSpeaking, setVoiceSettings, getVoices }
}

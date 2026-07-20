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

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices()
      setVoices(availableVoices)
      voicesRef.current = availableVoices
    }
    
    loadVoices()
    speechSynthesis.onvoiceschanged = loadVoices
    
    return () => {
      speechSynthesis.onvoiceschanged = null
    }
  }, [])

  const cancel = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      isSpeakingRef.current = false
    }
  }, [])
  
  const speak = useCallback((text: string, onend?: () => void) => {
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
      const preferredVoice = currentVoices.find(v => 
        v.name.toLowerCase().includes('google') && 
        (v.lang.includes('en') || v.lang.includes('EN'))
      )
      utterance.voice = preferredVoice || currentVoices[0]
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
  
  const isSpeaking = useCallback(() => isSpeakingRef.current, [])
  
  const setVoiceSettings = useCallback((rate: number, pitch: number, voiceName?: string) => {
    cancel()
    const currentVoices = voicesRef.current
    if (voiceName && currentVoices.length > 0) {
      const voice = currentVoices.find(v => v.name === voiceName)
      if (voice) {
        speak('', () => {})
        return
      }
    }
  }, [cancel, speak])
  
  const getVoices = useCallback(() => voices, [voices])
  
  return { speak, cancel, isSpeaking, setVoiceSettings, getVoices }
}

import { useEffect, useRef, useState, useCallback } from 'react'

export function useInterviewTimer(durationMinutes: number) {
  const [remaining, setRemaining] = useState(durationMinutes * 60)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  useEffect(() => {
    startTimer()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [startTimer])

  const reset = useCallback(() => {
    setRemaining(durationMinutes * 60)
    startTimer()
  }, [durationMinutes, startTimer])

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

  return {
    remaining,
    formatted,
    isExpired: remaining <= 0,
    isWarning: remaining > 0 && remaining <= 300,
    reset
  }
}

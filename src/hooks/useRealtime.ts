import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/api/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function useRealtimeSubscription<T>(
  channelName: string,
  event: string,
  callback: (payload: T) => void
) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event }, (payload) => callbackRef.current(payload.data as T))
      .subscribe()

    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [channelName, event])
}

export function useDatabaseChange<T>(
  table: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
  filter?: string,
  onData?: (data: T) => void
) {
  const [lastChange, setLastChange] = useState<T | null>(null)
  const onDataRef = useRef(onData)

  useEffect(() => {
    onDataRef.current = onData
  }, [onData])

  useEffect(() => {
    const filterConfig: Record<string, string> = {}
    if (filter) filterConfig.filter = filter

    const channel = supabase
      .channel(`db:${table}`)
      .on(
        'postgres_changes',
        { event, schema: 'public', table, ...filterConfig },
        (payload) => {
          const data = payload.new as T
          setLastChange(data)
          onDataRef.current?.(data)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [table, event, filter])

  return lastChange
}

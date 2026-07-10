import { useState, useRef, useCallback, useMemo } from 'react'
import { supabasePublic } from '@/api/client'
import { getMimeType, getCameraStream, getScreenStream, getAudioStream, stopStream, createCompositeStream } from '@/utils/mediaHelpers'

const RECORDING_VIDEO_BITS_PER_SECOND = 900_000
const RECORDING_AUDIO_BITS_PER_SECOND = 64_000

interface MediaRecorderState {
  status: 'idle' | 'recording' | 'paused' | 'stopped'
  duration: number
  error: string | null
  recordingId: string | null
}

export function useMediaRecorder() {
  const [state, setState] = useState<MediaRecorderState>({ status: 'idle', duration: 0, error: null, recordingId: null })
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamsRef = useRef<MediaStream[]>([])
  const startTimeRef = useRef<number>(0)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const sessionIdRef = useRef<string>('')
  const recordingIdRef = useRef<string | null>(null)
  const storagePathRef = useRef<string>('')
  const compositeIntervalRef = useRef<(() => void) | null>(null)
  const mimeTypeRef = useRef<string>('video/webm')

  const start = useCallback(async (sessionId: string, existingStreams?: { camera?: MediaStream; screen?: MediaStream | null; audio?: MediaStream }) => {
    try {
      sessionIdRef.current = sessionId
      recordingIdRef.current = null
      setState(prev => ({ ...prev, status: 'recording', error: null, recordingId: null }))
      chunksRef.current = []

      const cameraStream = existingStreams?.camera || await getCameraStream()
      const screenStream = existingStreams?.screen !== undefined ? existingStreams.screen : await getScreenStream()
      const audioStream = existingStreams?.audio || await getAudioStream()
      const audioFromOutside = !!existingStreams?.audio

      let mixedStream: MediaStream
      let cleanup: (() => void) | null = null
      if (screenStream && audioStream) {
        const result = createCompositeStream(cameraStream, screenStream, audioStream, {
          cameraWidth: 200,
          cameraHeight: 150,
          cameraMargin: 16,
          frameRate: 15
        })
        mixedStream = result.stream
        cleanup = result.cleanup
      } else if (screenStream) {
        // Screen but no audio — record screen + camera (silent video)
        mixedStream = new MediaStream([
          ...cameraStream.getVideoTracks(),
          ...screenStream.getVideoTracks()
        ])
      } else if (audioStream) {
        // No screen sharing — record camera + audio directly
        mixedStream = new MediaStream([
          ...cameraStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
        ])
      } else {
        // No audio, no screen — record camera video only
        mixedStream = new MediaStream([...cameraStream.getVideoTracks()])
      }
      compositeIntervalRef.current = cleanup

      // Only store internally-acquired streams for cleanup (external audio lifecycle is managed by the caller)
      streamsRef.current = [cameraStream, ...(screenStream ? [screenStream] : []), ...(audioStream && !audioFromOutside ? [audioStream] : [])]
      const mimeType = getMimeType()
      mimeTypeRef.current = mimeType
      const recorder = new MediaRecorder(mixedStream, {
        mimeType,
        videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND
      })

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => setState(prev => ({ ...prev, error: 'Recording error', status: 'stopped' }))

      recorder.start(5000)
      mediaRecorderRef.current = recorder
      startTimeRef.current = Date.now()
      storagePathRef.current = `sessions/${sessionId}/recording_${startTimeRef.current}.webm`

      const recordingId = crypto.randomUUID()
      recordingIdRef.current = recordingId
      setState(prev => ({ ...prev, recordingId }))

      const { error: insertError } = await supabasePublic
        .from('recordings_ai_interview')
        .insert({
          id: recordingId,
          session_id: sessionId,
          stream_type: 'camera_video',
          status: 'processing',
          storage_path: storagePathRef.current,
          mime_type: mimeType
        })

      if (insertError) {
        recorder.stop()
        mediaRecorderRef.current = null
        streamsRef.current.forEach(stopStream)
        streamsRef.current = []
        console.warn('Failed to create recording record:', insertError.message)
        setState(prev => ({ ...prev, error: `Recording DB insert failed: ${insertError.message}`, status: 'idle' }))
        return
      }

      durationIntervalRef.current = setInterval(() => {
        setState(prev => ({ ...prev, duration: Math.floor((Date.now() - startTimeRef.current) / 1000) }))
      }, 1000)
    } catch (err) {
      setState(prev => ({ ...prev, error: `Failed to start recording: ${err}`, status: 'idle' }))
    }
  }, [])

  const stop = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    const recordingId = recordingIdRef.current

    return new Promise<void>((resolve) => {
      recorder.addEventListener('stop', async () => {
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current)
        if (compositeIntervalRef.current) compositeIntervalRef.current()
        streamsRef.current.forEach(stopStream)
        streamsRef.current = []

        const fullBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current })
        chunksRef.current = []
        const storagePath = storagePathRef.current
        const storageContentType = (fullBlob.type || mimeTypeRef.current).split(';')[0] || 'video/webm'

        const markRecordingFailed = async (message: string) => {
          if (!recordingId) return
          await supabasePublic
            .from('recordings_ai_interview')
            .update({
              status: 'failed',
              duration_secs: Math.floor((Date.now() - startTimeRef.current) / 1000),
              file_size_bytes: fullBlob.size,
              mime_type: storageContentType,
              transcoded_paths: { error: message }
            })
            .eq('id', recordingId)
        }

        try {
          if (fullBlob.size === 0) {
            const message = 'Recording produced an empty file.'
            await markRecordingFailed(message)
            throw new Error(message)
          }

          const { error: uploadError } = await supabasePublic
            .storage
            .from('recordings')
            .upload(storagePath, fullBlob, {
              contentType: storageContentType,
              upsert: true
            })

          if (uploadError) {
            console.warn('Storage upload failed:', uploadError)
            await markRecordingFailed(uploadError.message)
            throw new Error(`Storage upload failed: ${uploadError.message}`)
          }

          if (recordingId) {
            const { error: updateError } = await supabasePublic
              .from('recordings_ai_interview')
              .update({
                status: 'ready',
                storage_path: storagePath,
                duration_secs: Math.floor((Date.now() - startTimeRef.current) / 1000),
                file_size_bytes: fullBlob.size,
                mime_type: storageContentType
              })
              .eq('id', recordingId)

            if (updateError) {
              console.warn('Recording update failed:', updateError)
              setState(prev => ({ ...prev, error: `Recording update failed: ${updateError.message}` }))
            }
          }
        } catch (err) {
          console.warn('Failed to finalize recording:', err)
          setState(prev => ({ ...prev, error: `Failed to finalize recording: ${err}` }))
        }

        setState(prev => ({ ...prev, status: 'stopped' }))
        resolve()
      })

      recorder.stop()
    })
  }, [])

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause()
      setState(prev => ({ ...prev, status: 'paused' }))
    }
  }, [])

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume()
      setState(prev => ({ ...prev, status: 'recording' }))
    }
  }, [])

  const getRecordingUrl = useCallback(async (): Promise<string | null> => {
    const sid = sessionIdRef.current
    if (!sid) return null
    const recordings = await supabasePublic
      .storage
      .from('recordings')
      .list(`sessions/${sid}`)

    if (recordings.error || !recordings.data?.length) return null

    const latest = recordings.data[recordings.data.length - 1]
    const { data } = supabasePublic
      .storage
      .from('recordings')
      .getPublicUrl(`sessions/${sid}/${latest.name}`)

    return data.publicUrl
  }, [])

  return useMemo(() => ({ ...state, start, stop, pause, resume, getRecordingUrl }), [state, start, stop, pause, resume, getRecordingUrl])
}

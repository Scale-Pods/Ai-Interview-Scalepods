import { useState, useRef, useCallback, useMemo } from 'react'
import { supabasePublic } from '@/api/client'
import { getMimeType, getCameraStream, getScreenStream, getAudioStream, stopStream, createCompositeStream } from '@/utils/mediaHelpers'

const RECORDING_VIDEO_BITS_PER_SECOND = 900_000
const RECORDING_AUDIO_BITS_PER_SECOND = 64_000

/**
 * Interval (ms) at which the MediaRecorder emits chunks.
 * Each chunk is uploaded individually, so keep this high enough
 * to avoid excessive requests but low enough to bound memory use.
 */
const CHUNK_INTERVAL_MS = 30_000 // 30-second chunks

interface MediaRecorderState {
  status: 'idle' | 'recording' | 'paused' | 'stopped'
  duration: number
  error: string | null
  recordingId: string | null
}

/**
 * Upload a single Blob chunk directly to Supabase Storage.
 * Each chunk is stored as its own object:
 *   sessions/{sessionId}/chunks/{recordingId}/{index}.webm
 *
 * Why per-chunk instead of TUS resumable for the whole file?
 * - TUS CREATE sends Upload-Length upfront → rejected with 413 if it
 *   exceeds the bucket's file_size_limit even with chunking in PATCH.
 * - Individual chunk objects are each small (≈3-4 MB @ 30 s) and
 *   always within the standard upload limit.
 */
/**
 * Upload a single Blob chunk directly to Supabase Storage with automatic retry.
 * Handles transient network glitches ("Failed to fetch", 500s) gracefully.
 */
async function uploadChunkWithRetry(
  chunk: Blob,
  path: string,
  contentType: string,
  maxRetries = 3
): Promise<void> {
  let attempt = 0
  let lastError: Error | null = null

  while (attempt <= maxRetries) {
    try {
      const { error } = await supabasePublic
        .storage
        .from('recordings')
        .upload(path, chunk, { contentType, upsert: true })

      if (!error) return // Success!
      lastError = new Error(`Chunk upload error (${path}): ${error.message}`)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }

    attempt++
    if (attempt <= maxRetries) {
      // Exponential backoff: 1s, 2s, 4s delay
      const delayMs = Math.pow(2, attempt - 1) * 1000
      console.warn(`[MediaRecorder] Chunk upload attempt ${attempt} failed for ${path}. Retrying in ${delayMs}ms...`, lastError?.message)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  // Log warning if chunk ultimately failed, but avoid throwing to keep queue alive
  console.warn(`[MediaRecorder] Chunk upload failed after ${maxRetries + 1} attempts (${path}):`, lastError)
}

export function useMediaRecorder() {
  const [state, setState] = useState<MediaRecorderState>({
    status: 'idle', duration: 0, error: null, recordingId: null
  })

  const mediaRecorderRef    = useRef<MediaRecorder | null>(null)
  const streamsRef          = useRef<MediaStream[]>([])
  const startTimeRef        = useRef<number>(0)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionIdRef        = useRef<string>('')
  const recordingIdRef      = useRef<string | null>(null)
  const storagePathRef      = useRef<string>('')   // base path for the first chunk
  const compositeIntervalRef = useRef<(() => void) | null>(null)
  const mimeTypeRef         = useRef<string>('video/webm')
  const chunkIndexRef       = useRef<number>(0)
  const uploadQueueRef      = useRef<Promise<void>>(Promise.resolve())

  /** Enqueue a chunk upload with automatic retry so they run sequentially without blocking recording */
  const enqueueChunkUpload = useCallback((chunk: Blob, path: string, contentType: string) => {
    uploadQueueRef.current = uploadQueueRef.current
      .then(() => uploadChunkWithRetry(chunk, path, contentType))
      .catch(err => {
        console.warn('[MediaRecorder] Background chunk upload queue warning:', err)
      })
  }, [])

  const start = useCallback(async (
    sessionId: string,
    existingStreams?: { camera?: MediaStream; screen?: MediaStream | null; audio?: MediaStream }
  ) => {
    try {
      sessionIdRef.current   = sessionId
      recordingIdRef.current = null
      chunkIndexRef.current  = 0
      uploadQueueRef.current = Promise.resolve()
      setState(prev => ({ ...prev, status: 'recording', error: null, recordingId: null }))

      const cameraStream = existingStreams?.camera || await getCameraStream()
      const screenStream = existingStreams?.screen !== undefined
        ? existingStreams.screen
        : await getScreenStream()
      const audioStream    = existingStreams?.audio || await getAudioStream()
      const audioFromOutside = !!existingStreams?.audio

      let mixedStream: MediaStream
      let cleanup: (() => void) | null = null

      if (screenStream && audioStream) {
        const result = createCompositeStream(cameraStream, screenStream, audioStream, {
          cameraWidth: 200, cameraHeight: 150, cameraMargin: 16, frameRate: 15
        })
        mixedStream = result.stream
        cleanup = result.cleanup
      } else if (screenStream) {
        mixedStream = new MediaStream([
          ...cameraStream.getVideoTracks(),
          ...screenStream.getVideoTracks()
        ])
      } else if (audioStream) {
        mixedStream = new MediaStream([
          ...cameraStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
        ])
      } else {
        mixedStream = new MediaStream([...cameraStream.getVideoTracks()])
      }
      compositeIntervalRef.current = cleanup

      streamsRef.current = [
        cameraStream,
        ...(screenStream ? [screenStream] : []),
        ...(audioStream && !audioFromOutside ? [audioStream] : [])
      ]

      const mimeType = getMimeType()
      mimeTypeRef.current = mimeType
      const cleanMimeType = mimeType.split(';')[0] || 'video/webm'

      const recorder = new MediaRecorder(mixedStream, {
        mimeType,
        videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND
      })

      const recordingId = crypto.randomUUID()
      recordingIdRef.current = recordingId
      startTimeRef.current   = Date.now()

      // Base storage path (chunk 0 = the first segment, used for preview URL)
      storagePathRef.current = `sessions/${sessionId}/chunks/${recordingId}/0.webm`

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return

        const idx  = chunkIndexRef.current++
        const path = `sessions/${sessionId}/chunks/${recordingId}/${idx}.webm`

        // Upload this chunk in the background without blocking recording
        enqueueChunkUpload(event.data, path, cleanMimeType)
      }

      recorder.onerror = () =>
        setState(prev => ({ ...prev, error: 'Recording error', status: 'stopped' }))

      // Emit a chunk every CHUNK_INTERVAL_MS so uploads happen continuously
      recorder.start(CHUNK_INTERVAL_MS)
      mediaRecorderRef.current = recorder
      setState(prev => ({ ...prev, recordingId }))

      // Register the recording row in the DB
      const { error: insertError } = await supabasePublic
        .from('recordings_ai_interview')
        .insert({
          id:           recordingId,
          session_id:   sessionId,
          stream_type:  'camera_video',
          status:       'processing',
          storage_path: storagePathRef.current,
          mime_type:    cleanMimeType
        })

      if (insertError) {
        console.warn('Recording DB insert warning:', insertError.message)
      }

      durationIntervalRef.current = setInterval(() => {
        setState(prev => ({
          ...prev,
          duration: Math.floor((Date.now() - startTimeRef.current) / 1000)
        }))
      }, 1000)

    } catch (err) {
      setState(prev => ({ ...prev, error: `Failed to start recording: ${err}`, status: 'idle' }))
    }
  }, [enqueueChunkUpload])

  const stop = useCallback(async () => {
    const recorder   = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    const recordingId = recordingIdRef.current

    return new Promise<void>((resolve) => {
      recorder.addEventListener('stop', async () => {
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current)
        if (compositeIntervalRef.current) compositeIntervalRef.current()
        streamsRef.current.forEach(stopStream)
        streamsRef.current = []

        // Wait for all in-flight chunk uploads to finish
        try {
          await uploadQueueRef.current
        } catch {
          // Individual chunk errors are already logged
        }

        const totalChunks    = chunkIndexRef.current
        const durationSecs   = Math.floor((Date.now() - startTimeRef.current) / 1000)
        const storagePath    = storagePathRef.current
        const sessionId      = sessionIdRef.current
        const storageContentType = mimeTypeRef.current.split(';')[0] || 'video/webm'

        if (recordingId) {
          const { error: updateError } = await supabasePublic
            .from('recordings_ai_interview')
            .upsert({
              id:           recordingId,
              session_id:   sessionId,
              stream_type:  'camera_video',
              status:       totalChunks > 0 ? 'ready' : 'failed',
              storage_path: storagePath,
              duration_secs: durationSecs,
              mime_type:    storageContentType,
              // Store chunk count so the player can load all segments
              transcoded_paths: { chunk_count: totalChunks }
            })

          if (updateError) {
            console.warn('Recording update failed:', updateError)
            setState(prev => ({ ...prev, error: `Recording update failed: ${updateError.message}` }))
          }
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
    const rid = recordingIdRef.current
    if (!sid || !rid) return null

    // List all chunks for this recording and return the public URL of the first one
    const { data, error } = await supabasePublic
      .storage
      .from('recordings')
      .list(`sessions/${sid}/chunks/${rid}`)

    if (error || !data?.length) return null

    // Sort chunks numerically and return the first chunk's URL (for preview)
    const sorted = [...data].sort((a, b) => {
      const ai = parseInt(a.name.replace('.webm', ''), 10)
      const bi = parseInt(b.name.replace('.webm', ''), 10)
      return ai - bi
    })

    const { data: urlData } = supabasePublic
      .storage
      .from('recordings')
      .getPublicUrl(`sessions/${sid}/chunks/${rid}/${sorted[0].name}`)

    return urlData.publicUrl
  }, [])

  return useMemo(
    () => ({ ...state, start, stop, pause, resume, getRecordingUrl }),
    [state, start, stop, pause, resume, getRecordingUrl]
  )
}

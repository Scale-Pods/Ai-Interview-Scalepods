import { useEffect, useState, useRef } from 'react'
import { Film, Loader, Play, Pause, Volume2, VolumeX, Maximize, Minimize, Download, Camera, Monitor, FileText, Video } from 'lucide-react'
import { supabase } from '@/api/client'
import { fetchRecordings } from '@/api/recordings'
import { InterviewTranscript } from './InterviewTranscript'
import type { Recording } from '@/types'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { formatDuration, formatBytes } from '@/utils/formatDate'

interface RecordingPlayerProps {
  sessionId: string
}

// A recording can be marked failed after its file has already reached storage
// (for example, if its final metadata update fails). Do not hide playback based
// on that status; the storage object is the source of truth for playback.
const isPlayableRecording = (recording: Recording) => Boolean(recording.storage_path)

export function RecordingPlayer({ sessionId }: RecordingPlayerProps) {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [activeRecording, setActiveRecording] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [publicVideoUrl, setPublicVideoUrl] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)
  const [activeView, setActiveView] = useState<'video' | 'transcript'>('video')
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const recs = await fetchRecordings(sessionId)
        if (recs && recs.length > 0) {
          setRecordings(recs)
          return
        }
      } catch (err) {
        console.warn('[RecordingPlayer] fetchRecordings DB query notice:', err)
      }

      // Fallback: Check if Supabase Storage contains chunk folders for this session
      try {
        const { data: chunkFolders } = await supabase.storage.from('recordings').list(`sessions/${sessionId}/chunks`)
        if (chunkFolders && chunkFolders.length > 0) {
          const fallbackRecs: Recording[] = chunkFolders.map(folder => ({
            id: folder.name,
            session_id: sessionId,
            stream_type: 'camera_video',
            status: 'ready',
            storage_path: `sessions/${sessionId}/chunks/${folder.name}/0.webm`,
            created_at: new Date().toISOString()
          }))
          setRecordings(fallbackRecs)
        }
      } catch (err) {
        console.warn('[RecordingPlayer] Storage fallback scan notice:', err)
      }
    }

    load().finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  useEffect(() => {
    if (!videoUrl) return
    const poll = setInterval(() => {
      const el = videoRef.current
      if (el && el.duration > 0 && isFinite(el.duration)) {
        setDuration(el.duration)
        clearInterval(poll)
      }
    }, 200)
    return () => clearInterval(poll)
  }, [videoUrl])

  const createdBlobUrlRef = useRef<string | null>(null)

  const cleanupBlobUrl = () => {
    if (createdBlobUrlRef.current) {
      URL.revokeObjectURL(createdBlobUrlRef.current)
      createdBlobUrlRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      cleanupBlobUrl()
    }
  }, [])

  const isChunkedRecording = (recording: Recording) =>
    recording.storage_path?.includes('/chunks/')

  const loadVideo = async (recording: Recording) => {
    setVideoLoading(true)
    setLoadError(null)
    setActiveRecording(recording.id)
    cleanupBlobUrl()
    setVideoUrl(null)
    setPublicVideoUrl(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(null)
    setActiveView('video')
    setActiveQuestionId(null)

    if (!isPlayableRecording(recording)) {
      setLoadError('This recording does not have a storage path yet.')
      setVideoLoading(false)
      return
    }

    try {
      if (isChunkedRecording(recording)) {
        // Concatenate all available chunks into a single continuous full recording Blob
        const chunkDir = recording.storage_path.replace(/\/0\.webm$/, '').replace(/0\.webm$/, '')
        const { data: chunkList, error: listError } = await supabase
          .storage
          .from('recordings')
          .list(chunkDir, { limit: 500 })

        if (!listError && chunkList && chunkList.length > 0) {
          const sorted = [...chunkList]
            .filter(f => f.name.endsWith('.webm') || f.name.endsWith('.mp4'))
            .sort((a, b) => {
              const ai = parseInt(a.name.replace(/\.(webm|mp4)$/, ''), 10)
              const bi = parseInt(b.name.replace(/\.(webm|mp4)$/, ''), 10)
              return (isNaN(ai) ? 0 : ai) - (isNaN(bi) ? 0 : bi)
            })

          // Fetch all available chunk Blobs using Promise.allSettled for resilience
          const chunkResults = await Promise.allSettled(
            sorted.map(async chunkFile => {
              const fullPath = `${chunkDir}/${chunkFile.name}`
              const { data: pub } = supabase.storage.from('recordings').getPublicUrl(fullPath)
              if (!pub?.publicUrl) throw new Error(`Missing URL for ${chunkFile.name}`)
              const res = await fetch(pub.publicUrl)
              if (!res.ok) throw new Error(`HTTP ${res.status} fetching chunk ${chunkFile.name}`)
              return res.blob()
            })
          )

          const validBlobs = chunkResults
            .filter((r): r is PromiseFulfilledResult<Blob> => r.status === 'fulfilled' && Boolean(r.value))
            .map(r => r.value)

          if (validBlobs.length > 0) {
            const cleanMime = (recording.mime_type || 'video/webm').split(';')[0] || 'video/webm'
            const mergedBlob = new Blob(validBlobs, { type: cleanMime })
            const mergedBlobUrl = URL.createObjectURL(mergedBlob)
            createdBlobUrlRef.current = mergedBlobUrl
            setVideoUrl(mergedBlobUrl)
            setVideoLoading(false)
            return
          }
        }
      }

      // Single file fallback
      const { data: publicData } = supabase
        .storage
        .from('recordings')
        .getPublicUrl(recording.storage_path)

      const fallbackUrl = publicData?.publicUrl || null
      setPublicVideoUrl(fallbackUrl)

      if (fallbackUrl) {
        setVideoUrl(fallbackUrl)
      } else {
        const { data: signedData, error: signedError } = await supabase
          .storage
          .from('recordings')
          .createSignedUrl(recording.storage_path, 3600)

        if (signedData?.signedUrl) {
          setVideoUrl(signedData.signedUrl)
        } else {
          setLoadError(`Recording URL could not be created.${signedError?.message ? ` ${signedError.message}` : ''}`)
        }
      }
    } catch (err) {
      console.warn('[RecordingPlayer] Error stitching chunks:', err)
      const { data: fallbackPub } = supabase.storage.from('recordings').getPublicUrl(recording.storage_path)
      if (fallbackPub?.publicUrl) {
        setVideoUrl(fallbackPub.publicUrl)
      } else {
        setLoadError('Failed to assemble full recording.')
      }
    } finally {
      setVideoLoading(false)
    }
  }

  const togglePlay = () => {
    if (!videoRef.current || !videoUrl || loadError) return
    if (isPlaying) videoRef.current.pause()
    else videoRef.current.play().catch(() => {})
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    videoRef.current.muted = !isMuted
    setIsMuted(!isMuted)
  }

  const toggleFullscreen = async () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  }


  const handleDownload = async (recording: Recording) => {
    try {
      let downloadUrl = videoUrl
      if (!downloadUrl || activeRecording !== recording.id) {
        if (isChunkedRecording(recording)) {
          const chunkDir = recording.storage_path.replace(/\/0\.webm$/, '').replace(/0\.webm$/, '')
          const { data: chunkList } = await supabase.storage.from('recordings').list(chunkDir, { limit: 200 })
          if (chunkList?.length) {
            const sorted = [...chunkList]
              .filter(f => f.name.endsWith('.webm'))
              .sort((a, b) => {
                const ai = parseInt(a.name.replace('.webm', ''), 10)
                const bi = parseInt(b.name.replace('.webm', ''), 10)
                return (isNaN(ai) ? 0 : ai) - (isNaN(bi) ? 0 : bi)
              })

            const chunkBlobs = await Promise.all(
              sorted.map(async f => {
                const { data: pub } = supabase.storage.from('recordings').getPublicUrl(`${chunkDir}/${f.name}`)
                const res = await fetch(pub.publicUrl)
                return res.blob()
              })
            )
            const cleanMime = (recording.mime_type || 'video/webm').split(';')[0] || 'video/webm'
            const mergedBlob = new Blob(chunkBlobs, { type: cleanMime })
            downloadUrl = URL.createObjectURL(mergedBlob)
          }
        }
      }

      if (!downloadUrl) {
        const { data: publicData } = supabase.storage.from('recordings').getPublicUrl(recording.storage_path)
        downloadUrl = publicData?.publicUrl || null
      }

      if (downloadUrl) {
        const anchor = document.createElement('a')
        anchor.href = downloadUrl
        anchor.download = `interview-recording-${sessionId.slice(0, 8)}.webm`
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
      }
    } catch (err) {
      console.error('[RecordingPlayer] Download error:', err)
    }
  }

  const currentRecording = recordings.find(r => r.id === activeRecording)
  const effectiveDuration = (duration !== null && isFinite(duration) && duration > 0)
    ? duration
    : (currentRecording?.duration_secs || null)

  const progressPercent = effectiveDuration && effectiveDuration > 0
    ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100))
    : 0

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value)
    if (videoRef.current && isFinite(targetTime)) {
      videoRef.current.currentTime = targetTime
    }
    setCurrentTime(targetTime)
  }

  const streamLabels: Record<string, string> = {
    camera_video: 'Full Recording (Camera + Screen + Audio)',
    screen_video: 'Screen Recording',
    audio_mixed: 'Audio Only'
  }

  const streamIcons: Record<string, typeof Film> = {
    camera_video: Camera,
    screen_video: Monitor,
    audio_mixed: Film
  }

  return (
    <div className="space-y-4">
      {activeRecording && videoUrl && (
        <div className="card overflow-hidden" style={{ padding: 0 }}>
          <div className="flex items-center" style={{ borderBottom: '1px solid var(--separator)', background: 'var(--fill-quaternary)' }}>
            <button
              onClick={() => setActiveView('video')}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition"
              style={{
                borderBottom: `2px solid ${activeView === 'video' ? 'var(--blue)' : 'transparent'}`,
                color: activeView === 'video' ? 'var(--blue)' : 'var(--label-tertiary)'
              }}
            >
              <Video size={14} />
              Recording
            </button>
            <button
              onClick={() => setActiveView('transcript')}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition"
              style={{
                borderBottom: `2px solid ${activeView === 'transcript' ? 'var(--blue)' : 'transparent'}`,
                color: activeView === 'transcript' ? 'var(--blue)' : 'var(--label-tertiary)'
              }}
            >
              <FileText size={14} />
              Transcript
            </button>
            <div className="flex-1" />
            {effectiveDuration !== null && (
              <span className="text-[10px] mr-3 font-mono" style={{ color: 'var(--label-tertiary)' }}>
                {formatDuration(Math.floor(currentTime))} / {formatDuration(Math.floor(effectiveDuration))}
              </span>
            )}
          </div>

          {activeView === 'video' && (
            <div ref={containerRef} className={`bg-black ${isFullscreen ? 'w-screen h-screen flex flex-col' : ''}`}>
              <div className={`relative bg-black ${isFullscreen ? 'flex-1 min-h-0 flex items-center justify-center' : ''}`}>
                {loadError ? (
                  <div className={`flex items-center justify-center ${isFullscreen ? 'h-full w-full' : 'h-48'}`}>
                    <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>{loadError}</p>
                  </div>
                ) : (
                  <video
                    ref={videoRef}
                    src={videoUrl || undefined}
                    className={`w-full bg-black cursor-pointer object-contain ${isFullscreen ? 'h-full max-h-none' : 'max-h-[500px]'}`}
                    onClick={togglePlay}
                    onTimeUpdate={() => {
                      if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
                    }}
                    onLoadedMetadata={() => {
                      if (videoRef.current && videoRef.current.duration > 0 && isFinite(videoRef.current.duration)) {
                        setDuration(videoRef.current.duration)
                      }
                    }}
                    onDurationChange={() => {
                      if (videoRef.current && videoRef.current.duration > 0 && isFinite(videoRef.current.duration)) {
                        setDuration(videoRef.current.duration)
                      }
                    }}
                    onError={() => {
                      if (publicVideoUrl && videoUrl !== publicVideoUrl) {
                        setVideoUrl(publicVideoUrl)
                        return
                      }
                      setLoadError('Recording file could not be loaded from storage.')
                    }}
                    onEnded={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                )}

                {videoLoading && (
                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
                    <Loader size={32} className="animate-spin text-white" />
                  </div>
                )}

                {!isPlaying && !videoLoading && !loadError && videoUrl && (
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.2)' }}
                    aria-label="Play recording"
                  >
                    <span className="w-16 h-16 rounded-full flex items-center justify-center transition" style={{ background: 'rgba(10,132,255,0.8)' } as React.CSSProperties}>
                      <Play size={28} className="text-white ml-1" />
                    </span>
                  </button>
                )}
              </div>

              <div className="px-4 py-3 shrink-0" style={{ background: 'rgba(0,0,0,0.95)' }}>
                <div className="flex items-center gap-3">
                  <button onClick={togglePlay} className="w-9 h-9 rounded-full flex items-center justify-center transition shrink-0"
                    style={{ background: 'var(--fill-tertiary)' }}>
                    {isPlaying ? <Pause size={16} style={{ color: 'var(--label-primary)' }} /> : <Play size={16} style={{ color: 'var(--label-primary)' }} className="ml-0.5" />}
                  </button>

                  <div className="flex-1 flex flex-col gap-1">
                    <input
                      type="range"
                      min={0}
                      max={effectiveDuration && effectiveDuration > 0 ? effectiveDuration : 100}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #0a84ff 0%, #0a84ff ${progressPercent}%, rgba(255, 255, 255, 0.2) ${progressPercent}%, rgba(255, 255, 255, 0.2) 100%)`,
                        accentColor: '#0a84ff'
                      }}
                    />
                    <div className="flex justify-between text-[9px] font-mono" style={{ color: 'var(--label-tertiary)' }}>
                      <span>{formatDuration(Math.floor(currentTime))}</span>
                      <span>{effectiveDuration ? formatDuration(Math.floor(effectiveDuration)) : '--:--'}</span>
                    </div>
                  </div>

                  <button onClick={toggleMute} className="w-8 h-8 rounded-full flex items-center justify-center transition shrink-0">
                    {isMuted ? <VolumeX size={15} style={{ color: 'var(--label-secondary)' }} /> : <Volume2 size={15} style={{ color: 'var(--label-secondary)' }} />}
                  </button>

                  <button onClick={toggleFullscreen} className="w-8 h-8 rounded-full flex items-center justify-center transition shrink-0">
                    {isFullscreen ? <Minimize size={15} style={{ color: 'var(--label-secondary)' }} /> : <Maximize size={15} style={{ color: 'var(--label-secondary)' }} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeView === 'transcript' && (
            <div className="p-4">
              <InterviewTranscript
                sessionId={sessionId}
                activeQuestionId={activeQuestionId}
                onSeekTo={(questionId) => {
                  setActiveQuestionId(questionId)
                  setActiveView('video')
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--label-secondary)' }}>Recordings</h3>
          <span className="text-[10px]" style={{ color: 'var(--label-tertiary)' }}>{recordings.length} file{recordings.length !== 1 ? 's' : ''}</span>
        </div>

        {recordings.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--label-tertiary)' }}>
            <Film size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No recordings yet. Complete an interview to generate a recording.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {recordings.map(recording => {
              const Icon = streamIcons[recording.stream_type] || Film
              const isActive = activeRecording === recording.id
              const isPlayable = isPlayableRecording(recording)

              return (
                <div key={recording.id} className="rounded-xl overflow-hidden transition" style={{
                  background: 'var(--fill-quaternary)',
                  border: isActive ? '1px solid color-mix(in srgb, var(--blue) 40%, transparent)' : '1px solid var(--separator)'
                }}>
                  <div className="p-3 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      recording.status === 'ready' ? 'badge-green' : ''
                    }`} style={recording.status !== 'ready' ? { background: 'var(--fill-quaternary)' } : {}}>
                      {recording.status === 'processing' ? (
                        <Loader size={18} className="animate-spin" style={{ color: 'var(--label-secondary)' }} />
                      ) : (
                        <Icon size={18} style={{
                          color: recording.status === 'ready' ? 'var(--green)' :
                          recording.status === 'failed' ? 'var(--red)' :
                          'var(--label-secondary)'
                        }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--label-primary)' }}>{streamLabels[recording.stream_type] || recording.stream_type}</p>
                      <div className="flex gap-2 text-[10px]" style={{ color: 'var(--label-tertiary)' }}>
                        {recording.duration_secs && <span>{formatDuration(recording.duration_secs)}</span>}
                        {recording.file_size_bytes && <span>{formatBytes(recording.file_size_bytes)}</span>}
                      </div>
                    </div>
                    {isPlayable && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => isActive ? setActiveRecording(null) : loadVideo(recording)}
                          className="px-2.5 py-1.5 rounded-lg text-xs transition flex items-center gap-1"
                          style={{
                            background: isActive ? 'color-mix(in srgb, var(--blue) 20%, transparent)' : 'var(--fill-tertiary)',
                            color: isActive ? 'var(--blue)' : 'var(--label-primary)'
                          }}
                        >
                          {isActive ? <Pause size={11} /> : <Play size={11} />}
                          {isActive ? 'Close' : 'Play'}
                        </button>
                        <button
                          onClick={() => handleDownload(recording)}
                          className="p-1.5 rounded-lg transition" style={{ background: 'var(--fill-tertiary)' }}
                          title="Download"
                        >
                          <Download size={13} style={{ color: 'var(--label-secondary)' }} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

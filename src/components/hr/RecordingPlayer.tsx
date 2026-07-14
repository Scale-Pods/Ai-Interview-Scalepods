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
    fetchRecordings(sessionId).then(setRecordings).finally(() => setLoading(false))
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

  const loadVideo = async (recording: Recording) => {
    setVideoLoading(true)
    setLoadError(null)
    setActiveRecording(recording.id)
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

    const { data: signedData, error: signedError } = await supabase
      .storage
      .from('recordings')
      .createSignedUrl(recording.storage_path, 3600)

    const { data: publicData } = supabase
      .storage
      .from('recordings')
      .getPublicUrl(recording.storage_path)

    const fallbackUrl = publicData?.publicUrl || null
    setPublicVideoUrl(fallbackUrl)

    if (signedData?.signedUrl) {
      setVideoUrl(signedData.signedUrl)
    } else if (fallbackUrl) {
      setVideoUrl(fallbackUrl)
    } else {
      const reason = signedError?.message ? ` ${signedError.message}` : ''
      setLoadError(`Recording URL could not be created.${reason}`)
    }

    setVideoLoading(false)
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

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value)
    if (videoRef.current) videoRef.current.currentTime = time
    setCurrentTime(time)
  }

  const handleDownload = async (recording: Recording) => {
    const { data, error } = await supabase
      .storage
      .from('recordings')
      .createSignedUrl(recording.storage_path, 3600)
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank')
      return
    }

    const { data: publicData } = supabase
      .storage
      .from('recordings')
      .getPublicUrl(recording.storage_path)
    if (publicData?.publicUrl) {
      window.open(publicData.publicUrl, '_blank')
      return
    }

    setLoadError(error?.message || 'Recording download URL could not be created.')
  }

  if (loading) return <LoadingSpinner text="Loading recordings..." />

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
            {duration !== null && (
              <span className="text-[10px] mr-3 font-mono" style={{ color: 'var(--label-tertiary)' }}>
                {formatDuration(Math.floor(currentTime))} / {formatDuration(Math.floor(duration))}
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
                      max={duration ?? (currentTime || 1)}
                      step="any"
                      value={currentTime}
                      onChange={handleSeek}
                      className="w-full h-1 rounded-full appearance-none cursor-pointer"
                      style={{ background: 'var(--fill-secondary)', accentColor: 'var(--blue)' }}
                    />
                    <div className="flex justify-between text-[9px] font-mono" style={{ color: 'var(--label-tertiary)' }}>
                      <span>{formatDuration(Math.floor(currentTime))}</span>
                      <span>{duration !== null ? formatDuration(Math.floor(duration)) : '--:--'}</span>
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

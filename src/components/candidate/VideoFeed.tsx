import { useEffect, useRef } from 'react'
import { CameraOff } from 'lucide-react'

interface VideoFeedProps {
  stream: MediaStream | null
  muted?: boolean
  mirrored?: boolean
  className?: string
  label?: string
}

export function VideoFeed({ stream, muted = false, mirrored = true, className = '', label }: VideoFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className={`relative rounded-xl overflow-hidden bg-black ${className}`}>
      {stream ? (
        <>
          <video
            ref={videoRef}
            autoPlay playsInline muted={muted}
            className={`w-full h-full object-cover ${mirrored ? 'scale-x-[-1]' : ''}`}
          />
          {label && (
            <div className="absolute bottom-2 left-2 text-[10px] text-white px-2 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.6)' }}>
              {label}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full" style={{ background: '#000' }}>
          <CameraOff size={24} className="mb-2" style={{ color: 'var(--label-quaternary)' }} />
          <span className="text-xs" style={{ color: 'var(--label-quaternary)' }}>Camera off</span>
        </div>
      )}
    </div>
  )
}

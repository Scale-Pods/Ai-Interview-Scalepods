import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'text/plain') {
    return file.text()
  }
  if (file.type === 'application/pdf') {
    return extractPdfText(file)
  }
  return `[File uploaded: ${file.name}, size: ${(file.size / 1024).toFixed(1)}KB]`
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: arrayBuffer }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const texts: string[] = []
    for (const item of textContent.items) {
      if ('str' in item) texts.push((item as { str: string }).str)
    }
    pages.push(texts.join(' '))
  }
  return pages.join('\n')
}

export function getMimeType(): string {
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
    return 'video/webm;codecs=vp9,opus'
  }
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
    return 'video/webm;codecs=vp8,opus'
  }
  return 'video/webm'
}

export async function getCameraStream(constraints?: MediaTrackConstraints, timeoutMs = 6000): Promise<MediaStream> {
  const tmr = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  const stream = await Promise.race([
    navigator.mediaDevices.getUserMedia({ video: constraints || { width: 640, height: 480, frameRate: 15 } }),
    tmr
  ]) as MediaStream
  return stream
}

export async function getAudioStream(timeoutMs = 4000): Promise<MediaStream | null> {
  const audioOnlyTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  try {
    return await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      audioOnlyTimeout
    ]) as MediaStream
  } catch {}

  // Try video+audio combined first — camera's built-in mic may require video
  for (const cons of [
    { audio: true, video: true },
    { audio: true }
  ]) {
    const tmr = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    try {
      const stream = await Promise.race([navigator.mediaDevices.getUserMedia(cons), tmr]) as MediaStream
      return stream
    } catch {}
  }
  return null
}

export async function getScreenStream(timeoutMs = 15000): Promise<MediaStream | null> {
  const tmr = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), timeoutMs)
  )
  try {
    const stream = await Promise.race([
      navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }),
      tmr
    ]) as MediaStream
    return stream
  } catch (err: any) {
    if (err?.message === 'timeout') {
      console.warn(`getScreenStream timed out after ${timeoutMs}ms`)
    }
    return null
  }
}

export function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach(t => t.stop())
}

interface CompositeOptions {
  cameraWidth?: number
  cameraHeight?: number
  cameraMargin?: number
  frameRate?: number
}

export function createCompositeStream(
  cameraStream: MediaStream,
  screenStream: MediaStream,
  audioStream: MediaStream,
  options: CompositeOptions = {}
): { stream: MediaStream; cleanup: () => void } {
  const { cameraWidth = 200, cameraHeight = 150, cameraMargin = 16, frameRate = 15 } = options

  const screenTrack = screenStream.getVideoTracks()[0]
  const settings = screenTrack.getSettings()
  const width = settings.width || 1920
  const height = settings.height || 1080

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const screenVideo = document.createElement('video')
  screenVideo.srcObject = screenStream
  screenVideo.muted = true
  screenVideo.play()

  const cameraVideo = document.createElement('video')
  cameraVideo.srcObject = cameraStream
  cameraVideo.muted = true
  cameraVideo.play()

  const compositeStream = canvas.captureStream(frameRate)
  audioStream.getAudioTracks().forEach(track => compositeStream.addTrack(track))

  const cameraX = width - cameraWidth - cameraMargin
  const cameraY = height - cameraHeight - cameraMargin

  const interval = setInterval(() => {
    ctx.drawImage(screenVideo, 0, 0, width, height)
    ctx.drawImage(cameraVideo, cameraX, cameraY, cameraWidth, cameraHeight)
  }, Math.round(1000 / frameRate))

  return {
    stream: compositeStream,
    cleanup: () => clearInterval(interval)
  }
}

export function createCanvasSnapshot(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  canvas.getContext('2d')!.drawImage(video, 0, 0, 320, 240)
  return canvas.toDataURL('image/jpeg', 0.7)
}

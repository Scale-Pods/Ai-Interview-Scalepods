/**
 * mediapipeFaceDetector.ts
 *
 * Singleton wrapper around @mediapipe/tasks-vision FaceDetector.
 *
 * The WASM model (~2 MB) is downloaded once on first call and cached as a module-level
 * singleton.  Every subsequent call to detectFaces() reuses the same instance, adding
 * virtually no overhead to the 3-second proctoring tick.
 *
 * Usage:
 *   const count = await detectFaces(videoElement)
 *   // count === 0  → face absent
 *   // count === 1  → exactly one face (normal)
 *   // count  > 1  → multiple faces
 *   // count === -1 → model not ready yet (skip this tick)
 */

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

// Singleton state
let detector: FaceDetector | null = null
let initialising = false
let initFailed = false

/**
 * Lazily initialises the MediaPipe FaceDetector on first call.
 * Subsequent calls return the already-created instance immediately.
 *
 * The WASM runtime is loaded from the MediaPipe CDN (jsDelivr mirror) so no
 * additional bundler configuration is needed.  The model file is also CDN-hosted
 * so there is nothing to copy to /public.
 */
async function getDetector(): Promise<FaceDetector | null> {
  if (detector) return detector
  if (initFailed) return null
  if (initialising) return null // another tick is already initialising — skip this one

  initialising = true
  try {
    // Vision WASM runtime — served from jsDelivr CDN
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    )

    detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        // BlazeFace Short-Range model — fast, lightweight, accurate for webcams
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
        delegate: 'GPU', // Falls back to CPU automatically if GPU is unavailable
      },
      runningMode: 'VIDEO', // Required for continuous video-frame input
      minDetectionConfidence: 0.6, // Only report faces the model is ≥60% confident about
      minSuppressionThreshold: 0.4,
    })

    console.log('[MediaPipe] FaceDetector initialised successfully')
    return detector
  } catch (err) {
    console.warn('[MediaPipe] FaceDetector initialisation failed, will not retry:', err)
    initFailed = true
    return null
  } finally {
    initialising = false
  }
}

/**
 * Detects how many faces are present in the given video frame.
 *
 * @param video  A <video> element that is actively playing (readyState ≥ 2)
 * @returns
 *   -1  → detector not ready yet (model still loading or failed) — caller should skip tick
 *    0  → no face detected
 *    n  → n faces detected (n ≥ 1)
 */
export async function detectFaces(video: HTMLVideoElement): Promise<number> {
  const det = await getDetector()
  if (!det) return -1 // not ready — skip this tick

  try {
    // detectForVideo requires a monotonically increasing timestamp in ms.
    // performance.now() is ideal: sub-millisecond precision, never goes backwards.
    const result = det.detectForVideo(video, performance.now())
    return result.detections.length
  } catch (err) {
    // Transient errors (e.g. video frame not decoded yet) are normal — just skip
    console.debug('[MediaPipe] detectForVideo error (transient):', err)
    return -1
  }
}

/**
 * Returns true once the MediaPipe model has finished loading.
 * Useful for showing a "camera warming up" state in the UI.
 */
export function isFaceDetectorReady(): boolean {
  return detector !== null
}

/**
 * Releases the detector and resets singleton state.
 * Call this when the interview session ends to free GPU/CPU resources.
 */
export function disposeFaceDetector(): void {
  if (detector) {
    try { detector.close() } catch {}
    detector = null
  }
  initialising = false
  initFailed = false
}

/**
 * mediapipeLandmarker.ts
 *
 * Singleton wrapper around @mediapipe/tasks-vision FaceLandmarker.
 *
 * Provides two behavioral signals useful for proctoring:
 *   - gazeAway  : candidate is looking left/right (toward a second screen or person)
 *   - headDown  : candidate is looking down (toward desk notes or a phone)
 *
 * Both signals require BOTH the relevant blendshape score AND head-pose angle to exceed
 * their thresholds simultaneously — this dual-gate approach drastically reduces false
 * positives from natural eye movement or minor head tilt during thinking.
 *
 * The WASM model (~3.5 MB) is downloaded from CDN on first call and cached as a
 * module-level singleton.  Every subsequent detectBehavior() call reuses it with
 * zero initialisation overhead.
 *
 * Usage:
 *   const result = await detectBehavior(videoElement)
 *   // result === null        → model not ready yet (skip this tick)
 *   // result.gazeAway        → true if looking left or right
 *   // result.headDown        → true if looking down
 *   // result.faceCount       → number of faces detected (bonus — reuse for face checks)
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export interface BehaviorResult {
  gazeAway: boolean
  headDown: boolean
  faceCount: number
  /** Raw yaw angle in degrees (positive = looking right, negative = looking left) */
  yawDeg: number
  /** Raw pitch angle in degrees (negative = looking down) */
  pitchDeg: number
}

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** Blendshape score (0–1) above which an eye is considered "looking outward" */
const GAZE_BLEND_THRESHOLD = 0.30

/** Head yaw angle (degrees) beyond which gaze_away is confirmed */
const GAZE_YAW_THRESHOLD = 18

/** Blendshape score above which eye is considered "looking down" */
const HEAD_DOWN_BLEND_THRESHOLD = 0.30

/** Head pitch angle (degrees) below which head_down is confirmed (negative = chin down) */
const HEAD_DOWN_PITCH_THRESHOLD = -14

// ─── Singleton state ──────────────────────────────────────────────────────────

let landmarker: FaceLandmarker | null = null
let initialising = false
let initFailed = false

async function getLandmarker(): Promise<FaceLandmarker | null> {
  if (landmarker) return landmarker
  if (initFailed) return null
  if (initialising) return null

  initialising = true
  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    )

    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        // Full face landmarker model with blendshape support
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 2,                        // detect up to 2 — enough for multi-face check too
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: true,        // needed for gaze and head_down blendshapes
      outputFacialTransformationMatrixes: true, // needed for yaw/pitch angles
    })

    console.log('[MediaPipe] FaceLandmarker initialised successfully')
    return landmarker
  } catch (err) {
    console.warn('[MediaPipe] FaceLandmarker initialisation failed:', err)
    initFailed = true
    return null
  } finally {
    initialising = false
  }
}

// ─── Matrix → Euler angles ────────────────────────────────────────────────────

/**
 * Extracts yaw (left/right) and pitch (up/down) angles in degrees from the
 * 4×4 facial transformation matrix output by FaceLandmarker.
 *
 * The matrix is column-major (WebGL convention):
 *   [ R00 R10 R20 0 ]
 *   [ R01 R11 R21 0 ]
 *   [ R02 R12 R22 0 ]
 *   [ tx  ty  tz  1 ]
 *
 * We use the standard ZYX Euler decomposition:
 *   pitch = atan2(-R20, sqrt(R21² + R22²))
 *   yaw   = atan2(R10, R00)
 */
function matrixToYawPitch(matrix: { data: Float32Array } | number[]): { yawDeg: number; pitchDeg: number } {
  const m = 'data' in matrix ? matrix.data : (matrix as unknown as Float32Array)
  // Column-major layout → m[i*4+j]
  const R00 = m[0], R10 = m[1], R20 = m[2]
  const R21 = m[6], R22 = m[10]

  const pitchRad = Math.atan2(-R20, Math.sqrt(R21 * R21 + R22 * R22))
  const yawRad = Math.atan2(R10, R00)

  return {
    yawDeg: yawRad * (180 / Math.PI),
    pitchDeg: pitchRad * (180 / Math.PI),
  }
}

/** Returns a blendshape score by name, or 0 if not found */
function blend(shapes: { categoryName: string; score: number }[], name: string): number {
  return shapes.find(s => s.categoryName === name)?.score ?? 0
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyses a video frame and returns behavioral proctoring signals.
 * Returns null while the model is still loading (caller should skip that tick).
 */
export async function detectBehavior(video: HTMLVideoElement): Promise<BehaviorResult | null> {
  const lm = await getLandmarker()
  if (!lm) return null

  try {
    const result = lm.detectForVideo(video, performance.now())
    const faceCount = result.faceLandmarks.length

    if (faceCount === 0) {
      return { gazeAway: false, headDown: false, faceCount: 0, yawDeg: 0, pitchDeg: 0 }
    }

    // Use the first (primary) face for behavioral analysis
    const blendshapes = result.faceBlendshapes?.[0]?.categories ?? []
    const matrices = result.facialTransformationMatrixes

    // ── Gaze Away Detection ────────────────────────────────────────────────
    // Eyes looking outward (toward a side screen) — confirmed by BOTH:
    //   1. eyeLookOutLeft or eyeLookOutRight blendshape above threshold
    //   2. Head yaw angle beyond threshold
    const eyeLookOutLeft = blend(blendshapes, 'eyeLookOutLeft')
    const eyeLookOutRight = blend(blendshapes, 'eyeLookOutRight')
    const eyeLookingOut = Math.max(eyeLookOutLeft, eyeLookOutRight) > GAZE_BLEND_THRESHOLD

    // ── Head Down Detection ────────────────────────────────────────────────
    // Eyes looking down — confirmed by BOTH:
    //   1. eyeLookDownLeft or eyeLookDownRight blendshape above threshold
    //   2. Head pitch below threshold (chin tilted downward)
    const eyeLookDownLeft = blend(blendshapes, 'eyeLookDownLeft')
    const eyeLookDownRight = blend(blendshapes, 'eyeLookDownRight')
    const eyeLookingDown = Math.max(eyeLookDownLeft, eyeLookDownRight) > HEAD_DOWN_BLEND_THRESHOLD

    // ── Head Pose from Transformation Matrix ──────────────────────────────
    let yawDeg = 0
    let pitchDeg = 0
    if (matrices && matrices.length > 0) {
      const angles = matrixToYawPitch(matrices[0] as any)
      yawDeg = angles.yawDeg
      pitchDeg = angles.pitchDeg
    }

    const headTurnedSideways = Math.abs(yawDeg) > GAZE_YAW_THRESHOLD
    const headTiltedDown = pitchDeg < HEAD_DOWN_PITCH_THRESHOLD

    // Trigger if head angle is turned OR eye blendshape indicates looking away
    const gazeAway = headTurnedSideways || (eyeLookingOut && Math.abs(yawDeg) > 8)
    const headDown = headTiltedDown || (eyeLookingDown && pitchDeg < -6)

    return { gazeAway, headDown, faceCount, yawDeg, pitchDeg }
  } catch (err) {
    console.debug('[MediaPipe] detectBehavior error (transient):', err)
    return null
  }
}

export function isLandmarkerReady(): boolean {
  return landmarker !== null
}

export function disposeLandmarker(): void {
  if (landmarker) {
    try { landmarker.close() } catch {}
    landmarker = null
  }
  initialising = false
  initFailed = false
}

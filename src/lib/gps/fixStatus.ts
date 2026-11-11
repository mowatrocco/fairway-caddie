import type { CourseFeature } from '../../types/courseMap'
import { distanceM, type LngLat } from '../geo/geodesic'
import { pointOf } from '../course/features'
import { FAIR_M, gradeAccuracy, type AccuracyGrade } from './accuracy'

export interface LiveFix {
  point: LngLat
  accuracyM: number
  /** Milliseconds since epoch, from the phone. */
  at: number
}

/** A reading older than this is shown as out of date. */
export const STALE_AFTER_MS = 20_000

export type FixStatus =
  | { kind: 'off' }
  | { kind: 'waiting' }
  | { kind: 'denied' }
  | { kind: 'unavailable' }
  | { kind: 'fix'; grade: AccuracyGrade; accuracyM: number; ageS: number; stale: boolean }

export function describeFix(fix: LiveFix | null, now: number, base: 'off' | 'waiting' | 'denied' | 'unavailable' = 'waiting'): FixStatus {
  if (!fix) return { kind: base }
  const age = Math.max(0, now - fix.at)
  return {
    kind: 'fix',
    grade: gradeAccuracy(fix.accuracyM),
    accuracyM: fix.accuracyM,
    ageS: Math.round(age / 1000),
    stale: age > STALE_AFTER_MS,
  }
}

/** Should distances from this fix be trusted for display as plain numbers? */
export function fixIsUsable(s: FixStatus): boolean {
  return s.kind === 'fix' && !s.stale && s.accuracyM <= FAIR_M
}

/**
 * If you're standing on another hole's tee, suggest switching to it.
 * Needs a decent fix; never switches by itself.
 */
export function suggestHole(features: CourseFeature[], fix: LiveFix | null, currentHole: number, withinM = 30): number | null {
  if (!fix || fix.accuracyM > 15) return null
  let best: { hole: number; d: number } | null = null
  for (const f of features) {
    if (f.kind !== 'tee') continue
    const p = pointOf(f)
    if (!p) continue
    const d = distanceM(fix.point, p)
    if (d <= withinM && (!best || d < best.d)) best = { hole: f.holes[0], d }
  }
  return best && best.hole !== currentHole ? best.hole : null
}

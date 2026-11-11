import type { Course } from '../../types/course'
import type { CourseFeature } from '../../types/courseMap'
import { distanceM, pathLengthM, type LngLat } from '../geo/geodesic'
import { describeOutline } from '../geo/green'
import {
  findGreen,
  findGreenMiddle,
  findLineOfPlay,
  findTee,
  KINDS,
  lineOf,
  onHole,
  pointOf,
  ringOf,
  vertices,
} from './features'

export type CheckLevel = 'missing' | 'problem' | 'warning' | 'ok'

export interface HoleCheck {
  level: CheckLevel
  text: string
}

export type HoleStatus = 'not-started' | 'needs-work' | 'check' | 'ready'

export interface HoleReport {
  hole: number
  status: HoleStatus
  checks: HoleCheck[]
  verified: number
  traced: number
}

/** Mapped hole length may differ from the card by this much before we flag it. */
export function lengthTolerance(cardM: number): number {
  return Math.max(10, cardM * 0.04)
}

/** Further than this from the club and a feature is almost certainly misplaced. */
export const MAX_FROM_CLUB_M = 3000

/** Middle of the green for distance purposes: GPS-verified point if captured, else outline centre. */
export function greenMiddle(features: CourseFeature[], hole: number): LngLat | undefined {
  const verified = pointOf(findGreenMiddle(features, hole))
  if (verified) return verified
  const ring = ringOf(findGreen(features, hole))
  return ring ? describeOutline(ring).middle : undefined
}

/**
 * Mapped length of a hole from one tee: tee → any dog-leg corners on the line of play → green middle.
 */
export function mappedLength(features: CourseFeature[], hole: number, teeId: string): number | undefined {
  const tee = pointOf(findTee(features, hole, teeId))
  const middle = greenMiddle(features, hole)
  if (!tee || !middle) return undefined
  const line = lineOf(findLineOfPlay(features, hole))
  const corners = line ? line.slice(1, -1) : []
  return pathLengthM([tee, ...corners, middle])
}

export function checkHole(features: CourseFeature[], hole: number, course: Course): HoleReport {
  const checks: HoleCheck[] = []
  const here = onHole(features, hole)
  const club: LngLat = [course.mapStart.lng, course.mapStart.lat]

  // Green
  const green = findGreen(features, hole)
  const ring = ringOf(green)
  if (!ring) {
    checks.push({ level: 'missing', text: 'Green outline' })
  } else {
    const shape = describeOutline(ring)
    if (shape.selfIntersecting) {
      checks.push({ level: 'problem', text: 'Green outline crosses itself. Move a corner so the edges don’t cross.' })
    } else if (shape.areaM2 < 150 || shape.areaM2 > 2000) {
      checks.push({
        level: 'warning',
        text: `Green is ${Math.round(shape.areaM2)} m², which is unusual for a green. Check the outline.`,
      })
    } else {
      checks.push({ level: 'ok', text: `Green outline, ${Math.round(shape.areaM2)} m²` })
    }
  }

  // Tees and lengths against the scorecard
  for (const tee of course.tees) {
    const card = tee.holes.find((h) => h.hole === hole)
    if (!card) continue
    if (!findTee(features, hole, tee.id)) {
      checks.push({ level: 'missing', text: `${tee.name} tee` })
      continue
    }
    const len = mappedLength(features, hole, tee.id)
    if (len === undefined) {
      checks.push({ level: 'ok', text: `${tee.name} tee placed. Length check needs the green.` })
      continue
    }
    const diff = len - card.metres
    if (Math.abs(diff) <= lengthTolerance(card.metres)) {
      checks.push({ level: 'ok', text: `${tee.name} tee: ${Math.round(len)} m mapped, card says ${card.metres} m` })
    } else {
      checks.push({
        level: 'warning',
        text: `${tee.name} tee: ${Math.round(len)} m mapped, card says ${card.metres} m (${Math.round(Math.abs(diff))} m ${diff < 0 ? 'short' : 'long'}). Check the tee and green, or add a line of play if the hole bends.`,
      })
    }
  }

  // Shapes that cross themselves, and anything far from the club
  for (const f of here) {
    if (f.kind !== 'green' && f.geometry.type === 'Polygon') {
      const shape = describeOutline(f.geometry.coordinates[0])
      if (shape.selfIntersecting) {
        checks.push({ level: 'problem', text: `${KINDS[f.kind].label} outline crosses itself.` })
      }
    }
    const far = vertices(f).some((p) => distanceM(p, club) > MAX_FROM_CLUB_M)
    if (far) {
      checks.push({
        level: 'problem',
        text: `${KINDS[f.kind].label} is more than ${MAX_FROM_CLUB_M / 1000} km from the club. It's probably in the wrong place.`,
      })
    }
  }

  const verified = here.filter((f) => f.trust === 'verified-on-course' || f.trust === 'official').length
  const traced = here.length - verified

  let status: HoleStatus
  if (here.length === 0) status = 'not-started'
  else if (checks.some((c) => c.level === 'missing' || c.level === 'problem')) status = 'needs-work'
  else if (checks.some((c) => c.level === 'warning')) status = 'check'
  else status = 'ready'

  return { hole, status, checks, verified, traced }
}

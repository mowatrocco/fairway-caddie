import type { CourseFeature, FeatureKind } from '../../types/courseMap'
import type { LngLat } from '../geo/geodesic'
import { localPlane, pointInRing, type XY } from '../geo/plane'
import { distanceM } from '../geo/geodesic'
import { findLineOfPlay, lineOf, pointOf, vertices } from './features'
import { greenMiddle } from './holeChecks'

// Which holes a hazard matters on is worked out from where it sits, not from the
// hole it was drawn on. Each hole has a playing corridor: back tee → any dog-leg
// corners → green middle, stretched a little behind the tee and past the green.

export const HAZARD_KINDS: FeatureKind[] = ['bunker', 'water', 'trouble', 'out-of-bounds']

/** An area hazard counts for a hole if any part is this close to the hole's centre line. */
export const AREA_REACH_M = 45
/** Out-of-bounds lines run along the edge of play, so they get a little more room. */
export const BOUNDARY_REACH_M = 60
const BEHIND_TEE_M = 20
const PAST_GREEN_M = 40
const STEP_M = 4

export function isHazard(f: CourseFeature): boolean {
  return HAZARD_KINDS.includes(f.kind)
}

/** The hole's centre line: back tee (furthest from the green), dog-leg corners, green middle. */
export function holeCorridor(features: CourseFeature[], hole: number): LngLat[] | null {
  const middle = greenMiddle(features, hole)
  if (!middle) return null
  const tees = features
    .filter((f) => f.kind === 'tee' && f.holes.includes(hole))
    .map((f) => pointOf(f))
    .filter((p): p is LngLat => Boolean(p))
  if (tees.length === 0) return null
  const back = tees.reduce((a, b) => (distanceM(b, middle) > distanceM(a, middle) ? b : a))
  const line = lineOf(findLineOfPlay(features, hole))
  const corners = line ? line.slice(1, -1) : []
  return [back, ...corners, middle]
}

function extend(line: XY[]): XY[] {
  const out = [...line]
  const stretch = (a: XY, b: XY, m: number): XY => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    return [b[0] + (dx / len) * m, b[1] + (dy / len) * m]
  }
  out.unshift(stretch(line[1], line[0], BEHIND_TEE_M))
  out.push(stretch(line[line.length - 2], line[line.length - 1], PAST_GREEN_M))
  return out
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function distToLine(p: XY, line: XY[]): number {
  let d = Infinity
  for (let i = 1; i < line.length; i++) d = Math.min(d, distToSegment(p, line[i - 1], line[i]))
  return d
}

/** Points every few metres along a path (closed for outlines). */
function densify(pts: XY[], closed: boolean): XY[] {
  const path = closed ? [...pts, pts[0]] : pts
  const out: XY[] = []
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = path[i - 1]
    const [x2, y2] = path[i]
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / STEP_M))
    for (let s = 0; s < n; s++) out.push([x1 + ((x2 - x1) * s) / n, y1 + ((y2 - y1) * s) / n])
  }
  out.push(path[path.length - 1])
  return out
}

export interface HoleReach {
  hole: number
  /** Closest the hazard comes to the hole's centre line, metres (0 if the line runs through it). */
  distanceM: number
}

/**
 * For every hazard: the holes it counts for, nearest first.
 * Returns a map of feature id → holes. Non-hazards aren't included.
 */
export function hazardHoles(features: CourseFeature[], origin: LngLat): Map<string, HoleReach[]> {
  const plane = localPlane(origin)
  const corridors: { hole: number; line: XY[]; samples: XY[] }[] = []
  for (let h = 1; h <= 18; h++) {
    const c = holeCorridor(features, h)
    if (!c) continue
    const line = extend(c.map(plane.toXY))
    corridors.push({ hole: h, line, samples: densify(line, false) })
  }

  const result = new Map<string, HoleReach[]>()
  for (const f of features) {
    if (!isHazard(f)) continue
    const isArea = f.geometry.type === 'Polygon'
    const outline = vertices(f).map(plane.toXY)
    const samples = densify(outline, isArea)
    const reach = isArea ? AREA_REACH_M : BOUNDARY_REACH_M
    const holes: HoleReach[] = []
    for (const c of corridors) {
      // The centre line runs through the hazard?
      const through = isArea && c.samples.some((p) => pointInRing(p, outline))
      const d = through ? 0 : Math.min(...samples.map((p) => distToLine(p, c.line)))
      if (d <= reach) holes.push({ hole: c.hole, distanceM: d })
    }
    result.set(
      f.id,
      holes.sort((a, b) => a.distanceM - b.distanceM),
    )
  }
  return result
}

/** Does this feature belong on this hole? Hazards: worked out from position. Others: as drawn. */
export function appliesToHole(f: CourseFeature, hole: number, auto: Map<string, HoleReach[]>): boolean {
  if (isHazard(f)) return (auto.get(f.id) ?? []).some((r) => r.hole === hole)
  return f.holes.includes(hole)
}

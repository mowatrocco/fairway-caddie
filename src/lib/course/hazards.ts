import type { CourseFeature, FeatureKind } from '../../types/courseMap'
import type { TrustLevel } from '../../types/course'
import type { LngLat } from '../geo/geodesic'
import { localPlane, type XY } from '../geo/plane'
import { KINDS, vertices } from './features'

// Hazards measured along your line to the target (normally the green middle):
// "reach" = how far to get to its near edge, "carry" = how far to fly over its far edge.
// Measured in a flat grid centred on you; over a golf hole the error is millimetres.

export type Side = 'left' | 'right' | 'across'

export interface HazardReading {
  id: string
  kind: FeatureKind
  label: string
  side: Side
  /** Along your line to its nearest edge, metres (0 if you're in it). */
  reachM: number
  /** Along your line to its far edge, metres. */
  carryM: number
  /** Closest sideways distance from your line, metres (0 if your line crosses it). */
  offsetM: number
  trust: TrustLevel
}

export interface BoundaryReading {
  id: string
  side: Side
  /** Closest the out-of-bounds line comes to your line, between you and the target, metres. */
  clearanceM: number
  /** How far along your line that closest point is, metres. */
  atM: number
  trust: TrustLevel
}

export interface HazardOptions {
  /** Ignore hazards further than this to the side of your line. */
  maxOffsetM?: number
  /** Include hazards up to this far beyond the target (e.g. behind the green). */
  beyondTargetM?: number
}

const AREA_KINDS: FeatureKind[] = ['bunker', 'water', 'trouble']

interface Frame {
  toXY: (p: LngLat) => XY
  dir: XY
  targetM: number
}

function frame(from: LngLat, target: LngLat): Frame | null {
  const plane = localPlane(from)
  const t = plane.toXY(target)
  const len = Math.hypot(t[0], t[1])
  if (len < 1) return null
  return { toXY: plane.toXY, dir: [t[0] / len, t[1] / len], targetM: len }
}

const along = (f: Frame, v: XY) => v[0] * f.dir[0] + v[1] * f.dir[1]
/** Positive = left of your line, negative = right. */
const across = (f: Frame, v: XY) => f.dir[0] * v[1] - f.dir[1] * v[0]

export function analyseHazards(
  features: CourseFeature[],
  hole: number,
  from: LngLat,
  target: LngLat,
  opts: HazardOptions = {},
): HazardReading[] {
  const maxOffset = opts.maxOffsetM ?? 40
  const beyond = opts.beyondTargetM ?? 30
  const f = frame(from, target)
  if (!f) return []

  const out: HazardReading[] = []
  for (const feat of features) {
    if (!AREA_KINDS.includes(feat.kind) || !feat.holes.includes(hole)) continue
    const pts = vertices(feat).map(f.toXY)
    const a = pts.map((p) => along(f, p))
    const c = pts.map((p) => across(f, p))
    const minA = Math.min(...a)
    const maxA = Math.max(...a)
    if (maxA <= 0 || minA > f.targetM + beyond) continue // behind you, or well past the target

    const crosses = Math.min(...c) <= 0 && Math.max(...c) >= 0
    // For a straight line, the closest point of a polygon that doesn't cross it is a corner.
    const offset = crosses ? 0 : Math.min(...c.map(Math.abs))
    if (offset > maxOffset) continue

    out.push({
      id: feat.id,
      kind: feat.kind,
      label: KINDS[feat.kind].label,
      side: crosses ? 'across' : c[0] > 0 ? 'left' : 'right',
      reachM: Math.max(0, minA),
      carryM: maxA,
      offsetM: offset,
      trust: feat.trust,
    })
  }
  return out.sort((x, y) => x.reachM - y.reachM)
}

/** Out-of-bounds lines near your line between you and the target. */
export function analyseBoundaries(
  features: CourseFeature[],
  hole: number,
  from: LngLat,
  target: LngLat,
  opts: { maxClearanceM?: number } = {},
): BoundaryReading[] {
  const maxClear = opts.maxClearanceM ?? 60
  const f = frame(from, target)
  if (!f) return []

  const out: BoundaryReading[] = []
  for (const feat of features) {
    if (feat.kind !== 'out-of-bounds' || !feat.holes.includes(hole) || feat.geometry.type !== 'LineString') continue
    const pts = feat.geometry.coordinates.map(f.toXY)
    let best: { clear: number; at: number; side: Side } | null = null
    let sawLeft = false
    let sawRight = false
    // Walk the boundary in 2 m steps so long straight fences are measured properly.
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1]
      const [x2, y2] = pts[i]
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2))
      for (let s = 0; s <= steps; s++) {
        const p: XY = [x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps]
        const a = along(f, p)
        if (a < 0 || a > f.targetM) continue
        const c = across(f, p)
        if (c > 0) sawLeft = true
        if (c < 0) sawRight = true
        if (!best || Math.abs(c) < best.clear) best = { clear: Math.abs(c), at: a, side: c >= 0 ? 'left' : 'right' }
      }
    }
    if (!best) continue
    const side: Side = sawLeft && sawRight ? 'across' : best.side
    const clearance = side === 'across' ? 0 : best.clear
    if (clearance > maxClear) continue
    out.push({ id: feat.id, side, clearanceM: clearance, atM: best.at, trust: feat.trust })
  }
  return out.sort((x, y) => x.clearanceM - y.clearanceM)
}

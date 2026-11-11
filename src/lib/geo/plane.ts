import type { LngLat } from './geodesic'

// A flat x/y grid in metres around a nearby origin, for shape work (areas, centres,
// crossings). Over a golf hole (under 1 km) its error is millimetres.
// Distances shown to the golfer still come from geodesic.ts.

export type XY = [number, number]

const A = 6378137 // WGS84 semi-major axis
const E2 = 0.00669437999014 // WGS84 eccentricity squared
const RAD = Math.PI / 180

export interface LocalPlane {
  toXY: (p: LngLat) => XY
  toLngLat: (p: XY) => LngLat
}

export function localPlane(origin: LngLat): LocalPlane {
  const phi = origin[1] * RAD
  const s = Math.sin(phi)
  const w = Math.sqrt(1 - E2 * s * s)
  const N = A / w // prime vertical radius
  const M = (A * (1 - E2)) / (w * w * w) // meridional radius
  const kx = N * Math.cos(phi) * RAD
  const ky = M * RAD
  return {
    toXY: (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    toLngLat: (p) => [origin[0] + p[0] / kx, origin[1] + p[1] / ky],
  }
}

/** Remove a repeated closing vertex, if present. */
export function openRing<T extends XY | LngLat>(ring: T[]): T[] {
  if (ring.length > 1) {
    const a = ring[0]
    const b = ring[ring.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1)
  }
  return ring
}

/** Signed area (m²) of an open ring; positive = anticlockwise. */
export function signedArea(ring: XY[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

export function area(ring: XY[]): number {
  return Math.abs(signedArea(ring))
}

/** Area-weighted centre of an open ring. */
export function centroid(ring: XY[]): XY {
  const a = signedArea(ring)
  if (Math.abs(a) < 1e-9) {
    const n = ring.length || 1
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    const f = x1 * y2 - x2 * y1
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
  }
  return [cx / (6 * a), cy / (6 * a)]
}

function cross(o: XY, a: XY, b: XY): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/** True if segments p1-p2 and p3-p4 cross (touching at shared endpoints doesn't count). */
export function segmentsCross(p1: XY, p2: XY, p3: XY, p4: XY): boolean {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** True if any two non-neighbouring edges of the open ring cross. */
export function isSelfIntersecting(ring: XY[]): boolean {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true
    }
  }
  return false
}

export function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Where the infinite line `origin + t·dir` crosses the ring's edges.
 * Returns the t values (dir is a unit vector, so t is metres along it).
 */
export function lineCrossings(origin: XY, dir: XY, ring: XY[]): number[] {
  const ts: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const denom = dir[0] * ey - dir[1] * ex
    if (Math.abs(denom) < 1e-12) continue // parallel
    const wx = a[0] - origin[0]
    const wy = a[1] - origin[1]
    const t = (wx * ey - wy * ex) / denom
    const u = (wx * dir[1] - wy * dir[0]) / denom
    if (u >= 0 && u <= 1) ts.push(t)
  }
  return ts
}

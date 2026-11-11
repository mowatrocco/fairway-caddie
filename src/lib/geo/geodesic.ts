import { Geodesic } from 'geographiclib-geodesic'

/** [longitude, latitude] in degrees, WGS84 — the same order GeoJSON uses. */
export type LngLat = [number, number]

const WGS84 = Geodesic.WGS84

/**
 * Distance in metres on the WGS84 ellipsoid (GeographicLib).
 * This is the only function in the app that should produce a distance between two coordinates.
 */
export function distanceM(a: LngLat, b: LngLat): number {
  return WGS84.Inverse(a[1], a[0], b[1], b[0]).s12 ?? NaN
}

/** Initial compass bearing from a to b, 0–360 degrees (0 = north). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const azi = WGS84.Inverse(a[1], a[0], b[1], b[0]).azi1 ?? NaN
  return (azi + 360) % 360
}

/** The point reached by going `metres` from `a` on compass bearing `bearing`. */
export function destination(a: LngLat, bearing: number, metres: number): LngLat {
  const r = WGS84.Direct(a[1], a[0], bearing, metres)
  return [r.lon2 ?? NaN, r.lat2 ?? NaN]
}

/** Length of a path (sum of its legs), metres. */
export function pathLengthM(points: LngLat[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1], points[i])
  return total
}

export function isValidLngLat(p: unknown): p is LngLat {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90
  )
}

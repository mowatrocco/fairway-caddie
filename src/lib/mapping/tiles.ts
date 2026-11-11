import type { LngLat } from '../geo/geodesic'
import { destination } from '../geo/geodesic'

// Web Mercator tile maths for saving the course's aerial photos on the phone.

export interface Tile {
  z: number
  x: number
  y: number
}

export function lngLatToTile([lng, lat]: LngLat, z: number): Tile {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) }
}

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

/** Box round some points, grown by `marginM` metres on every side. */
export function boundsAround(points: LngLat[], marginM: number): Bounds | null {
  if (points.length === 0) return null
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  const sw: LngLat = [Math.min(...lngs), Math.min(...lats)]
  const ne: LngLat = [Math.max(...lngs), Math.max(...lats)]
  const s = destination(sw, 180, marginM)[1]
  const w = destination(sw, 270, marginM)[0]
  const n = destination(ne, 0, marginM)[1]
  const e = destination(ne, 90, marginM)[0]
  return { west: w, south: s, east: e, north: n }
}

export function tilesInBounds(b: Bounds, z: number): Tile[] {
  const a = lngLatToTile([b.west, b.north], z)
  const c = lngLatToTile([b.east, b.south], z)
  const out: Tile[] = []
  for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) out.push({ z, x, y })
  return out
}

/**
 * Tiles to save for a course: the whole course at zooms 15–19, plus the
 * sharpest zoom (20) around each green, where detail matters most.
 */
export function courseTiles(allPoints: LngLat[], greenRings: LngLat[][]): Tile[] {
  const seen = new Set<string>()
  const out: Tile[] = []
  const add = (t: Tile) => {
    const k = `${t.z}/${t.x}/${t.y}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  const course = boundsAround(allPoints, 150)
  if (course) for (let z = 15; z <= 19; z++) tilesInBounds(course, z).forEach(add)
  for (const ring of greenRings) {
    const b = boundsAround(ring, 40)
    if (b) tilesInBounds(b, 20).forEach(add)
  }
  return out
}

/** Cache key without the API key, so a renewed key still finds saved photos. */
export function tileCacheKey(t: Tile): string {
  return `https://fairway-caddie.local/linz/aerial/${t.z}/${t.x}/${t.y}.webp`
}

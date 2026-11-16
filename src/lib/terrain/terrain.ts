import { bearingDeg, destination, type LngLat } from '../geo/geodesic'
import { boundsAround, tilesInBounds, type Tile } from '../mapping/tiles'
import type { Slope } from '../caddie/lie'

// Ground heights from LINZ's elevation model (1 m LiDAR where flown), delivered as
// Terrain-RGB pictures. Zoom 16 is about 1.9 m a pixel at South Head, finer than
// GPS can place you, and keeps the whole course to a few dozen small pictures.

export const TERRAIN_Z = 16
const SIZE = 256

/** Terrain-RGB colour to metres. */
export function decodeRgb(r: number, g: number, b: number): number {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1
}

/** A picture's pixels (RGBA) to heights; transparent or impossible pixels become NaN. */
export function heightsFromRgba(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(SIZE * SIZE)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const a = rgba[i * 4 + 3]
    const h = decodeRgb(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
    out[i] = a === 0 || h < -100 || h > 4000 ? NaN : h
  }
  return out
}

/** A tile is only trusted if most of it holds believable heights. */
export function tileLooksValid(h: Float32Array): boolean {
  let good = 0
  for (let i = 0; i < h.length; i++) if (!Number.isNaN(h[i])) good++
  return good > h.length * 0.9
}

const key = (t: Tile) => `${t.z}/${t.x}/${t.y}`

function globalPixel([lng, lat]: LngLat, z: number): [number, number] {
  const n = 2 ** z * SIZE
  const r = (lat * Math.PI) / 180
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n]
}

/** Heights held in memory, looked up instantly by the caddie engine. */
export class TerrainGrid {
  private tiles = new Map<string, Float32Array>()

  add(t: Tile, heights: Float32Array) {
    this.tiles.set(key(t), heights)
  }

  has(t: Tile): boolean {
    return this.tiles.has(key(t))
  }

  private pixel(px: number, py: number): number {
    const tx = Math.floor(px / SIZE)
    const ty = Math.floor(py / SIZE)
    const h = this.tiles.get(`${TERRAIN_Z}/${tx}/${ty}`)
    if (!h) return NaN
    return h[(py - ty * SIZE) * SIZE + (px - tx * SIZE)]
  }

  /** Ground height in metres at a point, blended between pixels. Null where unknown. */
  heightAt = (p: LngLat): number | null => {
    const [gx, gy] = globalPixel(p, TERRAIN_Z)
    const x = gx - 0.5
    const y = gy - 0.5
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const a = this.pixel(x0, y0)
    const b = this.pixel(x0 + 1, y0)
    const c = this.pixel(x0, y0 + 1)
    const d = this.pixel(x0 + 1, y0 + 1)
    const h = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
    return Number.isNaN(h) ? null : h
  }
}

/** Height tiles covering some points, with a margin. */
export function terrainTilesFor(points: LngLat[], marginM: number): Tile[] {
  const b = boundsAround(points, marginM)
  return b ? tilesInBounds(b, TERRAIN_Z) : []
}

export type HeightAt = (p: LngLat) => number | null

/** Rise per metre of ground, along a direction and across it (+ = rises to the right). */
export function groundSlope(heightAt: HeightAt, p: LngLat, towardDeg: number, halfM = 4): { along: number; across: number } | null {
  const ahead = heightAt(destination(p, towardDeg, halfM))
  const behind = heightAt(destination(p, towardDeg + 180, halfM))
  const right = heightAt(destination(p, towardDeg + 90, halfM))
  const left = heightAt(destination(p, towardDeg - 90, halfM))
  if (ahead === null || behind === null || right === null || left === null) return null
  return { along: (ahead - behind) / (2 * halfM), across: (right - left) / (2 * halfM) }
}

/** A slope steeper than this (about 3°) counts as a sloping lie. */
export const LIE_SLOPE = 0.05

/**
 * Which slope buttons the ground suggests, for a right-hander playing toward `target`.
 * A right-hander stands on the left of the ball looking at the target, so ground that
 * rises to the right puts the ball above the feet.
 */
export function suggestSlopes(heightAt: HeightAt, at: LngLat, target: LngLat): Slope[] {
  const s = groundSlope(heightAt, at, bearingDeg(at, target))
  if (!s) return []
  const out: Slope[] = []
  if (s.along > LIE_SLOPE) out.push('uphill')
  else if (s.along < -LIE_SLOPE) out.push('downhill')
  if (s.across > LIE_SLOPE) out.push('above-feet')
  else if (s.across < -LIE_SLOPE) out.push('below-feet')
  return out
}

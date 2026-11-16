import { describe, expect, it } from 'vitest'
import { decodeRgb, heightsFromRgba, suggestSlopes, TerrainGrid, terrainTilesFor, TERRAIN_Z, tileLooksValid } from '../lib/terrain/terrain'
import { recommend, finish, landing, type CaddieAdvice, type CaddieInput, type Terrain } from '../lib/caddie/engine'
import { modelClub } from '../lib/caddie/clubModel'
import { localPlane } from '../lib/geo/plane'
import { destination, type LngLat } from '../lib/geo/geodesic'
import { lngLatToTile } from '../lib/mapping/tiles'
import type { Club, ClubCategory } from '../types'

const ME: LngLat = [174.3178, -36.5602]
const plane = localPlane(ME)
/** Heights from a function of local x (east) and y (north), metres. */
const ground = (f: (x: number, y: number) => number) => (p: LngLat) => {
  const [x, y] = plane.toXY(p)
  return f(x, y)
}

function encode(h: number): [number, number, number] {
  const v = Math.round((h + 10000) / 0.1)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

describe('Terrain-RGB heights', () => {
  it('decodes the standard encoding', () => {
    expect(decodeRgb(1, 134, 160)).toBeCloseTo(0, 5)
    const [r, g, b] = encode(57.3)
    expect(decodeRgb(r, g, b)).toBeCloseTo(57.3, 5)
  })

  it('treats see-through pixels as unknown and rejects mostly-empty tiles', () => {
    const rgba = new Uint8ClampedArray(256 * 256 * 4)
    expect(tileLooksValid(heightsFromRgba(rgba))).toBe(false)
    for (let i = 0; i < 256 * 256; i++) rgba.set([...encode(12), 255], i * 4)
    const h = heightsFromRgba(rgba)
    expect(tileLooksValid(h)).toBe(true)
    expect(h[1000]).toBeCloseTo(12, 5)
  })

  it('blends between pixels and across tile edges', () => {
    // A tile pair whose height rises 1 m per pixel to the east.
    const t = lngLatToTile(ME, TERRAIN_Z)
    const grid = new TerrainGrid()
    for (const dx of [0, 1]) {
      const h = new Float32Array(256 * 256)
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) h[y * 256 + x] = (dx * 256 + x) * 1
      grid.add({ z: TERRAIN_Z, x: t.x + dx, y: t.y }, h)
    }
    const a = grid.heightAt(ME)!
    const east = grid.heightAt(destination(ME, 90, 19))!
    // ~1.9 m a pixel at this latitude and zoom, so 19 m east is ~10 m higher.
    expect(east - a).toBeGreaterThan(9)
    expect(east - a).toBeLessThan(11)
    expect(grid.heightAt(destination(ME, 0, 2000))).toBeNull()
  })

  it('covers the shot with a handful of tiles', () => {
    const tiles = terrainTilesFor([ME, destination(ME, 0, 200)], 80)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThan(16)
  })
})

describe('slope lie suggestions (right-hander)', () => {
  const target = destination(ME, 0, 150)
  it('ground rising toward the target is an uphill lie, falling is downhill', () => {
    expect(suggestSlopes(ground((_x, y) => 0.1 * y), ME, target)).toEqual(['uphill'])
    expect(suggestSlopes(ground((_x, y) => -0.1 * y), ME, target)).toEqual(['downhill'])
  })
  it('ground rising to the right puts the ball above your feet', () => {
    expect(suggestSlopes(ground((x) => 0.1 * x), ME, target)).toEqual(['above-feet'])
    expect(suggestSlopes(ground((x) => -0.1 * x), ME, target)).toEqual(['below-feet'])
  })
  it('gentle ground is left alone', () => {
    expect(suggestSlopes(ground((x, y) => 0.02 * x + 0.03 * y), ME, target)).toEqual([])
  })
})

// ---------- Engine with ground heights ----------

const club = (name: string, category: ClubCategory, carryM: number): Club => ({
  id: name,
  name,
  category,
  carryM,
  totalM: null,
  roughM: null,
  shape: 'unknown',
  missDirection: 'unknown',
  missDepth: 'unknown',
  spreadLeftM: null,
  spreadRightM: null,
  confidence: 'rough',
  source: 'estimate',
  notes: '',
})
const BAG = [club('5 Iron', 'iron', 155), club('7 Iron', 'iron', 140), club('8 Iron', 'iron', 130), club('9 Iron', 'iron', 120), club('PW', 'wedge', 110)]

function input(extra: Partial<CaddieInput> = {}): CaddieInput {
  const mid = destination(ME, 0, 147)
  const ring = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => destination(mid, a, 12))
  return {
    position: ME,
    positionSource: 'gps',
    positionAccuracyM: 4,
    green: [...ring, ring[0]],
    greenMiddle: mid,
    flagDistanceM: null,
    fromTee: false,
    corners: [],
    hazards: [],
    greenTrust: 'traced-from-imagery',
    clubs: BAG,
    strategy: 'normal',
    ...extra,
  }
}
const advise = (i: CaddieInput) => {
  const r = recommend(i)
  if (r.kind !== 'advice') throw new Error(r.kind)
  return r as CaddieAdvice
}
const carryOf = (name: string) => BAG.find((c) => c.name === name)!.carryM!

describe('the engine with ground heights', () => {
  it('an uphill green takes more club, and says how it plays', () => {
    const flat = advise(input())
    const up = advise(input({ heightAt: ground((_x, y) => 0.07 * y) }))
    expect(up.heightDiffM!).toBeCloseTo(10.3, 0)
    expect(up.playsLikeM!).toBeGreaterThan(155)
    expect(carryOf(up.primary.clubName)).toBeGreaterThan(carryOf(flat.primary.clubName))
    expect(up.reasons.join(' ')).toMatch(/middle is 10 m above you, so it plays about 157 m/)
  })

  it('a downhill green takes less club', () => {
    const flat = advise(input())
    const down = advise(input({ heightAt: ground((_x, y) => -0.07 * y) }))
    expect(carryOf(down.primary.clubName)).toBeLessThan(carryOf(flat.primary.clubName))
  })

  it('flat ground gives the same advice as no heights, but says slope is included', () => {
    const none = advise(input())
    const flat = advise(input({ heightAt: () => 31 }))
    expect(flat.primary).toEqual(none.primary)
    expect(flat.notes.join(' ')).toMatch(/Slope is, from LINZ ground heights/)
    expect(none.notes.join(' ')).toMatch(/no ground heights for this spot/)
  })

  it('no height where you stand means no slope at all', () => {
    const r = advise(input({ heightAt: () => null }))
    expect(r.heightDiffM).toBeNull()
  })

  const seven = modelClub(BAG[1])!
  const xyGround = (f: (x: number, y: number) => number): Terrain => ({ ground: ([x, y]) => f(x, y), h0: f(0, 0) })

  it('a ball landing on a downslope runs further; on an upslope it stops sooner', () => {
    const L = landing([0, 1], [-1, 0], 140, 0, seven, null)
    const flatF = finish(L, 0.1, null)
    const downF = finish(L, 0.1, xyGround((_x, y) => (y > 130 ? -(y - 130) * 0.06 : 0)))
    const upF = finish(L, 0.1, xyGround((_x, y) => (y > 130 ? (y - 130) * 0.06 : 0)))
    expect(downF[1]).toBeGreaterThan(flatF[1] + 3)
    expect(upF[1]).toBeLessThan(flatF[1] - 3)
  })

  it('a side slope kicks the ball downhill', () => {
    const L = landing([0, 1], [-1, 0], 140, 0, seven, null)
    // Ground falls away to the right (east, +x).
    const F = finish(L, 0.1, xyGround((x) => -0.08 * x))
    expect(F[0]).toBeGreaterThan(2)
  })

  it('landing on higher ground cuts the carry metre for metre', () => {
    const L = landing([0, 1], [-1, 0], 140, 0, seven, xyGround((_x, y) => (y > 100 ? 6 : 0)))
    expect(L[1]).toBeCloseTo(134, 5)
  })
})

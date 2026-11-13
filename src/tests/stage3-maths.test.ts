import { describe, expect, it } from 'vitest'
import { destination, type LngLat } from '../lib/geo/geodesic'
import { makeFeature } from '../lib/course/features'
import { analyseBoundaries, analyseHazards } from '../lib/course/hazards'
import { describeFix, fixIsUsable, suggestHole, STALE_AFTER_MS } from '../lib/gps/fixStatus'
import { courseTiles, lngLatToTile, tileCacheKey, tilesInBounds, boundsAround } from '../lib/mapping/tiles'

// Made-up geometry for testing only.
const me: LngLat = [174.3178, -36.5602]
const heading = 30 // playing roughly north-north-east
const green = destination(me, heading, 160)
const at = (alongM: number, sideM: number): LngLat =>
  destination(destination(me, heading, alongM), heading + (sideM >= 0 ? -90 : 90), Math.abs(sideM)) // +side = left

function blob(c: LngLat, r: number): LngLat[] {
  return [0, 72, 144, 216, 288].map((b) => destination(c, b, r))
}

describe('hazards along your line', () => {
  it('a bunker short-right: reach and carry along the line, on the right', () => {
    const f = [makeFeature('bunker', blob(at(130, -12), 5), 3)]
    const [h] = analyseHazards(f, me, green)
    expect(h.side).toBe('right')
    expect(h.reachM).toBeGreaterThan(124)
    expect(h.reachM).toBeLessThan(126)
    expect(h.carryM).toBeGreaterThan(134)
    expect(h.carryM).toBeLessThan(136)
    expect(h.offsetM).toBeGreaterThan(6)
    expect(h.offsetM).toBeLessThan(8)
  })

  it('water across the line is "across" with no sideways gap', () => {
    const f = [makeFeature('water', blob(at(90, 0), 10), 3)]
    const [h] = analyseHazards(f, me, green)
    expect(h.side).toBe('across')
    expect(h.offsetM).toBe(0)
    // A five-sided "pond" of radius 10 centred 90 m out: its corners sit 9.95 m short and 8.66 m long of centre.
    expect(h.reachM).toBeCloseTo(80.05, 1)
    expect(h.carryM).toBeCloseTo(98.66, 1)
  })

  it('ignores hazards behind you or far off to the side', () => {
    const f = [makeFeature('bunker', blob(at(-40, 0), 5), 3), makeFeature('bunker', blob(at(100, 80), 5), 3)]
    expect(analyseHazards(f, me, green)).toEqual([])
  })

  it('counts a hazard on your line even if it was drawn on another hole', () => {
    const f = [makeFeature('bunker', blob(at(100, 0), 5), 4)]
    expect(analyseHazards(f, me, green).length).toBe(1)
  })

  it('includes a bunker just behind the green, and lists hazards nearest first', () => {
    const f = [makeFeature('bunker', blob(at(175, 3), 4), 3), makeFeature('trouble', blob(at(60, 20), 5), 3)]
    const r = analyseHazards(f, me, green)
    expect(r.map((h) => h.kind)).toEqual(['trouble', 'bunker'])
    expect(r[0].side).toBe('left')
  })

  it("you're in the bunker: reach is 0", () => {
    const f = [makeFeature('bunker', blob(at(5, 0), 8), 3)]
    expect(analyseHazards(f, me, green)[0].reachM).toBe(0)
  })

  it('a fence 18 m right of the line is reported as out of bounds right, 18 m clear', () => {
    const fence = makeFeature('out-of-bounds', [at(-20, -18), at(200, -18)], 3)
    const [b] = analyseBoundaries([fence], me, green)
    expect(b.side).toBe('right')
    expect(b.clearanceM).toBeCloseTo(18, 0)
  })

  it('a boundary that crosses your line is "across"', () => {
    const fence = makeFeature('out-of-bounds', [at(100, -30), at(100, 30)], 3)
    const [b] = analyseBoundaries([fence], me, green)
    expect(b.side).toBe('across')
    expect(b.clearanceM).toBe(0)
    expect(b.atM).toBeCloseTo(100, 0)
  })
})

describe('GPS fix status', () => {
  const fix = (accuracyM: number, ageMs = 0) => ({ point: me, accuracyM, at: 1_000_000 - ageMs })

  it('grades and flags old readings', () => {
    expect(describeFix(fix(4), 1_000_000)).toMatchObject({ kind: 'fix', grade: 'good', stale: false })
    expect(describeFix(fix(4, STALE_AFTER_MS + 1000), 1_000_000)).toMatchObject({ stale: true })
    expect(describeFix(null, 0, 'denied')).toEqual({ kind: 'denied' })
  })

  it('only fair-or-better, fresh readings count as usable', () => {
    expect(fixIsUsable(describeFix(fix(8), 1_000_000))).toBe(true)
    expect(fixIsUsable(describeFix(fix(14), 1_000_000))).toBe(false)
    expect(fixIsUsable(describeFix(fix(4, 60_000), 1_000_000))).toBe(false)
  })

  it('suggests the hole whose tee you are standing on', () => {
    const tees = [
      makeFeature('tee', [destination(me, 0, 400)], 7, { teeId: 'white' }),
      makeFeature('tee', [destination(me, 90, 10)], 8, { teeId: 'white' }),
    ]
    expect(suggestHole(tees, fix(5), 7)).toBe(8)
    expect(suggestHole(tees, fix(5), 8)).toBeNull() // already there
    expect(suggestHole(tees, fix(25), 7)).toBeNull() // GPS too rough to say
  })
})

describe('offline map tiles', () => {
  it('finds the tile that actually contains the point (checked by working back to the tile edges)', () => {
    const edgeLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
    const edgeLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180
    for (const p of [me, [174.76, -36.86], [174.3, -36.55]] as LngLat[]) {
      for (const z of [10, 15, 18, 20]) {
        const t = lngLatToTile(p, z)
        expect(p[0]).toBeGreaterThanOrEqual(edgeLng(t.x, z))
        expect(p[0]).toBeLessThan(edgeLng(t.x + 1, z))
        expect(p[1]).toBeLessThanOrEqual(edgeLat(t.y, z))
        expect(p[1]).toBeGreaterThan(edgeLat(t.y + 1, z))
      }
    }
  })

  it('covers a box with whole tiles', () => {
    const b = boundsAround([me], 100)!
    const tiles = tilesInBounds(b, 18)
    expect(tiles.length).toBeGreaterThanOrEqual(4)
    expect(tiles.length).toBeLessThanOrEqual(9)
  })

  it('a course-sized area is a few hundred tiles, not thousands', () => {
    const corners = [me, destination(me, 45, 1400)]
    const greens = Array.from({ length: 18 }, (_, i) => blob(destination(me, i * 20, 300 + i * 30), 12))
    const n = courseTiles(corners, greens).length
    expect(n).toBeGreaterThan(200)
    expect(n).toBeLessThan(1500)
  })

  it("cache keys don't contain the map key", () => {
    expect(tileCacheKey({ z: 18, x: 1, y: 2 })).not.toMatch(/api=/)
  })
})

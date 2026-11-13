import { describe, expect, it } from 'vitest'
import { destination, type LngLat } from '../lib/geo/geodesic'
import { makeFeature } from '../lib/course/features'
import { appliesToHole, hazardHoles, holeCorridor } from '../lib/course/autoHoles'
import type { CourseFeature } from '../types/courseMap'

// Two made-up parallel holes, 80 m apart, both played north. Not real geometry.
const O: LngLat = [174.3178, -36.5602]
const tee16 = O
const green16 = destination(O, 0, 300)
const tee17 = destination(green16, 90, 80)
const green17 = destination(tee17, 180, 300) // 17 comes back south

const box = (c: LngLat, half: number): LngLat[] => [
  destination(destination(c, 180, half), 270, half),
  destination(destination(c, 180, half), 90, half),
  destination(destination(c, 0, half), 90, half),
  destination(destination(c, 0, half), 270, half),
]

function course(): CourseFeature[] {
  return [
    makeFeature('tee', [tee16], 16, { teeId: 'white' }),
    makeFeature('green', box(green16, 10), 16),
    makeFeature('tee', [tee17], 17, { teeId: 'white' }),
    makeFeature('green', box(green17, 10), 17),
  ]
}

const holesFor = (fs: CourseFeature[], id: string) => (hazardHoles(fs, O).get(id) ?? []).map((r) => r.hole).sort()

describe('hazards count for the holes they sit near', () => {
  it('water between two holes counts for both, whichever hole it was drawn on', () => {
    const between = destination(destination(O, 0, 150), 90, 40)
    const water = makeFeature('water', box(between, 12), 3) // drawn while on hole 3!
    const fs = [...course(), water]
    expect(holesFor(fs, water.id)).toEqual([16, 17])
  })

  it('a bunker beside one fairway only counts for that hole', () => {
    const bunker = makeFeature('bunker', box(destination(destination(O, 0, 200), 270, 15), 4), 17)
    const fs = [...course(), bunker]
    expect(holesFor(fs, bunker.id)).toEqual([16])
  })

  it('a greenside bunker just past the green counts', () => {
    const bunker = makeFeature('bunker', box(destination(green16, 0, 25), 4), 1)
    expect(holesFor([...course(), bunker], bunker.id)).toContain(16)
  })

  it('something far from every hole counts for none', () => {
    const far = makeFeature('trouble', box(destination(O, 270, 300), 10), 16)
    expect(holesFor([...course(), far], far.id)).toEqual([])
  })

  it('a pond the line runs straight through is distance 0', () => {
    const pond = makeFeature('water', box(destination(O, 0, 120), 15), 16)
    const reach = hazardHoles([...course(), pond], O).get(pond.id)!
    expect(reach[0]).toEqual({ hole: 16, distanceM: 0 })
  })

  it('an out-of-bounds fence 50 m right of a hole still counts (boundaries get more room)', () => {
    const fence = makeFeature('out-of-bounds', [destination(O, 270, 50), destination(green16, 270, 50)], 16)
    expect(holesFor([...course(), fence], fence.id)).toEqual([16])
  })

  it('uses dog-leg corners: a hazard inside the bend only counts if the line goes near it', () => {
    const corner = destination(O, 0, 200)
    const bentGreen = destination(corner, 90, 150)
    const fs: CourseFeature[] = [
      makeFeature('tee', [O], 5, { teeId: 'blue' }),
      makeFeature('green', box(bentGreen, 10), 5),
      makeFeature('line-of-play', [O, corner, bentGreen], 5),
    ]
    expect(holeCorridor(fs, 5)!.length).toBe(3)
    const atCorner = makeFeature('water', box(destination(corner, 0, 30), 8), 5)
    expect(holesFor([...fs, atCorner], atCorner.id)).toEqual([5])
  })

  it('tees, greens and lines of play still go by the hole they were drawn on', () => {
    const fs = course()
    const auto = hazardHoles(fs, O)
    expect(appliesToHole(fs[0], 16, auto)).toBe(true)
    expect(appliesToHole(fs[0], 17, auto)).toBe(false)
  })
})

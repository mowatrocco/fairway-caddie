import { describe, expect, it } from 'vitest'
import { bearingDeg, destination, distanceM, pathLengthM, type LngLat } from '../lib/geo/geodesic'
import { describeOutline, greenDistances, greenPoints } from '../lib/geo/green'
import { isSelfIntersecting, localPlane } from '../lib/geo/plane'

// A reference point near South Head. Only used to build test shapes.
const P: LngLat = [174.3178, -36.5602]

/** Rectangle `w` wide (east-west) and `h` deep (north-south) centred on c. */
function rect(c: LngLat, w: number, h: number): LngLat[] {
  const n = destination(c, 0, h / 2)
  const s = destination(c, 180, h / 2)
  return [
    destination(s, 270, w / 2),
    destination(s, 90, w / 2),
    destination(n, 90, w / 2),
    destination(n, 270, w / 2),
  ]
}

describe('geodesic distances', () => {
  it('going 150 m on any bearing and measuring back gives 150 m', () => {
    for (const b of [0, 37, 90, 145, 222, 300]) {
      expect(distanceM(P, destination(P, b, 150))).toBeCloseTo(150, 6)
    }
  })

  it('bearings point the right way', () => {
    expect(bearingDeg(P, destination(P, 0, 100))).toBeCloseTo(0, 6)
    expect(bearingDeg(P, destination(P, 90, 100))).toBeCloseTo(90, 4)
    expect(bearingDeg(P, destination(P, 200, 100))).toBeCloseTo(200, 6)
  })

  it('one thousandth of a degree of latitude here is about 110.9 m (ellipsoid, not sphere)', () => {
    const d = distanceM(P, [P[0], P[1] + 0.001])
    expect(d).toBeGreaterThan(110.8)
    expect(d).toBeLessThan(111.0)
    // A round-earth formula (radius 6371 km) would say 111.19 m: about 0.2% too long here.
    expect(Math.abs(d - 111.19)).toBeGreaterThan(0.15)
  })

  it('a dog-leg path adds its legs', () => {
    const corner = destination(P, 10, 220)
    const green = destination(corner, 60, 130)
    expect(pathLengthM([P, corner, green])).toBeCloseTo(350, 6)
  })
})

describe('local flat grid', () => {
  it('agrees with geodesic distance within 1 cm over 500 m', () => {
    const plane = localPlane(P)
    for (const b of [0, 45, 135, 250]) {
      const q = destination(P, b, 500)
      const [x, y] = plane.toXY(q)
      expect(Math.abs(Math.hypot(x, y) - 500)).toBeLessThan(0.01)
    }
  })

  it('round-trips coordinates', () => {
    const plane = localPlane(P)
    const q = destination(P, 77, 321)
    const back = plane.toLngLat(plane.toXY(q))
    expect(distanceM(q, back)).toBeLessThan(0.001)
  })
})

describe('green outlines', () => {
  it('measures area and finds the middle', () => {
    const g = describeOutline(rect(P, 20, 30))
    expect(g.areaM2).toBeCloseTo(600, 0)
    expect(distanceM(g.middle, P)).toBeLessThan(0.05)
    expect(g.selfIntersecting).toBe(false)
  })

  it('front/middle/back from 100 m straight short of a 30 m deep green', () => {
    const golfer = destination(P, 180, 100)
    const d = greenDistances(rect(P, 20, 30), golfer)
    expect(d.frontM!).toBeCloseTo(85, 1)
    expect(d.middleM).toBeCloseTo(100, 1)
    expect(d.backM!).toBeCloseTo(115, 1)
  })

  it('front and back follow the line of approach, not north/south', () => {
    // From the east, the 20 m width is the depth.
    const golfer = destination(P, 90, 140)
    const d = greenDistances(rect(P, 20, 30), golfer)
    expect(d.frontM!).toBeCloseTo(130, 1)
    expect(d.backM!).toBeCloseTo(150, 1)
  })

  it('on a two-tier L-shaped green, front is the first edge you reach', () => {
    // Golfer to the south. The green's middle sits in the east part of the "L".
    const plane = localPlane(P)
    const L = (
      [
        [0, 0], [30, 0], [30, 30], [15, 30], [15, 12], [0, 12],
      ] as [number, number][]
    ).map(plane.toLngLat)
    const golfer = plane.toLngLat([20, -100])
    const pts = greenPoints(L, golfer)
    expect(pts.front).not.toBeNull()
    const [fx, fy] = plane.toXY(pts.front!)
    const [, by] = plane.toXY(pts.back!)
    expect(fy).toBeLessThan(1) // enters at the bottom edge
    expect(fx).toBeGreaterThan(14)
    expect(by).toBeGreaterThan(29) // leaves at the top edge
  })

  it('gives no front/back when you are standing on the green', () => {
    const p = greenPoints(rect(P, 20, 30), destination(P, 0, 5))
    expect(p.front).toBeNull()
    expect(p.back).toBeNull()
  })

  it('uses a GPS-verified middle when given one', () => {
    const golfer = destination(P, 180, 100)
    const verified = destination(P, 0, 3)
    expect(greenDistances(rect(P, 20, 30), golfer, verified).middleM).toBeCloseTo(103, 1)
  })

  it('spots a figure-eight outline', () => {
    const plane = localPlane(P)
    const bow = (
      [
        [0, 0], [10, 10], [10, 0], [0, 10],
      ] as [number, number][]
    ).map(plane.toXY)
    expect(isSelfIntersecting(bow)).toBe(true)
  })
})

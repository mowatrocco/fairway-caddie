import { distanceM, type LngLat } from './geodesic'
import { area, centroid, isSelfIntersecting, lineCrossings, localPlane, openRing, pointInRing, type XY } from './plane'

export interface GreenPoints {
  front: LngLat | null
  middle: LngLat
  back: LngLat | null
}

export interface GreenShape {
  areaM2: number
  middle: LngLat
  selfIntersecting: boolean
}

/** Area and centre of a green (or any outline). Ring is [lng, lat] corners. */
export function describeOutline(ring: LngLat[]): GreenShape {
  const open = openRing(ring)
  const plane = localPlane(open[0])
  const xy = open.map(plane.toXY)
  return {
    areaM2: area(xy),
    middle: plane.toLngLat(centroid(xy)),
    selfIntersecting: isSelfIntersecting(xy),
  }
}

/**
 * Front, middle and back of a green as seen from `from` (the golfer, or the approach
 * point on the line of play). Middle is the centre of the outline. Front and back are
 * where the line from `from` through the middle first enters and finally leaves the green.
 * If `from` is on the green, front and back are null.
 */
export function greenPoints(ring: LngLat[], from: LngLat, middleOverride?: LngLat): GreenPoints {
  const open = openRing(ring)
  const plane = localPlane(open[0])
  const xy = open.map(plane.toXY)
  const c: XY = middleOverride ? plane.toXY(middleOverride) : centroid(xy)
  const f = plane.toXY(from)
  const middle = plane.toLngLat(c)

  const dx = c[0] - f[0]
  const dy = c[1] - f[1]
  const len = Math.hypot(dx, dy)
  if (len < 0.5 || pointInRing(f, xy)) return { front: null, middle, back: null }

  const dir: XY = [dx / len, dy / len]
  const fromT = -len // the golfer sits at t = -len on this line
  const ts = lineCrossings(c, dir, xy).filter((t) => t > fromT)
  if (ts.length < 2) return { front: null, middle, back: null }

  const at = (t: number) => plane.toLngLat([c[0] + dir[0] * t, c[1] + dir[1] * t])
  return { front: at(Math.min(...ts)), middle, back: at(Math.max(...ts)) }
}

export interface GreenDistances {
  frontM: number | null
  middleM: number
  backM: number | null
}

export function greenDistances(ring: LngLat[], from: LngLat, middleOverride?: LngLat): GreenDistances {
  const p = greenPoints(ring, from, middleOverride)
  return {
    frontM: p.front ? distanceM(from, p.front) : null,
    middleM: distanceM(from, p.middle),
    backM: p.back ? distanceM(from, p.back) : null,
  }
}

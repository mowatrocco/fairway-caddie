import { describe, expect, it } from 'vitest'
import { southHead } from '../data/courses/southHead'
import { makeFeature } from '../lib/course/features'
import { checkHole, mappedLength } from '../lib/course/holeChecks'
import { destination, distanceM, type LngLat } from '../lib/geo/geodesic'
import { gradeAccuracy, trustForCapture } from '../lib/gps/accuracy'
import { averageFixes, type Fix } from '../lib/gps/average'
import type { CourseFeature } from '../types/courseMap'

// A made-up hole near the clubhouse for testing. Not real South Head geometry.
const club: LngLat = [southHead.mapStart.lng, southHead.mapStart.lat]
const greenCentre = destination(club, 45, 400)

function squareGreen(c: LngLat, half: number): LngLat[] {
  return [
    destination(destination(c, 180, half), 270, half),
    destination(destination(c, 180, half), 90, half),
    destination(destination(c, 0, half), 90, half),
    destination(destination(c, 0, half), 270, half),
  ]
}

/** Hole 4 on the card: Blue 174, White 160, Yellow 111. Put each tee at its card length. */
function hole4(): CourseFeature[] {
  return [
    makeFeature('green', squareGreen(greenCentre, 12), 4),
    makeFeature('tee', [destination(greenCentre, 200, 174)], 4, { teeId: 'blue' }),
    makeFeature('tee', [destination(greenCentre, 200, 160)], 4, { teeId: 'white' }),
    makeFeature('tee', [destination(greenCentre, 200, 111)], 4, { teeId: 'yellow' }),
  ]
}

describe('hole checklist', () => {
  it('an empty hole is "not started" and lists what is missing', () => {
    const r = checkHole([], 4, southHead)
    expect(r.status).toBe('not-started')
    expect(r.checks.map((c) => c.text)).toEqual(['Green outline', 'Blue tee', 'White tee', 'Yellow tee'])
  })

  it('a hole matching the scorecard is ready', () => {
    const r = checkHole(hole4(), 4, southHead)
    expect(r.status).toBe('ready')
    expect(r.checks.find((c) => c.text.startsWith('Blue tee'))!.text).toMatch(/174 m mapped, card says 174 m/)
  })

  it('flags a tee placed 30 m from where the card says', () => {
    const f = hole4()
    f[1] = makeFeature('tee', [destination(greenCentre, 200, 144)], 4, { teeId: 'blue' })
    const r = checkHole(f, 4, southHead)
    expect(r.status).toBe('check')
    expect(r.checks.find((c) => c.text.startsWith('Blue'))!.text).toMatch(/30 m short/)
  })

  it('counts dog-leg corners from the line of play', () => {
    // Hole 1 Blue 324 m: tee → corner 200 m → green 124 m further.
    const corner = destination(club, 0, 200)
    const green = destination(corner, 70, 124)
    const tee = club
    const f = [
      makeFeature('green', squareGreen(green, 10), 1),
      makeFeature('tee', [tee], 1, { teeId: 'blue' }),
      makeFeature('line-of-play', [tee, corner, green], 1),
    ]
    expect(mappedLength(f, 1, 'blue')).toBeCloseTo(324, 0)
    // Without the line it's a straight line, so shorter.
    expect(mappedLength(f.slice(0, 2), 1, 'blue')!).toBeLessThan(310)
  })

  it('a GPS-captured green middle overrides the outline centre for length', () => {
    const f = hole4()
    const verifiedMiddle = destination(greenCentre, 20, 4)
    f.push({ ...makeFeature('green-middle', [verifiedMiddle], 4), trust: 'verified-on-course' })
    const blueTee = f[1].geometry.coordinates as LngLat
    expect(mappedLength(f, 4, 'blue')).toBeCloseTo(distanceM(blueTee, verifiedMiddle), 6)
  })

  it('catches a green that crosses itself', () => {
    const r = squareGreen(greenCentre, 12)
    const bow = [r[0], r[2], r[1], r[3]]
    const f = [makeFeature('green', bow, 4)]
    expect(checkHole(f, 4, southHead).checks[0].level).toBe('problem')
  })

  it('catches a feature dropped far from the club', () => {
    const f = [...hole4(), makeFeature('bunker', squareGreen(destination(club, 90, 5000), 4), 4)]
    const r = checkHole(f, 4, southHead)
    expect(r.status).toBe('needs-work')
    expect(r.checks.some((c) => /more than 3 km/.test(c.text))).toBe(true)
  })

  it('counts traced vs verified features', () => {
    const f = hole4()
    f[1] = { ...f[1], trust: 'verified-on-course' }
    const r = checkHole(f, 4, southHead)
    expect([r.verified, r.traced]).toEqual([1, 3])
  })
})

describe('GPS capture averaging', () => {
  const at = (p: LngLat, accuracyM: number): Fix => ({ lng: p[0], lat: p[1], accuracyM, at: 0 })

  it('averages scattered readings back to the true spot', () => {
    const truth = club
    const fixes = [0, 72, 144, 216, 288].map((b) => at(destination(truth, b, 3), 4))
    const r = averageFixes(fixes)!
    expect(distanceM(r.point, truth)).toBeLessThan(0.05)
    expect(r.spreadM).toBeCloseTo(3, 1)
    expect(r.samples).toBe(5)
  })

  it('ignores a wild reading when good ones exist', () => {
    const fixes = [at(club, 4), at(club, 5), at(destination(club, 90, 60), 40)]
    const r = averageFixes(fixes)!
    expect(distanceM(r.point, club)).toBeLessThan(0.01)
    expect(r.samples).toBe(2)
  })

  it('reports the typical accuracy, not an over-optimistic one', () => {
    const r = averageFixes([at(club, 3), at(club, 6), at(club, 9)])!
    expect(r.accuracyM).toBe(6)
  })

  it('says so when every reading was poor', () => {
    const r = averageFixes([at(club, 25), at(club, 30)])!
    expect(r.allPoor).toBe(true)
    expect(trustForCapture(r.accuracyM)).toBe('estimated')
  })

  it('returns nothing for no readings', () => {
    expect(averageFixes([])).toBeNull()
  })

  it('grades accuracy: 5 m good, 10 m fair, beyond poor', () => {
    expect([gradeAccuracy(3), gradeAccuracy(5), gradeAccuracy(8), gradeAccuracy(10), gradeAccuracy(12)]).toEqual([
      'good', 'good', 'fair', 'fair', 'poor',
    ])
    expect(trustForCapture(8)).toBe('verified-on-course')
  })
})

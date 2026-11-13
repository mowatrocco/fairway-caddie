import { describe, expect, it } from 'vitest'
import { recommend, type CaddieAdvice, type CaddieInput } from '../lib/caddie/engine'
import { destination, distanceM, type LngLat } from '../lib/geo/geodesic'
import { makeFeature } from '../lib/course/features'
import { modelClub } from '../lib/caddie/clubModel'
import type { Club, ClubCategory } from '../types'
import type { CourseFeature } from '../types/courseMap'

// Made-up situations near the clubhouse; not real South Head geometry.
const ME: LngLat = [174.3178, -36.5602]
const N = 0 // playing due north

function club(name: string, category: ClubCategory, carryM: number | null, extra: Partial<Club> = {}): Club {
  return {
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
    ...extra,
  }
}

const BAG: Club[] = [
  club('Driver', 'driver', 210),
  club('4 Wood', 'wood', 190),
  club('4 Hybrid', 'hybrid', 175),
  club('5 Iron', 'iron', 155),
  club('7 Iron', 'iron', 140),
  club('8 Iron', 'iron', 130),
  club('9 Iron', 'iron', 120),
  club('PW', 'wedge', 110),
  club('UW', 'wedge', 100),
  club('54', 'wedge', 90),
  club('Putter', 'putter', null),
]

const at = (along: number, side = 0): LngLat => destination(destination(ME, N, along), side >= 0 ? 270 : 90, Math.abs(side)) // + side = left
function box(c: LngLat, halfDepth: number, halfWidth: number): LngLat[] {
  const s = destination(c, 180, halfDepth)
  const n = destination(c, 0, halfDepth)
  const r = [destination(s, 270, halfWidth), destination(s, 90, halfWidth), destination(n, 90, halfWidth), destination(n, 270, halfWidth)]
  return [...r, r[0]]
}
const area = (kind: 'water' | 'bunker' | 'trouble', c: LngLat, hd: number, hw: number): CourseFeature => ({
  ...makeFeature(kind, box(c, hd, hw).slice(0, -1), 1),
})

function input(greenAt: number, hazards: CourseFeature[] = [], extra: Partial<CaddieInput> = {}): CaddieInput {
  const middle = at(greenAt)
  return {
    position: ME,
    positionSource: 'gps',
    positionAccuracyM: 4,
    green: box(middle, 13, 11),
    greenMiddle: middle,
    flagDistanceM: null,
    corners: [],
    hazards,
    greenTrust: 'traced-from-imagery',
    clubs: BAG,
    strategy: 'normal',
    ...extra,
  }
}

const advise = (i: CaddieInput) => {
  const r = recommend(i)
  if (r.kind !== 'advice') throw new Error(`expected advice, got ${r.kind}: ${'reason' in r ? r.reason : ''}`)
  return r as CaddieAdvice
}

describe('club model', () => {
  it('skips the putter and clubs without a carry', () => {
    expect(modelClub(club('Putter', 'putter', null))).toBeNull()
    expect(modelClub(club('58', 'wedge', null))).toBeNull()
  })
  it('uses your total for roll when you have one, otherwise an estimate', () => {
    expect(modelClub(club('7', 'iron', 140, { totalM: 150 }))!.rollKnown).toBe(true)
    expect(modelClub(club('7', 'iron', 140))!.rollKnown).toBe(false)
  })
  it('shifts the average shot toward your usual miss', () => {
    expect(modelClub(club('7', 'iron', 140, { missDirection: 'right' }))!.sideBiasM).toBeLessThan(0)
    expect(modelClub(club('7', 'iron', 140, { missDepth: 'short' }))!.depthBiasM).toBeLessThan(0)
  })
})

describe('straightforward approach', () => {
  it('147 m to an open green: 7 iron (140 carry, ~147 with roll), aimed at the middle', () => {
    const r = advise(input(147))
    expect(r.primary.clubName).toBe('7 Iron')
    expect(r.primary.aimText).toBe('Aim at the middle')
    expect(r.primary.pGreen).toBeGreaterThan(0.4)
    expect(r.reasons[0]).toMatch(/7 Iron carries about 140 m.*roll estimated.*The middle is 147 m/)
  })

  it('gives the same answer every time', () => {
    expect(advise(input(147))).toEqual(advise(input(147)))
  })

  it('uses the rangefinder flag distance when given', () => {
    const r = advise(input(147, [], { flagDistanceM: 136 }))
    expect(r.pinSource).toBe('rangefinder')
    expect(Math.round(r.targetM)).toBe(136)
    expect(r.primary.aimText).toMatch(/flag/)
  })

  it('a flag just on the front of the green: the plan finishes on the green, not short of it', () => {
    // Green runs 134–160 m; flag 2 m on.
    const r = advise(input(147, [], { flagDistanceM: 136 }))
    expect(r.primary.totalM).toBeGreaterThanOrEqual(134)
    expect(r.primary.totalM).toBeLessThanOrEqual(160)
  })

  it('a flag further back never gets a shorter club', () => {
    const front = advise(input(140, [], { flagDistanceM: 130 }))
    const back = advise(input(140, [], { flagDistanceM: 152 }))
    expect(back.primary.totalM).toBeGreaterThanOrEqual(front.primary.totalM)
  })
})

describe('hazards change the advice', () => {
  it("water short of the green: doesn't take the club that only just gets there", () => {
    // Green middle 140 m; water from 112 to 128 m right across the line.
    const water = area('water', at(120), 8, 40)
    const r = advise(input(140, [water], { strategy: 'safe' }))
    expect(['5 Iron', '7 Iron']).toContain(r.primary.clubName)
    expect(r.primary.pPenalty).toBeLessThan(0.03)
    // The 9 iron (finishes ~126 m) would be in the water a lot: it must never be the pick.
    expect(r.byStrategy.safe.clubName).not.toBe('9 Iron')
  })

  it('safe keeps the penalty chance under 5% when it can; aggressive may accept more', () => {
    const water = area('water', at(120), 8, 40)
    const r = advise(input(140, [water]))
    expect(r.byStrategy.safe.pPenalty).toBeLessThanOrEqual(0.05)
    expect(r.byStrategy.aggressive.expectedStrokes).toBeLessThanOrEqual(r.byStrategy.safe.expectedStrokes + 1e-9)
  })

  it('out of bounds tight right: aims left of the flag', () => {
    const fence = makeFeature('out-of-bounds', [at(-10, -14), at(200, -14)], 1)
    const r = advise(input(147, [fence], { strategy: 'safe' }))
    expect(r.primary.aimText).toMatch(/left of the middle/)
    expect(r.primary.pPenalty).toBeLessThanOrEqual(0.05)
  })

  it('a usual miss to the right makes it aim further left with OB right', () => {
    const fence = makeFeature('out-of-bounds', [at(-10, -16), at(200, -16)], 1)
    const bag = BAG.map((c) => (c.carryM ? { ...c, missDirection: 'right' as const } : c))
    const plain = advise(input(147, [fence], { strategy: 'normal' }))
    const fader = advise(input(147, [fence], { strategy: 'normal', clubs: bag }))
    const offset = (t: string) => Number(/Aim (\d+) m left/.exec(t)?.[1] ?? 0)
    expect(offset(fader.primary.aimText)).toBeGreaterThanOrEqual(offset(plain.primary.aimText))
  })

  it('safe takes less risk than aggressive when a bunker guards the front-right', () => {
    const bunker = area('bunker', at(130, -6), 5, 7)
    const water = area('water', at(160, -14), 12, 8) // water long-right as well
    const r = advise(input(147, [bunker, water]))
    const risk = (p: { pPenalty: number; pBunker: number }) => p.pPenalty + p.pBunker
    expect(risk(r.byStrategy.safe)).toBeLessThanOrEqual(risk(r.byStrategy.aggressive) + 1e-9)
    expect(r.byStrategy.aggressive.expectedStrokes).toBeLessThanOrEqual(r.byStrategy.safe.expectedStrokes + 1e-9)
  })

  it('normal avoids a 1-in-5 penalty when a safer plan costs little', () => {
    const water = area('water', at(120), 8, 40)
    const fence = makeFeature('out-of-bounds', [at(-10, -16), at(200, -16)], 1)
    const r = advise(input(140, [water, fence], { strategy: 'normal' }))
    expect(r.primary.pPenalty).toBeLessThan(0.15)
  })

  it('says so when the plan misses the green on purpose', () => {
    const water = area('water', at(120), 8, 40)
    const fence = makeFeature('out-of-bounds', [at(-10, -16), at(200, -16)], 1)
    const r = advise(input(140, [water, fence], { strategy: 'safe' }))
    if (r.primary.pGreen < 0.15 && !r.primary.layup) expect(r.reasons.join(' ')).toMatch(/misses the green on purpose/)
  })

  it('explains when the obvious club would be in trouble', () => {
    const water = area('water', at(120), 8, 40)
    const r = advise(input(132, [water], { strategy: 'normal' }))
    expect(r.reasons.join(' ')).toMatch(/would find a penalty/)
  })

  it('lays up short of water it can’t carry on a long second shot', () => {
    // 260 m to the green, water from 195 to 235 m across the line. Longest club ~227 m total.
    const water = area('water', at(215), 20, 60)
    const r = advise(input(260, [water], { strategy: 'safe' }))
    expect(r.primary.layup).toBe(true)
    expect(r.primary.pPenalty).toBeLessThan(0.05)
    expect(r.primary.aimText).toMatch(/leaving about \d+ m/)
  })
})

describe('dog-legs', () => {
  it('aims at the corner when trees block the straight line', () => {
    // Hole bends right: corner 190 m north, green 140 m east of it. Trees fill the inside of the bend.
    const corner = at(190)
    const green = destination(corner, 90, 140)
    const trees = makeFeature('trouble', [at(60, -15), at(60, -200), at(260, -200), at(260, -15)], 1)
    const i = input(0, [trees], { greenMiddle: green, green: box(green, 13, 11), corners: [corner], strategy: 'safe' })
    const r = advise(i)
    expect(r.primary.pTrouble).toBeLessThan(0.1)
    expect(r.primary.layup).toBe(true)
    expect(distanceM(r.primary.aim, corner)).toBeLessThan(60)
  })
})

describe('no lean of its own', () => {
  it('with no hazards and no usual miss, it aims at the middle from any direction and distance', () => {
    for (const bearing of [0, 90, 200, 315]) {
      for (const d of [150, 143, 128, 112]) {
        const mid = destination(ME, bearing, d)
        const ring = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => destination(mid, a, 12))
        const r = advise({ ...input(d), green: [...ring, ring[0]], greenMiddle: mid })
        expect(r.primary.aimText, `bearing ${bearing}, ${d} m`).toBe('Aim at the middle')
      }
    }
  })
})

describe('missing or weak data', () => {
  it('no carries at all: no advice, and says what to add', () => {
    const r = recommend(input(147, [], { clubs: BAG.map((c) => ({ ...c, carryM: null })) }))
    expect(r.kind).toBe('none')
    if (r.kind === 'none') expect(r.reason).toMatch(/My Bag/)
  })

  it('a distance not yet marked carry or total is used as carry, and the advice says so', () => {
    const bag = BAG.map((c) => ({ ...c, roughM: c.carryM, carryM: null }))
    const r = advise(input(147, [], { clubs: bag }))
    expect(r.primary.clubName).toBe(advise(input(147)).primary.clubName)
    expect(r.notes.join(' ')).toMatch(/treated as carry/)
    expect(r.confidence.because.join(' ')).toMatch(/confirmed as carry/)
  })

  it('a total distance is never used as carry', () => {
    const bag = BAG.map((c) => ({ ...c, totalM: c.carryM, carryM: null }))
    expect(recommend(input(147, [], { clubs: bag })).kind).toBe('none')
  })

  it('clubs with no distance at all are simply left out', () => {
    const bag = BAG.map((c) => (c.name === '7 Iron' ? { ...c, carryM: null, roughM: null } : c))
    const r = advise(input(147, [], { clubs: bag }))
    expect(r.primary.clubName).not.toBe('7 Iron')
  })

  it('inside the shortest full shot: says it needs a part swing', () => {
    const r = recommend(input(60))
    expect(r.kind).toBe('part-swing')
  })

  it('no position but a rangefinder distance: distance-only, and says hazards are not checked', () => {
    const r = recommend(input(147, [], { position: null, positionSource: 'none', flagDistanceM: 147 }))
    expect(r.kind).toBe('distance-only')
    if (r.kind === 'distance-only') expect(r.reason).toMatch(/hazards can't be checked/)
  })

  it('no position and no rangefinder: no advice', () => {
    expect(recommend(input(147, [], { position: null, positionSource: 'none' })).kind).toBe('none')
  })

  it('confidence: rough club numbers cap it at medium; poor GPS makes it low', () => {
    expect(advise(input(147)).confidence.level).toBe('medium')
    const measured = BAG.map((c) => ({ ...c, confidence: 'measured' as const }))
    expect(advise(input(147, [], { clubs: measured })).confidence.level).toBe('high')
    const poor = advise(input(147, [], { clubs: measured, positionAccuracyM: 18 }))
    expect(poor.confidence.level).toBe('low')
    expect(poor.confidence.because.join(' ')).toMatch(/GPS/)
  })

  it('says when it is using default spread and estimated roll', () => {
    const r = advise(input(147))
    expect(r.notes.join(' ')).toMatch(/standard left\/right spread/)
    expect(r.notes.join(' ')).toMatch(/roll is estimated/)
    expect(r.notes.join(' ')).toMatch(/Wind and slope are not included/)
  })
})

import { describe, expect, it } from 'vitest'
import { windDirsOnShot, windFromTaps, windModel, windOnShot, windPlaysFactor, type WindSetting } from '../lib/caddie/wind'
import { modelClub } from '../lib/caddie/clubModel'
import { recommend, type CaddieAdvice, type CaddieInput } from '../lib/caddie/engine'
import { destination, type LngLat } from '../lib/geo/geodesic'
import type { Club, ClubCategory } from '../types'

const setting = (fromDeg: number, strength: WindSetting['strength'] = 'medium'): WindSetting => ({ fromDeg, strength, setAt: 0 })

describe('wind follows you round the course', () => {
  it('turns taps on one shot into a compass direction', () => {
    // Playing north (0°): into means from the north, left to right means from the west.
    expect(windFromTaps(['into'], 0)).toBeCloseTo(0)
    expect(windFromTaps(['helping'], 0)).toBeCloseTo(180)
    expect(windFromTaps(['left-to-right'], 0)).toBeCloseTo(270)
    expect(windFromTaps(['right-to-left'], 0)).toBeCloseTo(90)
    expect(windFromTaps(['into', 'left-to-right'], 0)).toBeCloseTo(315)
    expect(windFromTaps(['into'], 100)).toBeCloseTo(100)
    expect(windFromTaps([], 0)).toBeNull()
  })

  it('shows the same wind correctly on a hole facing another way', () => {
    const w = setting(windFromTaps(['into'], 0)!)
    expect(windDirsOnShot(windOnShot(w, 0))).toEqual(['into'])
    expect(windDirsOnShot(windOnShot(w, 180))).toEqual(['helping'])
    // A north wind, playing east: it comes from your left.
    expect(windDirsOnShot(windOnShot(w, 90))).toEqual(['left-to-right'])
    expect(windDirsOnShot(windOnShot(w, 270))).toEqual(['right-to-left'])
    expect(windDirsOnShot(windOnShot(w, 45))).toEqual(['into', 'left-to-right'])
    expect(windDirsOnShot(windOnShot(setting(0, 'calm'), 0))).toEqual([])
  })
})

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
const BAG = [club('5 Iron', 'iron', 160), club('7 Iron', 'iron', 148), club('8 Iron', 'iron', 138), club('9 Iron', 'iron', 128), club('PW', 'wedge', 120)]

describe('what wind does to a shot', () => {
  const seven = modelClub(BAG[1])!
  it('a medium headwind takes about 12% off the carry; a tailwind adds about 6%', () => {
    expect(windModel(seven, windOnShot(setting(0), 0)).carryM / seven.carryM).toBeCloseTo(0.88, 2)
    expect(windModel(seven, windOnShot(setting(180), 0)).carryM / seven.carryM).toBeCloseTo(1.06, 2)
    expect(windPlaysFactor(windOnShot(setting(0), 0))).toBeCloseTo(1 / 0.88, 3)
  })
  it('a left-to-right wind pushes the ball right, about 9 m for a 148 m 7 iron in 20 km/h', () => {
    const m = windModel(seven, windOnShot(setting(270), 0))
    expect(m.sideBiasM).toBeCloseTo(-8.9, 1)
    expect(m.carryM).toBeCloseTo(seven.carryM, 5)
  })
  it('downwind runs more, into the wind runs less', () => {
    expect(windModel(seven, windOnShot(setting(180), 0)).rollShare).toBeGreaterThan(seven.rollShare)
    expect(windModel(seven, windOnShot(setting(0), 0)).rollShare).toBeLessThan(seven.rollShare)
  })
  it('calm changes nothing', () => {
    expect(windModel(seven, windOnShot(setting(0, 'calm'), 0))).toEqual(seven)
  })
})

describe('the engine in wind', () => {
  const ME: LngLat = [174.3178, -36.5602]
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
  const advise = (i: CaddieInput) => recommend(i) as CaddieAdvice
  const carry = (name: string) => BAG.find((c) => c.name === name)!.carryM!

  it('into the wind takes more club and says how it plays', () => {
    const calm = advise(input())
    const into = advise(input({ wind: windOnShot(setting(0, 'strong'), 0) }))
    expect(carry(into.primary.clubName)).toBeGreaterThan(carry(calm.primary.clubName))
    expect(into.playsLikeM!).toBeGreaterThan(165)
    expect(into.reasons.join(' ')).toMatch(/Wind \(into, strong\): about 18% less carry/)
    expect(into.notes.join(' ')).toMatch(/Wind is from your buttons/)
  })
  it('helping takes less club', () => {
    const calm = advise(input())
    const help = advise(input({ wind: windOnShot(setting(180, 'strong'), 0) }))
    expect(carry(help.primary.clubName)).toBeLessThan(carry(calm.primary.clubName))
  })
  it('a left-to-right wind aims left to allow for the drift', () => {
    const r = advise(input({ wind: windOnShot(setting(270, 'strong'), 0) }))
    expect(r.primary.aimText).toMatch(/left of the middle/)
    expect(r.reasons.join(' ')).toMatch(/drift right, allowed for in the aim/)
  })
})

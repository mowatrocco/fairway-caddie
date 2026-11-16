import { describe, expect, it } from 'vitest'
import { answer, findClub, parseQuestion, shortName, type ChatContext } from '../lib/caddie/chat'
import { recommend, type CaddieInput } from '../lib/caddie/engine'
import { compareLayup, missCosts } from '../lib/caddie/whatif'
import { makeFeature } from '../lib/course/features'
import { destination, type LngLat } from '../lib/geo/geodesic'
import type { Club, ClubCategory } from '../types'
import type { CourseFeature } from '../types/courseMap'

const club = (name: string, category: ClubCategory, carryM: number | null): Club => ({
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

const BAG: Club[] = [
  club('Ping G10 Driver', 'driver', 210),
  club('4 Wood', 'wood', 180),
  club('4 Hybrid', 'hybrid', 170),
  club('Ping Rapture 4 Iron', 'iron', 168),
  club('Mizuno 5 Iron', 'iron', 160),
  club('Ping G25 7 Iron', 'iron', 148),
  club('Ping G25 8 Iron', 'iron', 138),
  club('Ping G25 9 Iron', 'iron', 128),
  club('Ping G25 Pitching Wedge', 'wedge', 120),
  club('Ping G25 Utility Wedge', 'wedge', 110),
  club('Cleveland 54°', 'wedge', 100),
  club('Cleveland 58°', 'wedge', 90),
  club('Odyssey Putter', 'putter', null),
]

describe('recognising questions', () => {
  const q = (t: string) => parseQuestion(t, BAG)
  const clubOf = (t: string) => {
    const i = q(t)
    return i.kind === 'compare' ? `${i.club.name}|${i.swing}` : i.kind
  }
  it('finds clubs however you type them', () => {
    expect(findClub('why not 7 iron', BAG)?.name).toBe('Ping G25 7 Iron')
    expect(findClub('7i?', BAG)?.name).toBe('Ping G25 7 Iron')
    expect(findClub('what about the seven', BAG)?.name).toBe('Ping G25 7 Iron')
    expect(findClub('pw', BAG)?.name).toBe('Ping G25 Pitching Wedge')
    expect(findClub('gap wedge?', BAG)?.name).toBe('Ping G25 Utility Wedge')
    expect(findClub('54', BAG)?.name).toBe('Cleveland 54°')
    expect(findClub('58 degree', BAG)?.name).toBe('Cleveland 58°')
    expect(findClub('4 wood', BAG)?.name).toBe('4 Wood')
    expect(findClub('4 hybrid', BAG)?.name).toBe('4 Hybrid')
    expect(findClub('the 4 iron', BAG)?.name).toBe('Ping Rapture 4 Iron')
    expect(findClub('driver', BAG)?.name).toBe('Ping G10 Driver')
    expect(findClub('what club', BAG)).toBeNull()
  })

  it('tells the kinds of question apart', () => {
    expect(q('What club?').kind).toBe('what-club')
    expect(q('what should I hit')).toEqual({ kind: 'what-club' })
    expect(clubOf('Why not 7 iron?')).toBe('Ping G25 7 Iron|normal')
    expect(clubOf('what if I hit 8')).toBe('Ping G25 8 Iron|normal')
    expect(clubOf('8 hard')).toBe('Ping G25 8 Iron|hard')
    expect(clubOf('What if I hit 8 and swing hard?')).toBe('Ping G25 8 Iron|hard')
    expect(q('swing hard?').kind).toBe('hard-which')
    expect(q("Where's the safe miss?").kind).toBe('safe-miss')
    expect(q('where do I bail out')).toEqual({ kind: 'safe-miss' })
    expect(q('What do I need to carry the water?')).toEqual({ kind: 'carry', hazard: 'water' })
    expect(q('how far to clear the bunker')).toEqual({ kind: 'carry', hazard: 'bunker' })
    expect(q('Lay up or go for it?').kind).toBe('layup')
    expect(q('should I go for the green')).toEqual({ kind: 'layup' })
    expect(q("I'm in the rough")).toEqual({ kind: 'lie', surface: 'light-rough', slopes: [] })
    expect(q("ball's above my feet")).toEqual({ kind: 'lie', surface: null, slopes: ['above-feet'] })
    expect(q('in the rough, downhill and below my feet')).toEqual({ kind: 'lie', surface: 'light-rough', slopes: ['below-feet', 'downhill'] })
    expect(q('How did I go? What cost me shots?').kind).toBe('round')
    expect(q('what is the meaning of life').kind).toBe('unknown')
  })

  it('short names for buttons', () => {
    expect(BAG.map(shortName).slice(0, 6)).toEqual(['Driver', '4 Wood', '4 Hybrid', '4 Iron', '5 Iron', '7 Iron'])
    expect(shortName(BAG[10])).toBe('54°')
  })
})

// ---------- Answers on a made-up hole ----------

const ME: LngLat = [174.3178, -36.5602]
const at = (along: number, side = 0): LngLat => destination(destination(ME, 0, along), side >= 0 ? 270 : 90, Math.abs(side))
function box(c: LngLat, hd: number, hw: number): LngLat[] {
  const s = destination(c, 180, hd)
  const n = destination(c, 0, hd)
  return [destination(s, 270, hw), destination(s, 90, hw), destination(n, 90, hw), destination(n, 270, hw)]
}
const greenAt = (d: number) => {
  const r = box(at(d), 13, 11)
  return [...r, r[0]]
}
const water = (from: number, to: number): CourseFeature => makeFeature('water', box(at((from + to) / 2), (to - from) / 2, 40), 1)

function ctxFor(targetM: number, hazards: CourseFeature[] = [], extra: Partial<CaddieInput> = {}): ChatContext {
  const input: CaddieInput = {
    position: ME,
    positionSource: 'gps',
    positionAccuracyM: 4,
    green: greenAt(targetM),
    greenMiddle: at(targetM),
    flagDistanceM: null,
    fromTee: false,
    corners: [],
    hazards,
    greenTrust: 'traced-from-imagery',
    clubs: BAG,
    strategy: 'normal',
    ...extra,
  }
  return { input, result: recommend(input), features: hazards, units: 'metres' }
}
const say = (text: string, ctx: ChatContext) => answer(parseQuestion(text, BAG), ctx).text

describe('answers', () => {
  it('what club: the pick, the aim and why', () => {
    const t = say('what club?', ctxFor(147))
    expect(t).toMatch(/^\d Iron\. Aim/)
    expect(t).toMatch(/Confidence is medium/)
  })

  it('why not another club: both side by side, then a verdict in shots', () => {
    const t = say('why not 7 iron?', ctxFor(147))
    expect(t).toMatch(/^7 Iron: carries about 148 m/)
    expect(t).toMatch(/My pick, 8 Iron: on the green \d+%/)
    expect(t).toMatch(/On average it costs you about 0\.\d of a shot more|about the same/)
  })

  it('asking about the pick says so', () => {
    expect(say('why not 8 iron', ctxFor(147))).toMatch(/^That's my pick/)
  })

  it('a hard swing is described as a few metres more and wilder', () => {
    const t = say('8 hard', ctxFor(147))
    expect(t).toMatch(/^Swinging hard: a few metres more, but a fair bit wilder\. 8 Iron swung hard: carries about 142 m/)
  })

  it('driver off the fairway and too much club are explained, not computed', () => {
    expect(say('why not driver', ctxFor(147))).toMatch(/only an option off the tee/)
    expect(say('why not 4 wood', ctxFor(60))).toMatch(/^That's too much club: it carries about 180 m and you've got 60 m\./)
  })

  it('carry the water: reach, carry, and how often each club makes it', () => {
    const t = say('what do I need to carry the water?', ctxFor(147, [water(112, 128)]))
    expect(t).toMatch(/Water \/ penalty area across your line: 112 m to reach, 128 m to carry\./)
    expect(t).toMatch(/or longer carries it 9 times in 10 or better/)
    expect(say('carry the bunker?', ctxFor(147, [water(112, 128)]))).toMatch(/No bunkers to carry/)
  })

  it('safe miss: water short makes short the worst side', () => {
    const costs = missCosts(ctxFor(147, [water(118, 132)]).input)!
    expect(costs[costs.length - 1].side).toBe('short')
    expect(costs[costs.length - 1].worst).toBe('water')
    const t = say('safe miss?', ctxFor(147, [water(118, 132)]))
    expect(t).toMatch(/Worst is short \(water\), about \d\.\d of a shot worse than missing (long|left|right)\./)
  })

  it('lay up or go: both plans, a lay-up to a distance you have a club for, and a verdict', () => {
    const c = compareLayup(ctxFor(185, [water(160, 172)]).input)!
    expect(c.go).not.toBeNull()
    expect(c.layup).not.toBeNull()
    expect(BAG.some((b) => Math.abs((b.carryM ?? 0) * 1.03 - c.layup!.leaveM) < 12)).toBe(true)
    const t = say('lay up or go for it?', ctxFor(185, [water(160, 172)]))
    expect(t).toMatch(/^Go for it: .+ On the green \d+%, penalty \d+%\. Lay up: .+ leaving \d+ m for your .+ about \d+% of the time\. (Going for it|Laying up) saves you|about the same/)
  })

  it("lay up when you can't reach says so", () => {
    const t = say('go for it?', ctxFor(260))
    expect(t).toMatch(/^You can't get there from here: your longest club finishes about \d+ m and you've got 260 m\. Best lay-up:/)
  })

  it('telling it your lie sets the lie and gives the new club', () => {
    const r = answer(parseQuestion('I am in the bunker', BAG), ctxFor(147))
    expect(r.lie).toEqual({ surface: 'bunker', slopes: [] })
    expect(r.text).toMatch(/^Got it: Bunker\. .+Fairway bunker/)
  })

  it("questions it can't answer get the list of what it can", () => {
    expect(say('who won the rugby', ctxFor(147))).toMatch(/^I didn't catch that one\. I can tell you/)
  })

  it('needs a position for shot questions', () => {
    const ctx = ctxFor(147, [], { position: null, flagDistanceM: 140 })
    expect(say('safe miss', ctx)).toMatch(/need your position/)
  })
})

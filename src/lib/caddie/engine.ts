import type { Club } from '../../types'
import type { CourseFeature, FeatureKind } from '../../types/courseMap'
import type { TrustLevel } from '../../types/course'
import type { LngLat } from '../geo/geodesic'
import { localPlane, pointInRing, segmentsCross, centroid, type XY } from '../geo/plane'
import { expectedTotal, modelClub, type ClubModel } from './clubModel'
import {
  BUNKER_EXTRA,
  SAFE_MAX_PENALTY,
  STRATEGY_WEIGHTS,
  strokesFromOffGreen,
  strokesFromOnGreen,
  TROUBLE_EXTRA,
  type Strategy,
} from './scoring'

// The caddie: deterministic, testable shot planning. For each usable club and a fan
// of aim lines, it plays the same few hundred simulated shots (fixed random numbers,
// so the same situation always gives the same answer), scores where they finish, and
// picks the best plan for each strategy.

export const SAMPLES = 240
/** Plans closer than this in expected strokes count as a tie. */
const NEAR_TIE = 0.01
const AIM_OFFSETS_DEG = [-10, -8, -6, -4, -3, -2, -1, 0, 1, 2, 3, 4, 6, 8, 10]
const CORNER_OFFSETS_DEG = [-4, -2, 0, 2, 4]
const IGNORE_HAZARDS_BEYOND_M = 700

export interface CaddieInput {
  /** Where you are. Null if unknown. */
  position: LngLat | null
  positionSource: 'gps' | 'manual' | 'none'
  /** GPS accuracy in metres (null when set by hand). */
  positionAccuracyM: number | null
  positionStale?: boolean
  green: LngLat[]
  greenMiddle: LngLat
  /** Rangefinder distance to the flag, metres (flag assumed on your line to the green middle). */
  flagDistanceM: number | null
  /** Dog-leg corners on the line of play, tee to green order. */
  corners: LngLat[]
  /** Hazards and out-of-bounds lines anywhere on the course. */
  hazards: CourseFeature[]
  greenTrust: TrustLevel
  clubs: Club[]
  strategy: Strategy
}

export interface ShotPlan {
  clubId: string
  clubName: string
  /** Where to aim (the point the shot is pointed at, at its expected finishing distance). */
  aim: LngLat
  aimText: string
  carryM: number
  totalM: number
  rollKnown: boolean
  /** Share of shots: finish on the green / penalty (water or OB) / bunker / other trouble. */
  pGreen: number
  pPenalty: number
  pBunker: number
  pTrouble: number
  /** Average distance left to the flag when not penalised, metres. */
  leaveM: number
  layup: boolean
  /** Average strokes to finish the hole from here, this shot included. */
  expectedStrokes: number
  /** Landing zone (about two-thirds of shots) as an outline, for the map. */
  zone: LngLat[]
  /** Hazards this plan still brings into play, e.g. "Water left (6%)". */
  watchOut: string[]
}

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface CaddieAdvice {
  kind: 'advice'
  strategy: Strategy
  targetM: number
  pinSource: 'rangefinder' | 'green-middle'
  primary: ShotPlan
  alternative: ShotPlan | null
  byStrategy: Record<Strategy, ShotPlan>
  reasons: string[]
  confidence: { level: ConfidenceLevel; because: string[] }
  notes: string[]
}

export type CaddieResult =
  | CaddieAdvice
  | { kind: 'none'; reason: string }
  | { kind: 'part-swing'; targetM: number; shortestClub: string; shortestCarryM: number; reason: string }
  | { kind: 'distance-only'; targetM: number; clubName: string; carryM: number; totalM: number; reason: string }

// ---------- Fixed random numbers ----------

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The same standard-normal pairs every time (Box–Muller). Each pair is used four
 * ways (mirrored left/right and long/short) so the made-up shots have no lean of
 * their own: with no hazards and no usual miss, the caddie aims straight.
 */
const NORMALS: [number, number][] = (() => {
  const rand = mulberry32(20261113)
  const out: [number, number][] = []
  while (out.length < SAMPLES) {
    const u1 = Math.max(1e-12, rand())
    const u2 = rand()
    const r = Math.sqrt(-2 * Math.log(u1))
    const a = r * Math.cos(2 * Math.PI * u2)
    const b = r * Math.sin(2 * Math.PI * u2)
    out.push([a, b], [a, -b], [-a, b], [-a, -b])
  }
  return out
})()

// ---------- Geometry in a flat grid centred on you ----------

interface Area {
  id: string
  kind: FeatureKind
  ring: XY[]
  minX: number
  maxX: number
  minY: number
  maxY: number
  centre: XY
}

const inBox = (p: XY, a: Area) => p[0] >= a.minX && p[0] <= a.maxX && p[1] >= a.minY && p[1] <= a.maxY
const inArea = (p: XY, a: Area) => inBox(p, a) && pointInRing(p, a.ring)
const LABEL: Partial<Record<FeatureKind, string>> = { water: 'Water', bunker: 'Bunker', trouble: 'Trouble', 'out-of-bounds': 'Out of bounds' }

/** Compass-style angle (radians, 0 = +y/north, clockwise) to a unit vector in x/y. */
const dirOf = (a: number): XY => [Math.sin(a), Math.cos(a)]
const angleOf = (p: XY) => Math.atan2(p[0], p[1])

export function recommend(input: CaddieInput): CaddieResult {
  const models = input.clubs.map(modelClub).filter((m): m is ClubModel => m !== null)
  if (models.length === 0) {
    return { kind: 'none', reason: 'No clubs have a distance yet. Add them in My Bag and the caddie can advise.' }
  }

  // No position: only the rangefinder distance to go on.
  if (!input.position) {
    if (input.flagDistanceM === null) {
      return { kind: 'none', reason: "No position yet. Turn on GPS, set your spot on the Map view, or type in your rangefinder distance." }
    }
    const best = [...models].sort(
      (a, b) => Math.abs(expectedTotal(a) - input.flagDistanceM!) - Math.abs(expectedTotal(b) - input.flagDistanceM!),
    )[0]
    return {
      kind: 'distance-only',
      targetM: input.flagDistanceM,
      clubName: best.club.name,
      carryM: best.carryM,
      totalM: expectedTotal(best),
      reason: "Without your position, hazards can't be checked; this only matches the rangefinder distance.",
    }
  }

  const plane = localPlane(input.position)
  const middleXY = plane.toXY(input.greenMiddle)
  const middleDist = Math.hypot(middleXY[0], middleXY[1])
  const pinXY: XY =
    input.flagDistanceM !== null && middleDist > 0
      ? [(middleXY[0] / middleDist) * input.flagDistanceM, (middleXY[1] / middleDist) * input.flagDistanceM]
      : middleXY
  const targetM = Math.hypot(pinXY[0], pinXY[1])
  const pinWord = input.flagDistanceM !== null ? 'flag' : 'middle'

  const shortest = [...models].sort((a, b) => a.carryM - b.carryM)[0]
  if (targetM + 10 < shortest.carryM) {
    return {
      kind: 'part-swing',
      targetM,
      shortestClub: shortest.club.name,
      shortestCarryM: shortest.carryM,
      reason: `That's inside your shortest full shot (${shortest.club.name}, about ${Math.round(shortest.carryM)} m carry). It needs a part swing, which the caddie doesn't model yet.`,
    }
  }

  // Hazards near enough to matter, in the flat grid.
  const greenRing = input.green.map(plane.toXY)
  const areas: Area[] = []
  const boundaries: { id: string; line: XY[] }[] = []
  for (const f of input.hazards) {
    if (f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0].slice(0, -1).map(plane.toXY)
      const xs = ring.map((p) => p[0])
      const ys = ring.map((p) => p[1])
      const a: Area = { id: f.id, kind: f.kind, ring, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), centre: centroid(ring) }
      if (Math.hypot(a.centre[0], a.centre[1]) < IGNORE_HAZARDS_BEYOND_M) areas.push(a)
    } else if (f.geometry.type === 'LineString' && f.kind === 'out-of-bounds') {
      boundaries.push({ id: f.id, line: f.geometry.coordinates.map(plane.toXY) })
    }
  }

  // Aim lines: a fan around the flag, plus lines toward dog-leg corners ahead.
  const pinAngle = angleOf(pinXY)
  const aims: { angle: number; corner: boolean }[] = AIM_OFFSETS_DEG.map((o) => ({ angle: pinAngle + (o * Math.PI) / 180, corner: false }))
  for (const c of input.corners) {
    const cxy = plane.toXY(c)
    const along = cxy[0] * Math.sin(pinAngle) + cxy[1] * Math.cos(pinAngle)
    if (along > 30 && along < targetM) {
      for (const o of CORNER_OFFSETS_DEG) aims.push({ angle: angleOf(cxy) + (o * Math.PI) / 180, corner: true })
    }
  }

  const play = (m: ClubModel, aimAngle: number) => simulate(m, aimAngle, pinXY, greenRing, areas, boundaries, targetM)

  interface Candidate {
    m: ClubModel
    aim: { angle: number; corner: boolean }
    sim: SimResult
  }
  const candidates: Candidate[] = []
  for (const m of models) for (const aim of aims) candidates.push({ m, aim, sim: play(m, aim.angle) })

  const cost = (c: Candidate, s: Strategy) => {
    const w = STRATEGY_WEIGHTS[s]
    return c.sim.expectedStrokes + w.penalty * c.sim.pPenalty + w.bunker * c.sim.pBunker + w.trouble * c.sim.pTrouble
  }
  const bestFor = (s: Strategy, exclude?: string) => {
    let pool = candidates.filter((c) => c.m.club.id !== exclude)
    if (s === 'safe') {
      const safeOnes = pool.filter((c) => c.sim.pPenalty <= SAFE_MAX_PENALTY)
      if (safeOnes.length > 0) pool = safeOnes
    }
    if (pool.length === 0) return null
    // Near-ties (within 0.01 strokes of the best) go to the straighter aim: aiming off the middle has to earn its place.
    const lowest = Math.min(...pool.map((c) => cost(c, s)))
    const swing = (c: Candidate) => Math.abs(c.aim.angle - pinAngle)
    return pool
      .filter((c) => cost(c, s) <= lowest + NEAR_TIE)
      .reduce((a, c) => (swing(c) < swing(a) - 1e-9 || (Math.abs(swing(c) - swing(a)) <= 1e-9 && cost(c, s) < cost(a, s)) ? c : a))
  }

  const toPlan = (c: Candidate): ShotPlan => {
    const total = expectedTotal(c.m)
    const dir = dirOf(c.aim.angle)
    const aimXY: XY = [dir[0] * total, dir[1] * total]
    // Sideways offset of the aim from your line to the flag, measured at the aim distance.
    const offset = total * Math.sin(pinAngle - c.aim.angle) // + = left of the line
    const layup = total < targetM - 25
    let aimText: string
    if (c.aim.corner) aimText = 'Aim at the corner of the dog-leg'
    else if (Math.abs(offset) < 2.5) aimText = layup ? `Lay up straight at the ${pinWord}` : `Aim at the ${pinWord}`
    else aimText = `Aim ${Math.round(Math.abs(offset))} m ${offset > 0 ? 'left' : 'right'} of the ${pinWord}`
    if (layup) aimText += `, leaving about ${Math.round(c.sim.leaveM)} m`
    return {
      clubId: c.m.club.id,
      clubName: c.m.club.name,
      aim: plane.toLngLat(aimXY),
      aimText,
      carryM: c.m.carryM,
      totalM: total,
      rollKnown: c.m.rollKnown,
      pGreen: c.sim.pGreen,
      pPenalty: c.sim.pPenalty,
      pBunker: c.sim.pBunker,
      pTrouble: c.sim.pTrouble,
      leaveM: c.sim.leaveM,
      layup,
      expectedStrokes: c.sim.expectedStrokes,
      zone: zoneOutline(c.m, c.aim.angle).map(plane.toLngLat),
      watchOut: describeHits(c.sim.hits, areas, boundaries, c.aim.angle, total),
    }
  }

  const strategies: Strategy[] = ['safe', 'normal', 'aggressive']
  const picks = Object.fromEntries(strategies.map((s) => [s, bestFor(s)!])) as Record<Strategy, Candidate>
  const best = picks[input.strategy]
  const alt = bestFor(input.strategy, best.m.club.id)

  // The "obvious" club: the one whose usual finish is closest to the target, aimed straight.
  const straight = AIM_OFFSETS_DEG.indexOf(0)
  const naive = candidates
    .filter((c) => c.aim.angle === aims[straight].angle)
    .sort((a, b) => Math.abs(expectedTotal(a.m) - targetM) - Math.abs(expectedTotal(b.m) - targetM))[0]
  const bestStraight = candidates.find((c) => c.m === best.m && c.aim.angle === aims[straight].angle)!

  const reasons = explain(best, naive, bestStraight, targetM, pinWord, alt)
  const confidence = rateConfidence(input, best.m)
  const notes: string[] = []
  if (best.m.carryAssumed)
    notes.push(
      `${best.m.club.name}'s distance isn't marked as carry or total yet, so it's treated as carry. If it's really where the ball finishes, this could come up a few metres short.`,
    )
  if (!best.m.spreadKnown) notes.push(`Using a standard left/right spread for ${best.m.club.name}. Add your own in My Bag for sharper advice.`)
  if (!best.m.rollKnown) notes.push(`No total distance for ${best.m.club.name}, so its roll is estimated.`)
  notes.push('Wind and slope are not included yet.')

  return {
    kind: 'advice',
    strategy: input.strategy,
    targetM,
    pinSource: input.flagDistanceM !== null ? 'rangefinder' : 'green-middle',
    primary: toPlan(best),
    alternative: alt ? toPlan(alt) : null,
    byStrategy: { safe: toPlan(picks.safe), normal: toPlan(picks.normal), aggressive: toPlan(picks.aggressive) },
    reasons,
    confidence,
    notes,
  }
}

// ---------- Simulation ----------

interface SimResult {
  expectedStrokes: number
  pGreen: number
  pPenalty: number
  pBunker: number
  pTrouble: number
  leaveM: number
  /** Hits per hazard id. */
  hits: Map<string, number>
}

function simulate(
  m: ClubModel,
  aimAngle: number,
  pin: XY,
  green: XY[],
  areas: Area[],
  boundaries: { id: string; line: XY[] }[],
  targetM: number,
): SimResult {
  const d = dirOf(aimAngle)
  const left: XY = [-d[1], d[0]]
  let strokes = 0
  let green_ = 0
  let pen = 0
  let bunker = 0
  let trouble = 0
  let leaveSum = 0
  let leaveN = 0
  const hits = new Map<string, number>()
  const hit = (id: string) => hits.set(id, (hits.get(id) ?? 0) + 1)
  const origin: XY = [0, 0]

  for (const [z1, z2] of NORMALS) {
    const carry = Math.max(m.carryM * 0.3, m.carryM + m.depthBiasM + z1 * m.depthSdM)
    const side = m.sideBiasM + (z2 >= 0 ? z2 * m.leftSdM : z2 * m.rightSdM)
    const L: XY = [d[0] * carry + left[0] * side, d[1] * carry + left[1] * side]
    const scale = 1 + m.rollShare
    const F: XY = [L[0] * scale, L[1] * scale]

    let s: number
    const ob = boundaries.find((b) => crossesLine(origin, F, b.line))
    if (ob) {
      hit(ob.id)
      pen++
      s = 1 + strokesFromOffGreen(targetM) // stroke and distance: play again from here
    } else {
      const water = areas.find((a) => a.kind === 'water' && (inArea(L, a) || inArea(F, a)))
      if (water) {
        hit(water.id)
        pen++
        s = 1 + strokesFromOffGreen(Math.hypot(L[0] - pin[0], L[1] - pin[1]))
      } else {
        const dPin = Math.hypot(F[0] - pin[0], F[1] - pin[1])
        leaveSum += dPin
        leaveN++
        const tr = areas.find((a) => a.kind === 'trouble' && (inArea(L, a) || inArea(F, a)))
        const bk = !tr && areas.find((a) => a.kind === 'bunker' && (inArea(F, a) || inArea(L, a)))
        if (tr) {
          hit(tr.id)
          trouble++
          s = strokesFromOffGreen(dPin) + TROUBLE_EXTRA
        } else if (bk) {
          hit(bk.id)
          bunker++
          s = strokesFromOffGreen(dPin) + BUNKER_EXTRA
        } else if (pointInRing(F, green)) {
          green_++
          s = strokesFromOnGreen(dPin)
        } else {
          s = strokesFromOffGreen(dPin)
        }
      }
    }
    strokes += 1 + s
  }
  const n = NORMALS.length
  return {
    expectedStrokes: strokes / n,
    pGreen: green_ / n,
    pPenalty: pen / n,
    pBunker: bunker / n,
    pTrouble: trouble / n,
    leaveM: leaveN ? leaveSum / leaveN : targetM,
    hits,
  }
}

function crossesLine(a: XY, b: XY, line: XY[]): boolean {
  for (let i = 1; i < line.length; i++) if (segmentsCross(a, b, line[i - 1], line[i])) return true
  return false
}

/** Outline of where about two-thirds of shots finish (1 SD), as 24 points. */
function zoneOutline(m: ClubModel, aimAngle: number): XY[] {
  const d = dirOf(aimAngle)
  const left: XY = [-d[1], d[0]]
  const scale = 1 + m.rollShare
  const along0 = (m.carryM + m.depthBiasM) * scale
  const pts: XY[] = []
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * 2 * Math.PI
    const c = Math.cos(t)
    const s = Math.sin(t)
    const along = along0 + c * m.depthSdM * scale
    const side = m.sideBiasM + (s >= 0 ? s * m.leftSdM : s * m.rightSdM)
    pts.push([d[0] * along + left[0] * side, d[1] * along + left[1] * side])
  }
  return pts
}

function sideOf(p: XY, aimAngle: number): string {
  const d = dirOf(aimAngle)
  const across = d[0] * p[1] - d[1] * p[0]
  return across > 0 ? 'left' : 'right'
}

/** Where a hazard sits relative to the shot: short or long if the aim line runs through it, else left or right. */
function placeOf(a: Area, aimAngle: number, finishM: number): string {
  const d = dirOf(aimAngle)
  for (let s = 5; s <= finishM * 1.4; s += 4) {
    if (inArea([d[0] * s, d[1] * s], a)) {
      const along = a.centre[0] * d[0] + a.centre[1] * d[1]
      return along < finishM ? 'short' : 'long'
    }
  }
  return sideOf(a.centre, aimAngle)
}

function describeHits(
  hits: Map<string, number>,
  areas: Area[],
  boundaries: { id: string; line: XY[] }[],
  aimAngle: number,
  finishM: number,
): string[] {
  const out: { text: string; p: number }[] = []
  for (const [id, n] of hits) {
    const p = n / NORMALS.length
    if (p < 0.03) continue
    const a = areas.find((x) => x.id === id)
    if (a) {
      out.push({ text: `${LABEL[a.kind]} ${placeOf(a, aimAngle, finishM)} (${pct(p)})`, p })
      continue
    }
    const b = boundaries.find((x) => x.id === id)
    if (b) {
      const mid = b.line[Math.floor(b.line.length / 2)]
      out.push({ text: `Out of bounds ${sideOf(mid, aimAngle)} (${pct(p)})`, p })
    }
  }
  return out.sort((x, y) => y.p - x.p).map((x) => x.text)
}

export function pct(p: number): string {
  if (p > 0 && p < 0.01) return 'under 1%'
  return `${Math.round(p * 100)}%`
}

// ---------- Explanation and confidence ----------

interface Cand {
  m: ClubModel
  aim: { angle: number; corner: boolean }
  sim: SimResult
}

function explain(best: Cand, naive: Cand, bestStraight: Cand, targetM: number, pinWord: string, alt: Cand | null): string[] {
  const r: string[] = []
  const total = expectedTotal(best.m)
  const t = Math.round(targetM)
  r.push(
    `${best.m.club.name} carries about ${Math.round(best.m.carryM)} m and should finish around ${Math.round(total)} m${
      best.m.rollKnown ? '' : ' (roll estimated)'
    }. The ${pinWord} is ${t} m.`,
  )

  const trouble = (s: SimResult) => s.pPenalty + s.pBunker + s.pTrouble
  if (naive.m !== best.m && trouble(naive.sim) > trouble(best.sim) + 0.05) {
    const what =
      naive.sim.pPenalty > 0.03
        ? `a penalty about ${pct(naive.sim.pPenalty)} of the time`
        : naive.sim.pBunker > 0.03
          ? `the bunker about ${pct(naive.sim.pBunker)} of the time`
          : `trouble about ${pct(naive.sim.pTrouble)} of the time`
    r.push(`${naive.m.club.name} matches the distance more closely, but would find ${what}.`)
  }

  if (best.aim.angle !== bestStraight.aim.angle) {
    const before = trouble(bestStraight.sim)
    const after = trouble(best.sim)
    if (before - after >= 0.03) {
      r.push(`Aiming that way cuts the chance of trouble from ${pct(before)} to ${pct(after)}.`)
    }
  }

  const layup = total < targetM - 25
  if (!layup && best.sim.pGreen < 0.15 && best.sim.pPenalty < 0.05) {
    r.push(`This misses the green on purpose, to keep the penalty chance down to ${pct(best.sim.pPenalty)}.`)
  }
  if (best.sim.pPenalty >= 0.03) r.push(`There's still about a ${pct(best.sim.pPenalty)} chance of a penalty.`)
  else if (best.sim.pGreen >= 0.5 && total >= targetM - 25) r.push(`About ${pct(best.sim.pGreen)} of shots like this finish on the green.`)

  if (alt && Math.abs(alt.sim.expectedStrokes - best.sim.expectedStrokes) < 0.03) {
    r.push(`Close call with ${alt.m.club.name}; go with whichever feels right.`)
  }
  return r.slice(0, 4)
}

function rateConfidence(input: CaddieInput, m: ClubModel): { level: ConfidenceLevel; because: string[] } {
  const levels: ConfidenceLevel[] = []
  const because: string[] = []

  const c = m.club.confidence
  if (c === 'measured') levels.push('high')
  else if (c === 'rough') {
    levels.push('medium')
    because.push(`${m.club.name} distance is a rough estimate`)
  } else {
    levels.push('low')
    because.push(`${m.club.name} distance is a guess`)
  }

  if (m.carryAssumed) {
    levels.push('medium')
    because.push(`${m.club.name} distance isn't confirmed as carry`)
  }

  if (input.positionSource === 'manual') {
    levels.push('medium')
    because.push('your position was set by hand')
  } else if (input.positionStale || input.positionAccuracyM === null || input.positionAccuracyM > 10) {
    levels.push('low')
    because.push('GPS is rough or out of date')
  } else if (input.positionAccuracyM > 5) {
    levels.push('medium')
    because.push('GPS is only fair')
  } else levels.push('high')

  if (input.greenTrust === 'estimated') {
    levels.push('low')
    because.push("this green's outline is only estimated")
  }

  const level: ConfidenceLevel = levels.includes('low') ? 'low' : levels.includes('medium') ? 'medium' : 'high'
  return { level, because }
}

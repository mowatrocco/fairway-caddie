import { adjustModel, lieNotes, PLAIN_LIE, type Lie, type Swing } from './lie'
import type { Club } from '../../types'
import type { CourseFeature, FeatureKind } from '../../types/courseMap'
import type { TrustLevel } from '../../types/course'
import type { LngLat } from '../geo/geodesic'
import { localPlane, pointInRing, segmentsCross, centroid, type XY } from '../geo/plane'
import { expectedTotal, modelClub, partialModels, type ClubModel } from './clubModel'
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
  /** True when you're on this hole's tee. Driver is only suggested from the tee. */
  fromTee: boolean
  /** Dog-leg corners on the line of play, tee to green order. */
  corners: LngLat[]
  /** Hazards and out-of-bounds lines anywhere on the course. */
  hazards: CourseFeature[]
  greenTrust: TrustLevel
  clubs: Club[]
  strategy: Strategy
  /** How the ball's sitting. Fairway and flat if not given. */
  lie?: Lie
  /** Swing for every club (a what-if). Normal if not given. */
  swing?: Swing
  /** Ground height in metres at a point, or null where unknown. Without it the ground is treated as flat. */
  heightAt?: (p: LngLat) => number | null
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
  /** How far the target is above (+) or below (−) you, metres. Null without height data. */
  heightDiffM: number | null
  /** Target distance allowing for the height difference. Null without height data. */
  playsLikeM: number | null
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
  const lie = input.lie ?? PLAIN_LIE
  const swing = input.swing ?? 'normal'
  const usable = input.clubs
    .flatMap((c) => [modelClub(c), ...partialModels(c)])
    .filter((m): m is ClubModel => m !== null)
    .map((m) => adjustModel(m, lie, swing))
  if (usable.length === 0) {
    return { kind: 'none', reason: 'No clubs have a distance yet. Add them in My Bag and the caddie can advise.' }
  }
  // Driver off the deck is a specialist shot: only offer it from the tee.
  const models = input.fromTee ? usable : usable.filter((m) => m.club.category !== 'driver')
  const driverLeftOut = models.length < usable.length
  if (models.length === 0) {
    return { kind: 'none', reason: 'Your driver is the only club with a distance, and driver is only suggested from the tee. Add more clubs in My Bag.' }
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
  // Ground heights, if we have them for where you're standing.
  const heightAt = input.heightAt
  const groundXY = heightAt ? (xy: XY) => heightAt(plane.toLngLat(xy)) : null
  const h0 = groundXY ? groundXY([0, 0]) : null
  const terrain: Terrain | null = groundXY && h0 !== null ? { ground: groundXY, h0 } : null
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
      reason: input.clubs.some((c) => c.partials && Object.values(c.partials).some((v) => v !== null))
        ? `That's inside your shortest shot in the wedge chart (${shortest.club.name}, about ${Math.round(shortest.carryM)} m carry). Chip or pitch it, or add a shorter swing to your wedge chart in My Bag.`
        : `That's inside your shortest full shot (${shortest.club.name}, about ${Math.round(shortest.carryM)} m carry). It needs a part swing: add your part-swing carries to the wedge chart in My Bag and the caddie can pick one.`,
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

  const play = (m: ClubModel, aimAngle: number) => simulate(m, aimAngle, pinXY, greenRing, areas, boundaries, targetM, terrain)

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
    // Near-ties (within 0.01 strokes of the best) go to the plainest aim: straight at the target,
    // allowing only for the club's known lean (usual miss, or the lie). Anything more has to earn its place.
    const lowest = Math.min(...pool.map((c) => cost(c, s)))
    const swing = (c: Candidate) => Math.abs(c.aim.angle - (pinAngle + Math.atan2(c.m.sideBiasM, expectedTotal(c.m))))
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
      zone: zoneOutline(c.m, c.aim.angle, terrain).map(plane.toLngLat),
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

  const hTarget = terrain ? terrain.ground(pinXY) : null
  const heightDiffM = terrain && hTarget !== null ? hTarget - terrain.h0 : null
  const playsLikeM = heightDiffM !== null ? targetM + heightDiffM * PLAYS_LIKE_PER_M : null
  const heightReason =
    heightDiffM !== null && Math.abs(heightDiffM) >= 2
      ? [
          `The ${pinWord} is ${Math.round(Math.abs(heightDiffM))} m ${heightDiffM > 0 ? 'above' : 'below'} you, so it plays about ${Math.round(playsLikeM!)} m.`,
        ]
      : []
  const reasons = [...explain(best, naive, bestStraight, targetM, pinWord, alt), ...heightReason, ...lieNotes(lie, swing)]
  const confidence = rateConfidence(input, best.m)
  const notes: string[] = []
  if (driverLeftOut) notes.push("Driver is left out because you're not on the tee.")
  if (best.m.carryAssumed)
    notes.push(
      `${best.m.club.name}'s distance isn't marked as carry or total yet, so it's treated as carry. If it's really where the ball finishes, this could come up a few metres short.`,
    )
  if (!best.m.spreadKnown) notes.push(`Using a standard left/right spread for ${best.m.club.name}. Add your own in My Bag for sharper advice.`)
  if (!best.m.rollKnown) notes.push(`No total distance for ${best.m.club.name}, so its roll is estimated.`)
  notes.push(
    terrain
      ? "Wind isn't included yet. Slope is, from LINZ ground heights."
      : "Wind and slope aren't included here: no ground heights for this spot yet.",
  )

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
    heightDiffM,
    playsLikeM,
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
  terrain: Terrain | null = null,
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
    const L = landing(d, left, carry, side, m, terrain)
    const F = finish(L, m.rollShare, terrain)

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

// ---------- Ground ----------

export interface Terrain {
  /** Height at a point in the local grid, or null. */
  ground: (xy: XY) => number | null
  /** Height where you're standing. */
  h0: number
}

/** Each metre the landing spot is above you takes about a metre off the carry (and below adds one). */
export const PLAYS_LIKE_PER_M = 1
/** Roll grows on a downslope and shrinks on an upslope: ×(1 − grade × this). A 5% downslope runs 40% further. */
export const ROLL_PER_GRADE = 8
/** On a side slope the ball drifts downhill by this share of its roll per unit of grade. */
export const SIDE_KICK = 3

/** Where the ball first lands, allowing for the height of the ground there. */
export function landing(d: XY, left: XY, carry: number, side: number, m: ClubModel, terrain: Terrain | null): XY {
  const flat: XY = [d[0] * carry + left[0] * side, d[1] * carry + left[1] * side]
  if (!terrain) return flat
  const h = terrain.ground(flat)
  if (h === null) return flat
  const c = Math.max(m.carryM * 0.3, carry - (h - terrain.h0) * PLAYS_LIKE_PER_M)
  return [d[0] * c + left[0] * side, d[1] * c + left[1] * side]
}

/** Where the ball stops after rolling on from L, running further downhill and drifting off side slopes. */
export function finish(L: XY, rollShare: number, terrain: Terrain | null): XY {
  const len = Math.hypot(L[0], L[1])
  if (len === 0) return L
  const u: XY = [L[0] / len, L[1] / len]
  let roll = len * rollShare
  let drift = 0
  if (terrain && roll > 0) {
    const g = (p: XY) => terrain.ground(p)
    const a = g([L[0] + u[0] * 3, L[1] + u[1] * 3])
    const b = g([L[0] - u[0] * 3, L[1] - u[1] * 3])
    const v: XY = [-u[1], u[0]] // to the left
    const l = g([L[0] + v[0] * 3, L[1] + v[1] * 3])
    const r = g([L[0] - v[0] * 3, L[1] - v[1] * 3])
    if (a !== null && b !== null) roll *= Math.min(2.5, Math.max(0.3, 1 - ((a - b) / 6) * ROLL_PER_GRADE))
    if (l !== null && r !== null) drift = Math.max(-roll, Math.min(roll, -((l - r) / 6) * roll * SIDE_KICK))
  }
  return [L[0] + u[0] * roll - u[1] * drift, L[1] + u[1] * roll + u[0] * drift]
}

function crossesLine(a: XY, b: XY, line: XY[]): boolean {
  for (let i = 1; i < line.length; i++) if (segmentsCross(a, b, line[i - 1], line[i])) return true
  return false
}

/** Outline of where about two-thirds of shots finish (1 SD), as 24 points. */
function zoneOutline(m: ClubModel, aimAngle: number, terrain: Terrain | null = null): XY[] {
  const d = dirOf(aimAngle)
  const left: XY = [-d[1], d[0]]
  const scale = 1 + m.rollShare
  const nominal = landing(d, left, m.carryM + m.depthBiasM, m.sideBiasM, m, terrain)
  const along0 = (nominal[0] * d[0] + nominal[1] * d[1]) * scale
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

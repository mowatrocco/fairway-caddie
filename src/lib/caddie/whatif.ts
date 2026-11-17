import type { Club } from '../../types'
import type { CourseFeature } from '../../types/courseMap'
import { analyseHazards } from '../course/hazards'
import type { XY } from '../geo/plane'
import { expectedTotal, modelClub, partialModels, type ClubModel } from './clubModel'
import {
  angleOf,
  buildScene,
  dirOf,
  finish,
  landing,
  NORMALS,
  recommend,
  scoreFinish,
  type CaddieAdvice,
  type CaddieInput,
  type Scene,
  type ShotPlan,
  type Terrain,
} from './engine'
import { adjustModel, PLAIN_LIE, type Swing } from './lie'
import { windModel } from './wind'
import { STRATEGY_WEIGHTS, strokesFromOffGreen, strokesFromOnGreen } from './scoring'

// "What if" questions for the caddie chat. Every number comes from the same
// simulation as the main advice; nothing here is made up or remembered.

/** The clubs (and wedge-chart swings) the engine would consider, as they play from this lie. */
export function modelsFor(input: CaddieInput, swing: Swing = input.swing ?? 'normal'): ClubModel[] {
  const lie = input.lie ?? PLAIN_LIE
  return input.clubs
    .flatMap((c) => [modelClub(c), ...partialModels(c)])
    .filter((m): m is ClubModel => m !== null)
    .map((m) => windModel(adjustModel(m, lie, swing), input.wind ?? null))
    .filter((m) => input.fromTee || m.club.category !== 'driver')
}

// ---------- One club, compared with the pick ----------

export type ClubTry =
  | { kind: 'plan'; plan: ShotPlan; advice: CaddieAdvice }
  | { kind: 'driver-off-tee' }
  | { kind: 'too-much'; carryM: number; targetM: number }
  | { kind: 'no-distance' }

/** The best this club can do from here (same strategy and lie), optionally swung hard. */
export function tryClub(input: CaddieInput, club: Club, swing: Swing = 'normal'): ClubTry {
  if (club.category === 'driver' && !input.fromTee) return { kind: 'driver-off-tee' }
  const r = recommend({ ...input, clubs: [club], swing })
  if (r.kind === 'advice') return { kind: 'plan', plan: r.primary, advice: r }
  if (r.kind === 'part-swing') return { kind: 'too-much', carryM: r.shortestCarryM, targetM: r.targetM }
  return { kind: 'no-distance' }
}

// ---------- Where to miss ----------

export type MissSide = 'short' | 'long' | 'left' | 'right'

export interface MissCost {
  side: MissSide
  /** Extra strokes, on average, compared with finishing on the target. */
  extra: number
  /** The worst thing waiting that side, if any. */
  worst: 'water' | 'out of bounds' | 'trouble' | 'a bunker' | null
}

const rot = ([x, y]: XY, a: number): XY => [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)]

/** How costly a miss is each side of the target, cheapest first. */
export function missCosts(input: CaddieInput): MissCost[] | null {
  if (!input.position) return null
  const sc = buildScene(input, input.position)
  const len = Math.hypot(sc.pinXY[0], sc.pinXY[1])
  if (len < 1) return null
  const along: XY = [sc.pinXY[0] / len, sc.pinXY[1] / len]
  const leftV: XY = [-along[1], along[0]]
  const dirs: Record<MissSide, XY> = {
    short: [-along[0], -along[1]],
    long: along,
    left: leftV,
    right: [-leftV[0], -leftV[1]],
  }
  const origin: XY = [0, 0]
  const base = scoreFinish(sc.pinXY, sc.pinXY, origin, sc.pinXY, sc.greenRing, sc.areas, sc.boundaries).strokes
  const out: MissCost[] = []
  for (const side of Object.keys(dirs) as MissSide[]) {
    let sum = 0
    let n = 0
    const seen = new Map<string, number>()
    for (const r of [8, 14, 20]) {
      for (const a of [-0.26, 0, 0.26]) {
        const v = rot(dirs[side], a)
        const p: XY = [sc.pinXY[0] + v[0] * r, sc.pinXY[1] + v[1] * r]
        const o = scoreFinish(p, p, origin, sc.pinXY, sc.greenRing, sc.areas, sc.boundaries)
        sum += o.strokes
        n++
        if (o.outcome !== 'green' && o.outcome !== 'off-green') seen.set(o.outcome, (seen.get(o.outcome) ?? 0) + 1)
      }
    }
    const order: [string, MissCost['worst']][] = [
      ['ob', 'out of bounds'],
      ['water', 'water'],
      ['trouble', 'trouble'],
      ['bunker', 'a bunker'],
    ]
    const worst = order.find(([k]) => seen.has(k))?.[1] ?? null
    out.push({ side, extra: sum / n - base, worst })
  }
  return out.sort((a, b) => a.extra - b.extra)
}

// ---------- What it takes to carry a hazard ----------

export interface CarryNeed {
  label: string
  side: string
  reachM: number
  /** Carry needed, allowing for the height of the far edge if known. */
  carryM: number
  heightM: number | null
  clubs: { name: string; pCarry: number }[]
}

function normalCdf(z: number): number {
  // Abramowitz–Stegun approximation, plenty for percentages.
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

/** Hazards across your line to the target that you have to fly, and how often each club makes it. */
export function carryNeeds(input: CaddieInput, features: CourseFeature[], kind: 'water' | 'bunker' | 'trouble' | 'any'): CarryNeed[] | null {
  if (!input.position) return null
  const sc = buildScene(input, input.position)
  const target = sc.plane.toLngLat(sc.pinXY)
  const kinds = kind === 'any' ? ['water', 'bunker', 'trouble'] : [kind]
  const readings = analyseHazards(features, input.position, target).filter(
    (h) => kinds.includes(h.kind) && h.reachM > 0 && (h.side === 'across' || h.offsetM <= 6) && h.carryM <= sc.targetM + 5,
  )
  const models = modelsFor(input)
  const along = dirOf(angleOf(sc.pinXY))
  return readings.map((h) => {
    const edge: XY = [along[0] * h.carryM, along[1] * h.carryM]
    const hEdge = sc.terrain ? sc.terrain.ground(edge) : null
    const heightM = hEdge !== null && sc.terrain ? hEdge - sc.terrain.h0 : null
    const need = h.carryM + (heightM ?? 0)
    const clubs = models
      .map((m) => ({ name: m.club.name, pCarry: normalCdf((m.carryM + m.depthBiasM - need) / m.depthSdM), carry: m.carryM }))
      .filter((c) => c.pCarry >= 0.05)
      .sort((a, b) => a.carry - b.carry)
      .map(({ name, pCarry }) => ({ name, pCarry }))
    return { label: h.label, side: h.side, reachM: h.reachM, carryM: need, heightM, clubs }
  })
}

// ---------- Lay up or go for it ----------

export interface GoOption {
  clubName: string
  aimText: string
  pGreen: number
  pPenalty: number
  expectedStrokes: number
}

export interface LayupOption {
  clubName: string
  /** How far the lay-up should finish from you. */
  layM: number
  /** What it leaves to the target. */
  leaveM: number
  nextClubName: string
  pPenalty: number
  /** Chance of being on the green after the next shot. */
  pGreenNext: number
  expectedStrokes: number
}

export interface LayupComparison {
  targetM: number
  longestM: number
  go: GoOption | null
  layup: LayupOption | null
}

/** Second-shot samples: the first 24 fixed shots (six mirrored groups, so no lean). */
const SECOND = NORMALS.slice(0, 24)

function shiftTerrain(t: Terrain | null, at: XY): Terrain | null {
  if (!t) return null
  const ground = (xy: XY) => t.ground([xy[0] + at[0], xy[1] + at[1]])
  return { ground, h0: ground([0, 0]) ?? t.h0 }
}

function sampleShot(m: ClubModel, aimAngle: number, z1: number, z2: number, from: XY, terrain: Terrain | null): { L: XY; F: XY } {
  const d = dirOf(aimAngle)
  const left: XY = [-d[1], d[0]]
  const carry = Math.max(m.carryM * 0.3, m.carryM + m.depthBiasM + z1 * m.depthSdM)
  const side = m.sideBiasM + (z2 >= 0 ? z2 * m.leftSdM : z2 * m.rightSdM)
  const t = shiftTerrain(terrain, from)
  const Lr = landing(d, left, carry, side, m, t)
  const Fr = finish(Lr, m.rollShare, t)
  return { L: [Lr[0] + from[0], Lr[1] + from[1]], F: [Fr[0] + from[0], Fr[1] + from[1]] }
}

function closestClub(models: ClubModel[], distanceM: number): ClubModel {
  return models.reduce((a, b) => (Math.abs(expectedTotal(b) - distanceM) < Math.abs(expectedTotal(a) - distanceM) ? b : a))
}

/** Strokes to finish from a lay-up finishing at F, and whether the next shot finds the green. */
function secondShot(sc: Scene, models: ClubModel[], shortest: number, F: XY): { strokes: number; pGreen: number } {
  const d2 = Math.hypot(sc.pinXY[0] - F[0], sc.pinXY[1] - F[1])
  if (d2 <= 30) {
    // A chip: counted as finding the green.
    return { strokes: d2 < 1 ? strokesFromOnGreen(0) : strokesFromOffGreen(d2), pGreen: 1 }
  }
  let m = closestClub(models, d2)
  if (d2 + 10 < shortest) {
    // A pitch shorter than anything in your chart: your shortest wedge, eased off to the
    // distance, with a bit more spread than a measured swing.
    const s = 1.3 * (d2 / m.carryM)
    m = { ...m, carryM: d2 / (1 + m.rollShare), depthSdM: m.depthSdM * s, leftSdM: m.leftSdM * s, rightSdM: m.rightSdM * s, sideBiasM: 0 }
  }
  const aim = angleOf([sc.pinXY[0] - F[0], sc.pinXY[1] - F[1]])
  let strokes = 0
  let green = 0
  for (const [z1, z2] of SECOND) {
    const { L, F: F2 } = sampleShot(m, aim, z1, z2, F, sc.terrain)
    const o = scoreFinish(L, F2, F, sc.pinXY, sc.greenRing, sc.areas, sc.boundaries)
    strokes += 1 + o.strokes
    if (o.outcome === 'green') green++
  }
  return { strokes: strokes / SECOND.length, pGreen: green / SECOND.length }
}

/** Compare going for the green with the best lay-up to a distance you like. */
export function compareLayup(input: CaddieInput): LayupComparison | null {
  if (!input.position) return null
  const sc = buildScene(input, input.position)
  const models = modelsFor(input)
  if (models.length === 0) return null
  const longestM = Math.max(...models.map(expectedTotal))
  const shortest = Math.min(...models.map((m) => m.carryM))
  const w = STRATEGY_WEIGHTS[input.strategy]

  // Going for it: the best plan among clubs that get there.
  const reachers = models.filter((m) => expectedTotal(m) >= sc.targetM - 15).map((m) => m.club.id)
  let go: GoOption | null = null
  if (reachers.length > 0) {
    const r = recommend({ ...input, clubs: input.clubs.filter((c) => reachers.includes(c.id)) })
    if (r.kind === 'advice') {
      const p = r.primary
      go = { clubName: p.clubName, aimText: p.aimText, pGreen: p.pGreen, pPenalty: p.pPenalty, expectedStrokes: p.expectedStrokes }
    }
  }

  // Laying up: any club whose normal finish leaves a distance you have a full shot
  // or wedge-chart swing for (within 8 m), up to 130 m out.
  const second = models.filter((m) => m.club.category !== 'driver')
  const pinAngle = angleOf(sc.pinXY)
  let best: (LayupOption & { cost: number }) | null = null
  for (const m of models) {
    const layM = expectedTotal(m)
    const leave = sc.targetM - layM
    if (layM < 40 || leave < 30 || leave > 130) continue
    if (!second.some((s) => Math.abs(expectedTotal(s) - leave) <= 8)) continue
    for (const off of [-5, 0, 5]) {
      const aim = pinAngle + (off * Math.PI) / 180
      let strokes = 0
      let pen = 0
      let greenNext = 0
      for (const [z1, z2] of NORMALS) {
        const { L, F } = sampleShot(m, aim, z1, z2, [0, 0], sc.terrain)
        const o = scoreFinish(L, F, [0, 0], sc.pinXY, sc.greenRing, sc.areas, sc.boundaries)
        if (o.outcome === 'ob' || o.outcome === 'water') {
          pen++
          strokes += 1 + o.strokes
        } else if (o.outcome === 'green') {
          greenNext++
          strokes += 1 + o.strokes
        } else if (o.outcome === 'trouble') {
          strokes += 1 + o.strokes
        } else {
          const s2 = secondShot(sc, second, shortest, F)
          strokes += 1 + s2.strokes + (o.outcome === 'bunker' ? 0.2 : 0)
          greenNext += s2.pGreen
        }
      }
      const n = NORMALS.length
      const option = {
        clubName: m.club.name,
        layM: expectedTotal(m),
        leaveM: sc.targetM - expectedTotal(m),
        nextClubName: closestClub(second, sc.targetM - expectedTotal(m)).club.name,
        pPenalty: pen / n,
        pGreenNext: greenNext / n,
        expectedStrokes: strokes / n,
      }
      const cost = option.expectedStrokes + w.penalty * option.pPenalty
      if (!best || cost < best.cost - 1e-9) best = { ...option, cost }
    }
  }
  const layup = best ? (({ cost: _cost, ...o }) => o)(best) : null
  return { targetM: sc.targetM, longestM, go, layup }
}

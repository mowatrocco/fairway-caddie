import type { ClubModel } from './clubModel'

// Wind, set by you on the course. You tap how it blows on the shot you're facing;
// the app keeps it as a compass direction so it follows you round to every hole.
// The effects are general rules of thumb to start with, tuned later from logged rounds.

export type WindDir = 'into' | 'helping' | 'left-to-right' | 'right-to-left'
export type WindStrength = 'calm' | 'light' | 'medium' | 'strong'

export const WIND_DIR_LABEL: Record<WindDir, string> = {
  into: 'Into',
  helping: 'Helping',
  'left-to-right': 'Left to right',
  'right-to-left': 'Right to left',
}

export const WIND_STRENGTH_LABEL: Record<WindStrength, string> = {
  calm: 'Calm',
  light: 'Light',
  medium: 'Medium',
  strong: 'Strong',
}

/** Rough speed for each strength, km/h, shown as a hint. */
export const WIND_KMH: Record<WindStrength, number> = { calm: 0, light: 10, medium: 20, strong: 30 }

/** What you've set: where the wind blows from (compass degrees) and how hard. */
export interface WindSetting {
  /** Null until you've tapped a direction. */
  fromDeg: number | null
  strength: WindStrength
  /** When it was set (ms), so an old setting can be dropped. */
  setAt: number
}

/** A setting older than this is ignored: wind changes. */
export const WIND_MAX_AGE_MS = 4 * 60 * 60 * 1000

/** Wind relative to one shot. head: +1 straight into, −1 straight behind. cross: +1 left to right. */
export interface ShotWind {
  head: number
  cross: number
  kmh: number
  strength: WindStrength
}

const norm = (a: number) => ((a % 360) + 360) % 360

/** Directions as offsets from the shot line toward where the wind comes from. */
const FROM_OFFSET: Record<WindDir, [number, number]> = {
  // [head, cross] unit components
  into: [1, 0],
  helping: [-1, 0],
  'left-to-right': [0, 1],
  'right-to-left': [0, -1],
}

/** Turn tapped directions on this shot into a compass direction the wind comes from. */
export function windFromTaps(dirs: WindDir[], shotBearingDeg: number): number | null {
  let h = 0
  let c = 0
  for (const d of dirs) {
    h += FROM_OFFSET[d][0]
    c += FROM_OFFSET[d][1]
  }
  if (h === 0 && c === 0) return null
  // Into comes from straight ahead; left-to-right comes from your left (90° anticlockwise).
  return norm(shotBearingDeg + (Math.atan2(-c, h) * 180) / Math.PI)
}

/** How a set wind blows on a shot in a given direction. */
export function windOnShot(w: WindSetting, shotBearingDeg: number): ShotWind {
  if (w.fromDeg === null) return { head: 0, cross: 0, kmh: 0, strength: 'calm' }
  const rel = ((w.fromDeg - shotBearingDeg) * Math.PI) / 180
  return { head: Math.cos(rel), cross: -Math.sin(rel), kmh: WIND_KMH[w.strength], strength: w.strength }
}

/** Which direction buttons describe this wind on this shot (up to two). */
export function windDirsOnShot(sw: ShotWind): WindDir[] {
  if (sw.kmh === 0) return []
  const out: WindDir[] = []
  if (sw.head > 0.38) out.push('into')
  else if (sw.head < -0.38) out.push('helping')
  if (sw.cross > 0.38) out.push('left-to-right')
  else if (sw.cross < -0.38) out.push('right-to-left')
  return out
}

// Rules of thumb (per km/h of wind): a headwind costs about 0.6% of carry, a tailwind
// adds about 0.3%. A crosswind moves a mid-iron about 0.3% of its carry sideways per
// km/h (about 9 m at 150 m in a 20 km/h wind). Downwind balls run more, into-wind less,
// and everything gets a little less predictable.
export const HEAD_CARRY_PER_KMH = 0.006
export const TAIL_CARRY_PER_KMH = 0.003
export const DRIFT_PER_KMH = 0.003
export const ROLL_PER_KMH = 0.018

/** The club as it plays in this wind. */
export function windModel(m: ClubModel, w: ShotWind | null): ClubModel {
  if (!w || w.kmh === 0) return m
  const headKmh = w.head * w.kmh
  const crossKmh = w.cross * w.kmh
  const carryK = headKmh >= 0 ? 1 - HEAD_CARRY_PER_KMH * headKmh : 1 - TAIL_CARRY_PER_KMH * headKmh
  const carry = m.carryM * carryK
  const rollK = Math.min(2, Math.max(0.4, 1 - ROLL_PER_KMH * headKmh))
  return {
    ...m,
    carryM: carry,
    rollShare: m.rollShare * rollK,
    rollKnown: m.rollKnown && Math.abs(headKmh) < 3,
    // Left to right pushes the ball right; sideBias is + to the left.
    sideBiasM: m.sideBiasM - carry * DRIFT_PER_KMH * crossKmh,
    depthSdM: m.depthSdM * (1 + 0.004 * w.kmh),
    leftSdM: m.leftSdM * (1 + 0.006 * w.kmh),
    rightSdM: m.rightSdM * (1 + 0.006 * w.kmh),
  }
}

/** How many times longer (>1) or shorter (<1) a shot plays straight into or with this wind. */
export function windPlaysFactor(w: ShotWind | null): number {
  if (!w || w.kmh === 0) return 1
  const headKmh = w.head * w.kmh
  return 1 / (headKmh >= 0 ? 1 - HEAD_CARRY_PER_KMH * headKmh : 1 - TAIL_CARRY_PER_KMH * headKmh)
}

/** "into and left to right, medium" */
export function describeWind(w: ShotWind): string {
  const dirs = windDirsOnShot(w).map((d) => WIND_DIR_LABEL[d].toLowerCase())
  return `${dirs.join(' and ') || 'across'}, ${WIND_STRENGTH_LABEL[w.strength].toLowerCase()}`
}

/** One plain line for the reasons. */
export function windNote(w: ShotWind | null, carryM: number): string | null {
  if (!w || w.kmh === 0) return null
  const parts: string[] = []
  const headKmh = w.head * w.kmh
  if (Math.abs(headKmh) >= 3) {
    const pctChange = Math.round(Math.abs(1 / windPlaysFactor(w) - 1) * 100)
    parts.push(headKmh > 0 ? `about ${pctChange}% less carry` : `about ${pctChange}% more carry and more run`)
  }
  const drift = Math.abs(carryM * DRIFT_PER_KMH * w.cross * w.kmh)
  if (drift >= 2) parts.push(`about ${Math.round(drift)} m of drift ${w.cross > 0 ? 'right' : 'left'}, allowed for in the aim`)
  if (parts.length === 0) return null
  return `Wind (${describeWind(w)}): ${parts.join(', ')}. Rule of thumb, not measured.`
}

export const OPPOSITE_WIND: Record<WindDir, WindDir> = {
  into: 'helping',
  helping: 'into',
  'left-to-right': 'right-to-left',
  'right-to-left': 'left-to-right',
}

/** Is this setting still worth using? */
export function windIsCurrent(w: WindSetting | null, now: number): w is WindSetting {
  return w !== null && now - w.setAt < WIND_MAX_AGE_MS
}

/** Read a saved setting back, ignoring anything malformed. */
export function parseWindSetting(text: string | null): WindSetting | null {
  if (!text) return null
  try {
    const v = JSON.parse(text) as Partial<WindSetting>
    if (typeof v.setAt !== 'number' || !(v.strength && v.strength in WIND_KMH)) return null
    if (v.fromDeg !== null && typeof v.fromDeg !== 'number') return null
    return { fromDeg: v.fromDeg ?? null, strength: v.strength, setAt: v.setAt }
  } catch {
    return null
  }
}

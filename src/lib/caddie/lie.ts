import type { ClubModel } from './clubModel'

// How the lie and the swing change a shot. These are general golf rules of thumb
// for a right-hander, used as starting values; logged shots (Stage 5) can replace them.

export type Surface = 'fairway' | 'light-rough' | 'hard' | 'bunker'
export type Slope = 'above-feet' | 'below-feet' | 'uphill' | 'downhill'
export type Swing = 'normal' | 'hard'

export interface Lie {
  surface: Surface
  slopes: Slope[]
}

export const PLAIN_LIE: Lie = { surface: 'fairway', slopes: [] }

export const SURFACE_LABEL: Record<Surface, string> = {
  fairway: 'Fairway',
  'light-rough': 'Light rough',
  hard: 'Hard ground',
  bunker: 'Bunker',
}

export const SLOPE_LABEL: Record<Slope, string> = {
  'above-feet': 'Ball above feet',
  'below-feet': 'Ball below feet',
  uphill: 'Uphill',
  downhill: 'Downhill',
}

/** Slopes that can't both be true; picking one clears the other. */
export const OPPOSITE: Record<Slope, Slope> = {
  'above-feet': 'below-feet',
  'below-feet': 'above-feet',
  uphill: 'downhill',
  downhill: 'uphill',
}

interface Effect {
  /** Multiplies carry. */
  carry: number
  /** Multiplies roll after landing. */
  roll: number
  /** Multiplies the long/short spread. */
  depth: number
  /** Multiplies the left/right spread. */
  side: number
  /** Average pull of the shot, degrees: + left, − right (right-hander). */
  pullDeg: number
  /** What to tell you about it. */
  says: string
}

const NONE: Effect = { carry: 1, roll: 1, depth: 1, side: 1, pullDeg: 0, says: '' }

export const SURFACE_EFFECT: Record<Surface, Effect> = {
  fairway: NONE,
  'light-rough': {
    carry: 1,
    roll: 1.3,
    depth: 1.3,
    side: 1.05,
    pullDeg: 0,
    says: 'Light rough: about the same carry, a bit more run, and it can jump now and then.',
  },
  hard: {
    carry: 1,
    roll: 1.4,
    depth: 1.4,
    side: 1.1,
    pullDeg: 0,
    says: 'Hard ground: more run, and a thin or fat one is more likely, so distance is less reliable.',
  },
  bunker: {
    carry: 0.92,
    roll: 1,
    depth: 1.5,
    side: 1.2,
    pullDeg: 0,
    says: 'Fairway bunker: expect it to come out a bit shorter and less reliably. Ball first.',
  },
}

export const SLOPE_EFFECT: Record<Slope, Effect> = {
  'above-feet': {
    carry: 1,
    roll: 1,
    depth: 1,
    side: 1.15,
    pullDeg: 2,
    says: 'Ball above your feet: it tends to go left, so the aim allows for that.',
  },
  'below-feet': {
    carry: 0.97,
    roll: 1,
    depth: 1,
    side: 1.15,
    pullDeg: -2,
    says: 'Ball below your feet: it tends to go right and come up a touch short.',
  },
  uphill: {
    carry: 0.95,
    roll: 0.8,
    depth: 1,
    side: 1,
    pullDeg: 1,
    says: 'Uphill lie: it flies higher and shorter, and can pull left.',
  },
  downhill: {
    carry: 0.98,
    roll: 1.4,
    depth: 1.15,
    side: 1.05,
    pullDeg: -1,
    says: 'Downhill lie: it comes out lower and runs, and can slide right.',
  },
}

export const HARD_SWING: Effect = {
  carry: 1.03,
  roll: 1.05,
  depth: 1.3,
  side: 1.4,
  pullDeg: 0,
  says: 'Swinging hard: a few metres more, but a fair bit wilder.',
}

function effectsOf(lie: Lie, swing: Swing): Effect[] {
  const list = [SURFACE_EFFECT[lie.surface], ...lie.slopes.map((s) => SLOPE_EFFECT[s])]
  if (swing === 'hard') list.push(HARD_SWING)
  return list.filter((e) => e !== NONE)
}

export function isPlain(lie: Lie, swing: Swing = 'normal'): boolean {
  return effectsOf(lie, swing).length === 0
}

/** The club as it plays from this lie with this swing. */
export function adjustModel(m: ClubModel, lie: Lie, swing: Swing = 'normal'): ClubModel {
  const effects = effectsOf(lie, swing)
  if (effects.length === 0) return m
  const k = effects.reduce(
    (a, e) => ({
      carry: a.carry * e.carry,
      roll: a.roll * e.roll,
      depth: a.depth * e.depth,
      side: a.side * e.side,
      pullDeg: a.pullDeg + e.pullDeg,
    }),
    { carry: 1, roll: 1, depth: 1, side: 1, pullDeg: 0 },
  )
  const carry = m.carryM * k.carry
  return {
    ...m,
    carryM: carry,
    rollShare: m.rollShare * k.roll,
    // Roll from a lie is a rule of thumb, not your number.
    rollKnown: m.rollKnown && k.roll === 1,
    depthSdM: m.depthSdM * k.depth,
    leftSdM: m.leftSdM * k.side,
    rightSdM: m.rightSdM * k.side,
    sideBiasM: m.sideBiasM + carry * Math.tan((k.pullDeg * Math.PI) / 180),
  }
}

/** One line per thing that changes the shot, in plain words. */
export function lieNotes(lie: Lie, swing: Swing = 'normal'): string[] {
  return effectsOf(lie, swing).map((e) => e.says)
}

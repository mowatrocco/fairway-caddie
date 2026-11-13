// Rough "strokes still to play" from a spot, for comparing outcomes. These are simple
// starting values for a mid-handicap golfer; they only need to rank outcomes sensibly
// (closer is better, penalties hurt). Real shot data will tune them in a later stage.

/**
 * Strokes to hole out from off the green, `d` metres from the flag. It rises steeply
 * close in (a 10 m chip is much easier than a 30 m pitch) and flattens further out.
 * Roughly: 5 m 2.4, 15 m 2.5, 30 m 2.7, 100 m 3.0, 150 m 3.2, 250 m 3.3.
 */
export function strokesFromOffGreen(d: number): number {
  return 2.2 + 0.32 * Math.log(1 + Math.max(0, d) / 8)
}

/** Strokes to hole out from on the green, `d` metres from the flag (2 m ≈ 1.6, 10 m ≈ 1.85, 20 m ≈ 2.2). */
export function strokesFromOnGreen(d: number): number {
  return 1.5 + 0.035 * Math.min(Math.max(0, d), 25)
}

export const BUNKER_EXTRA = 0.4
export const TROUBLE_EXTRA = 0.6

export type Strategy = 'safe' | 'normal' | 'aggressive'

/**
 * Extra cost per unit of probability, on top of average strokes.
 * Safe hates penalty strokes; Aggressive just plays the averages.
 */
export const STRATEGY_WEIGHTS: Record<Strategy, { penalty: number; bunker: number; trouble: number }> = {
  safe: { penalty: 1.5, bunker: 0.3, trouble: 0.3 },
  normal: { penalty: 1.0, bunker: 0.1, trouble: 0.15 },
  aggressive: { penalty: 0, bunker: 0, trouble: 0 },
}

/**
 * Safe is a firm rule, not just a weighting: only plans with a penalty chance at or
 * under this are considered, if any club and aim manage it.
 */
export const SAFE_MAX_PENALTY = 0.05

export const STRATEGY_LABEL: Record<Strategy, string> = {
  safe: 'Safe',
  normal: 'Normal',
  aggressive: 'Aggressive',
}

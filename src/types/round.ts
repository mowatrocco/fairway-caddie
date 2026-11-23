import type { LngLat } from '../lib/geo/geodesic'

/** Where the tee shot finished on a par 4 or 5. */
export type FairwayResult = 'hit' | 'left' | 'right'

export interface HoleScore {
  hole: number
  /** Total strokes for the hole, penalty strokes included. Null until scored. */
  strokes: number | null
  putts: number | null
  /** Penalty strokes (water, OB, unplayable). Already counted in strokes. */
  penalties: number
  /** Par 4s and 5s only. */
  fairway: FairwayResult | null
}

export interface Round {
  id: string
  courseId: string
  teeId: string
  startedAt: string
  /** Null while the round is being played. */
  finishedAt: string | null
  /** Always 18, hole 1 first. */
  holes: HoleScore[]
  /** Shots you logged on the Caddie screen, in the order you logged them. Putts aren't logged. */
  shots: Shot[]
}

/** A place on the course, and how sure the phone was about it. */
export interface ShotSpot {
  point: LngLat
  /** ± metres from the phone's GPS. Null when you set the spot by hand on the map. */
  accuracyM: number | null
}

/**
 * ok: counts towards club distances.
 * penalty: went in the water, OB or was unplayable.
 * mishit: topped, shanked, duffed. Logged, but kept out of club distances.
 */
export type ShotResult = 'ok' | 'penalty' | 'mishit'

export interface Shot {
  id: string
  hole: number
  clubId: string
  /** Kept so the shot still reads right if the club is renamed or removed later. */
  clubName: string
  /** When you logged it. */
  at: string
  /** Where you hit it from. Null when there was no usable position. */
  from: ShotSpot | null
  /** Where it finished. Null until your next shot on the hole, or until you mark it. */
  to: ShotSpot | null
  /** How the finish was set: from where you hit your next shot, or marked by you. */
  toBy: 'next-shot' | 'marked' | null
  result: ShotResult
}

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
}

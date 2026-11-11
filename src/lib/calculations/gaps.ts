import type { Club } from '../../types'
import { distanceBasis, type DistanceBasisKind } from './clubs'

/** Starting thresholds. A typical iron-to-iron gap is roughly 10–12 m. */
export const BIG_GAP_M = 15
export const TIGHT_GAP_M = 5

export type GapFlag = 'ok' | 'big' | 'tight' | 'reversed' | 'unknown-between'

export interface Gap {
  fromId: string
  toId: string
  /** Longer club's distance minus the next club's, metres. */
  gapM: number
  basis: DistanceBasisKind
  flag: GapFlag
  /** Clubs between these two (in bag order) that have no distance yet. */
  skippedIds: string[]
}

export interface GapReport {
  gaps: Gap[]
  /** Clubs (excluding the putter) with no usable distance. */
  missingIds: string[]
  /** Clubs with a total but no carry: listed so the golfer can add carry. */
  totalOnlyIds: string[]
}

function flagFor(gapM: number, skipped: number): GapFlag {
  if (gapM <= 0) return 'reversed'
  if (skipped > 0) return 'unknown-between'
  if (gapM < TIGHT_GAP_M) return 'tight'
  if (gapM >= BIG_GAP_M) return 'big'
  return 'ok'
}

/**
 * Gaps between neighbouring clubs, in the golfer's bag order (longest club first).
 * Compares carry where known, otherwise unconfirmed rough distances (labelled as such).
 */
export function analyseGaps(bag: Club[]): GapReport {
  const clubs = bag.filter((c) => c.category !== 'putter')
  const gaps: Gap[] = []
  const missingIds: string[] = []
  const totalOnlyIds: string[] = []

  let prev: { club: Club; m: number; kind: DistanceBasisKind } | null = null
  let skipped: string[] = []

  for (const club of clubs) {
    const basis = distanceBasis(club)
    if (basis === null) {
      missingIds.push(club.id)
      if (club.totalM !== null) totalOnlyIds.push(club.id)
      if (prev) skipped.push(club.id)
      continue
    }
    if (prev) {
      const gapM = Math.round((prev.m - basis.m) * 10) / 10
      gaps.push({
        fromId: prev.club.id,
        toId: club.id,
        gapM,
        basis: prev.kind === 'carry' && basis.kind === 'carry' ? 'carry' : 'unconfirmed',
        flag: flagFor(gapM, skipped.length),
        skippedIds: skipped,
      })
    }
    prev = { club, m: basis.m, kind: basis.kind }
    skipped = []
  }

  return { gaps, missingIds, totalOnlyIds }
}

export function gapsNeedingAttention(report: GapReport): Gap[] {
  return report.gaps.filter((g) => g.flag === 'big' || g.flag === 'tight' || g.flag === 'reversed')
}

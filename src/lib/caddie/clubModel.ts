import type { Club, ClubCategory, DistanceConfidence } from '../../types'
import { distanceBasis } from '../calculations/clubs'

// How each club is modelled for the simulation. Your own numbers are used where
// they exist; anything missing uses a stated default and is flagged in the advice.
// These defaults are starting values, to be replaced by your logged shots later.

/** Distance spread (1 standard deviation) as a share of carry, by how sure you are. */
export const DEPTH_SPREAD_SHARE: Record<DistanceConfidence, number> = {
  measured: 0.05,
  rough: 0.07,
  guess: 0.09,
  unknown: 0.1,
}

/** Sideways spread (1 standard deviation) as an angle, by how sure you are. */
export const SIDE_SPREAD_DEG: Record<DistanceConfidence, number> = {
  measured: 4.5,
  rough: 5,
  guess: 6,
  unknown: 6,
}

/** Roll after landing, as a share of carry, when no total distance is recorded. */
export const DEFAULT_ROLL_SHARE: Record<ClubCategory, number> = {
  driver: 0.1,
  wood: 0.08,
  hybrid: 0.07,
  iron: 0.05,
  wedge: 0.02,
  putter: 0,
}

/** How strongly a "usual miss" shifts the average shot, in standard deviations. */
export const MISS_BIAS_SD = 0.3

export interface ClubModel {
  club: Club
  carryM: number
  /** True when the club only has an unconfirmed distance, used here as carry. */
  carryAssumed: boolean
  /** Roll as a share of carry. */
  rollShare: number
  rollKnown: boolean
  depthSdM: number
  /** Sideways spread to the left and right (1 SD), metres. */
  leftSdM: number
  rightSdM: number
  spreadKnown: boolean
  /** Average sideways shift: + left, − right, metres. */
  sideBiasM: number
  /** Average distance shift, metres. */
  depthBiasM: number
}

/**
 * Null if the club can't be used (putter, or no distance at all).
 * A distance not yet marked as carry or total is used as carry, and flagged
 * (carryAssumed) so the advice can say so. A total is never used as carry.
 */
export function modelClub(club: Club): ClubModel | null {
  const basis = distanceBasis(club)
  if (!basis || basis.m <= 0) return null
  const carry = basis.m
  const carryAssumed = basis.kind === 'unconfirmed'
  const rollKnown = !carryAssumed && club.totalM !== null && club.totalM >= carry
  const rollShare = rollKnown ? (club.totalM! - carry) / carry : DEFAULT_ROLL_SHARE[club.category]

  const depthSd = Math.max(4, carry * DEPTH_SPREAD_SHARE[club.confidence])
  const defaultSide = Math.max(4, carry * Math.tan((SIDE_SPREAD_DEG[club.confidence] * Math.PI) / 180))
  // "Spread left/right" in My Bag = how far a normal miss ends up that side: used as 1 SD.
  const leftSd = club.spreadLeftM ?? defaultSide
  const rightSd = club.spreadRightM ?? defaultSide
  const spreadKnown = club.spreadLeftM !== null && club.spreadRightM !== null

  const avgSide = (leftSd + rightSd) / 2
  const sideBias =
    club.missDirection === 'left' ? MISS_BIAS_SD * avgSide : club.missDirection === 'right' ? -MISS_BIAS_SD * avgSide : 0
  const depthBias = club.missDepth === 'short' ? -MISS_BIAS_SD * depthSd : club.missDepth === 'long' ? MISS_BIAS_SD * depthSd : 0

  return {
    club,
    carryM: carry,
    carryAssumed,
    rollShare,
    rollKnown,
    depthSdM: depthSd,
    leftSdM: leftSd,
    rightSdM: rightSd,
    spreadKnown,
    sideBiasM: sideBias,
    depthBiasM: depthBias,
  }
}

export function expectedTotal(m: ClubModel): number {
  return m.carryM * (1 + m.rollShare)
}

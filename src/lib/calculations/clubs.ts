import type { Club } from '../../types'

export const MAX_DISTANCE_M = 400
export const MAX_SPREAD_M = 100

export type DistanceBasisKind = 'carry' | 'unconfirmed'

export interface DistanceBasis {
  m: number
  kind: DistanceBasisKind
}

/**
 * The distance used to compare clubs with each other.
 * Carry if known; otherwise the rough distance, clearly marked as unconfirmed.
 * Total is NEVER used as a stand-in for carry.
 */
export function distanceBasis(club: Club): DistanceBasis | null {
  if (club.category === 'putter') return null
  if (club.carryM !== null) return { m: club.carryM, kind: 'carry' }
  if (club.roughM !== null) return { m: club.roughM, kind: 'unconfirmed' }
  return null
}

/** Move an unconfirmed rough distance into carry or total, once the golfer says which it is. */
export function confirmRough(club: Club, as: 'carry' | 'total'): Club {
  if (club.roughM === null) return club
  return {
    ...club,
    carryM: as === 'carry' ? club.roughM : club.carryM,
    totalM: as === 'total' ? club.roughM : club.totalM,
    roughM: null,
  }
}

export interface ClubCheck {
  errors: string[]
  warnings: string[]
}

function badDistance(v: number | null): boolean {
  return v !== null && (!Number.isFinite(v) || v <= 0 || v > MAX_DISTANCE_M)
}

function badSpread(v: number | null): boolean {
  return v !== null && (!Number.isFinite(v) || v < 0 || v > MAX_SPREAD_M)
}

/** Errors block saving; warnings are shown but allowed. */
export function checkClub(club: Club): ClubCheck {
  const errors: string[] = []
  const warnings: string[] = []

  if (club.name.trim() === '') errors.push('Give the club a name.')
  if (badDistance(club.carryM)) errors.push(`Carry must be between 1 and ${MAX_DISTANCE_M} m.`)
  if (badDistance(club.totalM)) errors.push(`Total must be between 1 and ${MAX_DISTANCE_M} m.`)
  if (badDistance(club.roughM)) errors.push(`Rough distance must be between 1 and ${MAX_DISTANCE_M} m.`)
  if (badSpread(club.spreadLeftM)) errors.push(`Left spread must be between 0 and ${MAX_SPREAD_M} m.`)
  if (badSpread(club.spreadRightM)) errors.push(`Right spread must be between 0 and ${MAX_SPREAD_M} m.`)

  if (club.carryM !== null && club.totalM !== null && club.totalM < club.carryM) {
    warnings.push('Total is shorter than carry. That only happens if the ball spins back.')
  }
  if (club.category !== 'putter' && club.carryM === null && club.roughM === null) {
    warnings.push('No carry distance yet, so the caddie will leave this club out.')
  }
  if (club.roughM !== null) {
    warnings.push('Rough distance not confirmed as carry or total.')
  }
  return { errors, warnings }
}

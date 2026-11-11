import type { TrustLevel } from '../../types/course'

export type AccuracyGrade = 'good' | 'fair' | 'poor'

/** Starting thresholds from the plan; to be tuned with real readings at South Head. */
export const GOOD_M = 5
export const FAIR_M = 10

export function gradeAccuracy(accuracyM: number): AccuracyGrade {
  if (accuracyM <= GOOD_M) return 'good'
  if (accuracyM <= FAIR_M) return 'fair'
  return 'poor'
}

export const GRADE_LABEL: Record<AccuracyGrade, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
}

/** A GPS capture only counts as "verified on course" if the phone's accuracy was fair or better. */
export function trustForCapture(accuracyM: number): TrustLevel {
  return accuracyM <= FAIR_M ? 'verified-on-course' : 'estimated'
}

import type { Units } from '../../types'

/** International yard, exactly. */
export const METRES_PER_YARD = 0.9144

export function metresToYards(m: number): number {
  return m / METRES_PER_YARD
}

export function yardsToMetres(yd: number): number {
  return yd * METRES_PER_YARD
}

/** Convert a stored metre value to the display unit. */
export function toDisplay(m: number, units: Units): number {
  return units === 'yards' ? metresToYards(m) : m
}

/** Convert a value typed in the display unit back to metres (stored to 0.1 m). */
export function fromDisplay(value: number, units: Units): number {
  const m = units === 'yards' ? yardsToMetres(value) : value
  return Math.round(m * 10) / 10
}

/** Whole-number distance for display, e.g. "140". */
export function formatDistance(m: number | null, units: Units): string {
  if (m === null || !Number.isFinite(m)) return '—'
  return String(Math.round(toDisplay(m, units)))
}

export function unitLabel(units: Units): string {
  return units === 'yards' ? 'yd' : 'm'
}

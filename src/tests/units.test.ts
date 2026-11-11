import { describe, expect, it } from 'vitest'
import { formatDistance, fromDisplay, metresToYards, toDisplay, yardsToMetres } from '../lib/calculations/units'

describe('unit conversion', () => {
  it('uses the exact international yard', () => {
    expect(yardsToMetres(100)).toBeCloseTo(91.44, 10)
    expect(metresToYards(91.44)).toBeCloseTo(100, 10)
  })

  it('round-trips metres -> yards -> metres', () => {
    for (const m of [1, 90, 140, 155, 237.5]) {
      expect(yardsToMetres(metresToYards(m))).toBeCloseTo(m, 9)
    }
  })

  it('formats whole numbers in the chosen unit', () => {
    expect(formatDistance(140, 'metres')).toBe('140')
    expect(formatDistance(140, 'yards')).toBe('153') // 153.1 yd
    expect(formatDistance(null, 'metres')).toBe('—')
  })

  it('stores typed yards as metres to 0.1 m', () => {
    expect(fromDisplay(150, 'yards')).toBe(137.2)
    expect(fromDisplay(140, 'metres')).toBe(140)
  })

  it('display conversion leaves metres alone', () => {
    expect(toDisplay(123.4, 'metres')).toBe(123.4)
  })
})

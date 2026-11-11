import { describe, expect, it } from 'vitest'
import { southHead } from '../data/courses/southHead'
import { backNine, checkTeeCard, frontNine } from '../lib/calculations/scorecard'
import type { TeeCard } from '../types/course'

const tee = (id: string) => southHead.tees.find((t) => t.id === id)!

describe('South Head scorecards match the printed cards', () => {
  for (const t of southHead.tees) {
    it(`${t.name}: holes add up to the printed OUT, IN and total, stroke indexes 1–18`, () => {
      expect(checkTeeCard(t)).toEqual([])
    })
  }

  it('Blue is 5751 m, par 72', () => {
    expect(frontNine(tee('blue')).metres + backNine(tee('blue')).metres).toBe(5751)
  })

  it('White is 5419 m, par 72', () => {
    const t = tee('white')
    expect(frontNine(t).par + backNine(t).par).toBe(72)
  })

  it('Yellow is par 73 with its own stroke indexes', () => {
    const y = tee('yellow')
    expect(frontNine(y).par + backNine(y).par).toBe(73)
    expect(y.holes[3].strokeIndex).toBe(17) // hole 4
    expect(tee('white').holes[3].strokeIndex).toBe(13)
  })

  it('is labelled as official club data', () => {
    expect(southHead.source.trust).toBe('official')
  })
})

describe('scorecard checks catch transcription mistakes', () => {
  const white = tee('white')

  it('catches a mistyped hole length', () => {
    const bad: TeeCard = { ...white, holes: white.holes.map((h) => (h.hole === 5 ? { ...h, metres: 456 } : h)) }
    expect(checkTeeCard(bad).join(' ')).toMatch(/front nine adds to 2961 m, card says 2970/)
  })

  it('catches a repeated stroke index', () => {
    const bad: TeeCard = { ...white, holes: white.holes.map((h) => (h.hole === 2 ? { ...h, strokeIndex: 7 } : h)) }
    expect(checkTeeCard(bad).join(' ')).toMatch(/stroke indexes must be 1 to 18/)
  })

  it('catches a wrong par', () => {
    const bad: TeeCard = { ...white, holes: white.holes.map((h) => (h.hole === 17 ? { ...h, par: 4 } : h)) }
    expect(checkTeeCard(bad).join(' ')).toMatch(/back nine par adds to 34, card says 35/)
  })

  it('catches a missing hole', () => {
    const bad: TeeCard = { ...white, holes: white.holes.slice(0, 17) }
    expect(checkTeeCard(bad)[0]).toMatch(/has 17 holes/)
  })
})

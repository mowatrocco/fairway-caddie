import { describe, expect, it } from 'vitest'
import { starterData } from '../data/starterBag'
import { southHead } from '../data/courses/southHead'
import { reducer } from '../state/reducer'
import { createBackup, readBackup } from '../lib/storage/backup'
import { activeRound, emptyHoles, formatToPar, greenInReg, holeProblems, nextHoleToScore, roundTotals, scoreName } from '../lib/rounds/score'
import type { HoleScore, Round } from '../types/round'

const white = southHead.tees.find((t) => t.id === 'white')!
const par = (h: number) => white.holes[h - 1].par

function round(scores: Partial<HoleScore>[]): Round {
  const holes = emptyHoles().map((h, i) => ({ ...h, ...(scores[i] ?? {}) }))
  return { id: 'r1', courseId: 'south-head', teeId: 'white', startedAt: '2026-11-18T01:00:00Z', finishedAt: null, holes }
}

describe('scoring maths', () => {
  it('green in regulation means two putts left for par', () => {
    expect(greenInReg({ hole: 1, strokes: 4, putts: 2, penalties: 0, fairway: null }, 4)).toBe(true)
    expect(greenInReg({ hole: 1, strokes: 5, putts: 2, penalties: 0, fairway: null }, 4)).toBe(false)
    // Holing out from off the green never reached it in regulation.
    expect(greenInReg({ hole: 1, strokes: 3, putts: 0, penalties: 0, fairway: null }, 4)).toBe(false)
    expect(greenInReg({ hole: 1, strokes: 4, putts: null, penalties: 0, fairway: null }, 4)).toBeNull()
  })

  it('adds up a partly played round against par, with putts, fairways and greens', () => {
    const r = round([
      { strokes: par(1) + 1, putts: 2, fairway: par(1) >= 4 ? 'left' : null },
      { strokes: par(2), putts: 2, fairway: par(2) >= 4 ? 'hit' : null },
      { strokes: par(3) + 2, putts: 3, penalties: 1, fairway: par(3) >= 4 ? 'right' : null },
    ])
    const t = roundTotals(r, white)
    expect(t.played).toBe(3)
    expect(t.toPar).toBe(3)
    expect(t.strokes).toBe(par(1) + par(2) + par(3) + 3)
    expect(t.putts).toBe(7)
    expect(t.penalties).toBe(1)
    expect(t.greens).toEqual({ hit: 1, of: 3 })
    expect(t.out.played).toBe(3)
    expect(t.in.played).toBe(0)
    const fairwayHoles = [1, 2, 3].filter((h) => par(h) >= 4).length
    expect(t.fairways.of).toBe(fairwayHoles)
  })

  it('a fairway on a par 3 is ignored', () => {
    const p3 = white.holes.find((h) => h.par === 3)!.hole
    const scores: Partial<HoleScore>[] = []
    scores[p3 - 1] = { strokes: 3, putts: 2, fairway: 'hit' }
    expect(roundTotals(round(scores), white).fairways.of).toBe(0)
  })

  it('says when the numbers on a hole cannot be right', () => {
    expect(holeProblems({ hole: 1, strokes: 3, putts: 3, penalties: 0, fairway: null })).toHaveLength(1)
    expect(holeProblems({ hole: 1, strokes: 5, putts: 2, penalties: 1, fairway: null })).toEqual([])
    expect(holeProblems({ hole: 1, strokes: 1, putts: 0, penalties: 0, fairway: null })).toEqual([])
  })

  it('formats scores the golf way', () => {
    expect(formatToPar(0)).toBe('E')
    expect(formatToPar(3)).toBe('+3')
    expect(formatToPar(-2)).toBe('−2')
    expect(scoreName(3, 4)).toBe('Birdie')
    expect(scoreName(6, 4)).toBe('Double')
    expect(scoreName(1, 3)).toBe('Hole in one')
  })

  it('opens on the first hole without a score', () => {
    expect(nextHoleToScore(round([{ strokes: 4 }, { strokes: 5 }]))).toBe(3)
    expect(nextHoleToScore(round(Array.from({ length: 18 }, () => ({ strokes: 4 }))))).toBe(18)
  })
})

describe('rounds in the saved data', () => {
  const at = '2026-11-18T01:00:00Z'
  it('start, score, finish, carry on and delete', () => {
    let d = reducer(starterData(), { type: 'startRound', id: 'a', courseId: 'south-head', teeId: 'white', at })
    expect(activeRound(d.rounds)?.id).toBe('a')
    d = reducer(d, { type: 'updateHole', roundId: 'a', hole: { hole: 1, strokes: 5, putts: 2, penalties: 0, fairway: 'hit' } })
    expect(d.rounds[0].holes[0].strokes).toBe(5)
    expect(d.rounds[0].holes[1].strokes).toBeNull()
    d = reducer(d, { type: 'finishRound', roundId: 'a', at })
    expect(activeRound(d.rounds)).toBeNull()
    d = reducer(d, { type: 'reopenRound', roundId: 'a', at })
    expect(activeRound(d.rounds)?.id).toBe('a')
    d = reducer(d, { type: 'deleteRound', roundId: 'a' })
    expect(d.rounds).toEqual([])
  })

  it('only one round is ever going: starting another finishes the first', () => {
    let d = reducer(starterData(), { type: 'startRound', id: 'a', courseId: 'south-head', teeId: 'white', at })
    d = reducer(d, { type: 'startRound', id: 'b', courseId: 'south-head', teeId: 'blue', at })
    expect(d.rounds.filter((r) => r.finishedAt === null).map((r) => r.id)).toEqual(['b'])
  })

  it('rounds survive a backup, and older backups without rounds still restore', () => {
    let d = reducer(starterData(), { type: 'startRound', id: 'a', courseId: 'south-head', teeId: 'white', at })
    d = reducer(d, { type: 'updateHole', roundId: 'a', hole: { hole: 7, strokes: 3, putts: 1, penalties: 0, fairway: null } })
    const r = readBackup(JSON.stringify(createBackup(d)))
    expect(r.ok && r.data.rounds[0].holes[6]).toEqual({ hole: 7, strokes: 3, putts: 1, penalties: 0, fairway: null })

    const v2 = createBackup(starterData()) as unknown as { schemaVersion: number; data: Record<string, unknown> }
    v2.schemaVersion = 2
    delete v2.data.rounds
    const old = readBackup(JSON.stringify(v2))
    expect(old.ok && old.data.rounds).toEqual([])
  })

  it('rejects a round with impossible scores', () => {
    const d = reducer(starterData(), { type: 'startRound', id: 'a', courseId: 'south-head', teeId: 'white', at })
    const bad = createBackup(d) as unknown as { data: { rounds: Round[] } }
    bad.data.rounds[0].holes[0].strokes = 0
    expect(readBackup(JSON.stringify(bad)).ok).toBe(false)
  })
})

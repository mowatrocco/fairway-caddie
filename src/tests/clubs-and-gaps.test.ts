import { describe, expect, it } from 'vitest'
import { starterBag } from '../data/starterBag'
import { checkClub, confirmRough, distanceBasis } from '../lib/calculations/clubs'
import { analyseGaps, gapsNeedingAttention } from '../lib/calculations/gaps'
import type { Club } from '../types'

const base = (over: Partial<Club>): Club => ({
  id: over.name ?? 'x',
  name: 'Club',
  category: 'iron',
  carryM: null,
  totalM: null,
  roughM: null,
  shape: 'unknown',
  missDirection: 'unknown',
  missDepth: 'unknown',
  spreadLeftM: null,
  spreadRightM: null,
  confidence: 'unknown',
  source: 'estimate',
  notes: '',
  ...over,
})

describe('carry versus total', () => {
  it('never uses total as a stand-in for carry', () => {
    const c = base({ name: '7i', totalM: 150 })
    expect(distanceBasis(c)).toBeNull()
  })

  it('uses carry when known, ahead of an unconfirmed rough number', () => {
    const c = base({ name: '7i', carryM: 135, roughM: 140 })
    expect(distanceBasis(c)).toEqual({ m: 135, kind: 'carry' })
  })

  it('labels a rough distance as unconfirmed', () => {
    expect(distanceBasis(base({ name: '7i', roughM: 140 }))).toEqual({ m: 140, kind: 'unconfirmed' })
  })

  it('confirming a rough distance moves it to the chosen field only', () => {
    const c = base({ name: '7i', roughM: 140 })
    const asCarry = confirmRough(c, 'carry')
    expect([asCarry.carryM, asCarry.totalM, asCarry.roughM]).toEqual([140, null, null])
    const asTotal = confirmRough(c, 'total')
    expect([asTotal.carryM, asTotal.totalM, asTotal.roughM]).toEqual([null, 140, null])
  })

  it('warns when total is shorter than carry, but allows it', () => {
    const r = checkClub(base({ name: 'LW', carryM: 70, totalM: 66 }))
    expect(r.errors).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/shorter than carry/)
  })

  it('rejects impossible numbers', () => {
    expect(checkClub(base({ name: 'x', carryM: -5 })).errors.length).toBe(1)
    expect(checkClub(base({ name: 'x', carryM: 900 })).errors.length).toBe(1)
    expect(checkClub(base({ name: 'x', spreadLeftM: -1 })).errors.length).toBe(1)
    expect(checkClub(base({ name: ' ' })).errors).toContain('Give the club a name.')
  })

  it('the putter has no distance basis', () => {
    expect(distanceBasis(base({ name: 'P', category: 'putter', carryM: 5 }))).toBeNull()
  })
})

describe('gap analysis on the starter bag', () => {
  const bag = starterBag()
  const byName = (n: string) => bag.find((c) => c.name.includes(n))!.id
  const report = analyseGaps(bag)

  it('finds the 15 m gap between the 5 and 7 iron (no 6 iron)', () => {
    const g = report.gaps.find((x) => x.fromId === byName('5 Iron'))!
    expect(g.toId).toBe(byName('7 Iron'))
    expect(g.gapM).toBe(15)
    expect(g.flag).toBe('big')
  })

  it('treats 10 m steps through the scoring clubs as fine', () => {
    const ok = report.gaps.filter((g) => g.flag === 'ok').map((g) => g.gapM)
    expect(ok).toEqual([10, 10, 10, 10, 10])
  })

  it('labels every starter gap as unconfirmed, because no carry is confirmed yet', () => {
    expect(report.gaps.every((g) => g.basis === 'unconfirmed')).toBe(true)
  })

  it('lists clubs with no distance and ignores the putter', () => {
    const missing = report.missingIds
    expect(missing).toContain(byName('Driver'))
    expect(missing).toContain(byName('58°'))
    expect(missing).not.toContain(byName('Putter'))
    expect(missing.length).toBe(5)
  })

  it('only flags the 5–7 iron gap as needing attention', () => {
    expect(gapsNeedingAttention(report).length).toBe(1)
  })
})

describe('gap flags', () => {
  it('flags a club that goes further than the one above it', () => {
    const r = analyseGaps([base({ name: 'a', carryM: 120 }), base({ name: 'b', carryM: 125 })])
    expect(r.gaps[0].flag).toBe('reversed')
  })

  it('flags clubs too close together', () => {
    const r = analyseGaps([base({ name: 'a', carryM: 120 }), base({ name: 'b', carryM: 117 })])
    expect(r.gaps[0].flag).toBe('tight')
  })

  it("doesn't call a gap big when an unmeasured club sits in between", () => {
    const r = analyseGaps([
      base({ name: 'a', carryM: 160 }),
      base({ name: 'b' }),
      base({ name: 'c', carryM: 140 }),
    ])
    expect(r.gaps[0].flag).toBe('unknown-between')
    expect(r.gaps[0].skippedIds).toEqual(['b'])
  })

  it('reports a carry basis only when both clubs have confirmed carry', () => {
    const r = analyseGaps([base({ name: 'a', carryM: 150 }), base({ name: 'b', carryM: 140 })])
    expect(r.gaps[0].basis).toBe('carry')
  })

  it('lists total-only clubs so carry can be added', () => {
    const r = analyseGaps([base({ name: 'a', totalM: 150 })])
    expect(r.totalOnlyIds).toEqual(['a'])
  })
})

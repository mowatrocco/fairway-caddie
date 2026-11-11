import { describe, expect, it } from 'vitest'
import { blankClub, starterData } from '../data/starterBag'
import { reducer } from '../state/reducer'

describe('bag editing', () => {
  const start = starterData()
  const names = (d: typeof start) => d.bag.map((c) => c.name)

  it('adds a new club just above the putter', () => {
    const next = reducer(start, { type: 'addClub', club: { ...blankClub(), name: '6 Iron' } })
    expect(names(next).slice(-2)).toEqual(['6 Iron', 'Odyssey Putter'])
  })

  it('moves a club up and down, and ignores moves off the ends', () => {
    const id = start.bag[1].id
    const up = reducer(start, { type: 'moveClub', id, dir: -1 })
    expect(up.bag[0].id).toBe(id)
    expect(reducer(up, { type: 'moveClub', id, dir: -1 })).toBe(up)
    const down = reducer(start, { type: 'moveClub', id: start.bag[12].id, dir: 1 })
    expect(down).toBe(start)
  })

  it('deletes a club', () => {
    const next = reducer(start, { type: 'deleteClub', id: start.bag[0].id })
    expect(next.bag.length).toBe(12)
    expect(names(next)).not.toContain('Ping G10 Driver')
  })

  it('confirms all rough distances as carry in one go', () => {
    const next = reducer(start, { type: 'confirmAllRough', as: 'carry' })
    expect(next.bag.every((c) => c.roughM === null)).toBe(true)
    expect(next.bag.find((c) => c.name === 'Ping G25 7 Iron')!.carryM).toBe(140)
    expect(next.bag.find((c) => c.name === 'Ping G25 7 Iron')!.totalM).toBeNull()
  })

  it('updates the profile without touching the bag', () => {
    const next = reducer(start, { type: 'updateProfile', profile: { units: 'yards' } })
    expect(next.profile.units).toBe('yards')
    expect(next.bag).toBe(start.bag)
  })
})

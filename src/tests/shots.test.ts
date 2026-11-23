import { describe, expect, it } from 'vitest'
import geodesic from 'geographiclib-geodesic'
import { starterData } from '../data/starterBag'
import { reducer } from '../state/reducer'
import { createBackup, readBackup } from '../lib/storage/backup'
import { appDataSchema, migrateAppData } from '../lib/storage/schema'
import { addShot, clubLines, countsForDistance, markFinish, openShot, removeShot, shotDistance, shotsOnHole } from '../lib/rounds/shots'
import type { LngLat } from '../lib/geo/geodesic'
import type { Shot, ShotSpot } from '../types/round'

const { Geodesic } = geodesic
const W = Geodesic.WGS84
const TEE: LngLat = [174.317846, -36.560186]
/** A point `m` metres from the tee, heading north-east. */
const along = (m: number): LngLat => {
  const r = W.Direct(TEE[1], TEE[0], 45, m)
  return [r.lon2!, r.lat2!]
}
const gps = (p: LngLat, accuracyM = 4): ShotSpot => ({ point: p, accuracyM })

let n = 0
function shot(hole: number, clubId: string, from: ShotSpot | null, extra: Partial<Shot> = {}): Shot {
  n++
  return { id: `s${n}`, hole, clubId, clubName: clubId, at: '2026-11-24T00:00:00Z', from, to: null, toBy: null, result: 'ok', ...extra }
}

describe('logging shots', () => {
  it("a shot finishes where the next one on the hole is hit from", () => {
    let shots = addShot([], shot(1, 'driver', gps(TEE)))
    expect(openShot(shots, 1)?.clubId).toBe('driver')
    shots = addShot(shots, shot(1, '7i', gps(along(230))))
    const [drive, seven] = shotsOnHole(shots, 1)
    expect(drive.toBy).toBe('next-shot')
    expect(shotDistance(drive)!.m).toBeCloseTo(230, 1)
    expect(seven.to).toBeNull()
    expect(openShot(shots, 1)?.clubId).toBe('7i')
  })

  it('never joins shots on different holes', () => {
    let shots = addShot([], shot(1, 'driver', gps(TEE)))
    shots = addShot(shots, shot(2, 'driver', gps(along(400))))
    expect(shots[0].to).toBeNull()
  })

  it('a penalty shot is not given a finish from the re-hit', () => {
    let shots = addShot([], shot(1, 'driver', gps(TEE), { result: 'penalty' }))
    shots = addShot(shots, shot(1, 'driver', gps(along(1))))
    expect(shots[0].to).toBeNull()
  })

  it('a shot logged with no position leaves the last finish open', () => {
    let shots = addShot([], shot(1, 'driver', gps(TEE)))
    shots = addShot(shots, shot(1, '7i', null))
    expect(shots[0].to).toBeNull()
    expect(shotDistance(shots[1])).toBeNull()
  })

  it('undo puts the last shot back to having no finish, or links it to the next one', () => {
    let shots = addShot([], shot(1, 'driver', gps(TEE)))
    const second = shot(1, '7i', gps(along(230)))
    shots = addShot(shots, second)
    shots = removeShot(shots, second.id)
    expect(shots).toHaveLength(1)
    expect(shots[0].to).toBeNull()

    // Remove a shot from the middle: the one before takes its finish from the one after.
    const a = shot(1, 'driver', gps(TEE))
    const b = shot(1, '5i', gps(along(220)))
    const c = shot(1, 'pw', gps(along(380)))
    let s2 = addShot(addShot(addShot([], a), b), c)
    s2 = removeShot(s2, b.id)
    expect(shotDistance(s2[0])!.m).toBeCloseTo(380, 1)
  })

  it("undo doesn't touch a finish you marked yourself", () => {
    const a = shot(1, 'pw', gps(TEE))
    let shots = markFinish(addShot([], a), a.id, gps(along(90)))
    const b = shot(1, 'sw', gps(along(95)))
    shots = removeShot(addShot(shots, b), b.id)
    expect(shots[0].toBy).toBe('marked')
    expect(shotDistance(shots[0])!.m).toBeCloseTo(90, 1)
  })

  it('rough GPS at either end marks the distance as rough and keeps it out of club numbers', () => {
    let shots = addShot([], shot(1, 'driver', gps(TEE, 25)))
    shots = addShot(shots, shot(1, '7i', gps(along(230))))
    expect(shotDistance(shots[0])!.rough).toBe(true)
    expect(countsForDistance(shots[0])).toBe(false)
    // A spot set by hand on the map counts as good.
    const byHand = addShot(addShot([], shot(1, 'driver', { point: TEE, accuracyM: null })), shot(1, '7i', gps(along(230))))
    expect(countsForDistance(byHand[0])).toBe(true)
  })
})

describe('club lines for the round summary', () => {
  it('averages only shots that count, in bag order', () => {
    const bag = starterData().bag
    const driver = bag.find((c) => c.category === 'driver')!
    const iron = bag.find((c) => c.category === 'iron')!
    const s = [
      shot(1, driver.id, gps(TEE)),
      shot(1, iron.id, gps(along(220))),
      shot(1, iron.id, gps(along(370))), // iron 1: 150 m
      shot(2, driver.id, gps(TEE)),
      shot(2, iron.id, gps(along(240))), // driver 2: 240 m
      shot(3, driver.id, gps(TEE), { result: 'mishit' }),
      shot(3, iron.id, gps(along(100))), // mis-hit: not counted
    ].reduce<Shot[]>(addShot, [])
    const lines = clubLines(s, bag)
    expect(lines.map((l) => l.clubId)).toEqual([driver.id, iron.id])
    const d = lines[0]
    expect(d.shots).toBe(3)
    expect(d.measured).toBe(2)
    expect(d.averageM!).toBeCloseTo(230, 0)
    expect(d.longestM!).toBeCloseTo(240, 0)
    const i = lines[1]
    expect(i.shots).toBe(4)
    expect(i.measured).toBe(1)
    expect(i.averageM!).toBeCloseTo(150, 0)
  })

  it('a club no longer in the bag keeps its name and goes last', () => {
    const bag = starterData().bag
    const lines = clubLines([shot(1, 'gone', gps(TEE), { clubName: 'Old 2 iron' })], bag)
    expect(lines[0].clubName).toBe('Old 2 iron')
  })
})

describe('shots in the saved data', () => {
  const at = '2026-11-24T01:00:00Z'
  it('log, mark, edit and delete through the app state, and survive a backup', () => {
    const start = starterData()
    const driver = start.bag.find((c) => c.category === 'driver')!
    const iron = start.bag.find((c) => c.category === 'iron')!
    let d = reducer(start, { type: 'startRound', id: 'r', courseId: 'south-head', teeId: 'white', at })
    d = reducer(d, { type: 'logShot', roundId: 'r', shot: shot(1, driver.id, gps(TEE), { id: 'a', clubName: driver.name }) })
    d = reducer(d, { type: 'logShot', roundId: 'r', shot: shot(1, iron.id, gps(along(210)), { id: 'b', clubName: iron.name }) })
    d = reducer(d, { type: 'markShotFinish', roundId: 'r', shotId: 'b', spot: gps(along(350)) })
    d = reducer(d, { type: 'editShot', roundId: 'r', shotId: 'b', result: 'mishit' })
    d = reducer(d, { type: 'editShot', roundId: 'r', shotId: 'a', clubId: iron.id })
    expect(d.rounds[0].shots.map((s) => [s.clubName, s.result])).toEqual([
      [iron.name, 'ok'],
      [iron.name, 'mishit'],
    ])
    // Changing to a club that isn't in the bag does nothing.
    expect(reducer(d, { type: 'editShot', roundId: 'r', shotId: 'a', clubId: 'nope' })).toBe(d)

    const back = readBackup(JSON.stringify(createBackup(d)))
    expect(back.ok && back.data.rounds[0].shots).toEqual(d.rounds[0].shots)

    d = reducer(d, { type: 'deleteShot', roundId: 'r', shotId: 'a' })
    expect(d.rounds[0].shots.map((s) => s.id)).toEqual(['b'])
  })

  it('rounds saved before shot logging upgrade with no shots and scores untouched', () => {
    let d = reducer(starterData(), { type: 'startRound', id: 'r', courseId: 'south-head', teeId: 'white', at })
    d = reducer(d, { type: 'updateHole', roundId: 'r', hole: { hole: 3, strokes: 4, putts: 2, penalties: 0, fairway: 'hit' } })
    const v3 = createBackup(d) as unknown as { schemaVersion: number; data: { rounds: Record<string, unknown>[] } }
    v3.schemaVersion = 3
    delete v3.data.rounds[0].shots
    const r = readBackup(JSON.stringify(v3))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.rounds[0].shots).toEqual([])
      expect(r.data.rounds[0].holes[2]).toEqual({ hole: 3, strokes: 4, putts: 2, penalties: 0, fairway: 'hit' })
    }
  })

  it('a v3 round without shots fails the v4 check unless it is upgraded', () => {
    const d = reducer(starterData(), { type: 'startRound', id: 'r', courseId: 'south-head', teeId: 'white', at })
    const raw = JSON.parse(JSON.stringify(d)) as { rounds: Record<string, unknown>[] }
    delete raw.rounds[0].shots
    expect(appDataSchema.safeParse(raw).success).toBe(false)
    expect(appDataSchema.safeParse(migrateAppData(raw, 3)).success).toBe(true)
  })

  it('rejects a shot whose finish has no source', () => {
    let d = reducer(starterData(), { type: 'startRound', id: 'r', courseId: 'south-head', teeId: 'white', at })
    d = reducer(d, { type: 'logShot', roundId: 'r', shot: shot(1, 'x', gps(TEE), { id: 'a', to: gps(along(10)) }) })
    expect(appDataSchema.safeParse(d).success).toBe(false)
  })
})

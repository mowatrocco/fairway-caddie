import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { starterData } from '../data/starterBag'
import { backupToJson, createBackup, readBackup } from '../lib/storage/backup'
import { closeDb, loadAppData, saveAppData } from '../lib/storage/db'
import { SCHEMA_VERSION } from '../types'

describe('backup and restore', () => {
  it('round-trips without losing anything', () => {
    const data = starterData()
    data.bag[5] = { ...data.bag[5], carryM: 138, totalM: 146, roughM: null, notes: 'Holds greens' }
    const json = backupToJson(createBackup(data))
    const result = readBackup(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual(data)
      expect(result.summary).toBe('13 clubs for Rocco, 0 mapped course features')
    }
  })

  it('keeps the wedge chart through a backup, and older backups without one still load', () => {
    const data = starterData()
    const w = data.bag.findIndex((c) => c.category === 'wedge')
    data.bag[w] = { ...data.bag[w], partials: { hip: 40, nine: 60, tenThirty: null } }
    const r = readBackup(backupToJson(createBackup(data)))
    expect(r.ok && r.data.bag[w].partials).toEqual({ hip: 40, nine: 60, tenThirty: null })
    const old = readBackup(backupToJson(createBackup(starterData())))
    expect(old.ok && old.data.bag.every((c) => c.partials === undefined)).toBe(true)
  })

  it('rejects text that is not JSON', () => {
    const r = readBackup('not json')
    expect(r.ok).toBe(false)
  })

  it('rejects JSON from another app', () => {
    const r = readBackup(JSON.stringify({ app: 'athlete-os', schemaVersion: 1, exportedAt: '', data: {} }))
    expect(r).toMatchObject({ ok: false })
  })

  it('rejects backups from a newer app version', () => {
    const b = { ...createBackup(starterData()), schemaVersion: SCHEMA_VERSION + 1 }
    const r = readBackup(JSON.stringify(b))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/newer version/)
  })

  it('rejects a backup with impossible club numbers and says where', () => {
    const b = createBackup(starterData())
    b.data.bag[0] = { ...b.data.bag[0], carryM: -40 }
    const r = readBackup(JSON.stringify(b))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/bag\.0\.carryM/)
  })

  it('rejects a backup where two clubs share an id', () => {
    const b = createBackup(starterData())
    b.data.bag[1] = { ...b.data.bag[1], id: b.data.bag[0].id }
    expect(readBackup(JSON.stringify(b)).ok).toBe(false)
  })
})

describe('on-phone storage', () => {
  beforeEach(async () => {
    await closeDb()
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('fairway-caddie')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })

  it('reports empty on first launch', async () => {
    expect(await loadAppData()).toEqual({ status: 'empty' })
  })

  it('saves and loads the same data', async () => {
    const data = starterData()
    await saveAppData(data)
    const loaded = await loadAppData()
    expect(loaded.status).toBe('ok')
    if (loaded.status === 'ok') expect(loaded.data).toEqual(data)
  })

  it('flags saved data that fails validation instead of using it', async () => {
    const data = starterData()
    data.bag[0] = { ...data.bag[0], carryM: 9999 }
    await saveAppData(data)
    const loaded = await loadAppData()
    expect(loaded.status).toBe('invalid')
  })
})

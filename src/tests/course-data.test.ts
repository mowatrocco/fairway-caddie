import { describe, expect, it } from 'vitest'
import { destination, type LngLat } from '../lib/geo/geodesic'
import { makeFeature, vertices, withVertices } from '../lib/course/features'
import { exportGeoJson, importGeoJson } from '../lib/course/geojson'
import { parseLinzKey } from '../lib/mapping/linzKey'
import { createBackup, readBackup } from '../lib/storage/backup'
import { featureSchema } from '../lib/storage/schema'
import { starterData } from '../data/starterBag'
import { reducer } from '../state/reducer'

const P: LngLat = [174.3178, -36.5602]
const square = (c: LngLat, s: number): LngLat[] => [
  destination(destination(c, 180, s), 270, s),
  destination(destination(c, 180, s), 90, s),
  destination(destination(c, 0, s), 90, s),
  destination(destination(c, 0, s), 270, s),
]

describe('course features', () => {
  it('closes green outlines and passes the schema', () => {
    const g = makeFeature('green', square(P, 12), 3)
    expect(g.geometry.type).toBe('Polygon')
    const ring = g.geometry.type === 'Polygon' ? g.geometry.coordinates[0] : []
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(vertices(g).length).toBe(4)
    expect(g.trust).toBe('traced-from-imagery')
    expect(featureSchema.safeParse(g).success).toBe(true)
  })

  it('refuses an outline with too few corners', () => {
    expect(() => makeFeature('bunker', [P, destination(P, 90, 5)], 1)).toThrow(/at least 3/)
  })

  it('a tee must say which colour it is', () => {
    const t = makeFeature('tee', [P], 1)
    expect(featureSchema.safeParse(t).success).toBe(false)
    expect(featureSchema.safeParse(makeFeature('tee', [P], 1, { teeId: 'white' })).success).toBe(true)
  })

  it('moving a GPS-verified point by hand drops it back to "traced"', () => {
    const verified = { ...makeFeature('tee', [P], 1, { teeId: 'blue' }), trust: 'verified-on-course' as const, gps: { accuracyM: 4, samples: 12, spreadM: 1.2, capturedAt: '' } }
    const moved = withVertices(verified, [destination(P, 0, 2)])
    expect(moved.trust).toBe('traced-from-imagery')
    expect(moved.gps).toBeUndefined()
  })

  it('stores features in the app data via the reducer', () => {
    const start = starterData()
    const next = reducer(start, { type: 'setCourseFeatures', courseId: 'south-head', features: [makeFeature('green', square(P, 10), 1)] })
    expect(next.courseMaps[0].features.length).toBe(1)
  })
})

describe('GeoJSON', () => {
  const features = [
    makeFeature('green', square(P, 12), 1),
    makeFeature('tee', [destination(P, 180, 300)], 1, { teeId: 'white' }),
    makeFeature('out-of-bounds', [destination(P, 270, 40), destination(P, 300, 60)], 1),
  ]
  const map = { courseId: 'south-head', features, updatedAt: '' }

  it('exports and re-imports without losing anything', () => {
    const r = importGeoJson(exportGeoJson(map, 'South Head Golf Club'))
    expect(r.ok).toBe(true)
    expect(r.skipped).toEqual([])
    expect(r.features).toEqual(features)
  })

  it('skips features it can’t trust, and says why', () => {
    const fc = JSON.parse(exportGeoJson(map, 'x'))
    fc.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [174, -36] }, properties: {} })
    fc.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [174, -36] }, properties: { kind: 'green', holes: [2] } })
    const r = importGeoJson(JSON.stringify(fc))
    expect(r.features.length).toBe(3)
    expect(r.skipped.map((s) => s.index)).toEqual([3, 4])
    expect(r.skipped[0].reason).toMatch(/kind/)
    expect(r.skipped[1].reason).toMatch(/does not match/)
  })

  it('marks features from other tools as "estimated" when they carry no trust label', () => {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: P }, properties: { kind: 'tee', holes: [4], teeId: 'blue' } }] }
    const r = importGeoJson(JSON.stringify(fc))
    expect(r.features[0].trust).toBe('estimated')
  })

  it('rejects files that are not GeoJSON', () => {
    expect(importGeoJson('{"type":"Feature"}').ok).toBe(false)
    expect(importGeoJson('nope').ok).toBe(false)
  })
})

describe('backups with course maps', () => {
  it('a version 1 backup (before course maps) still restores', () => {
    const v1 = createBackup(starterData()) as unknown as { schemaVersion: number; data: Record<string, unknown> }
    v1.schemaVersion = 1
    delete v1.data.courseMaps
    const r = readBackup(JSON.stringify(v1))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.courseMaps[0]).toMatchObject({ courseId: 'south-head', features: [] })
  })

  it('course features round-trip through a backup', () => {
    const data = reducer(starterData(), { type: 'setCourseFeatures', courseId: 'south-head', features: [makeFeature('bunker', square(P, 4), 7)] })
    const r = readBackup(JSON.stringify(createBackup(data)))
    expect(r.ok && r.data.courseMaps[0].features.length).toBe(1)
    expect(r.ok && r.summary).toMatch(/1 mapped course feature$/)
  })
})

describe('LINZ key', () => {
  it('accepts a bare key', () => {
    expect(parseLinzKey('  c01abcdefghijklmnopqrstu  ')).toEqual({ ok: true, key: 'c01abcdefghijklmnopqrstu' })
  })
  it('pulls the key out of a pasted map address', () => {
    const r = parseLinzKey('https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=c01xyzABC123def456')
    expect(r).toEqual({ ok: true, key: 'c01xyzABC123def456' })
  })
  it('rejects junk with a helpful message', () => {
    const r = parseLinzKey('hello there')
    expect(r.ok).toBe(false)
  })
})

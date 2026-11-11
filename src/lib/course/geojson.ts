import type { CourseFeature, CourseMap } from '../../types/courseMap'
import { featureSchema } from '../storage/schema'
import { SCHEMA_VERSION } from '../../types'
import { newId } from '../id'

// Standard GeoJSON, so the course can be opened in other mapping tools (QGIS, geojson.io).
// Our extra details (kind, holes, trust…) ride along in each feature's properties.

export function exportGeoJson(map: CourseMap, courseName: string, now = new Date()): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: courseName,
      fairwayCaddie: { courseId: map.courseId, schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString() },
      features: map.features.map((f) => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: {
          kind: f.kind,
          holes: f.holes,
          ...(f.teeId ? { teeId: f.teeId } : {}),
          trust: f.trust,
          source: f.source,
          updatedAt: f.updatedAt,
          ...(f.gps ? { gps: f.gps } : {}),
          notes: f.notes,
        },
      })),
    },
    null,
    2,
  )
}

export function geoJsonFileName(courseId: string, now = new Date()): string {
  return `${courseId}-course-map-${now.toISOString().slice(0, 10)}.geojson`
}

export interface ImportResult {
  ok: boolean
  features: CourseFeature[]
  skipped: { index: number; reason: string }[]
  error?: string
}

/** Read GeoJSON. Features that fail checks are skipped and listed, never silently changed. */
export function importGeoJson(text: string, now = new Date()): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, features: [], skipped: [], error: "This file isn't valid JSON." }
  }
  const fc = raw as { type?: unknown; features?: unknown }
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return { ok: false, features: [], skipped: [], error: "This file isn't a GeoJSON FeatureCollection." }
  }

  const features: CourseFeature[] = []
  const skipped: ImportResult['skipped'] = []
  const seen = new Set<string>()

  fc.features.forEach((item: unknown, index: number) => {
    const f = item as { id?: unknown; geometry?: unknown; properties?: Record<string, unknown> | null }
    const p = f?.properties ?? {}
    if (typeof p.kind !== 'string') {
      skipped.push({ index, reason: 'No "kind" property (tee, green, bunker…).' })
      return
    }
    let id = typeof f.id === 'string' && f.id ? f.id : newId()
    if (seen.has(id)) id = newId()
    seen.add(id)

    const candidate = {
      id,
      kind: p.kind,
      holes: p.holes,
      teeId: p.teeId,
      geometry: f.geometry,
      // Anything arriving without a trust label is treated as the least trusted.
      trust: p.trust ?? 'estimated',
      source: typeof p.source === 'string' ? p.source : 'Imported from GeoJSON',
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now.toISOString(),
      gps: p.gps,
      notes: typeof p.notes === 'string' ? p.notes : '',
    }
    const parsed = featureSchema.safeParse(candidate)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      skipped.push({ index, reason: `${issue.path.join('.') || 'feature'}: ${issue.message}` })
      return
    }
    features.push(parsed.data as CourseFeature)
  })

  return { ok: true, features, skipped }
}

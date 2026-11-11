import { z } from 'zod'
import { MAX_DISTANCE_M, MAX_SPREAD_M } from '../calculations/clubs'
import { KINDS } from '../course/features'
import { SCHEMA_VERSION, type AppData } from '../../types'
import type { FeatureKind } from '../../types/courseMap'

const distance = z.number().positive().max(MAX_DISTANCE_M).nullable()
const spread = z.number().min(0).max(MAX_SPREAD_M).nullable()

export const clubSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  category: z.enum(['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter']),
  carryM: distance,
  totalM: distance,
  roughM: distance,
  shape: z.enum(['unknown', 'straight', 'draw', 'fade', 'hook', 'slice', 'varies']),
  missDirection: z.enum(['unknown', 'left', 'right', 'either']),
  missDepth: z.enum(['unknown', 'short', 'long', 'either']),
  spreadLeftM: spread,
  spreadRightM: spread,
  confidence: z.enum(['unknown', 'guess', 'rough', 'measured']),
  source: z.enum(['estimate', 'rangefinder', 'launch-monitor', 'logged-shots']),
  notes: z.string().max(1000),
})

export const profileSchema = z.object({
  name: z.string().max(60),
  handicap: z.number().min(-10).max(54).nullable(),
  homeCourse: z.string().max(100),
  usualTees: z.string().max(40),
  units: z.enum(['metres', 'yards']),
})

// ---------- Course geometry ----------

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: lngLat }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(lngLat).min(2).max(500) }),
  z.object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(z.array(lngLat).min(4).max(500))
      .length(1, { message: 'Outlines must be a single ring with no holes.' })
      .refine(
        (rings) => {
          const r = rings[0]
          return r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
        },
        { message: 'Outline must finish where it starts.' },
      ),
  }),
])

const kindValues = Object.keys(KINDS) as [FeatureKind, ...FeatureKind[]]

export const featureSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(kindValues),
    holes: z.array(z.number().int().min(1).max(18)).min(1).max(18),
    teeId: z.string().max(20).optional(),
    geometry: geometrySchema,
    trust: z.enum(['official', 'verified-on-course', 'traced-from-imagery', 'estimated']),
    source: z.string().max(200),
    updatedAt: z.string(),
    gps: z
      .object({
        accuracyM: z.number().min(0).max(10000),
        samples: z.number().int().min(1),
        spreadM: z.number().min(0),
        capturedAt: z.string(),
      })
      .optional(),
    notes: z.string().max(1000),
  })
  .refine((f) => f.geometry.type === KINDS[f.kind].shape, {
    message: 'Shape type does not match the feature kind.',
  })
  .refine((f) => f.kind !== 'tee' || (typeof f.teeId === 'string' && f.teeId.length > 0), {
    message: 'A tee needs a tee colour.',
  })

export const courseMapSchema = z.object({
  courseId: z.string().min(1),
  features: z.array(featureSchema).max(2000),
  updatedAt: z.string(),
})

export const appDataSchema = z
  .object({
    profile: profileSchema,
    bag: z.array(clubSchema).max(30),
    courseMaps: z.array(courseMapSchema).max(20),
  })
  .refine((d) => new Set(d.bag.map((c) => c.id)).size === d.bag.length, {
    message: 'Two clubs share the same id.',
  })

export const backupSchema = z.object({
  app: z.literal('fairway-caddie'),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  data: z.unknown(),
})

/**
 * Bring data saved by an older version up to date before it is checked.
 * v1 → v2: course maps added (empty South Head map).
 */
export function migrateAppData(raw: unknown, fromVersion: number): unknown {
  let data = raw
  if (fromVersion < 2 && data && typeof data === 'object' && !('courseMaps' in data)) {
    data = {
      ...(data as object),
      courseMaps: [{ courseId: 'south-head', features: [], updatedAt: new Date(0).toISOString() }],
    }
  }
  return data
}

export function parseAppData(value: unknown): AppData {
  return appDataSchema.parse(value) as AppData
}

export { SCHEMA_VERSION }

import { z } from 'zod'
import { MAX_DISTANCE_M, MAX_SPREAD_M } from '../calculations/clubs'
import { SCHEMA_VERSION, type AppData } from '../../types'

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

export const appDataSchema = z
  .object({
    profile: profileSchema,
    bag: z.array(clubSchema).max(30),
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

export function parseAppData(value: unknown): AppData {
  return appDataSchema.parse(value) as AppData
}

export { SCHEMA_VERSION }

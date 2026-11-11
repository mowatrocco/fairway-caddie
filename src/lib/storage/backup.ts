import type { AppData } from '../../types'
import { appDataSchema, backupSchema, SCHEMA_VERSION } from './schema'

export interface BackupFile {
  app: 'fairway-caddie'
  schemaVersion: number
  exportedAt: string
  data: AppData
}

export function createBackup(data: AppData, now: Date = new Date()): BackupFile {
  return { app: 'fairway-caddie', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), data }
}

export function backupToJson(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

export function backupFileName(now: Date = new Date()): string {
  const d = now.toISOString().slice(0, 10)
  return `fairway-caddie-backup-${d}.json`
}

export type RestoreResult =
  | { ok: true; data: AppData; exportedAt: string; summary: string }
  | { ok: false; error: string }

/** Check a backup file fully before anything is replaced. */
export function readBackup(text: string): RestoreResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: "This file isn't valid JSON. Choose a Fairway Caddie backup file." }
  }

  const envelope = backupSchema.safeParse(raw)
  if (!envelope.success) {
    return { ok: false, error: "This file isn't a Fairway Caddie backup." }
  }
  if (envelope.data.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: 'This backup was made by a newer version of the app. Update the app, then restore.',
    }
  }

  const parsed = appDataSchema.safeParse(envelope.data.data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? ` (at ${issue.path.join('.')})` : ''
    return { ok: false, error: `The backup has a problem${where}: ${issue?.message ?? 'invalid data'}.` }
  }

  const data = parsed.data as AppData
  const summary = `${data.bag.length} clubs${data.profile.name ? ` for ${data.profile.name}` : ''}`
  return { ok: true, data, exportedAt: envelope.data.exportedAt, summary }
}

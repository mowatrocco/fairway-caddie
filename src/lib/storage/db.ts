import { openDB, type IDBPDatabase } from 'idb'
import type { AppData } from '../../types'
import { appDataSchema, migrateAppData, SCHEMA_VERSION } from './schema'

// Everything is kept on the phone in IndexedDB. Nothing is sent anywhere.

const DB_NAME = 'fairway-caddie'
const DB_VERSION = 1
const STORE = 'kv'
const KEY = 'appData'

interface StoredRecord {
  schemaVersion: number
  savedAt: string
  data: AppData
}

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
      },
    })
  }
  return dbPromise
}

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: AppData; savedAt: string }
  | { status: 'invalid'; reason: string }

export async function loadAppData(): Promise<LoadResult> {
  const record = (await (await db()).get(STORE, KEY)) as StoredRecord | undefined
  if (!record) return { status: 'empty' }
  const parsed = appDataSchema.safeParse(migrateAppData(record.data, record.schemaVersion ?? 1))
  if (!parsed.success) {
    return { status: 'invalid', reason: parsed.error.issues[0]?.message ?? 'Saved data is not valid.' }
  }
  return { status: 'ok', data: parsed.data as AppData, savedAt: record.savedAt }
}

export async function saveAppData(data: AppData): Promise<string> {
  const savedAt = new Date().toISOString()
  const record: StoredRecord = { schemaVersion: SCHEMA_VERSION, savedAt, data }
  await (await db()).put(STORE, record, KEY)
  return savedAt
}

/** Small device-only settings (like the map key). Not part of backups. */
export async function getDeviceSetting(name: string): Promise<string | null> {
  const v = await (await db()).get(STORE, `setting:${name}`)
  return typeof v === 'string' ? v : null
}

export async function setDeviceSetting(name: string, value: string | null): Promise<void> {
  const database = await db()
  if (value === null) await database.delete(STORE, `setting:${name}`)
  else await database.put(STORE, value, `setting:${name}`)
}

/** Keep a copy of unreadable data before anything overwrites it. */
export async function quarantineInvalid(): Promise<void> {
  const database = await db()
  const record = await database.get(STORE, KEY)
  if (record) await database.put(STORE, record, `${KEY}-unreadable-${Date.now()}`)
}

/** Ask the browser not to clear our storage under pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

/** Close and forget the cached connection (used by tests and before deleting the database). */
export async function closeDb(): Promise<void> {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
}

import { linzAerialTileUrl } from './linzKey'
import { tileCacheKey, type Tile } from './tiles'

// Aerial photos are kept on the phone (Cache Storage) under key-free names, so:
//  - anything you've already looked at works with no signal,
//  - "Save course for offline" can fetch the whole course ahead of a round,
//  - a renewed LINZ key still finds the saved photos.

export const TILE_CACHE = 'linz-aerial-v1'

/** Standard LINZ keys allow 1,000 tiles a minute; stay well under it. */
export const DOWNLOAD_TILES_PER_MINUTE = 300

let currentKey: string | null = null
export function setTileKey(key: string | null) {
  currentKey = key
}

function hasCaches(): boolean {
  return typeof caches !== 'undefined'
}

export class TileError extends Error {
  status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
  }
}

/** One aerial tile: from the phone if saved, otherwise from LINZ (and then saved). */
export async function getTile(t: Tile, signal?: AbortSignal): Promise<ArrayBuffer> {
  const cacheKey = tileCacheKey(t)
  if (hasCaches()) {
    const hit = await (await caches.open(TILE_CACHE)).match(cacheKey)
    if (hit) return hit.arrayBuffer()
  }
  if (!currentKey) throw new TileError('No map key', 401)
  const url = linzAerialTileUrl(currentKey).replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
  const res = await fetch(url, { signal, mode: 'cors' })
  if (!res.ok) throw new TileError(`Tile ${t.z}/${t.x}/${t.y}: ${res.status}`, res.status)
  if (hasCaches()) {
    try {
      await (await caches.open(TILE_CACHE)).put(cacheKey, res.clone())
    } catch {
      // Storage full: still show the tile, just don't keep it.
    }
  }
  return res.arrayBuffer()
}

export async function isTileSaved(t: Tile): Promise<boolean> {
  if (!hasCaches()) return false
  return Boolean(await (await caches.open(TILE_CACHE)).match(tileCacheKey(t)))
}

export async function countSavedTiles(): Promise<number> {
  if (!hasCaches()) return 0
  return (await (await caches.open(TILE_CACHE)).keys()).length
}

export async function deleteSavedTiles(): Promise<void> {
  if (hasCaches()) await caches.delete(TILE_CACHE)
}

export interface DownloadProgress {
  done: number
  total: number
  failed: number
}

/**
 * Save tiles for offline use, a few at a time and under LINZ's rate limit.
 * Tiles already on the phone are skipped. Stops early if `signal` aborts.
 */
export async function downloadTiles(
  tiles: Tile[],
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
  perMinute = DOWNLOAD_TILES_PER_MINUTE,
): Promise<DownloadProgress> {
  const gapMs = 60_000 / perMinute
  const progress: DownloadProgress = { done: 0, total: tiles.length, failed: 0 }
  let next = 0
  let lastStart = 0

  const worker = async () => {
    while (next < tiles.length && !signal?.aborted) {
      const t = tiles[next++]
      if (await isTileSaved(t)) {
        progress.done++
        onProgress({ ...progress })
        continue
      }
      const wait = lastStart + gapMs - Date.now()
      lastStart = Math.max(Date.now(), lastStart + gapMs)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      try {
        await getTile(t, signal)
      } catch {
        if (signal?.aborted) break
        progress.failed++
      }
      progress.done++
      onProgress({ ...progress })
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return progress
}

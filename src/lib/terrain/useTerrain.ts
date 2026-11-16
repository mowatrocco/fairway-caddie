import { useEffect, useState } from 'react'
import type { LngLat } from '../geo/geodesic'
import type { Tile } from '../mapping/tiles'
import { ELEVATION, getTile, setTileKey } from '../mapping/tileStore'
import { getDeviceSetting } from '../storage/db'
import { heightsFromRgba, terrainTilesFor, TerrainGrid, tileLooksValid, type HeightAt } from './terrain'

// Loads ground heights around the shot (from the phone if saved, else from LINZ) and
// keeps them in memory so the caddie engine can look them up instantly.

const grid = new TerrainGrid()
const bad = new Set<string>()
const pending = new Map<string, Promise<boolean>>()
const k = (t: Tile) => `${t.z}/${t.x}/${t.y}`

async function decode(buf: ArrayBuffer): Promise<Float32Array> {
  // Colour management must be off, or the heights come out wrong.
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('No canvas')
  ctx.drawImage(bmp, 0, 0)
  return heightsFromRgba(ctx.getImageData(0, 0, 256, 256).data)
}

function load(t: Tile): Promise<boolean> {
  const id = k(t)
  if (grid.has(t)) return Promise.resolve(true)
  if (bad.has(id)) return Promise.resolve(false)
  let p = pending.get(id)
  if (!p) {
    p = getTile(t, undefined, ELEVATION)
      .then(decode)
      .then((h) => {
        if (!tileLooksValid(h)) {
          bad.add(id)
          return false
        }
        grid.add(t, h)
        return true
      })
      .catch(() => false) // offline, no key, or no data here: try again next time
      .finally(() => pending.delete(id))
    pending.set(id, p)
  }
  return p
}

let keyRead: Promise<void> | null = null
function readKey(): Promise<void> {
  keyRead ??= getDeviceSetting('linzKey').then(
    (key) => {
      if (key) setTileKey(key)
    },
    () => {},
  )
  return keyRead
}

export interface TerrainState {
  /** Height lookup, or null when the heights around this shot aren't all available. */
  heightAt: HeightAt | null
  /** Changes whenever more heights arrive, so advice can rework. */
  version: number
}

/** Ground heights covering `points` (you and the green), with a margin for misses. */
export function useTerrain(points: LngLat[] | null): TerrainState {
  const tiles = points && points.length > 0 ? terrainTilesFor(points, 80) : []
  const sig = tiles.map(k).join(',')
  const [state, setState] = useState<{ sig: string; ready: boolean; version: number }>({ sig: '', ready: false, version: 0 })

  useEffect(() => {
    if (!sig) return
    let alive = true
    const list = sig.split(',').map((s) => {
      const [z, x, y] = s.split('/').map(Number)
      return { z, x, y }
    })
    readKey()
      .then(() => Promise.all(list.map(load)))
      .then((ok) => {
        if (alive) setState((s) => ({ sig, ready: ok.every(Boolean), version: s.version + 1 }))
      })
    return () => {
      alive = false
    }
  }, [sig])

  const ready = state.sig === sig && state.ready
  return { heightAt: ready ? grid.heightAt : null, version: state.version }
}

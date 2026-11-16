import { useEffect, useRef, useState } from 'react'
import type { CourseFeature } from '../types/courseMap'
import { ringOf, vertices } from '../lib/course/features'
import { courseTiles } from '../lib/mapping/tiles'
import {
  countSavedTiles,
  deleteSavedTiles,
  downloadTiles,
  DOWNLOAD_TILES_PER_MINUTE,
  ELEVATION,
  setTileKey,
  type DownloadProgress,
} from '../lib/mapping/tileStore'
import { terrainTilesFor } from '../lib/terrain/terrain'
import { getDeviceSetting } from '../lib/storage/db'

interface Props {
  features: CourseFeature[]
}

/** Settings section: save the course's aerial photos on the phone for rounds with no signal. */
export function OfflinePhotos({ features }: Props) {
  const [saved, setSaved] = useState<number | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [usedMB, setUsedMB] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)

  const greens = features.filter((f) => f.kind === 'green').map((f) => ringOf(f)!).filter(Boolean)
  const tiles = courseTiles(features.flatMap(vertices), greens)
  const heightTiles = terrainTilesFor(features.flatMap(vertices), 150)
  const minutes = Math.max(1, Math.ceil((tiles.length + heightTiles.length) / DOWNLOAD_TILES_PER_MINUTE))
  const [savedHeights, setSavedHeights] = useState<number | null>(null)

  const refresh = async () => {
    setSaved(await countSavedTiles())
    setSavedHeights(await countSavedTiles(ELEVATION))
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate()
      setUsedMB(e.usage ? e.usage / 1_000_000 : null)
    }
  }

  useEffect(() => {
    let alive = true
    countSavedTiles().then((n) => alive && setSaved(n))
    countSavedTiles(ELEVATION).then((n) => alive && setSavedHeights(n))
    navigator.storage?.estimate?.().then((e) => alive && setUsedMB(e.usage ? e.usage / 1_000_000 : null))
    return () => {
      alive = false
      abort.current?.abort()
    }
  }, [])

  const start = async () => {
    const key = await getDeviceSetting('linzKey')
    if (!key) return setMsg('Add your LINZ map key first.')
    setTileKey(key)
    setMsg(null)
    abort.current = new AbortController()
    const photos = await downloadTiles(tiles, setProgress, abort.current.signal)
    const heights = abort.current.signal.aborted
      ? { done: 0, total: 0, failed: 0 }
      : await downloadTiles(heightTiles, setProgress, abort.current.signal, undefined, ELEVATION)
    const result = { failed: photos.failed + heights.failed }
    const stopped = abort.current.signal.aborted
    abort.current = null
    setProgress(null)
    await refresh()
    setMsg(
      stopped
        ? 'Stopped. What was saved stays saved.'
        : result.failed > 0
          ? `Saved, but ${result.failed} pieces didn't download. Run it again with a better signal to fill the gaps.`
          : 'Course photos and ground heights saved. The map and slope work with no signal.',
    )
  }

  return (
    <>
      <h3 className="group-title">Photos and heights for offline</h3>
      <p className="quiet">
        {features.length === 0
          ? 'Trace some of the course first; the download covers the area you have mapped.'
          : `Covers your mapped area: ${tiles.length} photo tiles and ${heightTiles.length} ground-height tiles, about ${minutes} minute${minutes === 1 ? '' : 's'} on Wi-Fi.`}{' '}
        {saved !== null &&
          `${saved} photo and ${savedHeights ?? 0} height tiles saved on this phone${usedMB !== null ? ` (app storage in use: ${usedMB.toFixed(1)} MB)` : ''}.`}
      </p>
      {progress ? (
        <div className="download" aria-live="polite">
          <div className="meter-bar" aria-hidden="true">
            <span className="meter-fill" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <p className="field-hint">
            {progress.done} of {progress.total}
            {progress.failed > 0 && `, ${progress.failed} failed`}
          </p>
          <button className="btn btn-ghost" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        </div>
      ) : (
        <div className="btn-row">
          <button className="btn" disabled={features.length === 0} onClick={start}>
            Save course photos and heights
          </button>
          <button
            className="btn btn-ghost btn-danger-text"
            disabled={!saved}
            onClick={async () => {
              await deleteSavedTiles()
              await deleteSavedTiles(ELEVATION)
              await refresh()
              setMsg('Saved photos and heights deleted.')
            }}
          >
            Delete saved photos
          </button>
        </div>
      )}
      {msg && (
        <p className="field-hint" aria-live="polite">
          {msg}
        </p>
      )}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { AppData } from '../types'
import type { Action } from '../state/reducer'
import { southHead } from '../data/courses/southHead'
import { exportGeoJson, geoJsonFileName, importGeoJson, type ImportResult } from '../lib/course/geojson'
import { getDeviceSetting, setDeviceSetting } from '../lib/storage/db'
import { shareOrDownload } from '../lib/storage/share'
import { MapKeyForm } from './MapKeyForm'

interface Props {
  data: AppData
  dispatch: (a: Action) => void
}

/** Settings section: map key, and course map export/import as GeoJSON. */
export function CourseMapTools({ data, dispatch }: Props) {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [keyMsg, setKeyMsg] = useState<string | null>(null)
  const [pending, setPending] = useState<ImportResult | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const map = data.courseMaps.find((m) => m.courseId === southHead.id)
  const count = map?.features.length ?? 0

  useEffect(() => {
    getDeviceSetting('linzKey').then(
      (k) => setHasKey(Boolean(k)),
      () => setHasKey(false),
    )
  }, [])

  return (
    <>
      <h3 className="group-title">Course map</h3>
      <p className="quiet">
        {count} mapped feature{count === 1 ? '' : 's'} at South Head. Aerial photos:{' '}
        {hasKey === null ? '…' : hasKey ? 'map key saved' : 'no map key yet'}.
      </p>
      {hasKey !== null && (
        <MapKeyForm
          hasKey={hasKey}
          onSave={async (k) => {
            await setDeviceSetting('linzKey', k)
            setHasKey(true)
            setKeyMsg('Map key saved.')
          }}
          onRemove={async () => {
            await setDeviceSetting('linzKey', null)
            setHasKey(false)
            setKeyMsg('Map key removed.')
          }}
        />
      )}
      {keyMsg && (
        <p className="field-hint" aria-live="polite">
          {keyMsg}
        </p>
      )}

      <div className="btn-row">
        <button
          className="btn"
          disabled={!map || count === 0}
          onClick={async () => {
            if (!map) return
            const r = await shareOrDownload(exportGeoJson(map, southHead.name), geoJsonFileName(map.courseId), 'application/geo+json')
            setMsg(r === 'cancelled' ? 'Export cancelled.' : 'Course map exported as GeoJSON.')
          }}
        >
          Export course map
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import course map
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        className="visually-hidden"
        aria-label="Course map file"
        data-testid="geojson-input"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (fileRef.current) fileRef.current.value = ''
          setMsg(null)
          if (file) setPending(importGeoJson(await file.text()))
        }}
      />
      {msg && (
        <p className="field-hint" aria-live="polite">
          {msg}
        </p>
      )}
      {pending && !pending.ok && (
        <p className="msg msg-error" role="alert">
          {pending.error}
        </p>
      )}
      {pending && pending.ok && (
        <div className="callout" role="group" aria-label="Confirm course map import">
          <p>
            {pending.features.length} feature{pending.features.length === 1 ? '' : 's'} ready to import
            {pending.skipped.length > 0 && `, ${pending.skipped.length} skipped`}. Importing replaces the {count} on this
            phone.
          </p>
          {pending.skipped.length > 0 && (
            <ul className="msg msg-warn">
              {pending.skipped.slice(0, 5).map((s) => (
                <li key={s.index}>
                  Feature {s.index + 1}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={pending.features.length === 0}
              onClick={() => {
                dispatch({ type: 'setCourseFeatures', courseId: southHead.id, features: pending.features })
                setMsg(`Imported ${pending.features.length} features.`)
                setPending(null)
              }}
            >
              Replace course map
            </button>
          </div>
        </div>
      )}
    </>
  )
}

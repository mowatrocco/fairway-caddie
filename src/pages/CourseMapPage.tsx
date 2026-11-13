import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppData } from '../types'
import type { Action } from '../state/reducer'
import type { CourseFeature, FeatureKind } from '../types/courseMap'
import type { LngLat } from '../lib/geo/geodesic'
import { bearingDeg, distanceM, pathLengthM } from '../lib/geo/geodesic'
import { describeOutline } from '../lib/geo/green'
import { southHead } from '../data/courses/southHead'
import {
  findTee,
  KINDS,
  makeFeature,
  pointOf,
  ringOf,
  TRUST_LABEL,
  vertices,
  withVertices,
} from '../lib/course/features'
import { checkHole, greenMiddle, type HoleReport } from '../lib/course/holeChecks'
import { appliesToHole, hazardHoles, isHazard, type HoleReach } from '../lib/course/autoHoles'
import { createMap, holePoints, TEE_COLOURS, type MapAdapter } from '../lib/mapping/mapAdapter'
import { getDeviceSetting, setDeviceSetting } from '../lib/storage/db'
import { useGpsCapture, CAPTURE_MIN_FIXES, CAPTURE_SECONDS } from '../lib/gps/useGpsCapture'
import { gradeAccuracy, GRADE_LABEL, trustForCapture } from '../lib/gps/accuracy'
import { formatDistance, unitLabel } from '../lib/calculations/units'
import { MapKeyForm } from '../components/MapKeyForm'
import { Sheet } from '../components/Sheet'
import { CloseIcon, DownIcon, UpIcon } from '../components/Icons'

interface Props {
  data: AppData
  dispatch: (a: Action) => void
  onClose: () => void
}

const COURSE = southHead
const DRAW_KINDS: FeatureKind[] = ['tee', 'green', 'bunker', 'water', 'out-of-bounds', 'fairway', 'line-of-play', 'trouble']
/** Kinds with only one per hole (per tee colour for tees): drawing a new one replaces the old. */
const SINGLE_PER_HOLE: FeatureKind[] = ['tee', 'green', 'line-of-play', 'green-middle']

type CaptureTarget = { kind: 'tee'; teeId: string } | { kind: 'green-middle' } | { existingId: string }

type Mode =
  | { type: 'browse' }
  | { type: 'pick-tee'; then: 'draw' | 'capture' }
  | { type: 'draw'; kind: FeatureKind; teeId?: string; points: LngLat[] }
  | { type: 'edit'; id: string; points: LngLat[]; active: number }
  | { type: 'capture'; target: CaptureTarget }

const STATUS_LABEL: Record<HoleReport['status'], string> = {
  'not-started': 'Not started',
  'needs-work': 'Needs work',
  check: 'Check',
  ready: 'Ready',
}

declare global {
  interface Window {
    __fairwayMap?: MapAdapter
  }
}

export default function CourseMapPage({ data, dispatch, onClose }: Props) {
  const units = data.profile.units
  const u = unitLabel(units)
  const d = (m: number) => `${formatDistance(m, units)} ${u}`
  const features = useMemo(
    () => data.courseMaps.find((m) => m.courseId === COURSE.id)?.features ?? [],
    [data.courseMaps],
  )

  const [hole, setHole] = useState(1)
  const [mode, setMode] = useState<Mode>({ type: 'browse' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [undoStack, setUndoStack] = useState<CourseFeature[][]>([])
  const [crosshair, setCrosshair] = useState<LngLat | null>(null)
  const [mapKey, setMapKey] = useState<string | null | undefined>(undefined)
  const [imageryError, setImageryError] = useState<string | null>(null)
  const [showHoles, setShowHoles] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const mapEl = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<MapAdapter | null>(null)
  const capture = useGpsCapture()

  const usualTee = COURSE.tees.find((t) => t.id === data.profile.usualTees) ?? COURSE.tees[0]
  const card = usualTee.holes.find((h) => h.hole === hole)!
  const report = useMemo(() => checkHole(features, hole, COURSE), [features, hole])
  const selected = features.find((f) => f.id === selectedId) ?? null
  // Which holes each hazard counts for, worked out from where it sits.
  const autoHoles = useMemo(() => hazardHoles(features, [COURSE.mapStart.lng, COURSE.mapStart.lat]), [features])
  const hereIds = useMemo(
    () => new Set(features.filter((f) => appliesToHole(f, hole, autoHoles)).map((f) => f.id)),
    [features, hole, autoHoles],
  )
  const strayHazards = features.filter((f) => isHazard(f) && (autoHoles.get(f.id)?.length ?? 0) === 0)

  // ---------- Map set-up ----------

  // Lock the page underneath so dragging the map never scrolls it.
  useEffect(() => {
    window.scrollTo(0, 0)
    document.documentElement.classList.add('mapper-open')
    return () => document.documentElement.classList.remove('mapper-open')
  }, [])

  useEffect(() => {
    getDeviceSetting('linzKey').then((k) => setMapKey(k), () => setMapKey(null))
  }, [])

  useEffect(() => {
    if (mapKey === undefined || !mapEl.current) return
    const adapter = createMap(mapEl.current, {
      key: mapKey,
      centre: [COURSE.mapStart.lng, COURSE.mapStart.lat],
      zoom: 16,
    })
    adapterRef.current = adapter
    if (location.search.includes('e2e')) window.__fairwayMap = adapter
    setCrosshair(adapter.getCentre())
    const offMove = adapter.onMove(() => setCrosshair(adapter.getCentre()))
    const offErr = adapter.onImageryError((status) => {
      // A missing tile (404/204) just means no photo at that zoom; not worth a warning.
      if (status === 404 || status === 204) return
      setImageryError(
        status === 400 || status === 401 || status === 403
          ? "LINZ didn't accept the map key. Standard keys expire after 90 days, so you may need a new one."
          : "Aerial photos didn't load. Check your signal; your mapped features are still here.",
      )
    })
    return () => {
      offMove()
      offErr()
      adapter.destroy()
      adapterRef.current = null
    }
  }, [mapKey])

  // Keep the map's drawings in step with the app's state.
  useEffect(() => {
    adapterRef.current?.setFeatures(features, hereIds, selectedId)
  }, [features, hereIds, selectedId, mapKey])

  useEffect(() => {
    const a = adapterRef.current
    if (!a) return
    a.setDraft(mode.type === 'draw' ? mode.points : [], mode.type === 'draw' ? KINDS[mode.kind].shape : null)
    a.setEditVertices(mode.type === 'edit' ? mode.points : [], mode.type === 'edit' ? mode.active : null)
  }, [mode, mapKey])

  useEffect(() => {
    const s = capture.state
    const last = s.phase === 'listening' ? s.fixes[s.fixes.length - 1] : undefined
    if (last) adapterRef.current?.setGolfer([last.lng, last.lat], last.accuracyM)
    else if (s.phase === 'done') adapterRef.current?.setGolfer(s.result.point, s.result.accuracyM)
    else adapterRef.current?.setGolfer(null, null)
  }, [capture.state])

  // Frame the hole whenever it changes (and once the map exists).
  const frameHole = useCallback(
    (h: number) => {
      const a = adapterRef.current
      if (!a) return
      const pts = holePoints(features, h)
      const tee = pointOf(findTee(features, h, 'blue')) ?? pointOf(features.find((f) => f.kind === 'tee' && f.holes.includes(h)))
      const mid = greenMiddle(features, h)
      const bearing = tee && mid ? bearingDeg(tee, mid) : 0
      if (pts.length > 0) {
        a.fitTo(pts, bearing)
      } else {
        const prevGreen = greenMiddle(features, h - 1)
        if (prevGreen) a.jumpTo(prevGreen, 17, 0)
      }
    },
    [features],
  )

  const framedFor = useRef<string>('')
  useEffect(() => {
    const key = `${hole}|${mapKey}`
    if (framedFor.current === key || !adapterRef.current) return
    framedFor.current = key
    frameHole(hole)
  }, [hole, mapKey, frameHole])

  // Tapping a feature selects it (only when not drawing).
  useEffect(() => {
    const a = adapterRef.current
    if (!a) return
    return a.onTapFeature((id) => {
      if (mode.type === 'browse') setSelectedId(id)
    })
  }, [mode.type, mapKey])

  // ---------- Changes (with undo) ----------

  const commit = (next: CourseFeature[], message?: string) => {
    setUndoStack((s) => [...s.slice(-49), features])
    dispatch({ type: 'setCourseFeatures', courseId: COURSE.id, features: next })
    if (message) setNotice(message)
  }

  const undo = () => {
    const prev = undoStack[undoStack.length - 1]
    if (!prev) return
    setUndoStack((s) => s.slice(0, -1))
    dispatch({ type: 'setCourseFeatures', courseId: COURSE.id, features: prev })
    setSelectedId(null)
    setNotice('Undone.')
  }

  /** Add a feature, replacing the existing one where only one is allowed per hole. */
  const addFeature = (f: CourseFeature) => {
    const replaces = SINGLE_PER_HOLE.includes(f.kind)
      ? features.filter((x) => x.kind === f.kind && x.holes.includes(hole) && (f.kind !== 'tee' || x.teeId === f.teeId))
      : []
    const next = [...features.filter((x) => !replaces.includes(x)), f]
    const name = f.kind === 'tee' ? `${teeName(f.teeId)} tee` : KINDS[f.kind].label
    // Stay on the tools after adding, so the next feature can be traced straight away.
    commit(next, replaces.length ? `${name} replaced.` : `${name} added.`)
  }

  const teeName = (id?: string) => COURSE.tees.find((t) => t.id === id)?.name ?? 'Tee'

  // ---------- Drawing ----------

  const startDraw = (kind: FeatureKind) => {
    setSelectedId(null)
    setNotice(null)
    if (kind === 'tee') setMode({ type: 'pick-tee', then: 'draw' })
    else setMode({ type: 'draw', kind, points: [] })
  }

  const addPoint = () => {
    if (mode.type !== 'draw' || !crosshair) return
    const points = [...mode.points, crosshair]
    if (KINDS[mode.kind].shape === 'Point') {
      addFeature(makeFeature(mode.kind, points, hole, { teeId: mode.teeId }))
      setMode({ type: 'browse' })
    } else {
      setMode({ ...mode, points })
    }
  }

  const finishDraw = () => {
    if (mode.type !== 'draw') return
    addFeature(makeFeature(mode.kind, mode.points, hole, { teeId: mode.teeId }))
    setMode({ type: 'browse' })
  }

  // ---------- Editing ----------

  const startEdit = (f: CourseFeature) => {
    const pts = vertices(f)
    setMode({ type: 'edit', id: f.id, points: pts, active: 0 })
    adapterRef.current?.jumpTo(pts[0])
  }

  const stepCorner = (dir: -1 | 1) => {
    if (mode.type !== 'edit') return
    const active = (mode.active + dir + mode.points.length) % mode.points.length
    setMode({ ...mode, active })
    adapterRef.current?.jumpTo(mode.points[active])
  }

  const saveEdit = () => {
    if (mode.type !== 'edit') return
    const f = features.find((x) => x.id === mode.id)
    if (f) commit(features.map((x) => (x.id === f.id ? withVertices(f, mode.points) : x)), 'Shape saved.')
    setMode({ type: 'browse' })
  }

  // ---------- GPS capture ----------

  const startCapture = (target: CaptureTarget) => {
    setMode({ type: 'capture', target })
    capture.start()
  }

  const saveCapture = () => {
    if (capture.state.phase !== 'done' || mode.type !== 'capture') return
    const r = capture.state.result
    // Runs on tap (event handler), not during render.
    // oxlint-disable-next-line react/purity
    const gps = { accuracyM: r.accuracyM, samples: r.samples, spreadM: r.spreadM, capturedAt: new Date().toISOString() }
    const trust = trustForCapture(r.accuracyM)
    const source = 'GPS capture on course'
    const t = mode.target
    if ('existingId' in t) {
      commit(
        features.map((x) =>
          x.id === t.existingId
            ? { ...x, geometry: { type: 'Point', coordinates: r.point }, trust, source, gps, updatedAt: gps.capturedAt }
            : x,
        ),
        'Point updated from GPS.',
      )
    } else {
      const f = makeFeature(t.kind, [r.point], hole, { teeId: 'teeId' in t ? t.teeId : undefined, trust, source })
      addFeature({ ...f, gps })
      const name = t.kind === 'tee' ? `${teeName(t.teeId)} tee` : KINDS[t.kind].label
      setNotice(`${name} saved as ${TRUST_LABEL[trust]}, ±${Math.round(r.accuracyM)} m.`)
    }
    adapterRef.current?.jumpTo(r.point, 19)
    capture.cancel()
    setMode({ type: 'browse' })
  }

  const cancelCapture = () => {
    capture.cancel()
    setMode({ type: 'browse' })
  }

  // ---------- Read-outs ----------

  const middle = greenMiddle(features, hole)
  const usualTeePoint = pointOf(findTee(features, hole, usualTee.id))
  const crossToGreen = crosshair && middle ? distanceM(crosshair, middle) : null
  const crossFromTee = crosshair && usualTeePoint ? distanceM(usualTeePoint, crosshair) : null

  const holeStatuses = useMemo(
    () => Array.from({ length: 18 }, (_, i) => checkHole(features, i + 1, COURSE)),
    [features],
  )
  const readyCount = holeStatuses.filter((r) => r.status === 'ready').length
  const todo = report.checks.filter((c) => c.level !== 'ok').length

  const goHole = (h: number) => {
    setHole(((h - 1 + 18) % 18) + 1)
    setMode({ type: 'browse' })
    setSelectedId(null)
    setNotice(null)
  }

  // ---------- Render ----------

  return (
    <div className="mapper" role="dialog" aria-modal="true" aria-label="Course map">
      <header className="mapper-top">
        <button className="btn btn-small" onClick={onClose}>
          Done
        </button>
        <div className="hole-nav">
          <button className="icon-btn" aria-label="Previous hole" onClick={() => goHole(hole - 1)}>
            <span className="chev">‹</span>
          </button>
          <button className="hole-title" onClick={() => setShowHoles(true)} aria-label={`Hole ${hole}, show all holes`}>
            <span className="hole-num">Hole {hole}</span>
            <span className="hole-sub">
              Par {card.par}, {d(card.metres)} {usualTee.name}
            </span>
          </button>
          <button className="icon-btn" aria-label="Next hole" onClick={() => goHole(hole + 1)}>
            <span className="chev">›</span>
          </button>
        </div>
        <button className={`status-pill status-${report.status}`} onClick={() => setShowHoles(true)}>
          {todo === 0 && report.status !== 'not-started' ? 'Ready' : `${todo} to do`}
        </button>
      </header>

      <div className="mapper-map-wrap">
        <div ref={mapEl} className="mapper-map" data-testid="map" />
        <div className="crosshair" aria-hidden="true" />
        {(crossToGreen !== null || crossFromTee !== null) && (
          <div className="cross-readout" aria-live="polite">
            {crossFromTee !== null && (
              <span>
                <strong>{formatDistance(crossFromTee, units)}</strong> {u} from {usualTee.name} tee
              </span>
            )}
            {crossToGreen !== null && (
              <span>
                <strong>{formatDistance(crossToGreen, units)}</strong> {u} to green middle
              </span>
            )}
          </div>
        )}
        {undoStack.length > 0 && mode.type === 'browse' && (
          <button className="map-undo" onClick={undo}>
            Undo
          </button>
        )}
        {mapKey === null && (
          <button className="map-banner" onClick={() => setShowKey(true)}>
            No aerial photos yet. Add your free LINZ map key.
          </button>
        )}
        {imageryError && (
          <button className="map-banner map-banner-error" onClick={() => setShowKey(true)}>
            {imageryError}
          </button>
        )}
      </div>

      <section className="mapper-panel" aria-label="Mapping tools">
        {notice && mode.type === 'browse' && <p className="panel-notice" aria-live="polite">{notice}</p>}

        {mode.type === 'browse' && !selected && (
          <>
            <p className="panel-hint">Move the map so the crosshair sits on the spot, then choose what to add.</p>
            <div className="tool-grid">
              {DRAW_KINDS.map((k) => (
                <button key={k} className="tool" onClick={() => startDraw(k)}>
                  <span className="tool-swatch" style={{ background: KINDS[k].colour }} aria-hidden="true" />
                  {KINDS[k].label}
                </button>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn" onClick={() => setMode({ type: 'pick-tee', then: 'capture' })}>
                GPS: I'm on a tee
              </button>
              <button className="btn" onClick={() => startCapture({ kind: 'green-middle' })}>
                GPS: I'm mid-green
              </button>
            </div>
          </>
        )}

        {mode.type === 'browse' && selected && (
          <FeaturePanel
            f={selected}
            reach={autoHoles.get(selected.id)}
            teeName={teeName}
            d={d}
            onClose={() => setSelectedId(null)}
            onEdit={() => startEdit(selected)}
            onMoveHere={() =>
              crosshair &&
              commit(features.map((x) => (x.id === selected.id ? withVertices(x, [crosshair]) : x)), 'Point moved.')
            }
            onCapture={() => startCapture({ existingId: selected.id })}
            onDelete={() => {
              commit(features.filter((x) => x.id !== selected.id), `${KINDS[selected.kind].label} deleted. Undo brings it back.`)
              setSelectedId(null)
            }}
          />
        )}

        {mode.type === 'pick-tee' && (
          <>
            <p className="panel-hint">Which tee?</p>
            <div className="btn-row">
              {COURSE.tees.map((t) => (
                <button
                  key={t.id}
                  className="btn"
                  onClick={() =>
                    mode.then === 'draw'
                      ? setMode({ type: 'draw', kind: 'tee', teeId: t.id, points: [] })
                      : startCapture({ kind: 'tee', teeId: t.id })
                  }
                >
                  <span className="tee-dot" style={{ background: TEE_COLOURS[t.id] }} aria-hidden="true" /> {t.name}
                </button>
              ))}
              <button className="btn btn-ghost" onClick={() => setMode({ type: 'browse' })}>
                Cancel
              </button>
            </div>
          </>
        )}

        {mode.type === 'draw' && (
          <>
            <p className="panel-title">
              {mode.kind === 'tee' ? `${teeName(mode.teeId)} tee` : KINDS[mode.kind].label}
            </p>
            <p className="panel-hint">
              {KINDS[mode.kind].help}{' '}
              {KINDS[mode.kind].shape !== 'Point' &&
                `${mode.points.length} point${mode.points.length === 1 ? '' : 's'} so far${
                  mode.points.length > 1 ? `, ${d(drawLength(mode.points, KINDS[mode.kind].shape === 'Polygon'))} round` : ''
                }.`}
            </p>
            <div className="btn-row">
              <button className="btn btn-primary btn-big" onClick={addPoint}>
                {KINDS[mode.kind].shape === 'Point' ? 'Place here' : 'Add point'}
              </button>
            </div>
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => setMode({ type: 'browse' })}>
                Cancel
              </button>
              {KINDS[mode.kind].shape !== 'Point' && (
                <>
                  <button
                    className="btn"
                    disabled={mode.points.length === 0}
                    onClick={() => setMode({ ...mode, points: mode.points.slice(0, -1) })}
                  >
                    Remove last
                  </button>
                  <button className="btn" disabled={mode.points.length < KINDS[mode.kind].minPoints} onClick={finishDraw}>
                    Finish
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {mode.type === 'edit' && (
          <>
            <p className="panel-title">
              Corner {mode.active + 1} of {mode.points.length}
            </p>
            <p className="panel-hint">Step to a corner, move the map to where it should be, then tap Move corner here.</p>
            <div className="btn-row">
              <button className="icon-btn icon-btn-boxed" aria-label="Previous corner" onClick={() => stepCorner(-1)}>
                <UpIcon />
              </button>
              <button className="icon-btn icon-btn-boxed" aria-label="Next corner" onClick={() => stepCorner(1)}>
                <DownIcon />
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!crosshair) return
                  const points = [...mode.points]
                  points[mode.active] = crosshair
                  setMode({ ...mode, points })
                }}
              >
                Move corner here
              </button>
            </div>
            <div className="btn-row">
              <button
                className="btn"
                onClick={() => {
                  if (!crosshair) return
                  const points = [...mode.points]
                  points.splice(mode.active + 1, 0, crosshair)
                  setMode({ ...mode, points, active: mode.active + 1 })
                }}
              >
                Add corner after
              </button>
              <button
                className="btn"
                disabled={mode.points.length <= KINDS[features.find((x) => x.id === mode.id)?.kind ?? 'green'].minPoints}
                onClick={() => {
                  const points = mode.points.filter((_, i) => i !== mode.active)
                  setMode({ ...mode, points, active: Math.min(mode.active, points.length - 1) })
                }}
              >
                Delete corner
              </button>
            </div>
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => setMode({ type: 'browse' })}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveEdit}>
                Save shape
              </button>
            </div>
          </>
        )}

        {mode.type === 'capture' && (
          <CapturePanel state={capture.state} d={d} onSave={saveCapture} onStopEarly={capture.finish} onCancel={cancelCapture} onRetry={capture.start} />
        )}
      </section>

      {showHoles && (
        <Sheet title="Holes" onClose={() => setShowHoles(false)}>
          <p className="quiet">
            {readyCount} of 18 holes ready. Tap a hole to go there.
          </p>
          <div className="hole-grid">
            {holeStatuses.map((r) => (
              <button
                key={r.hole}
                className={`hole-cell status-${r.status}${r.hole === hole ? ' hole-cell-on' : ''}`}
                onClick={() => {
                  goHole(r.hole)
                  setShowHoles(false)
                }}
                aria-label={`Hole ${r.hole}: ${STATUS_LABEL[r.status]}`}
              >
                <span className="hole-cell-num">{r.hole}</span>
                <span className="hole-cell-status">{STATUS_LABEL[r.status]}</span>
              </button>
            ))}
          </div>
          {strayHazards.length > 0 && (
            <p className="msg msg-warn">
              {strayHazards.length} hazard{strayHazards.length === 1 ? " isn't" : "s aren't"} near any hole's line of play,
              so {strayHazards.length === 1 ? 'it' : 'they'} won't show on any hole. Check{' '}
              {strayHazards.length === 1 ? "it's" : "they're"} in the right place.
            </p>
          )}
          <p className="field-hint">
            Hazards and out of bounds count for every hole they sit near, whichever hole you drew them on.
          </p>
          <h3 className="group-title">Hole {hole} checklist</h3>
          <ul className="checklist">
            {report.checks.map((c, i) => (
              <li key={i} className={`check check-${c.level}`}>
                <span className="check-mark" aria-hidden="true">
                  {c.level === 'ok' ? '✓' : c.level === 'missing' ? '○' : '!'}
                </span>
                <span>
                  {c.level === 'missing' ? `Add: ${c.text}` : c.text}
                </span>
              </li>
            ))}
          </ul>
          <p className="field-hint">
            {report.verified} feature{report.verified === 1 ? '' : 's'} verified on course, {report.traced} traced from
            photos.
          </p>
        </Sheet>
      )}

      {showKey && (
        <Sheet title="Aerial photos" onClose={() => setShowKey(false)}>
          <MapKeyForm
            hasKey={Boolean(mapKey)}
            onSave={async (k) => {
              await setDeviceSetting('linzKey', k)
              setImageryError(null)
              framedFor.current = ''
              setMapKey(k)
              setShowKey(false)
            }}
            onRemove={async () => {
              await setDeviceSetting('linzKey', null)
              framedFor.current = ''
              setMapKey(null)
              setShowKey(false)
            }}
          />
        </Sheet>
      )}
    </div>
  )
}

function listHoles(holes: number[]): string {
  const s = [...holes].sort((a, b) => a - b)
  return s.length <= 1 ? s.join('') : `${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`
}

function drawLength(points: LngLat[], closed: boolean): number {
  return pathLengthM(closed && points.length > 2 ? [...points, points[0]] : points)
}

function FeaturePanel({
  f,
  reach,
  teeName,
  d,
  onClose,
  onEdit,
  onMoveHere,
  onCapture,
  onDelete,
}: {
  f: CourseFeature
  reach: HoleReach[] | undefined
  teeName: (id?: string) => string
  d: (m: number) => string
  onClose: () => void
  onEdit: () => void
  onMoveHere: () => void
  onCapture: () => void
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const isPoint = f.geometry.type === 'Point'
  const title = f.kind === 'tee' ? `${teeName(f.teeId)} tee` : KINDS[f.kind].label
  const ring = ringOf(f)
  const detail = ring
    ? `${Math.round(describeOutline(ring).areaM2)} m²`
    : f.geometry.type === 'LineString'
      ? d(pathLengthM(f.geometry.coordinates))
      : null

  return (
    <>
      <div className="panel-row">
        <p className="panel-title">{title}</p>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <p className="panel-hint">
        <span className={`trust trust-${f.trust}`}>{TRUST_LABEL[f.trust]}</span>
        {detail && <> {detail}.</>}
        {f.gps && (
          <>
            {' '}
            GPS ±{Math.round(f.gps.accuracyM)} m from {f.gps.samples} readings.
          </>
        )}{' '}
        {f.source}.
      </p>
      {isHazard(f) && (
        <p className="panel-hint" data-testid="counts-for">
          {reach && reach.length > 0
            ? `Counts for ${reach.length === 1 ? 'hole' : 'holes'} ${listHoles(reach.map((r) => r.hole))}, worked out from where it sits.`
            : "Not near any hole's line of play. Check it's in the right place."}
        </p>
      )}
      <div className="btn-row">
        {isPoint ? (
          <button className="btn" onClick={onMoveHere}>
            Move to crosshair
          </button>
        ) : (
          <button className="btn" onClick={onEdit}>
            Edit corners
          </button>
        )}
        {(f.kind === 'tee' || f.kind === 'green-middle') && (
          <button className="btn" onClick={onCapture}>
            Re-capture with GPS
          </button>
        )}
      </div>
      <div className="btn-row">
        {confirm ? (
          <>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
              Keep it
            </button>
            <button className="btn btn-danger" onClick={onDelete}>
              Delete {title}
            </button>
          </>
        ) : (
          <button className="btn btn-ghost btn-danger-text" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
    </>
  )
}

function CapturePanel({
  state,
  d,
  onSave,
  onStopEarly,
  onCancel,
  onRetry,
}: {
  state: ReturnType<typeof useGpsCapture>['state']
  d: (m: number) => string
  onSave: () => void
  onStopEarly: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  if (state.phase === 'listening') {
    const n = state.fixes.length
    return (
      <>
        <p className="panel-title">Stand still on the spot</p>
        <p className="panel-hint" aria-live="polite">
          {n === 0
            ? 'Waiting for GPS…'
            : `${n} reading${n === 1 ? '' : 's'}. Latest accuracy ±${Math.round(state.latestAccuracyM ?? 0)} m (${GRADE_LABEL[gradeAccuracy(state.latestAccuracyM ?? 99)]}). Finishes within ${CAPTURE_SECONDS} seconds.`}
        </p>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={n < CAPTURE_MIN_FIXES} onClick={onStopEarly}>
            Use readings so far
          </button>
        </div>
      </>
    )
  }
  if (state.phase === 'done') {
    const r = state.result
    const grade = gradeAccuracy(r.accuracyM)
    return (
      <>
        <p className="panel-title">
          GPS point: ±{Math.round(r.accuracyM)} m, {GRADE_LABEL[grade].toLowerCase()}
        </p>
        <p className="panel-hint">
          {r.samples} readings, wandering about {d(r.spreadM)}.{' '}
          {grade === 'poor'
            ? 'Too rough to count as verified; it will be saved as Estimated. Try again in the open, away from trees.'
            : 'This will be saved as Verified on course.'}
        </p>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={onCancel}>
            Discard
          </button>
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
          <button className="btn btn-primary" onClick={onSave}>
            Save point
          </button>
        </div>
      </>
    )
  }
  if (state.phase === 'error') {
    return (
      <>
        <p className="msg msg-error" role="alert">
          {state.message}
        </p>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={onCancel}>
            Close
          </button>
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      </>
    )
  }
  return null
}


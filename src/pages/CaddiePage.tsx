import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { AppData } from '../types'
import type { LngLat } from '../lib/geo/geodesic'
import { distanceM } from '../lib/geo/geodesic'
import { greenDistances, type GreenDistances } from '../lib/geo/green'
import { analyseGaps } from '../lib/calculations/gaps'
import { formatDistance, fromDisplay, toDisplay, unitLabel } from '../lib/calculations/units'
import { checkHole, greenMiddle } from '../lib/course/holeChecks'
import { findGreen, findGreenMiddle, pointOf, ringOf, TRUST_LABEL } from '../lib/course/features'
import { analyseBoundaries, analyseHazards } from '../lib/course/hazards'
import { southHead } from '../data/courses/southHead'
import { useLiveGps } from '../lib/gps/useLiveGps'
import { useWakeLock } from '../lib/gps/useWakeLock'
import { describeFix, suggestHole } from '../lib/gps/fixStatus'
import { FAIR_M } from '../lib/gps/accuracy'
import { getDeviceSetting, setDeviceSetting } from '../lib/storage/db'
import { GpsBadge, GreenNumbers, HazardList } from '../components/caddie/readouts'
import { NumberField } from '../components/Fields'
import type { CourseFeature } from '../types/courseMap'

const CaddieMap = lazy(() => import('../components/caddie/CaddieMap'))

interface Props {
  data: AppData
  goToBag: () => void
  openMap: () => void
}

const COURSE = southHead
/** Further than this from the green and you're almost certainly on a different hole. */
const WRONG_HOLE_M = 700

function savedHole(): number {
  const n = Number(sessionStorage.getItem('caddieHole'))
  return n >= 1 && n <= 18 ? n : 1
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function CaddiePage({ data, goToBag, openMap }: Props) {
  const units = data.profile.units
  const u = unitLabel(units)
  const features = useMemo(() => data.courseMaps.find((m) => m.courseId === COURSE.id)?.features ?? [], [data.courseMaps])
  const anyGreen = features.some((f) => f.kind === 'green')

  const [hole, setHoleState] = useState(savedHole)
  const [view, setView] = useState<'quick' | 'map'>('quick')
  const [gpsOn, setGpsOn] = useState<boolean | null>(null)
  const [keepAwake, setKeepAwake] = useState(false)
  const [manualPos, setManualPos] = useState<LngLat | null>(null)
  const [measure, setMeasure] = useState<LngLat | null>(null)
  const [rangefinder, setRangefinder] = useState<Record<number, number | null>>({})

  useEffect(() => {
    getDeviceSetting('gpsOn').then((v) => setGpsOn(v === 'yes'), () => setGpsOn(false))
    getDeviceSetting('keepAwake').then((v) => setKeepAwake(v === 'yes'), () => {})
  }, [])

  const gps = useLiveGps(Boolean(gpsOn) && anyGreen)
  const wake = useWakeLock(keepAwake && anyGreen)
  const status = describeFix(gps.fix, gps.now, gps.base)
  const onTapMap = useCallback((p: LngLat) => setMeasure(p), [])

  if (!anyGreen) return <SetupView data={data} features={features} goToBag={goToBag} openMap={openMap} />

  const setHole = (h: number) => {
    const n = ((h - 1 + 18) % 18) + 1
    setHoleState(n)
    sessionStorage.setItem('caddieHole', String(n))
    setMeasure(null)
    setManualPos(null)
  }

  // ---------- Where you are, and what's around ----------

  const position: LngLat | null = manualPos ?? gps.fix?.point ?? null
  /** Set when GPS is too rough (or too old) to show plain numbers. */
  const roughM =
    manualPos || status.kind !== 'fix' ? null : status.stale || status.accuracyM > FAIR_M ? status.accuracyM : null
  const fairPm = !manualPos && status.kind === 'fix' && !status.stale && status.grade === 'fair' ? status.accuracyM : null

  const usual = COURSE.tees.find((t) => t.id === data.profile.usualTees) ?? COURSE.tees.find((t) => t.id === 'white')!
  const card = usual.holes.find((h) => h.hole === hole)!
  const green = findGreen(features, hole)
  const ring = ringOf(green)
  const verifiedMiddle = pointOf(findGreenMiddle(features, hole))
  const middle = greenMiddle(features, hole)

  const dists: GreenDistances | null = position && ring ? greenDistances(ring, position, verifiedMiddle) : null
  const farAway = dists !== null && dists.middleM > WRONG_HOLE_M
  const onGreen = dists !== null && !farAway && dists.frontM === null
  const hazards = position && middle && !farAway ? analyseHazards(features, position, middle) : []
  const boundaries = position && middle && !farAway ? analyseBoundaries(features, position, middle) : []
  const suggestion = manualPos ? null : suggestHole(features, gps.fix, hole)

  const rf = rangefinder[hole] ?? null
  const rfMismatch =
    rf !== null && dists && dists.frontM !== null && dists.backM !== null && !roughM && !farAway
      ? rf < dists.frontM - 5 || rf > dists.backM + 5
      : false

  const report = checkHole(features, hole, COURSE)

  return (
    <section className="page caddie" aria-labelledby="caddie-title">
      <div className="caddie-head">
        <button className="icon-btn" aria-label="Previous hole" onClick={() => setHole(hole - 1)}>
          <span className="chev">‹</span>
        </button>
        <div className="caddie-hole">
          <h1 id="caddie-title">Hole {hole}</h1>
          <p className="quiet">
            Par {card.par}, {formatDistance(card.metres, units)} {u} {usual.name}
          </p>
        </div>
        <button className="icon-btn" aria-label="Next hole" onClick={() => setHole(hole + 1)}>
          <span className="chev">›</span>
        </button>
      </div>

      <div className="caddie-bar">
        <GpsBadge status={status} manual={Boolean(manualPos)} units={units} />
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'quick'} className={view === 'quick' ? 'seg-on' : ''} onClick={() => setView('quick')}>
            Quick
          </button>
          <button role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'seg-on' : ''} onClick={() => setView('map')}>
            Map
          </button>
        </div>
      </div>

      {gpsOn === false && (
        <div className="callout">
          <p>Turn on GPS to see distances from where you're standing. It runs only while this screen is open.</p>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                setGpsOn(true)
                setDeviceSetting('gpsOn', 'yes')
              }}
            >
              Turn on GPS
            </button>
          </div>
        </div>
      )}
      {status.kind === 'denied' && !manualPos && (
        <p className="msg msg-error" role="alert">
          Location is blocked for this app. On iPhone: Settings → Privacy &amp; Security → Location Services → Safari Websites
          → While Using. Meanwhile, tap your spot on the Map view.
        </p>
      )}
      {suggestion && (
        <button className="suggest" onClick={() => setHole(suggestion)}>
          You look to be on the {ordinal(suggestion)} tee. Switch to hole {suggestion}
        </button>
      )}
      {manualPos && (
        <button className="suggest" onClick={() => setManualPos(null)}>
          Using a spot you set on the map. Back to GPS
        </button>
      )}

      {!ring ? (
        <div className="hero-empty">
          <p className="hero-empty-line">Hole {hole} isn't mapped yet.</p>
          <p className="quiet">Trace its green in the course map to get distances here.</p>
          <button className="btn btn-wide" onClick={openMap}>
            Open course map
          </button>
        </div>
      ) : view === 'quick' ? (
        <>
          {!position ? (
            <p className="waiting-line">{gpsOn ? 'Waiting for your position…' : 'GPS is off.'}</p>
          ) : farAway ? (
            <div className="hero-empty">
              <p className="hero-empty-line">{(dists!.middleM / 1000).toFixed(1)} km from this green.</p>
              <p className="quiet">Wrong hole? Use the arrows, or move closer.</p>
            </div>
          ) : onGreen ? (
            <p className="waiting-line">You're on the green.</p>
          ) : (
            <GreenNumbers d={dists!} units={units} roughM={roughM} />
          )}
          {roughM && position && (
            <p className="msg msg-warn">
              GPS is rough here (±{formatDistance(roughM, units)} {u}). Check with your rangefinder, or set your spot on the
              Map view.
            </p>
          )}
          {fairPm && (
            <p className="field-hint">
              GPS is fair: distances could be out by up to {formatDistance(fairPm, units)} {u}.
            </p>
          )}
        </>
      ) : (
        <>
          <Suspense fallback={<div className="caddie-map-wrap map-loading">Loading map…</div>}>
            <CaddieMap
              features={features}
              hole={hole}
              centre={middle ?? [COURSE.mapStart.lng, COURSE.mapStart.lat]}
              golfer={position ? { point: position, accuracyM: manualPos ? null : (gps.fix?.accuracyM ?? null) } : null}
              measure={measure}
              onTap={onTapMap}
            />
          </Suspense>
          {measure ? (
            <div className="measure" aria-live="polite">
              <p>
                {position && (
                  <>
                    <strong>{formatDistance(distanceM(position, measure), units)}</strong> {u} from you,{' '}
                  </>
                )}
                {middle && (
                  <>
                    <strong>{formatDistance(distanceM(measure, middle), units)}</strong> {u} on to the green middle
                  </>
                )}
              </p>
              <div className="btn-row">
                <button className="btn" onClick={() => setMeasure(null)}>
                  Clear
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setManualPos(measure)
                    setMeasure(null)
                  }}
                >
                  I'm standing here
                </button>
              </div>
            </div>
          ) : (
            <p className="field-hint">Tap the map to measure to any spot.</p>
          )}
          {dists && !farAway && !onGreen && <GreenNumbers d={dists} units={units} roughM={roughM} compact />}
        </>
      )}

      {ring && position && !farAway && (
        <>
          <h2 className="section-title">Hazards</h2>
          <HazardList hazards={hazards} boundaries={boundaries} units={units} />
        </>
      )}

      {ring && (
        <>
          <h2 className="section-title">Rangefinder</h2>
          <NumberField
            label="To the flag"
            name="rangefinder"
            unit={u}
            value={rf === null ? null : toDisplay(rf, units)}
            onChange={(v) => setRangefinder((r) => ({ ...r, [hole]: v === null ? null : fromDisplay(v, units) }))}
            hint="Type in your rangefinder reading. Club advice will use it from the next stage."
          />
          {rfMismatch && (
            <p className="msg msg-warn">
              That doesn't fit between the front and back of the green from here. The GPS or this green's outline may be
              off. Worth checking this hole in the course map.
            </p>
          )}
          <p className="field-hint trust-line">
            Green: {TRUST_LABEL[green!.trust]}
            {verifiedMiddle && ', middle checked by GPS'}. Hole {report.status === 'ready' ? 'fully mapped' : 'still being mapped'}.
          </p>
        </>
      )}

      <div className="caddie-foot">
        {wake.supported ? (
          <label className="toggle">
            <input
              type="checkbox"
              checked={keepAwake}
              onChange={(e) => {
                setKeepAwake(e.target.checked)
                setDeviceSetting('keepAwake', e.target.checked ? 'yes' : 'no')
              }}
            />
            <span>Keep screen on{keepAwake && wake.active ? ' (on now)' : ''}. Uses more battery.</span>
          </label>
        ) : (
          <p className="field-hint">
            This phone can't keep the screen on from the app. For a round, set Auto-Lock longer in iPhone Settings.
          </p>
        )}
        {wake.error && <p className="field-hint">{wake.error}</p>}
        <button className="btn btn-ghost" onClick={openMap}>
          Course map
        </button>
      </div>
    </section>
  )
}

/** Before any green is mapped: what's left to set up. */
function SetupView({
  data,
  features,
  goToBag,
  openMap,
}: {
  data: AppData
  features: CourseFeature[]
  goToBag: () => void
  openMap: () => void
}) {
  const clubs = data.bag.filter((c) => c.category !== 'putter')
  const report = analyseGaps(data.bag)
  const withDistance = clubs.length - report.missingIds.length
  const confirmedCarry = clubs.filter((c) => c.carryM !== null).length
  const holeReports = Array.from({ length: 18 }, (_, i) => checkHole(features, i + 1, COURSE))
  const holesReady = holeReports.filter((r) => r.status === 'ready').length
  const holesStarted = holeReports.filter((r) => r.status !== 'not-started').length

  const steps = [
    {
      title: 'Your bag',
      state: confirmedCarry === clubs.length ? 'done' : 'now',
      detail: `${withDistance} of ${clubs.length} clubs have a distance; ${confirmedCarry} confirmed as carry.`,
    },
    {
      title: 'Map South Head',
      state: holesReady === 18 ? 'done' : 'now',
      detail:
        holesStarted === 0
          ? 'Trace greens, tees and hazards on aerial photos, then check them on the course.'
          : `${holesReady} of 18 holes ready, ${holesStarted} started.`,
    },
    { title: 'GPS distances', state: 'later', detail: 'Appear here as soon as a green is traced.' },
    { title: 'Club advice', state: 'later', detail: 'Club, target and the reasons, for safe, normal or aggressive play.' },
  ] as const

  return (
    <section className="page" aria-labelledby="caddie-title">
      <div className="page-head">
        <div>
          <h1 id="caddie-title">{data.profile.homeCourse || 'Caddie'}</h1>
          <p className="quiet">Distances appear once greens are mapped.</p>
        </div>
      </div>
      <div className="hero-empty">
        <p className="hero-empty-line">No distances yet.</p>
        <p className="quiet">
          Rather than guess, the caddie stays quiet until it has a mapped green and your GPS position. Until then, use
          your rangefinder.
        </p>
      </div>
      <h2 className="section-title">Getting it ready</h2>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.title} className={`step step-${s.state}`}>
            <span className="step-title">{s.title}</span>
            <span className="step-state">{s.state === 'done' ? 'Done' : s.state === 'now' ? 'In progress' : 'Coming'}</span>
            <span className="step-detail">{s.detail}</span>
          </li>
        ))}
      </ol>
      <button className="btn btn-wide btn-primary" onClick={openMap}>
        Open course map
      </button>
      {confirmedCarry < clubs.length && (
        <button className="btn btn-wide" onClick={goToBag}>
          Finish setting up my bag
        </button>
      )}
    </section>
  )
}

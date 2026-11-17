import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { AppData } from '../types'
import type { LngLat } from '../lib/geo/geodesic'
import { bearingDeg, distanceM } from '../lib/geo/geodesic'
import { greenDistances, type GreenDistances } from '../lib/geo/green'
import { analyseGaps } from '../lib/calculations/gaps'
import { formatDistance, fromDisplay, toDisplay, unitLabel } from '../lib/calculations/units'
import { checkHole, greenMiddle } from '../lib/course/holeChecks'
import { findGreen, findGreenMiddle, findLineOfPlay, lineOf, pointOf, ringOf, TRUST_LABEL } from '../lib/course/features'
import { isHazard } from '../lib/course/autoHoles'
import { recommend, type CaddieInput, type CaddieResult } from '../lib/caddie/engine'
import { CaddieChat } from '../components/caddie/CaddieChat'
import type { Strategy } from '../lib/caddie/scoring'
import { AdviceCard, LiePicker, StrategyPicker, StrategyTable, WindPicker } from '../components/caddie/AdviceCard'
import {
  parseWindSetting,
  WIND_KMH,
  windDirsOnShot,
  windFromTaps,
  windIsCurrent,
  windOnShot,
  type ShotWind,
  type WindDir,
  type WindSetting,
  type WindStrength,
} from '../lib/caddie/wind'
import { isPlain, PLAIN_LIE, type Lie } from '../lib/caddie/lie'
import { useTerrain } from '../lib/terrain/useTerrain'
import { activeRound, formatToPar, roundTotals } from '../lib/rounds/score'
import { suggestSlopes, type HeightAt } from '../lib/terrain/terrain'
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
import type { TrustLevel } from '../types/course'
import type { Club } from '../types'

const CaddieMap = lazy(() => import('../components/caddie/CaddieMap'))

interface Props {
  data: AppData
  goToBag: () => void
  openMap: () => void
  /** Open the Round tab on a hole. */
  scoreHole: (hole: number) => void
}

const COURSE = southHead
/** Further than this from the green and you're almost certainly on a different hole. */
const WRONG_HOLE_M = 700
/** Walk further than this from where you took a rangefinder reading and it stops being used. */
const RF_MOVE_M = 15
/** For stamping settings when you tap (not during render). */
const clockNow = () => Date.now()
/** Within this of one of the hole's tee markers counts as being on the tee. */
const ON_TEE_M = 25

function savedHole(): number {
  const n = Number(sessionStorage.getItem('caddieHole'))
  return n >= 1 && n <= 18 ? n : 1
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function CaddiePage({ data, goToBag, openMap, scoreHole }: Props) {
  const liveRound = activeRound(data.rounds)
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
  // A reading belongs to the spot you took it from; walk on and it no longer applies.
  const [rangefinder, setRangefinder] = useState<Record<number, { m: number; at: LngLat | null } | null>>({})
  const [strategy, setStrategyState] = useState<Strategy>('normal')
  // The lie belongs to one shot: it resets when you change hole or walk on.
  const [lieAt, setLieAt] = useState<{ lie: Lie; hole: number; at: LngLat | null } | null>(null)
  // Wind is set once and kept as a compass direction, so it follows you round the course.
  const [windSet, setWindState] = useState<WindSetting | null>(null)
  const saveWind = (w: WindSetting) => {
    setWindState(w)
    setDeviceSetting('wind', JSON.stringify(w))
  }

  useEffect(() => {
    getDeviceSetting('gpsOn').then((v) => setGpsOn(v === 'yes'), () => setGpsOn(false))
    getDeviceSetting('keepAwake').then((v) => setKeepAwake(v === 'yes'), () => {})
    getDeviceSetting('wind').then((v) => setWindState(parseWindSetting(v)), () => {})
    getDeviceSetting('strategy').then(
      (v) => {
        if (v === 'safe' || v === 'normal' || v === 'aggressive') setStrategyState(v)
      },
      () => {},
    )
  }, [])
  const setStrategy = (s: Strategy) => {
    setStrategyState(s)
    setDeviceSetting('strategy', s)
  }

  const gps = useLiveGps(Boolean(gpsOn) && anyGreen)
  const wake = useWakeLock(keepAwake && anyGreen)
  const status = describeFix(gps.fix, gps.now, gps.base)
  const onTapMap = useCallback((p: LngLat) => setMeasure(p), [])
  const [plan, setPlan] = useState<{ aim: LngLat; zone: LngLat[] } | null>(null)

  // Ground heights around this shot (you and the green), for slope.
  const herePos: LngLat | null = manualPos ?? gps.fix?.point ?? null
  const hereMiddle = anyGreen ? greenMiddle(features, hole) : null
  const nearGreen = herePos && hereMiddle && distanceM(herePos, hereMiddle) <= WRONG_HOLE_M
  const terrain = useTerrain(nearGreen ? [herePos, hereMiddle] : null)

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

  // During a round, the card is the tees you're playing.
  const usual =
    COURSE.tees.find((t) => t.id === (liveRound?.teeId ?? data.profile.usualTees)) ?? COURSE.tees.find((t) => t.id === 'white')!
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

  const rfEntry = rangefinder[hole] ?? null
  const rfMovedM = rfEntry?.at && position ? distanceM(rfEntry.at, position) : 0
  const rfOld = rfEntry !== null && rfMovedM > RF_MOVE_M
  const rf = rfEntry && !rfOld ? rfEntry.m : null
  const rfMismatch =
    rf !== null && dists && dists.frontM !== null && dists.backM !== null && !roughM && !farAway
      ? rf < dists.frontM - 5 || rf > dists.backM + 5
      : false

  const report = checkHole(features, hole, COURSE)

  const shotBearing = position && middle && !farAway ? bearingDeg(position, middle) : null
  const windNow = windIsCurrent(windSet, gps.now) ? windSet : null
  const shotWind: ShotWind | null = windNow && shotBearing !== null ? windOnShot(windNow, shotBearing) : null
  const windDirs = shotWind ? windDirsOnShot(shotWind) : []
  const windStrength: WindStrength = windNow?.strength ?? 'calm'
  const setWindDirs = (dirs: WindDir[]) => {
    if (shotBearing === null) return
    const fromDeg = windFromTaps(dirs, shotBearing)
    saveWind({ fromDeg, strength: fromDeg === null ? windStrength : windStrength === 'calm' ? 'medium' : windStrength, setAt: clockNow() })
  }
  const applyWind = ({ dirs, strength }: { dirs: WindDir[]; strength: WindStrength | null }) => {
    const s = strength ?? (windStrength === 'calm' ? 'medium' : windStrength)
    if (dirs.length > 0 && shotBearing !== null) saveWind({ fromDeg: windFromTaps(dirs, shotBearing), strength: s, setAt: clockNow() })
    else saveWind({ fromDeg: s === 'calm' ? null : (windNow?.fromDeg ?? null), strength: s, setAt: clockNow() })
  }
  const setWindStrength = (s: WindStrength) => saveWind({ fromDeg: windNow?.fromDeg ?? null, strength: s, setAt: clockNow() })

  const lieSet = lieAt && lieAt.hole === hole && !(lieAt.at && position && distanceM(lieAt.at, position) > RF_MOVE_M)
  // Until you touch the buttons for this shot, the slope ones come from the ground heights.
  const mapSlopes = !lieSet && terrain.heightAt && position && middle && !farAway ? suggestSlopes(terrain.heightAt, position, middle) : []
  const lie: Lie = lieSet ? lieAt.lie : { surface: 'fairway', slopes: mapSlopes }
  const setLie = (l: Lie) => setLieAt({ lie: l, hole, at: position })

  // Driver is only offered from the tee. Use the mapped tees; if none are mapped yet,
  // being about the card's length from the green counts.
  const teeSpots = features.filter((f) => f.kind === 'tee' && f.holes.includes(hole)).map(pointOf).filter((p): p is LngLat => p !== null)
  const fromTee =
    position !== null &&
    !farAway &&
    (teeSpots.length > 0
      ? teeSpots.some((t) => distanceM(t, position) <= ON_TEE_M)
      : dists !== null && Math.abs(dists.middleM - card.metres) <= ON_TEE_M + 10)

  const adviceInput: AdviceInput | null =
    ring && middle && green && !onGreen
      ? {
          features,
          hole,
          green: ring,
          middle,
          greenTrust: green.trust,
          position: farAway ? null : position,
          source: farAway || !position ? 'none' : manualPos ? 'manual' : 'gps',
          accuracyM: manualPos || status.kind !== 'fix' ? null : status.accuracyM,
          stale: !manualPos && status.kind === 'fix' && status.stale,
          rf,
          fromTee,
          lie: fromTee ? PLAIN_LIE : lie,
          heightAt: terrain.heightAt,
          wind: shotWind,
          terrainVersion: terrain.version,
          clubs: data.bag,
          strategy,
        }
      : null

  const lieBlock =
    adviceInput && position && !farAway && !onGreen ? (
      fromTee ? (
        <p className="field-hint lie-tee">Teeing off: lie buttons appear for your next shot.</p>
      ) : (
        <div className="lie-wrap">
          <div className="lie-head">
            <h2 className="section-title">Your lie</h2>
            {!isPlain(lie) && (
              <button className="link-btn" onClick={() => setLie(PLAIN_LIE)}>
                Reset
              </button>
            )}
          </div>
          <LiePicker lie={lie} onChange={setLie} />
          {!lieSet && mapSlopes.length > 0 && (
            <p className="field-hint" data-testid="lie-from-map">
              Slope set from the ground heights. GPS is a few metres out, so check it and tap to change.
            </p>
          )}
        </div>
      )
    ) : null
  const windBlock =
    adviceInput && position && !farAway && !onGreen ? (
      <div className="lie-wrap">
        <div className="lie-head">
          <h2 className="section-title">Wind</h2>
        </div>
        <WindPicker dirs={windDirs} strength={windStrength} onDirs={setWindDirs} onStrength={setWindStrength} />
        <p className="field-hint" data-testid="wind-hint">
          {windNow && windNow.fromDeg !== null && windStrength !== 'calm'
            ? `About ${WIND_KMH[windStrength]} km/h. Set once: it follows you round, showing which way it blows on each shot. Change it whenever it shifts.`
            : windStrength !== 'calm'
              ? 'Now tap which way it blows on this shot.'
              : 'Tap which way it blows on this shot, and how hard. Set it once and it follows you round.'}
        </p>
      </div>
    ) : null
  const rangefinderBlock = ring && (
    <div className="rf-block">
      <NumberField
        label="Rangefinder to the flag"
        name="rangefinder"
        unit={u}
        value={rf === null ? null : toDisplay(rf, units)}
        onChange={(v) =>
          setRangefinder((r) => ({ ...r, [hole]: v === null ? null : { m: fromDisplay(v, units), at: position } }))
        }
        hint={
          rfOld
            ? `Your last reading (${formatDistance(rfEntry!.m, units)} ${u}) was from ${formatDistance(rfMovedM, units)} ${u} back, so it's no longer used. Type a new one from here.`
            : rf !== null
              ? 'Club advice is playing to this reading.'
              : 'Type in your rangefinder reading and the club advice plays to it instead of the green middle.'
        }
      />
      {rfMismatch && (
        <p className="msg msg-warn">
          That doesn't fit between the front and back of the green from here. The GPS or this green's outline may be
          off. Worth checking this hole in the course map.
        </p>
      )}
    </div>
  )
  const trustLine = ring && (
    <p className="field-hint trust-line">
      Green: {TRUST_LABEL[green!.trust]}
      {verifiedMiddle && ', middle checked by GPS'}. Hole {report.status === 'ready' ? 'fully mapped' : 'still being mapped'}.
    </p>
  )

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

      {liveRound && (
        <div className="round-bar" data-testid="round-bar">
          <span>
            Round:{' '}
            {(() => {
              const t = roundTotals(liveRound, COURSE.tees.find((x) => x.id === liveRound.teeId) ?? COURSE.tees[0])
              return t.played === 0 ? 'no holes scored yet' : `${formatToPar(t.toPar)} through ${t.played}`
            })()}
          </span>
          <button className="btn btn-small" onClick={() => scoreHole(hole)}>
            Score hole {hole}
          </button>
        </div>
      )}

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
          {lieBlock}
          {windBlock}
          {!onGreen && rangefinderBlock}
          {adviceInput && (position || rf !== null) && (
            <Advice input={adviceInput} units={units} onStrategy={setStrategy} goToBag={goToBag} chat onSetLie={setLie} onSetWind={applyWind} />
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
              plan={view === 'map' ? plan : null}
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
          {lieBlock}
          {windBlock}
          {!onGreen && !farAway && rangefinderBlock}
          {adviceInput && position && !farAway && (
            <Advice input={adviceInput} units={units} onStrategy={setStrategy} goToBag={goToBag} onPlan={setPlan} table />
          )}
        </>
      )}

      {ring && position && !farAway && (
        <>
          <h2 className="section-title">Hazards</h2>
          <HazardList hazards={hazards} boundaries={boundaries} units={units} />
        </>
      )}

      {trustLine}

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
    {
      title: 'Club advice',
      state: 'later',
      detail: 'Club, aim and the reasons, for safe, normal or aggressive play. Works once a green is traced and your clubs have distances.',
    },
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

interface AdviceInput {
  features: CourseFeature[]
  hole: number
  green: LngLat[]
  middle: LngLat
  greenTrust: TrustLevel
  position: LngLat | null
  source: 'gps' | 'manual' | 'none'
  accuracyM: number | null
  stale: boolean
  rf: number | null
  fromTee: boolean
  lie: Lie
  heightAt: HeightAt | null
  terrainVersion: number
  wind: ShotWind | null
  clubs: Club[]
  strategy: Strategy
}

/** Runs the caddie engine (only when something it uses has changed) and shows the call. */
function Advice({
  input,
  units,
  onStrategy,
  goToBag,
  onPlan,
  table,
  chat,
  onSetLie,
  onSetWind,
}: {
  input: AdviceInput
  units: AppData['profile']['units']
  onStrategy: (s: Strategy) => void
  goToBag: () => void
  onPlan?: (p: { aim: LngLat; zone: LngLat[] } | null) => void
  table?: boolean
  chat?: boolean
  onSetLie?: (l: Lie) => void
  onSetWind?: (w: { dirs: WindDir[]; strength: WindStrength | null }) => void
}) {
  const { features, hole, green, middle, greenTrust, position, source, accuracyM, stale, rf, fromTee, lie, heightAt, terrainVersion, wind, clubs, strategy } = input
  const windKey = wind ? `${wind.head.toFixed(2)}|${wind.cross.toFixed(2)}|${wind.kmh}` : ''
  const lieKey = `${lie.surface}|${[...lie.slopes].sort().join(',')}`
  // GPS readings jiggle by a metre or so every second; round to about 2 m so the advice only reworks on real moves.
  const lng = position ? Math.round(position[0] * 5e4) / 5e4 : null
  const lat = position ? Math.round(position[1] * 5e4) / 5e4 : null
  const acc = accuracyM === null ? null : Math.round(accuracyM)
  const engineInput: CaddieInput = useMemo(
    () => ({
        position: lng === null || lat === null ? null : [lng, lat],
        positionSource: source,
        positionAccuracyM: acc,
        positionStale: stale,
        green,
        greenMiddle: middle,
        flagDistanceM: rf,
        fromTee,
        lie,
        heightAt: heightAt ?? undefined,
        wind,
        corners: lineOf(findLineOfPlay(features, hole))?.slice(1, -1) ?? [],
        hazards: features.filter(isHazard),
        greenTrust,
        clubs,
        strategy,
      }),
    // green and middle come from features and hole
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, hole, lng, lat, source, acc, stale, rf, fromTee, lieKey, heightAt, terrainVersion, windKey, clubs, strategy, greenTrust],
  )
  const result: CaddieResult = useMemo(() => recommend(engineInput), [engineInput])
  useEffect(() => {
    if (!onPlan) return
    onPlan(result.kind === 'advice' ? { aim: result.primary.aim, zone: result.primary.zone } : null)
  }, [result, onPlan])
  useEffect(() => () => onPlan?.(null), [onPlan])

  const noDistances = result.kind === 'none' && !clubs.some((c) => c.category !== 'putter' && (c.carryM ?? c.roughM) !== null)
  return (
    <div className="advice-wrap">
      <div className="advice-head">
        <h2 className="section-title">Club advice</h2>
        {result.kind === 'advice' && <StrategyPicker value={strategy} onChange={onStrategy} />}
      </div>
      <AdviceCard result={result} units={units} />
      {noDistances && (
        <button className="btn btn-wide" onClick={goToBag}>
          Add club distances
        </button>
      )}
      {table && <StrategyTable result={result} units={units} />}
      {chat && (
        <CaddieChat
          input={engineInput}
          result={result}
          features={features}
          units={units}
          hole={hole}
          position={position}
          onSetLie={onSetLie}
          onSetWind={onSetWind}
        />
      )}
    </div>
  )
}

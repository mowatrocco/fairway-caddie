import { useState } from 'react'
import type { AppData, Profile } from '../types'
import type { TeeCard, ScorecardHole } from '../types/course'
import type { FairwayResult, HoleScore, Round } from '../types/round'
import type { Action } from '../state/reducer'
import { southHead } from '../data/courses/southHead'
import { backNine, frontNine } from '../lib/calculations/scorecard'
import { formatDistance, unitLabel } from '../lib/calculations/units'
import {
  activeRound,
  formatToPar,
  greenInReg,
  holeProblems,
  nextHoleToScore,
  parOf,
  roundTotals,
  scoreName,
} from '../lib/rounds/score'
import { Choice } from '../components/Fields'
import { newId } from '../lib/id'

interface Props {
  data: AppData
  dispatch: (a: Action) => void
  /** Hole to open on (from the Caddie screen's "Score this hole"). */
  initialHole: number | null
}

const course = southHead
const teeOf = (id: string): TeeCard => course.tees.find((t) => t.id === id) ?? course.tees[0]
const stamp = () => new Date().toISOString()

function when(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

export function RoundPage({ data, dispatch, initialHole }: Props) {
  const live = activeRound(data.rounds)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = viewingId ? (data.rounds.find((r) => r.id === viewingId) ?? null) : null
  const round = viewing ?? live

  if (!round) return <StartView data={data} dispatch={dispatch} onOpen={setViewingId} />
  return (
    <RoundView
      key={round.id}
      round={round}
      profile={data.profile}
      dispatch={dispatch}
      initialHole={round === live ? initialHole : null}
      onClose={viewing ? () => setViewingId(null) : null}
    />
  )
}

// ---------- No round going: start one, or look back ----------

function StartView({ data, dispatch, onOpen }: { data: AppData; dispatch: (a: Action) => void; onOpen: (id: string) => void }) {
  const usual = course.tees.find((t) => t.id === data.profile.usualTees)
  const [teeId, setTeeId] = useState(usual?.id ?? 'white')
  const tee = teeOf(teeId)
  const past = [...data.rounds].reverse()

  return (
    <section className="page" aria-labelledby="round-title">
      <div className="page-head">
        <div>
          <h1 id="round-title">Round</h1>
          <p className="quiet">{course.name}</p>
        </div>
      </div>

      <Choice label="Tees" value={tee.id} options={course.tees.map((t) => ({ value: t.id, label: t.name }))} onChange={setTeeId} />
      <button className="btn btn-primary btn-wide" onClick={() => dispatch({ type: 'startRound', id: newId(), courseId: course.id, teeId, at: stamp() })}>
        Start round
      </button>
      <p className="field-hint">Score each hole as you go. It saves on your phone, so no signal is fine.</p>

      {past.length > 0 && (
        <>
          <h2 className="section-title">Past rounds</h2>
          <ul className="round-list">
            {past.map((r) => {
              const t = roundTotals(r, teeOf(r.teeId))
              return (
                <li key={r.id}>
                  <button className="round-row" onClick={() => onOpen(r.id)}>
                    <span className="round-date">{when(r.startedAt)}</span>
                    <span className="round-meta">
                      {teeOf(r.teeId).name} tees, {t.played === 1 ? '1 hole' : `${t.played} holes`}
                    </span>
                    <span className="round-score">
                      {t.played > 0 ? (
                        <>
                          {t.strokes} <small>({formatToPar(t.toPar)})</small>
                        </>
                      ) : (
                        '–'
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <h2 className="section-title">The card</h2>
      <CourseCard tee={tee} profile={data.profile} />
    </section>
  )
}

// ---------- A round: one hole at a time ----------

function RoundView({
  round,
  profile,
  dispatch,
  initialHole,
  onClose,
}: {
  round: Round
  profile: Profile
  dispatch: (a: Action) => void
  initialHole: number | null
  onClose: (() => void) | null
}) {
  const tee = teeOf(round.teeId)
  const [hole, setHole] = useState(() => initialHole ?? nextHoleToScore(round))
  const [confirm, setConfirm] = useState<'finish' | 'delete' | null>(null)
  const totals = roundTotals(round, tee)
  const h = round.holes[hole - 1]
  const card = tee.holes.find((x) => x.hole === hole)!
  const par = card.par
  const live = round.finishedAt === null
  const unscored = round.holes.filter((x) => x.strokes === null).length
  const u = unitLabel(profile.units)

  const update = (patch: Partial<HoleScore>) => dispatch({ type: 'updateHole', roundId: round.id, hole: { ...h, ...patch } })

  return (
    <section className="page" aria-labelledby="round-title">
      <div className="page-head">
        <div>
          <h1 id="round-title">{live ? 'Round' : when(round.startedAt)}</h1>
          <p className="quiet">
            {tee.name} tees, {live ? `started ${timeOf(round.startedAt)}` : 'finished'}
          </p>
        </div>
        {onClose && (
          <button className="btn btn-small" onClick={onClose}>
            All rounds
          </button>
        )}
      </div>

      <Summary totals={totals} />

      <div className="hole-card" data-testid="hole-card">
        <div className="hole-nav">
          <button className="icon-btn" aria-label="Previous hole" disabled={hole === 1} onClick={() => setHole(hole - 1)}>
            ‹
          </button>
          <div className="hole-title">
            <span className="hole-no">Hole {hole}</span>
            <span className="quiet">
              Par {par}, {formatDistance(card.metres, profile.units)} {u}, index {card.strokeIndex}
            </span>
          </div>
          <button className="icon-btn" aria-label="Next hole" disabled={hole === 18} onClick={() => setHole(hole + 1)}>
            ›
          </button>
        </div>

        <Stepper
          label="Score"
          name="strokes"
          value={h.strokes}
          min={1}
          max={20}
          startUp={par}
          startDown={par - 1}
          onChange={(v) => update({ strokes: v })}
          note={h.strokes !== null ? scoreName(h.strokes, par) : 'Tap + for par'}
        />
        <Stepper label="Putts" name="putts" value={h.putts} min={0} max={10} startUp={2} startDown={1} onChange={(v) => update({ putts: v })} />
        <Stepper
          label="Penalty strokes"
          name="penalties"
          value={h.penalties}
          min={0}
          max={10}
          startUp={1}
          startDown={0}
          onChange={(v) => update({ penalties: v ?? 0 })}
          note="Water, OB, unplayable. Count them in the score too."
        />

        {par >= 4 && (
          <div className="field" role="radiogroup" aria-label="Fairway">
            <span className="field-label">Tee shot</span>
            <div className="chips">
              {(
                [
                  ['left', 'Missed left'],
                  ['hit', 'Fairway'],
                  ['right', 'Missed right'],
                ] as [FairwayResult, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={h.fairway === v}
                  className={h.fairway === v ? 'chip chip-on' : 'chip'}
                  onClick={() => update({ fairway: h.fairway === v ? null : v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {greenInReg(h, par) !== null && (
          <p className="field-hint" data-testid="gir">
            Green in regulation: {greenInReg(h, par) ? 'yes' : 'no'}
          </p>
        )}
        {holeProblems(h).map((p) => (
          <p key={p} className="msg msg-warn">
            {p}
          </p>
        ))}

        {hole < 18 && (
          <button className="btn btn-wide" onClick={() => setHole(hole + 1)}>
            Next hole
          </button>
        )}
      </div>

      <ScoreGrid round={round} tee={tee} current={hole} onPick={setHole} />

      <div className="round-actions">
        {live ? (
          confirm === 'finish' ? (
            <div className="confirm" role="group" aria-label="Finish round">
              <p>{unscored > 0 ? `${unscored} hole${unscored === 1 ? ' has' : 's have'} no score. Finish anyway?` : 'Finish the round?'}</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  dispatch({ type: 'finishRound', roundId: round.id, at: stamp() })
                  setConfirm(null)
                }}
              >
                Finish round
              </button>
              <button className="btn" onClick={() => setConfirm(null)}>
                Keep playing
              </button>
            </div>
          ) : (
            <button className="btn btn-wide" onClick={() => setConfirm('finish')}>
              Finish round
            </button>
          )
        ) : (
          <button className="btn btn-wide" onClick={() => dispatch({ type: 'reopenRound', roundId: round.id, at: stamp() })}>
            Carry on with this round
          </button>
        )}
        {confirm === 'delete' ? (
          <div className="confirm" role="group" aria-label="Delete round">
            <p>Delete this round? This can't be undone.</p>
            <button
              className="btn btn-danger"
              onClick={() => {
                dispatch({ type: 'deleteRound', roundId: round.id })
                onClose?.()
              }}
            >
              Delete round
            </button>
            <button className="btn" onClick={() => setConfirm(null)}>
              Keep it
            </button>
          </div>
        ) : (
          <button className="link-btn link-danger" onClick={() => setConfirm('delete')}>
            Delete this round
          </button>
        )}
      </div>
    </section>
  )
}

function Summary({ totals: t }: { totals: ReturnType<typeof roundTotals> }) {
  if (t.played === 0) return <p className="round-summary quiet">No holes scored yet.</p>
  return (
    <div className="round-summary" data-testid="round-summary">
      <p className="round-big">
        <span className="round-topar">{formatToPar(t.toPar)}</span>
        <span className="quiet">
          {t.strokes} through {t.played}
        </span>
      </p>
      <p className="quiet">
        {t.puttHoles > 0 && `${t.putts} putts`}
        {t.fairways.of > 0 && `${t.puttHoles > 0 ? ', ' : ''}fairways ${t.fairways.hit} of ${t.fairways.of}`}
        {t.greens.of > 0 && `, greens ${t.greens.hit} of ${t.greens.of}`}
        {t.penalties > 0 && `, ${t.penalties} penalty stroke${t.penalties === 1 ? '' : 's'}`}
      </p>
    </div>
  )
}

function Stepper({
  label,
  name,
  value,
  min,
  max,
  startUp,
  startDown,
  onChange,
  note,
}: {
  label: string
  name: string
  value: number | null
  min: number
  max: number
  startUp: number
  startDown: number
  onChange: (v: number | null) => void
  note?: string
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div className="stepper" data-testid={`stepper-${name}`}>
      <div>
        <span className="field-label">{label}</span>
        {note && <span className="field-hint">{note}</span>}
      </div>
      <div className="stepper-controls">
        <button className="step-btn" aria-label={`${label} down`} disabled={value !== null && value <= min} onClick={() => set(value === null ? startDown : value - 1)}>
          −
        </button>
        <output className={value === null ? 'step-value step-empty' : 'step-value'} aria-label={label}>
          {value ?? '–'}
        </output>
        <button className="step-btn" aria-label={`${label} up`} disabled={value !== null && value >= max} onClick={() => set(value === null ? startUp : value + 1)}>
          +
        </button>
      </div>
    </div>
  )
}

function ScoreGrid({ round, tee, current, onPick }: { round: Round; tee: TeeCard; current: number; onPick: (h: number) => void }) {
  const half = (from: number) => {
    const holes = round.holes.slice(from - 1, from + 8)
    const scored = holes.filter((h) => h.strokes !== null)
    return (
      <div className="grid-nine">
        {holes.map((h) => {
          const par = parOf(tee, h.hole)
          const diff = h.strokes === null ? null : h.strokes - par
          const cls = diff === null ? '' : diff < 0 ? 'under' : diff === 0 ? 'level' : diff === 1 ? 'over' : 'over2'
          return (
            <button
              key={h.hole}
              className={`grid-cell ${h.hole === current ? 'grid-on' : ''}`}
              aria-label={`Hole ${h.hole}, par ${par}${h.strokes !== null ? `, ${h.strokes}` : ', no score'}`}
              onClick={() => onPick(h.hole)}
            >
              <span className="grid-hole">{h.hole}</span>
              <span className={`grid-score ${cls}`}>{h.strokes ?? '·'}</span>
            </button>
          )
        })}
        <div className="grid-cell grid-total">
          <span className="grid-hole">{from === 1 ? 'Out' : 'In'}</span>
          <span className="grid-score">{scored.length ? scored.reduce((a, h) => a + h.strokes!, 0) : '–'}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="score-grid" aria-label="Scorecard">
      {half(1)}
      {half(10)}
    </div>
  )
}

// ---------- The printed card, for reference ----------

function CourseCard({ tee, profile }: { tee: TeeCard; profile: Profile }) {
  const u = unitLabel(profile.units)
  const out = frontNine(tee)
  const back = backNine(tee)
  const d = (m: number) => formatDistance(m, profile.units)
  const holeRows = (holes: ScorecardHole[]) =>
    holes.map((h) => (
      <tr key={h.hole}>
        <th scope="row">{h.hole}</th>
        <td>{d(h.metres)}</td>
        <td>{h.par}</td>
        <td className="si">{h.strokeIndex}</td>
      </tr>
    ))
  return (
    <>
      <p className="card-summary">
        <span className="card-total">{d(out.metres + back.metres)}</span> {u}, par {out.par + back.par}. Rating {tee.courseRating}, slope{' '}
        {tee.slope}.
      </p>
      <table className="scorecard">
        <caption className="visually-hidden">{tee.name} tee scorecard</caption>
        <thead>
          <tr>
            <th scope="col">Hole</th>
            <th scope="col">{u === 'm' ? 'Metres' : 'Yards'}</th>
            <th scope="col">Par</th>
            <th scope="col">Index</th>
          </tr>
        </thead>
        <tbody>
          {holeRows(tee.holes.filter((h) => h.hole <= 9))}
          <tr className="subtotal">
            <th scope="row">Out</th>
            <td>{d(out.metres)}</td>
            <td>{out.par}</td>
            <td />
          </tr>
          {holeRows(tee.holes.filter((h) => h.hole >= 10))}
          <tr className="subtotal">
            <th scope="row">In</th>
            <td>{d(back.metres)}</td>
            <td>{back.par}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="field-hint">
        From the club's official scorecard (card {tee.cardNumber}). Distance markers on course measure to the middle of the green:{' '}
        {course.distanceMarkers.map((m) => `${m.colour} ${d(m.toMiddleM)} ${u}`).join(', ')}.
      </p>
    </>
  )
}

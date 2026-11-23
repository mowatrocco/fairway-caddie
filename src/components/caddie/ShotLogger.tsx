import { useState } from 'react'
import type { Club, Units } from '../../types'
import type { Round, Shot, ShotSpot } from '../../types/round'
import type { Action } from '../../state/reducer'
import { formatDistance, unitLabel } from '../../lib/calculations/units'
import { openShot, shotDistance, shotsOnHole } from '../../lib/rounds/shots'
import { newId } from '../../lib/id'

/** For stamping a shot when you tap (not during render). */
const stamp = () => new Date().toISOString()

interface Props {
  round: Round
  hole: number
  bag: Club[]
  units: Units
  /** Where you are now, if the GPS (or a spot set on the map) is good enough to log. */
  spot: ShotSpot | null
  /** The caddie's club for this shot, offered as the one-tap button. */
  pickId: string | null
  /** You're standing on the green of this hole. */
  onGreen: boolean
  /** You're close to the green (chipping range), where a shot might be holed or finish on the green. */
  nearGreen: boolean
  dispatch: (a: Action) => void
}

/**
 * One tap per shot: stand over the ball, tap the club. Where you're standing is where
 * the shot is hit from, and where the last shot on this hole finished.
 */
export function ShotLogger({ round, hole, bag, units, spot, pickId, onGreen, nearGreen, dispatch }: Props) {
  const [choosing, setChoosing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const u = unitLabel(units)
  const clubs = bag.filter((c) => c.category !== 'putter')
  const pick = clubs.find((c) => c.id === pickId) ?? null
  const shots = shotsOnHole(round.shots, hole)
  const open = openShot(round.shots, hole)
  const last = shots[shots.length - 1] ?? null

  const log = (club: Club) => {
    const shot: Shot = {
      id: newId(),
      hole,
      clubId: club.id,
      clubName: club.name,
      at: stamp(),
      from: spot,
      to: null,
      toBy: null,
      result: 'ok',
    }
    dispatch({ type: 'logShot', roundId: round.id, shot })
    setChoosing(false)
    setFlash(spot ? `Shot ${shots.length + 1} logged: ${club.name}.` : `${club.name} logged, but with no position, so no distance for it.`)
  }

  const markHere = () => {
    if (!open || !spot) return
    dispatch({ type: 'markShotFinish', roundId: round.id, shotId: open.id, spot })
    setFlash(`Marked where your ${open.clubName} finished.`)
  }

  const undo = () => {
    if (!last) return
    dispatch({ type: 'deleteShot', roundId: round.id, shotId: last.id })
    setFlash(`Removed shot ${shots.length}: ${last.clubName}.`)
  }

  return (
    <div className="shot-logger" data-testid="shot-logger">
      <div className="shot-head">
        <h2 className="section-title">Shots</h2>
        {last && (
          <button className="link-btn" onClick={undo}>
            Undo last
          </button>
        )}
      </div>

      {shots.length > 0 ? (
        <ol className="shot-line" aria-label={`Shots logged on hole ${hole}`}>
          {shots.map((s, i) => {
            const d = shotDistance(s)
            return (
              <li key={s.id}>
                <span className="shot-no">{i + 1}</span> {s.clubName}
                <span className="shot-dist">
                  {d ? `${d.rough ? '≈' : ''}${formatDistance(d.m, units)} ${u}` : s.result === 'penalty' ? 'penalty' : s.from ? '…' : 'no position'}
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="field-hint">Standing over the ball? Tap the club you're hitting. Putts go on the scorecard.</p>
      )}

      {open && open.from && spot && (onGreen || nearGreen) && (
        <button className={onGreen ? 'btn btn-wide btn-primary' : 'link-btn'} onClick={markHere} data-testid="mark-finish">
          {onGreen ? `On the green: mark where your ${open.clubName} finished` : `Holed it, or on the green? Mark where it finished`}
        </button>
      )}

      {!onGreen && (
        <div className="shot-buttons">
          {pick && !choosing && (
            <button className="btn btn-primary shot-pick" onClick={() => log(pick)} data-testid="log-pick">
              Hitting {pick.name}
            </button>
          )}
          <button className="btn" onClick={() => setChoosing((c) => !c)} aria-expanded={choosing}>
            {choosing ? 'Close' : pick ? 'Other club' : 'Log a shot'}
          </button>
        </div>
      )}
      {choosing && (
        <div className="chips shot-clubs" role="group" aria-label="Club for this shot">
          {clubs.map((c) => (
            <button key={c.id} type="button" className={c.id === pickId ? 'chip chip-on' : 'chip'} onClick={() => log(c)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {!spot && !onGreen && <p className="field-hint">No good GPS fix right now: shots still log, without a distance.</p>}
      <p className="shot-flash" aria-live="polite" data-testid="shot-flash">
        {flash}
      </p>
    </div>
  )
}

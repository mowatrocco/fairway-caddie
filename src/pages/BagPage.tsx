import { useMemo, useState } from 'react'
import type { Club, Units } from '../types'
import type { Action } from '../state/reducer'
import { analyseGaps, gapsNeedingAttention, type Gap } from '../lib/calculations/gaps'
import { formatDistance, toDisplay, unitLabel } from '../lib/calculations/units'
import { blankClub } from '../data/starterBag'
import { ClubEditor } from '../components/ClubEditor'
import { DownIcon, PlusIcon, UpIcon } from '../components/Icons'

interface Props {
  bag: Club[]
  units: Units
  dispatch: (a: Action) => void
}

const confidenceLabel: Record<Club['confidence'], string> = {
  unknown: 'No idea yet',
  guess: 'A guess',
  rough: 'Rough idea',
  measured: 'Measured',
}

export function BagPage({ bag, units, dispatch }: Props) {
  const [editing, setEditing] = useState<{ club: Club; isNew: boolean } | null>(null)
  const [reordering, setReordering] = useState(false)
  const u = unitLabel(units)

  const report = useMemo(() => analyseGaps(bag), [bag])
  const gapByTo = useMemo(() => new Map(report.gaps.map((g) => [g.toId, g])), [report])
  const attention = gapsNeedingAttention(report)
  const unconfirmed = bag.filter((c) => c.roughM !== null).length
  const nameOf = (id: string) => bag.find((c) => c.id === id)?.name ?? ''

  return (
    <section className="page" aria-labelledby="bag-title">
      <div className="page-head">
        <div>
          <h1 id="bag-title">My bag</h1>
          <p className="quiet">{bag.length} clubs, longest first</p>
        </div>
        <button className="btn btn-small" onClick={() => setReordering((r) => !r)} aria-pressed={reordering}>
          {reordering ? 'Done' : 'Reorder'}
        </button>
      </div>

      {unconfirmed > 0 && !reordering && (
        <div className="callout">
          <p>
            {unconfirmed} {unconfirmed === 1 ? 'distance is' : 'distances are'} marked ≈ because {unconfirmed === 1 ? "it isn't" : "they aren't"}{' '}
            confirmed as carry or total. Carry is how far the ball flies. Total includes the roll.
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => dispatch({ type: 'confirmAllRough', as: 'carry' })}>
              They're all carry
            </button>
            <button className="btn" onClick={() => dispatch({ type: 'confirmAllRough', as: 'total' })}>
              They're all total
            </button>
          </div>
          <p className="field-hint">Mixed? Tap each club to set it one at a time.</p>
        </div>
      )}

      {attention.length > 0 && !reordering && (
        <p className="attention-line">
          {attention.length === 1 ? '1 gap to look at' : `${attention.length} gaps to look at`}
        </p>
      )}

      <ol className="ladder">
        {bag.map((club, i) => {
          const gap = gapByTo.get(club.id)
          return (
            <li key={club.id} className="ladder-item">
              {gap && !reordering && <GapMarker gap={gap} units={units} fromName={nameOf(gap.fromId)} />}
              <div className="club-row">
                {reordering ? (
                  <div className="club-main">
                    <span className="club-name">{club.name}</span>
                  </div>
                ) : (
                  <button className="club-main" onClick={() => setEditing({ club, isNew: false })}>
                    <span className="club-name">{club.name}</span>
                    <span className="club-meta">
                      {club.category === 'putter' ? 'Putter' : confidenceLabel[club.confidence]}
                    </span>
                  </button>
                )}
                {reordering ? (
                  <div className="reorder">
                    <button
                      className="icon-btn"
                      aria-label={`Move ${club.name} up`}
                      disabled={i === 0}
                      onClick={() => dispatch({ type: 'moveClub', id: club.id, dir: -1 })}
                    >
                      <UpIcon />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Move ${club.name} down`}
                      disabled={i === bag.length - 1}
                      onClick={() => dispatch({ type: 'moveClub', id: club.id, dir: 1 })}
                    >
                      <DownIcon />
                    </button>
                  </div>
                ) : (
                  <ClubDistance club={club} units={units} unit={u} />
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {!reordering && (
        <button className="btn btn-wide" onClick={() => setEditing({ club: blankClub(), isNew: true })}>
          <PlusIcon /> Add a club
        </button>
      )}

      {editing && (
        <ClubEditor
          club={editing.club}
          units={units}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={(club) => {
            dispatch(editing.isNew ? { type: 'addClub', club } : { type: 'updateClub', club })
            setEditing(null)
          }}
          onDelete={(id) => {
            dispatch({ type: 'deleteClub', id })
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}

function ClubDistance({ club, units, unit }: { club: Club; units: Units; unit: string }) {
  if (club.category === 'putter') return <div className="club-dist club-dist-none">Putting</div>

  if (club.carryM !== null) {
    return (
      <div className="club-dist">
        <span className="dist-num">{formatDistance(club.carryM, units)}</span>
        <span className="dist-label">
          {unit} carry
          {club.totalM !== null && <>, {formatDistance(club.totalM, units)} total</>}
        </span>
      </div>
    )
  }
  if (club.roughM !== null) {
    return (
      <div className="club-dist club-dist-unconfirmed">
        <span className="dist-num">≈{formatDistance(club.roughM, units)}</span>
        <span className="dist-label">{unit} unconfirmed</span>
      </div>
    )
  }
  if (club.totalM !== null) {
    return (
      <div className="club-dist club-dist-unconfirmed">
        <span className="dist-num dist-num-small">{formatDistance(club.totalM, units)}</span>
        <span className="dist-label">{unit} total, carry unknown</span>
      </div>
    )
  }
  return <div className="club-dist club-dist-none">No distance yet</div>
}

function GapMarker({ gap, units, fromName }: { gap: Gap; units: Units; fromName: string }) {
  const u = unitLabel(units)
  const approx = gap.basis === 'unconfirmed' ? '≈' : ''
  const size = `${approx}${Math.round(toDisplay(Math.abs(gap.gapM), units))} ${u}`

  let text: string
  switch (gap.flag) {
    case 'big':
      text = `${size} gap. Nothing in the bag for that distance.`
      break
    case 'tight':
      text = `Only ${size} apart. These two overlap.`
      break
    case 'reversed':
      text = `Goes ${size} further than the club above. Check the order or the numbers.`
      break
    case 'unknown-between':
      text = `${size} below the ${fromName}, with ${gap.skippedIds.length} club${gap.skippedIds.length === 1 ? '' : 's'} between that ${gap.skippedIds.length === 1 ? 'has' : 'have'} no distance`
      break
    default:
      text = size
  }

  const warn = gap.flag === 'big' || gap.flag === 'tight' || gap.flag === 'reversed'
  return (
    <div className={warn ? 'gap gap-warn' : 'gap'}>
      <span className="gap-line" aria-hidden="true" />
      <span className="gap-text">{text}</span>
    </div>
  )
}

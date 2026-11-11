import { useState } from 'react'
import type { Club, ClubCategory, DistanceConfidence, DistanceSource, MissDepth, MissDirection, ShotShape, Units } from '../types'
import { checkClub, confirmRough } from '../lib/calculations/clubs'
import { formatDistance, fromDisplay, toDisplay, unitLabel } from '../lib/calculations/units'
import { Choice, NumberField, TextField } from './Fields'
import { Sheet } from './Sheet'

interface Props {
  club: Club
  units: Units
  isNew: boolean
  onSave: (c: Club) => void
  onDelete: (id: string) => void
  onClose: () => void
}

const categories: { value: ClubCategory; label: string }[] = [
  { value: 'driver', label: 'Driver' },
  { value: 'wood', label: 'Wood' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'iron', label: 'Iron' },
  { value: 'wedge', label: 'Wedge' },
  { value: 'putter', label: 'Putter' },
]

const shapes: { value: ShotShape; label: string }[] = [
  { value: 'unknown', label: 'Not sure' },
  { value: 'straight', label: 'Straight' },
  { value: 'draw', label: 'Draw' },
  { value: 'fade', label: 'Fade' },
  { value: 'hook', label: 'Hook' },
  { value: 'slice', label: 'Slice' },
  { value: 'varies', label: 'Varies' },
]

const missDirections: { value: MissDirection; label: string }[] = [
  { value: 'unknown', label: 'Not sure' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'either', label: 'Either side' },
]

const missDepths: { value: MissDepth; label: string }[] = [
  { value: 'unknown', label: 'Not sure' },
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
  { value: 'either', label: 'Both' },
]

const confidences: { value: DistanceConfidence; label: string }[] = [
  { value: 'unknown', label: 'No idea yet' },
  { value: 'guess', label: 'A guess' },
  { value: 'rough', label: 'Rough idea' },
  { value: 'measured', label: 'Measured' },
]

const sources: { value: DistanceSource; label: string }[] = [
  { value: 'estimate', label: 'My estimate' },
  { value: 'rangefinder', label: 'Rangefinder' },
  { value: 'launch-monitor', label: 'Launch monitor' },
  { value: 'logged-shots', label: 'Logged shots' },
]

export function ClubEditor({ club, units, isNew, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState<Club>(club)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const u = unitLabel(units)
  const check = checkClub(draft)
  const set = (patch: Partial<Club>) => setDraft((d) => ({ ...d, ...patch }))
  const shown = (m: number | null) => (m === null ? null : toDisplay(m, units))
  const stored = (v: number | null) => (v === null ? null : fromDisplay(v, units))
  const isPutter = draft.category === 'putter'

  const footer = (
    <>
      {check.errors.length > 0 && (
        <ul className="msg msg-error" aria-live="polite">
          {check.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={check.errors.length > 0}
          onClick={() => onSave({ ...draft, name: draft.name.trim() })}
        >
          {isNew ? 'Add club' : 'Save club'}
        </button>
      </div>
    </>
  )

  return (
    <Sheet title={isNew ? 'Add a club' : draft.name || 'Club'} onClose={onClose} footer={footer}>
      <TextField label="Name" name="club-name" value={draft.name} onChange={(name) => set({ name })} />
      <Choice label="Type" value={draft.category} options={categories} onChange={(category) => set({ category })} />

      {isPutter ? (
        <p className="quiet">Putters don't need distances. The caddie never recommends a putter for a full shot.</p>
      ) : (
        <>
          {draft.roughM !== null && (
            <div className="callout" role="group" aria-label="Unconfirmed distance">
              <p>
                You noted <strong>{formatDistance(draft.roughM, units)} {u}</strong> for this club. Is that how far it
                flies, or where it stops?
              </p>
              <div className="btn-row">
                <button className="btn" onClick={() => setDraft((d) => confirmRough(d, 'carry'))}>
                  Carry (in the air)
                </button>
                <button className="btn" onClick={() => setDraft((d) => confirmRough(d, 'total'))}>
                  Total (where it stops)
                </button>
              </div>
            </div>
          )}

          <h3 className="group-title">Distance</h3>
          <div className="pair">
            <NumberField
              label="Carry"
              name="carry"
              unit={u}
              value={shown(draft.carryM)}
              onChange={(v) => set({ carryM: stored(v) })}
              hint="In the air"
            />
            <NumberField
              label="Total"
              name="total"
              unit={u}
              value={shown(draft.totalM)}
              onChange={(v) => set({ totalM: stored(v) })}
              hint="Including roll"
            />
          </div>
          <Choice
            label="How sure are you?"
            value={draft.confidence}
            options={confidences}
            onChange={(confidence) => set({ confidence })}
          />
          <Choice label="Where the numbers came from" value={draft.source} options={sources} onChange={(source) => set({ source })} />

          <h3 className="group-title">Shot pattern</h3>
          <Choice label="Usual shape" value={draft.shape} options={shapes} onChange={(shape) => set({ shape })} />
          <Choice
            label="Usual miss, sideways"
            value={draft.missDirection}
            options={missDirections}
            onChange={(missDirection) => set({ missDirection })}
          />
          <Choice
            label="Usual miss, distance"
            value={draft.missDepth}
            options={missDepths}
            onChange={(missDepth) => set({ missDepth })}
          />
          <div className="pair">
            <NumberField
              label="Spread left"
              name="spread-left"
              unit={u}
              value={shown(draft.spreadLeftM)}
              onChange={(v) => set({ spreadLeftM: stored(v) })}
              hint="How far left of target a normal miss ends up"
            />
            <NumberField
              label="Spread right"
              name="spread-right"
              unit={u}
              value={shown(draft.spreadRightM)}
              onChange={(v) => set({ spreadRightM: stored(v) })}
              hint="Same, to the right"
            />
          </div>
        </>
      )}

      <TextField label="Notes" name="notes" multiline value={draft.notes} onChange={(notes) => set({ notes })} />

      {check.warnings.length > 0 && (
        <ul className="msg msg-warn">
          {check.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {!isNew && (
        <div className="danger-zone">
          {confirmingDelete ? (
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </button>
              <button className="btn btn-danger" onClick={() => onDelete(draft.id)}>
                Delete {draft.name || 'club'}
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-danger-text" onClick={() => setConfirmingDelete(true)}>
              Delete this club
            </button>
          )}
        </div>
      )}
    </Sheet>
  )
}

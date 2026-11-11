import type { Units } from '../../types'
import type { FixStatus } from '../../lib/gps/fixStatus'
import type { BoundaryReading, HazardReading } from '../../lib/course/hazards'
import type { GreenDistances } from '../../lib/geo/green'
import { formatDistance, unitLabel } from '../../lib/calculations/units'
import { GRADE_LABEL } from '../../lib/gps/accuracy'

const SIDE_WORD = { left: 'left', right: 'right', across: 'across' } as const

/** GPS state in a few words, coloured by quality. */
export function GpsBadge({ status, manual, units }: { status: FixStatus; manual: boolean; units: Units }) {
  const u = unitLabel(units)
  if (manual) return <span className="gps-badge gps-manual">Position set by hand</span>
  switch (status.kind) {
    case 'off':
      return <span className="gps-badge gps-off">GPS off</span>
    case 'waiting':
      return <span className="gps-badge gps-off">Finding you…</span>
    case 'denied':
      return <span className="gps-badge gps-poor">Location blocked</span>
    case 'unavailable':
      return <span className="gps-badge gps-poor">No GPS signal</span>
    case 'fix':
      if (status.stale) return <span className="gps-badge gps-poor">Last fix {status.ageS} s ago</span>
      return (
        <span className={`gps-badge gps-${status.grade}`}>
          GPS ±{formatDistance(status.accuracyM, units)} {u}, {GRADE_LABEL[status.grade].toLowerCase()}
        </span>
      )
  }
}

/**
 * Front / middle / back. With rough GPS the numbers are dimmed and carry a ± so
 * they never look more exact than they are.
 */
export function GreenNumbers({
  d,
  units,
  roughM,
  compact,
}: {
  d: GreenDistances
  units: Units
  /** Set when the position is only good to this many metres. */
  roughM: number | null
  compact?: boolean
}) {
  const u = unitLabel(units)
  const n = (m: number | null) => (m === null ? '—' : formatDistance(m, units))
  const cls = `green-numbers${compact ? ' green-numbers-compact' : ''}${roughM ? ' green-numbers-rough' : ''}`
  return (
    <div className={cls} aria-label="Distances to the green">
      <div className="gn-row gn-back">
        <span className="gn-label">Back</span>
        <span className="gn-val">{n(d.backM)}</span>
      </div>
      <div className="gn-row gn-middle">
        <span className="gn-label">Middle</span>
        <span className="gn-val" data-testid="middle-distance">
          {n(d.middleM)}
        </span>
        <span className="gn-unit">
          {u}
          {roughM && <span className="gn-pm"> ±{formatDistance(roughM, units)}</span>}
        </span>
      </div>
      <div className="gn-row gn-front">
        <span className="gn-label">Front</span>
        <span className="gn-val">{n(d.frontM)}</span>
      </div>
    </div>
  )
}

export function HazardList({
  hazards,
  boundaries,
  units,
}: {
  hazards: HazardReading[]
  boundaries: BoundaryReading[]
  units: Units
}) {
  const u = unitLabel(units)
  const n = (m: number) => formatDistance(m, units)
  if (hazards.length === 0 && boundaries.length === 0) {
    return <p className="quiet">No mapped hazards near your line to the green.</p>
  }
  return (
    <ul className="hazards">
      {boundaries.map((b) => (
        <li key={b.id} className="hazard hazard-ob">
          <span className="hz-name">Out of bounds {SIDE_WORD[b.side]}</span>
          <span className="hz-nums">
            {b.side === 'across' ? `crosses at ${n(b.atM)} ${u}` : `${n(b.clearanceM)} ${u} off your line`}
          </span>
        </li>
      ))}
      {hazards.map((h) => (
        <li key={h.id} className={`hazard hazard-${h.kind}`}>
          <span className="hz-name">
            {h.label} {SIDE_WORD[h.side]}
            {h.trust === 'estimated' && <span className="hz-trust"> (estimated)</span>}
          </span>
          <span className="hz-nums">
            {h.reachM === 0 ? 'you are in it' : `${n(h.reachM)} reach`}, {n(h.carryM)} carry
          </span>
        </li>
      ))}
    </ul>
  )
}

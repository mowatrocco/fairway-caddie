import type { Club } from '../../types'
import type { Round, Shot, ShotResult, ShotSpot } from '../../types/round'
import { distanceM } from '../geo/geodesic'
import { FAIR_M } from '../gps/accuracy'

/**
 * Shot logging. You tap a club when you're standing over the ball, so each shot
 * starts where you are. Where it finished is the spot you hit your next shot
 * from on the same hole, or a spot you mark (on the green, say).
 */

/** Shots on one hole, in the order played. */
export function shotsOnHole(shots: Shot[], hole: number): Shot[] {
  return shots.filter((s) => s.hole === hole)
}

/** The previous and next shot on the same hole as `index` (an index into `shots`). */
function neighbours(shots: Shot[], index: number): { prev: number; next: number } {
  const hole = shots[index].hole
  let prev = -1
  let next = -1
  for (let i = index - 1; i >= 0; i--)
    if (shots[i].hole === hole) {
      prev = i
      break
    }
  for (let i = index + 1; i < shots.length; i++)
    if (shots[i].hole === hole) {
      next = i
      break
    }
  return { prev, next }
}

/**
 * Add a shot. If the shot before it on this hole has no finish yet, it finished
 * where you're standing now. A penalty shot doesn't: after water or OB you play
 * from somewhere else.
 */
export function addShot(shots: Shot[], shot: Shot): Shot[] {
  const out = [...shots, shot]
  const { prev } = neighbours(out, out.length - 1)
  if (prev !== -1 && shot.from !== null) {
    const p = out[prev]
    if (p.to === null && p.result !== 'penalty') out[prev] = { ...p, to: shot.from, toBy: 'next-shot' }
  }
  return out
}

/**
 * Remove a shot. If the shot before it took its finish from this one, it takes it
 * from the next shot instead, or goes back to having no finish.
 */
export function removeShot(shots: Shot[], id: string): Shot[] {
  const i = shots.findIndex((s) => s.id === id)
  if (i === -1) return shots
  const { prev, next } = neighbours(shots, i)
  const out = [...shots]
  if (prev !== -1 && out[prev].toBy === 'next-shot') {
    const from = next !== -1 ? out[next].from : null
    out[prev] = from ? { ...out[prev], to: from, toBy: 'next-shot' } : { ...out[prev], to: null, toBy: null }
  }
  out.splice(i, 1)
  return out
}

/** Mark where a shot finished, by hand or from where you're standing. */
export function markFinish(shots: Shot[], id: string, spot: ShotSpot | null): Shot[] {
  return shots.map((s) => (s.id === id ? { ...s, to: spot, toBy: spot ? 'marked' : null } : s))
}

/** Change the club or the result of a shot. */
export function editShot(shots: Shot[], id: string, patch: { club?: Club; result?: ShotResult }): Shot[] {
  return shots.map((s) => {
    if (s.id !== id) return s
    const next = { ...s }
    if (patch.club) {
      next.clubId = patch.club.id
      next.clubName = patch.club.name
    }
    if (patch.result) next.result = patch.result
    return next
  })
}

/** The last shot on a hole that still has no finish, if it's the last shot on that hole. */
export function openShot(shots: Shot[], hole: number): Shot | null {
  const on = shotsOnHole(shots, hole)
  const last = on[on.length - 1]
  return last && last.to === null ? last : null
}

export interface ShotDistance {
  /** From where it was hit to where it finished (carry + roll), metres. */
  m: number
  /** Either end came from GPS worse than fair, so it could be well out. */
  rough: boolean
}

/** How far a shot went, when both ends are known. */
export function shotDistance(s: Shot): ShotDistance | null {
  if (!s.from || !s.to) return null
  const rough = [s.from.accuracyM, s.to.accuracyM].some((a) => a !== null && a > FAIR_M)
  return { m: distanceM(s.from.point, s.to.point), rough }
}

/** A shot whose distance can be trusted for a club's numbers. */
export function countsForDistance(s: Shot): boolean {
  const d = shotDistance(s)
  return s.result === 'ok' && d !== null && !d.rough
}

export interface ClubLine {
  clubId: string
  clubName: string
  /** Every shot logged with this club. */
  shots: number
  /** Shots with a distance that can be trusted (fine result, both ends from fair GPS or set by hand). */
  measured: number
  averageM: number | null
  longestM: number | null
}

/**
 * Shots by club, in bag order (clubs no longer in the bag go last).
 * Distances are to where the ball finished, so they include roll.
 */
export function clubLines(shots: Shot[], bag: Club[]): ClubLine[] {
  const byId = new Map<string, ClubLine & { sum: number }>()
  for (const s of shots) {
    let line = byId.get(s.clubId)
    if (!line) {
      line = { clubId: s.clubId, clubName: s.clubName, shots: 0, measured: 0, averageM: null, longestM: null, sum: 0 }
      byId.set(s.clubId, line)
    }
    line.shots++
    if (countsForDistance(s)) {
      const m = shotDistance(s)!.m
      line.measured++
      line.sum += m
      line.longestM = Math.max(line.longestM ?? 0, m)
    }
  }
  const order = (id: string) => {
    const i = bag.findIndex((c) => c.id === id)
    return i === -1 ? bag.length : i
  }
  return [...byId.values()]
    .map(({ sum, ...l }) => ({ ...l, clubName: bag.find((c) => c.id === l.clubId)?.name ?? l.clubName, averageM: l.measured ? sum / l.measured : null }))
    .sort((a, b) => order(a.clubId) - order(b.clubId))
}

/** Shots in a round with no finish yet, other than penalties. */
export function unfinishedShots(round: Round): number {
  return round.shots.filter((s) => s.to === null && s.result !== 'penalty').length
}

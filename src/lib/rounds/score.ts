import type { TeeCard } from '../../types/course'
import type { HoleScore, Round } from '../../types/round'

export function emptyHoles(): HoleScore[] {
  return Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, strokes: null, putts: null, penalties: 0, fairway: null }))
}

export function parOf(tee: TeeCard, hole: number): number {
  return tee.holes.find((h) => h.hole === hole)?.par ?? 4
}

/** Green in regulation: on the green with two putts left for par (needs strokes and putts). */
export function greenInReg(h: HoleScore, par: number): boolean | null {
  if (h.strokes === null || h.putts === null) return null
  return h.strokes - h.putts <= par - 2
}

/** Things that don't add up on a hole, in plain words. */
export function holeProblems(h: HoleScore): string[] {
  const out: string[] = []
  if (h.strokes !== null && h.putts !== null && h.putts + h.penalties >= h.strokes + (h.putts === 0 ? 1 : 0))
    out.push("Putts and penalties add up to the whole score or more. That only works if you didn't hit a shot to the green.")
  if (h.strokes !== null && h.penalties >= h.strokes) out.push('More penalty strokes than strokes.')
  return out
}

export interface RoundTotals {
  /** Holes with a score. */
  played: number
  strokes: number
  /** Against par for the holes played. */
  toPar: number
  putts: number
  /** Holes where putts were entered. */
  puttHoles: number
  penalties: number
  fairways: { hit: number; of: number; left: number; right: number }
  greens: { hit: number; of: number }
  out: { strokes: number; par: number; played: number }
  in: { strokes: number; par: number; played: number }
}

export function roundTotals(round: Round, tee: TeeCard): RoundTotals {
  const t: RoundTotals = {
    played: 0,
    strokes: 0,
    toPar: 0,
    putts: 0,
    puttHoles: 0,
    penalties: 0,
    fairways: { hit: 0, of: 0, left: 0, right: 0 },
    greens: { hit: 0, of: 0 },
    out: { strokes: 0, par: 0, played: 0 },
    in: { strokes: 0, par: 0, played: 0 },
  }
  for (const h of round.holes) {
    if (h.strokes === null) continue
    const par = parOf(tee, h.hole)
    const half = h.hole <= 9 ? t.out : t.in
    t.played++
    t.strokes += h.strokes
    t.toPar += h.strokes - par
    t.penalties += h.penalties
    half.strokes += h.strokes
    half.par += par
    half.played++
    if (h.putts !== null) {
      t.putts += h.putts
      t.puttHoles++
    }
    if (par >= 4 && h.fairway !== null) {
      t.fairways.of++
      if (h.fairway === 'hit') t.fairways.hit++
      else t.fairways[h.fairway]++
    }
    const gir = greenInReg(h, par)
    if (gir !== null) {
      t.greens.of++
      if (gir) t.greens.hit++
    }
  }
  return t
}

/** "+3", "−1", "E" */
export function formatToPar(n: number): string {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`
}

/** The first hole without a score (or 18 when all are done). */
export function nextHoleToScore(round: Round): number {
  return round.holes.find((h) => h.strokes === null)?.hole ?? 18
}

export function activeRound(rounds: Round[]): Round | null {
  for (let i = rounds.length - 1; i >= 0; i--) if (rounds[i].finishedAt === null) return rounds[i]
  return null
}

/** Name for a score against par on one hole. */
export function scoreName(strokes: number, par: number): string {
  const d = strokes - par
  if (strokes === 1) return 'Hole in one'
  return d <= -3 ? 'Albatross' : d === -2 ? 'Eagle' : d === -1 ? 'Birdie' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double' : d === 3 ? 'Triple' : `+${d}`
}

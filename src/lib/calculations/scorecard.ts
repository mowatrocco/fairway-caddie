import type { ScorecardHole, TeeCard } from '../../types/course'

export interface NineTotals {
  metres: number
  par: number
}

export function sumHoles(holes: ScorecardHole[]): NineTotals {
  return holes.reduce((t, h) => ({ metres: t.metres + h.metres, par: t.par + h.par }), { metres: 0, par: 0 })
}

export function frontNine(tee: TeeCard): NineTotals {
  return sumHoles(tee.holes.filter((h) => h.hole <= 9))
}

export function backNine(tee: TeeCard): NineTotals {
  return sumHoles(tee.holes.filter((h) => h.hole >= 10))
}

/** Problems with a tee's scorecard data. Empty list = good. */
export function checkTeeCard(tee: TeeCard): string[] {
  const problems: string[] = []
  const name = `${tee.name} tee`

  if (tee.holes.length !== 18) problems.push(`${name}: has ${tee.holes.length} holes, expected 18.`)
  tee.holes.forEach((h, i) => {
    if (h.hole !== i + 1) problems.push(`${name}: row ${i + 1} is labelled hole ${h.hole}.`)
    if (h.par < 3 || h.par > 6) problems.push(`${name} hole ${h.hole}: par ${h.par} is outside 3–6.`)
    if (h.metres < 50 || h.metres > 650) problems.push(`${name} hole ${h.hole}: ${h.metres} m looks wrong.`)
  })

  const indexes = tee.holes.map((h) => h.strokeIndex).sort((a, b) => a - b)
  const expected = Array.from({ length: 18 }, (_, i) => i + 1)
  if (indexes.join(',') !== expected.join(',')) {
    problems.push(`${name}: stroke indexes must be 1 to 18, each used once.`)
  }

  const out = frontNine(tee)
  const back = backNine(tee)
  const p = tee.printed
  if (out.metres !== p.outMetres) problems.push(`${name}: front nine adds to ${out.metres} m, card says ${p.outMetres}.`)
  if (back.metres !== p.inMetres) problems.push(`${name}: back nine adds to ${back.metres} m, card says ${p.inMetres}.`)
  if (out.metres + back.metres !== p.totalMetres)
    problems.push(`${name}: total adds to ${out.metres + back.metres} m, card says ${p.totalMetres}.`)
  if (out.par !== p.outPar) problems.push(`${name}: front nine par adds to ${out.par}, card says ${p.outPar}.`)
  if (back.par !== p.inPar) problems.push(`${name}: back nine par adds to ${back.par}, card says ${p.inPar}.`)
  if (out.par + back.par !== p.totalPar)
    problems.push(`${name}: total par adds to ${out.par + back.par}, card says ${p.totalPar}.`)

  return problems
}

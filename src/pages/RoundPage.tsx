import { useState } from 'react'
import type { Profile } from '../types'
import { southHead } from '../data/courses/southHead'
import { backNine, frontNine } from '../lib/calculations/scorecard'
import { formatDistance, unitLabel } from '../lib/calculations/units'
import { Choice } from '../components/Fields'
import type { ScorecardHole } from '../types/course'

interface Props {
  profile: Profile
}

export function RoundPage({ profile }: Props) {
  const course = southHead
  const usual = course.tees.find((t) => t.id === profile.usualTees)
  const [teeId, setTeeId] = useState(usual?.id ?? 'white')
  const tee = course.tees.find((t) => t.id === teeId) ?? course.tees[0]
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
    <section className="page" aria-labelledby="round-title">
      <div className="page-head">
        <div>
          <h1 id="round-title">Round</h1>
          <p className="quiet">{course.name}</p>
        </div>
      </div>

      <Choice
        label="Tees"
        value={tee.id}
        options={course.tees.map((t) => ({ value: t.id, label: t.name }))}
        onChange={setTeeId}
      />

      <p className="card-summary">
        <span className="card-total">{d(out.metres + back.metres)}</span> {u}, par {out.par + back.par}. Rating{' '}
        {tee.courseRating}, slope {tee.slope}.
      </p>

      <table className="scorecard">
        <caption className="visually-hidden">
          {tee.name} tee scorecard
        </caption>
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
        From the club's official scorecard (card {tee.cardNumber}). Distance markers on course measure to the middle of
        the green: {course.distanceMarkers.map((m) => `${m.colour} ${d(m.toMiddleM)} ${u}`).join(', ')}.
      </p>

      <h2 className="section-title">Logging a round</h2>
      <p className="quiet">
        Score, putts, penalties and a one-tap shot log arrive once South Head is mapped.
      </p>
    </section>
  )
}

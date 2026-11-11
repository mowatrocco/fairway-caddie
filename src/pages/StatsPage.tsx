import type { AppData } from '../types'
import { analyseGaps, gapsNeedingAttention } from '../lib/calculations/gaps'

interface Props {
  data: AppData
}

/** Stage 1 dashboard: how complete the bag data is. Round stats come later. */
export function StatsPage({ data }: Props) {
  const clubs = data.bag.filter((c) => c.category !== 'putter')
  const report = analyseGaps(data.bag)
  const n = clubs.length

  const rows = [
    { label: 'Clubs with a confirmed carry', value: clubs.filter((c) => c.carryM !== null).length, of: n },
    { label: 'Clubs with a total distance', value: clubs.filter((c) => c.totalM !== null).length, of: n },
    { label: 'Clubs with any distance', value: n - report.missingIds.length, of: n },
    {
      label: 'Clubs with left/right spread',
      value: clubs.filter((c) => c.spreadLeftM !== null && c.spreadRightM !== null).length,
      of: n,
    },
    { label: 'Clubs with a usual miss', value: clubs.filter((c) => c.missDirection !== 'unknown').length, of: n },
  ]
  const attention = gapsNeedingAttention(report).length

  return (
    <section className="page" aria-labelledby="stats-title">
      <div className="page-head">
        <div>
          <h1 id="stats-title">Stats</h1>
          <p className="quiet">Your numbers, and how much the caddie has to work with</p>
        </div>
      </div>

      <h2 className="section-title">Bag data</h2>
      <ul className="meter-list">
        {rows.map((r) => (
          <li key={r.label} className="meter">
            <span className="meter-label">{r.label}</span>
            <span className="meter-value">
              {r.value}
              <span className="meter-of"> of {r.of}</span>
            </span>
            <span className="meter-bar" aria-hidden="true">
              <span className="meter-fill" style={{ width: `${r.of ? (r.value / r.of) * 100 : 0}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className={attention ? 'attention-line' : 'quiet'}>
        {attention === 0 ? 'No distance gaps need attention.' : `${attention} distance ${attention === 1 ? 'gap needs' : 'gaps need'} attention in My Bag.`}
      </p>

      <h2 className="section-title">Rounds</h2>
      <p className="quiet">
        No rounds logged yet. Scoring, fairways, greens, putts and club performance appear here after your first
        round.
      </p>
    </section>
  )
}

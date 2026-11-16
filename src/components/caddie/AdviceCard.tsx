import type { Units } from '../../types'
import type { CaddieResult } from '../../lib/caddie/engine'
import { pct } from '../../lib/caddie/engine'
import { STRATEGY_LABEL, type Strategy } from '../../lib/caddie/scoring'
import { formatDistance, unitLabel } from '../../lib/calculations/units'
import { OPPOSITE, SLOPE_LABEL, SURFACE_LABEL, type Lie, type Slope, type Surface } from '../../lib/caddie/lie'

const CONF_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const

export function StrategyPicker({ value, onChange }: { value: Strategy; onChange: (s: Strategy) => void }) {
  return (
    <div className="strategy" role="radiogroup" aria-label="Strategy">
      {(['safe', 'normal', 'aggressive'] as Strategy[]).map((s) => (
        <button key={s} role="radio" aria-checked={value === s} className={value === s ? 'chip chip-on' : 'chip'} onClick={() => onChange(s)}>
          {STRATEGY_LABEL[s]}
        </button>
      ))}
    </div>
  )
}

/** The caddie's call: club, aim, why, and how sure it is. */
export function AdviceCard({ result, units }: { result: CaddieResult; units: Units }) {
  const u = unitLabel(units)
  const d = (m: number) => `${formatDistance(m, units)} ${u}`

  if (result.kind === 'none') {
    return (
      <div className="advice advice-quiet" data-testid="advice">
        <p>{result.reason}</p>
      </div>
    )
  }
  if (result.kind === 'part-swing') {
    return (
      <div className="advice advice-quiet" data-testid="advice">
        <p className="advice-club">Part swing</p>
        <p>{result.reason}</p>
      </div>
    )
  }
  if (result.kind === 'distance-only') {
    return (
      <div className="advice" data-testid="advice">
        <p className="advice-club">{result.clubName}</p>
        <p className="advice-aim">
          Carries about {d(result.carryM)}, finishes around {d(result.totalM)}. Flag {d(result.targetM)} (rangefinder).
        </p>
        <p className="msg msg-warn">{result.reason}</p>
        <p className="advice-conf conf-low">Confidence: Low</p>
      </div>
    )
  }

  const p = result.primary
  return (
    <div className="advice" data-testid="advice">
      <p className="advice-target">
        {result.pinSource === 'rangefinder'
          ? `Playing to your rangefinder: ${d(result.targetM)} to the flag`
          : `Playing to the green middle: ${d(result.targetM)}`}
        {result.playsLikeM !== null &&
          result.heightDiffM !== null &&
          Math.abs(result.heightDiffM) >= 2 &&
          `, plays ${d(result.playsLikeM)} (${Math.round(Math.abs(result.heightDiffM))} m ${result.heightDiffM > 0 ? 'up' : 'down'})`}
      </p>
      <div className="advice-top">
        <p className="advice-club">{p.clubName}</p>
        <span className={`advice-conf conf-${result.confidence.level}`}>Confidence: {CONF_LABEL[result.confidence.level]}</span>
      </div>
      <p className="advice-aim">{p.aimText}.</p>
      <p className="advice-nums">
        Carry {d(p.carryM)}, finishes ~{d(p.totalM)}
        {p.rollKnown ? '' : ' (roll estimated)'}
      </p>
      <p className="advice-odds">
        {p.layup ? `Leaves about ${d(p.leaveM)}` : `On the green ${pct(p.pGreen)}`}
        {', '}penalty {pct(p.pPenalty)}
        {p.pBunker >= 0.03 && `, bunker ${pct(p.pBunker)}`}
      </p>
      {p.watchOut.length > 0 && <p className="advice-watch">Watch: {p.watchOut.join(', ')}</p>}
      <ul className="advice-why">
        {result.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {result.alternative && (
        <p className="advice-alt">
          Or: {result.alternative.clubName}, {result.alternative.aimText.charAt(0).toLowerCase() + result.alternative.aimText.slice(1)}.
        </p>
      )}
      {result.confidence.because.length > 0 && (
        <p className="field-hint">Confidence is {result.confidence.level} because {result.confidence.because.join(', and ')}.</p>
      )}
      {result.notes
        .filter((n) => n.startsWith('Wind'))
        .map((n) => (
          <p key={n} className="field-hint">
            {n}
          </p>
        ))}
      <details className="advice-more">
        <summary>How this was worked out</summary>
        <ul>
          {result.notes
            .filter((n) => !n.startsWith('Wind'))
            .map((n) => (
              <li key={n}>{n}</li>
            ))}
          <li>
            Each club was tried along several aim lines, a few hundred simulated shots each, using your carry, spread and usual
            miss. {STRATEGY_LABEL[result.strategy]} picks the best plan
            {result.strategy === 'safe'
              ? ' that keeps the penalty chance at or under 5% where any plan can'
              : result.strategy === 'normal'
                ? ', counting penalty strokes as extra costly'
                : ' on average score alone'}
            .
          </li>
        </ul>
      </details>
    </div>
  )
}

/** All three strategies side by side, for the Map view. */
export function StrategyTable({ result, units }: { result: CaddieResult; units: Units }) {
  if (result.kind !== 'advice') return null
  return (
    <table className="strategy-table">
      <caption className="visually-hidden">What each strategy would play</caption>
      <thead>
        <tr>
          <th scope="col">Strategy</th>
          <th scope="col">Club and aim</th>
          <th scope="col">Penalty</th>
        </tr>
      </thead>
      <tbody>
        {(['safe', 'normal', 'aggressive'] as Strategy[]).map((s) => {
          const p = result.byStrategy[s]
          return (
            <tr key={s} className={s === result.strategy ? 'row-on' : ''}>
              <th scope="row">{STRATEGY_LABEL[s]}</th>
              <td>
                {p.clubName}
                <span className="st-aim">
                  {p.aimText}, finishes ~{formatDistance(p.totalM, units)} {unitLabel(units)}
                </span>
              </td>
              <td>{pct(p.pPenalty)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** How the ball's sitting: one surface, plus any slopes. */
export function LiePicker({ lie, onChange }: { lie: Lie; onChange: (l: Lie) => void }) {
  const toggleSlope = (s: Slope) => {
    const on = lie.slopes.includes(s)
    const slopes = on ? lie.slopes.filter((x) => x !== s) : [...lie.slopes.filter((x) => x !== OPPOSITE[s]), s]
    onChange({ ...lie, slopes })
  }
  return (
    <div className="lie" data-testid="lie">
      <div className="lie-row" role="radiogroup" aria-label="Ball is in">
        {(Object.keys(SURFACE_LABEL) as Surface[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={lie.surface === s}
            className={lie.surface === s ? 'chip chip-on' : 'chip'}
            onClick={() => onChange({ ...lie, surface: s })}
          >
            {SURFACE_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="lie-row" role="group" aria-label="Slope">
        {(Object.keys(SLOPE_LABEL) as Slope[]).map((s) => (
          <button key={s} aria-pressed={lie.slopes.includes(s)} className={lie.slopes.includes(s) ? 'chip chip-on' : 'chip'} onClick={() => toggleSlope(s)}>
            {SLOPE_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

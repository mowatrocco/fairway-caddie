import type { Units } from '../../types'
import type { CaddieResult } from '../../lib/caddie/engine'
import { pct } from '../../lib/caddie/engine'
import { STRATEGY_LABEL, type Strategy } from '../../lib/caddie/scoring'
import { formatDistance, unitLabel } from '../../lib/calculations/units'
import { OPPOSITE, SLOPE_LABEL, SURFACE_LABEL, type Lie, type Slope, type Surface } from '../../lib/caddie/lie'
import { OPPOSITE_WIND, WIND_DIR_LABEL, WIND_KMH, WIND_STRENGTH_LABEL, type WindDir, type WindStrength } from '../../lib/caddie/wind'

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

/**
 * The call at a glance, for the Caddie screen: club, aim, odds. The whole card is a
 * button that opens the full reasons.
 */
export function AdviceSummary({ result, units, onOpen }: { result: CaddieResult; units: Units; onOpen: () => void }) {
  const u = unitLabel(units)
  const d = (m: number) => `${formatDistance(m, units)} ${u}`
  const why = <span className="sum-why">Why ›</span>

  if (result.kind === 'none') {
    return (
      <div className="advice-sum advice-sum-quiet" data-testid="advice">
        <p>{result.reason}</p>
      </div>
    )
  }
  if (result.kind === 'part-swing') {
    return (
      <button className="advice-sum advice-sum-quiet" data-testid="advice" onClick={onOpen}>
        <span className="sum-top">
          <span className="advice-club">Part swing</span>
          {why}
        </span>
        <span className="sum-line">
          {d(result.targetM)}: inside your {result.shortestClub} ({d(result.shortestCarryM)})
        </span>
      </button>
    )
  }
  if (result.kind === 'distance-only') {
    return (
      <button className="advice-sum" data-testid="advice" onClick={onOpen}>
        <span className="sum-top">
          <span className="advice-club">{result.clubName}</span>
          <span className="advice-conf conf-low">Low</span>
        </span>
        <span className="sum-line">
          Carries ~{d(result.carryM)} to your rangefinder {d(result.targetM)}. No position, so no aim.
        </span>
        <span className="sum-odds">{why}</span>
      </button>
    )
  }

  const p = result.primary
  const plays = result.playsLikeM !== null && Math.abs(result.playsLikeM - result.targetM) >= 2 ? ` · plays ${d(result.playsLikeM)}${playsWhy(result)}` : ''
  return (
    <button className="advice-sum" data-testid="advice" onClick={onOpen}>
      <span className="sum-top">
        <span className="advice-club">{p.clubName}</span>
        <span className={`advice-conf conf-${result.confidence.level}`}>{CONF_LABEL[result.confidence.level]}</span>
      </span>
      <span className="sum-aim">
        {p.aimText}
        {plays}
      </span>
      <span className="sum-odds">
        <span>
          {p.layup ? `Leaves ~${d(p.leaveM)}` : `Green ${pct(p.pGreen)}`} · penalty {pct(p.pPenalty)}
          {p.pBunker >= 0.03 && ` · bunker ${pct(p.pBunker)}`} · {STRATEGY_LABEL[result.strategy]}
        </span>
        {why}
      </span>
    </button>
  )
}

/** The caddie's call: club, aim, why, and how sure it is. */
export function AdviceCard({ result, units }: { result: CaddieResult; units: Units }) {
  const u = unitLabel(units)
  const d = (m: number) => `${formatDistance(m, units)} ${u}`

  if (result.kind === 'none') {
    return (
      <div className="advice advice-quiet" data-testid="advice-full">
        <p>{result.reason}</p>
      </div>
    )
  }
  if (result.kind === 'part-swing') {
    return (
      <div className="advice advice-quiet" data-testid="advice-full">
        <p className="advice-club">Part swing</p>
        <p>{result.reason}</p>
      </div>
    )
  }
  if (result.kind === 'distance-only') {
    return (
      <div className="advice" data-testid="advice-full">
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
    <div className="advice" data-testid="advice-full">
      <p className="advice-target">
        {result.pinSource === 'rangefinder'
          ? `Playing to your rangefinder: ${d(result.targetM)} to the flag`
          : `Playing to the green middle: ${d(result.targetM)}`}
        {result.playsLikeM !== null && Math.abs(result.playsLikeM - result.targetM) >= 2 && `, plays ${d(result.playsLikeM)}${playsWhy(result)}`}
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

/** "(10 m up, into the wind)" */
function playsWhy(r: Extract<CaddieResult, { kind: 'advice' }>): string {
  const parts: string[] = []
  if (r.heightDiffM !== null && Math.abs(r.heightDiffM) >= 2) parts.push(`${Math.round(Math.abs(r.heightDiffM))} m ${r.heightDiffM > 0 ? 'up' : 'down'}`)
  const windOnly = (r.playsLikeM ?? 0) - r.targetM - (r.heightDiffM ?? 0)
  if (Math.abs(windOnly) >= 2) parts.push(windOnly > 0 ? 'into the wind' : 'wind helping')
  return parts.length ? ` (${parts.join(', ')})` : ''
}

/** Which way the wind blows on this shot, and how hard. */
export function WindPicker({
  dirs,
  strength,
  onDirs,
  onStrength,
}: {
  dirs: WindDir[]
  strength: WindStrength
  onDirs: (d: WindDir[]) => void
  onStrength: (s: WindStrength) => void
}) {
  const toggle = (d: WindDir) => onDirs(dirs.includes(d) ? dirs.filter((x) => x !== d) : [...dirs.filter((x) => x !== OPPOSITE_WIND[d]), d])
  return (
    <div className="lie" data-testid="wind">
      <div className="lie-row" role="group" aria-label="Wind direction on this shot">
        {(Object.keys(WIND_DIR_LABEL) as WindDir[]).map((d) => (
          <button key={d} aria-pressed={dirs.includes(d)} className={dirs.includes(d) ? 'chip chip-on' : 'chip'} onClick={() => toggle(d)}>
            {WIND_DIR_LABEL[d]}
          </button>
        ))}
      </div>
      <div className="lie-row" role="radiogroup" aria-label="Wind strength">
        {(Object.keys(WIND_STRENGTH_LABEL) as WindStrength[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={strength === s}
            className={strength === s ? 'chip chip-on' : 'chip'}
            onClick={() => onStrength(s)}
            title={s === 'calm' ? 'No wind' : `About ${WIND_KMH[s]} km/h`}
          >
            {WIND_STRENGTH_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

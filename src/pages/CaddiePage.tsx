import type { AppData } from '../types'
import { analyseGaps } from '../lib/calculations/gaps'

interface Props {
  data: AppData
  goToBag: () => void
}

/** Stage 1: the caddie is honest that it can't advise yet, and shows what's left to set up. */
export function CaddiePage({ data, goToBag }: Props) {
  const clubs = data.bag.filter((c) => c.category !== 'putter')
  const report = analyseGaps(data.bag)
  const withDistance = clubs.length - report.missingIds.length
  const confirmedCarry = clubs.filter((c) => c.carryM !== null).length

  const steps = [
    {
      title: 'Your bag',
      state: confirmedCarry === clubs.length ? 'done' : 'now',
      detail: `${withDistance} of ${clubs.length} clubs have a distance; ${confirmedCarry} confirmed as carry.`,
    },
    { title: 'Map South Head', state: 'later', detail: 'Greens, tees and hazards traced, then checked on the course.' },
    { title: 'GPS distances', state: 'later', detail: 'Front, middle and back, with an accuracy badge.' },
    { title: 'Club advice', state: 'later', detail: 'Club, target and the reasons, for safe, normal or aggressive play.' },
  ] as const

  return (
    <section className="page" aria-labelledby="caddie-title">
      <div className="page-head">
        <div>
          <h1 id="caddie-title">{data.profile.homeCourse || 'Caddie'}</h1>
          <p className="quiet">The caddie gives advice once the course is mapped.</p>
        </div>
      </div>

      <div className="hero-empty">
        <p className="hero-empty-line">No distances yet.</p>
        <p className="quiet">
          Rather than guess, the caddie stays quiet until it has a mapped course and your GPS position. Until
          then, use your rangefinder.
        </p>
      </div>

      <h2 className="section-title">Getting it ready</h2>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.title} className={`step step-${s.state}`}>
            <span className="step-title">{s.title}</span>
            <span className="step-state">{s.state === 'done' ? 'Done' : s.state === 'now' ? 'In progress' : 'Coming'}</span>
            <span className="step-detail">{s.detail}</span>
          </li>
        ))}
      </ol>

      {confirmedCarry < clubs.length && (
        <button className="btn btn-wide" onClick={goToBag}>
          Finish setting up my bag
        </button>
      )}
    </section>
  )
}

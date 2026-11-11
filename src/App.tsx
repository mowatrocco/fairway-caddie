import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useAppStore } from './state/useAppStore'
import { CaddiePage } from './pages/CaddiePage'
import { RoundPage } from './pages/RoundPage'
import { BagPage } from './pages/BagPage'
import { StatsPage } from './pages/StatsPage'
import { SettingsSheet } from './pages/SettingsSheet'
import { BagIcon, CardIcon, ChartIcon, FlagIcon, GearIcon } from './components/Icons'

// The map screen loads only when opened, keeping the app quick to start.
const CourseMapPage = lazy(() => import('./pages/CourseMapPage'))

type Tab = 'caddie' | 'round' | 'bag' | 'stats'

const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'caddie', label: 'Caddie', icon: <FlagIcon /> },
  { id: 'round', label: 'Round', icon: <CardIcon /> },
  { id: 'bag', label: 'My Bag', icon: <BagIcon /> },
  { id: 'stats', label: 'Stats', icon: <ChartIcon /> },
]

function tabFromHash(): Tab {
  const h = window.location.hash.replace('#', '')
  return (tabs.some((t) => t.id === h) ? h : 'caddie') as Tab
}

export default function App() {
  const store = useAppStore()
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(() => window.location.hash === '#map')

  useEffect(() => {
    const onHash = () => {
      setTab(tabFromHash())
      setMapOpen(window.location.hash === '#map')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const openMap = () => {
    history.replaceState(null, '', '#map')
    setMapOpen(true)
  }
  const closeMap = () => {
    history.replaceState(null, '', `#${tab}`)
    setMapOpen(false)
  }

  const go = (t: Tab) => {
    setTab(t)
    history.replaceState(null, '', `#${t}`)
    window.scrollTo(0, 0)
  }

  if (!store.ready) {
    return <div className="loading" aria-busy="true" />
  }

  const { data, dispatch } = store

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Fairway Caddie</span>
        <span className={`save-state save-${store.saveState}`} aria-live="polite">
          {store.saveState === 'saving' ? 'Saving' : store.saveState === 'saved' ? 'Saved' : store.saveState === 'error' ? "Couldn't save" : ''}
        </span>
        <button className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <GearIcon />
        </button>
      </header>

      {import.meta.env.VITE_PREVIEW === '1' && (
        <p className="preview-note">Preview only. Saving and backups may not work here; the real app will be at its own web address.</p>
      )}

      {store.loadProblem && (
        <div className="msg msg-error banner" role="alert">
          <p>{store.loadProblem}</p>
          <button className="btn btn-small" onClick={store.dismissLoadProblem}>
            OK
          </button>
        </div>
      )}

      <main className="main">
        {tab === 'caddie' && <CaddiePage data={data} goToBag={() => go('bag')} openMap={openMap} />}
        {tab === 'round' && <RoundPage profile={data.profile} />}
        {tab === 'bag' && <BagPage bag={data.bag} units={data.profile.units} dispatch={dispatch} />}
        {tab === 'stats' && <StatsPage data={data} />}
      </main>

      <nav className="tabbar" aria-label="Main">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'tab tab-on' : 'tab'}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => go(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {mapOpen && (
        <Suspense fallback={<div className="mapper mapper-loading">Loading map…</div>}>
          <CourseMapPage data={data} dispatch={dispatch} onClose={closeMap} />
        </Suspense>
      )}

      {settingsOpen && (
        <SettingsSheet
          data={data}
          dispatch={dispatch}
          onClose={() => setSettingsOpen(false)}
          lastSavedAt={store.lastSavedAt}
          persisted={store.persisted}
        />
      )}
    </div>
  )
}

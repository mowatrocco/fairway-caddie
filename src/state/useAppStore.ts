import { useEffect, useReducer, useRef, useState } from 'react'
import { starterData } from '../data/starterBag'
import { loadAppData, quarantineInvalid, requestPersistence, saveAppData } from '../lib/storage/db'
import type { AppData } from '../types'
import { reducer, type Action } from './reducer'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface AppStore {
  ready: boolean
  data: AppData
  dispatch: (a: Action) => void
  saveState: SaveState
  lastSavedAt: string | null
  /** Shown once if saved data could not be read. */
  loadProblem: string | null
  dismissLoadProblem: () => void
  persisted: boolean | null
}

const SAVE_DELAY_MS = 250

export function useAppStore(): AppStore {
  const [data, rawDispatch] = useReducer(reducer, undefined, starterData)
  const [ready, setReady] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const dirty = useRef(false)

  // Load once on start.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await loadAppData()
        if (cancelled) return
        if (result.status === 'ok') {
          rawDispatch({ type: 'replace', data: result.data })
          setLastSavedAt(result.savedAt)
        } else if (result.status === 'invalid') {
          await quarantineInvalid()
          setLoadProblem(
            `Your saved data couldn't be read (${result.reason}). A copy was kept, and the starter bag has been loaded. You can restore a backup in Settings.`,
          )
          dirty.current = true
        } else {
          dirty.current = true // first launch: save the starter bag
        }
      } catch {
        setLoadProblem("This browser couldn't open on-phone storage. Changes won't be kept. Try installing the app to your Home Screen.")
      }
      if (!cancelled) setReady(true)
      setPersisted(await requestPersistence())
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-save shortly after every change.
  useEffect(() => {
    if (!ready || !dirty.current) return
    setSaveState('saving')
    const t = setTimeout(async () => {
      try {
        const at = await saveAppData(data)
        dirty.current = false
        setLastSavedAt(at)
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [data, ready])

  const dispatch = (a: Action) => {
    dirty.current = true
    rawDispatch(a)
  }

  return {
    ready,
    data,
    dispatch,
    saveState,
    lastSavedAt,
    loadProblem,
    dismissLoadProblem: () => setLoadProblem(null),
    persisted,
  }
}

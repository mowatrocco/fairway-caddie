import { useEffect, useState } from 'react'
import type { LiveFix } from './fixStatus'

export type LiveBase = 'off' | 'waiting' | 'denied' | 'unavailable'

/**
 * Follows your position while `enabled` and the app is on screen. GPS is switched
 * off whenever the app is hidden or the screen using it closes, to save battery.
 */
export function useLiveGps(enabled: boolean) {
  const [fix, setFix] = useState<LiveFix | null>(null)
  /** Set only from the GPS callbacks: why there's no fix, if the phone said. */
  const [problem, setProblem] = useState<'denied' | 'unavailable' | null>(null)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // A slow clock so "reading is out of date" shows up even when no new fix arrives.
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [enabled])

  const hasGeo = typeof navigator !== 'undefined' && 'geolocation' in navigator

  useEffect(() => {
    if (!enabled || !visible || !hasGeo) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setFix({ point: [pos.coords.longitude, pos.coords.latitude], accuracyM: pos.coords.accuracy, at: pos.timestamp })
        setProblem(null)
        setNow(Date.now())
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setProblem('denied')
        else setProblem((p) => (p === 'denied' ? p : 'unavailable'))
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [enabled, visible, hasGeo])

  const base: LiveBase = !enabled ? 'off' : !hasGeo ? 'unavailable' : (problem ?? 'waiting')
  return { fix: enabled ? fix : null, base, now }
}

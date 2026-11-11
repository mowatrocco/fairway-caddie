import { useEffect, useRef, useState } from 'react'

/**
 * Keeps the screen on while `wanted` is true (Screen Wake Lock API, iOS 16.4+ for
 * Home Screen apps). The phone drops the lock when the app is hidden, so it's
 * re-requested when you come back.
 */
export function useWakeLock(wanted: boolean) {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!supported || !wanted) return
    let cancelled = false
    const request = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const l = await navigator.wakeLock.request('screen')
        if (cancelled) {
          l.release()
          return
        }
        lock.current = l
        setActive(true)
        setError(null)
        l.addEventListener('release', () => setActive(false))
      } catch {
        setError("The phone didn't allow keeping the screen on.")
        setActive(false)
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') request()
    }
    request()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      lock.current?.release()
      lock.current = null
      setActive(false)
    }
  }, [wanted, supported])

  return { supported, active, error }
}

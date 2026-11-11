import { useCallback, useEffect, useRef, useState } from 'react'
import { averageFixes, type AveragedFix, type Fix } from './average'

export const CAPTURE_SECONDS = 15
export const CAPTURE_MAX_FIXES = 20
export const CAPTURE_MIN_FIXES = 3

export type CaptureState =
  | { phase: 'idle' }
  | { phase: 'listening'; fixes: Fix[]; latestAccuracyM: number | null; startedAt: number }
  | { phase: 'done'; result: AveragedFix }
  | { phase: 'error'; message: string }

function errorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return 'Location is switched off for this app. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites (or the app) → While Using.'
  }
  if (err.code === err.TIMEOUT) return "The phone couldn't get a GPS fix in time. Move into the open and try again."
  return "The phone couldn't get a GPS fix. Try again in the open."
}

/**
 * Collect GPS readings for up to CAPTURE_SECONDS while the golfer stands still,
 * then average them. GPS stops as soon as capture ends.
 */
export function useGpsCapture() {
  const [state, setState] = useState<CaptureState>({ phase: 'idle' })
  const watchId = useRef<number | null>(null)
  const fixesRef = useRef<Fix[]>([])
  const lastError = useRef<GeolocationPositionError | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopWatching = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const finish = useCallback(() => {
    stopWatching()
    const result = averageFixes(fixesRef.current)
    const why = lastError.current ? errorMessage(lastError.current) : 'No GPS readings came in. Try again in the open.'
    setState(result ? { phase: 'done', result } : { phase: 'error', message: why })
  }, [stopWatching])

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ phase: 'error', message: "This browser can't use GPS." })
      return
    }
    stopWatching()
    fixesRef.current = []
    lastError.current = null
    const startedAt = Date.now()
    setState({ phase: 'listening', fixes: [], latestAccuracyM: null, startedAt })
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: Fix = {
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracyM: pos.coords.accuracy,
          at: pos.timestamp,
        }
        fixesRef.current = [...fixesRef.current, fix]
        setState({ phase: 'listening', fixes: fixesRef.current, latestAccuracyM: fix.accuracyM, startedAt })
        if (fixesRef.current.length >= CAPTURE_MAX_FIXES) finish()
      },
      (err) => {
        // Permission refused: stop now. Anything else (a moment without a fix, a slow
        // reading) is usually a blip, so keep listening; the timer decides when to finish.
        if (err.code === err.PERMISSION_DENIED) {
          stopWatching()
          setState({ phase: 'error', message: errorMessage(err) })
        } else {
          lastError.current = err
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    timer.current = setTimeout(finish, CAPTURE_SECONDS * 1000)
  }, [finish, stopWatching])

  const cancel = useCallback(() => {
    stopWatching()
    setState({ phase: 'idle' })
  }, [stopWatching])

  useEffect(() => stopWatching, [stopWatching])

  return { state, start, finish, cancel }
}

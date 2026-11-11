import type { LngLat } from '../geo/geodesic'
import { localPlane } from '../geo/plane'

export interface Fix {
  lng: number
  lat: number
  /** The phone's own estimate of its error, metres. */
  accuracyM: number
  at: number
}

export interface AveragedFix {
  point: LngLat
  /** Typical (median) accuracy of the readings used. Averaging steadies the point but doesn't remove bias. */
  accuracyM: number
  /** Root-mean-square distance of readings from the average, metres. */
  spreadM: number
  samples: number
  /** True if no reading met the usable threshold and all readings had to be used. */
  allPoor: boolean
}

/** Readings worse than this are left out of the average when better ones exist. */
export const USABLE_ACCURACY_M = 15

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Average several readings taken while standing still. Better readings count for more
 * (weight 1/accuracy²). Returns null if there are no readings.
 */
export function averageFixes(fixes: Fix[]): AveragedFix | null {
  const valid = fixes.filter(
    (f) => Number.isFinite(f.lng) && Number.isFinite(f.lat) && Number.isFinite(f.accuracyM) && f.accuracyM > 0,
  )
  if (valid.length === 0) return null
  const usable = valid.filter((f) => f.accuracyM <= USABLE_ACCURACY_M)
  const used = usable.length > 0 ? usable : valid

  const plane = localPlane([used[0].lng, used[0].lat])
  let sx = 0
  let sy = 0
  let sw = 0
  const xys = used.map((f) => plane.toXY([f.lng, f.lat]))
  used.forEach((f, i) => {
    const w = 1 / (f.accuracyM * f.accuracyM)
    sx += xys[i][0] * w
    sy += xys[i][1] * w
    sw += w
  })
  const mean: [number, number] = [sx / sw, sy / sw]
  const spread = Math.sqrt(xys.reduce((s, p) => s + (p[0] - mean[0]) ** 2 + (p[1] - mean[1]) ** 2, 0) / xys.length)

  return {
    point: plane.toLngLat(mean),
    accuracyM: median(used.map((f) => f.accuracyM)),
    spreadM: spread,
    samples: used.length,
    allPoor: usable.length === 0,
  }
}

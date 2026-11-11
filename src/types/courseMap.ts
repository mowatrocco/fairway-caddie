import type { LngLat } from '../lib/geo/geodesic'
import type { TrustLevel } from './course'

export type FeatureKind =
  | 'tee'
  | 'green'
  | 'green-middle'
  | 'bunker'
  | 'water'
  | 'out-of-bounds'
  | 'fairway'
  | 'line-of-play'
  | 'trouble'

export type FeatureGeometry =
  | { type: 'Point'; coordinates: LngLat }
  | { type: 'LineString'; coordinates: LngLat[] }
  /** One closed outer ring: first corner repeated at the end, as GeoJSON requires. */
  | { type: 'Polygon'; coordinates: LngLat[][] }

export interface GpsCapture {
  /** Typical accuracy reported by the phone over the capture, metres. */
  accuracyM: number
  samples: number
  /** How much the readings wandered around their average, metres. */
  spreadM: number
  capturedAt: string
}

export interface CourseFeature {
  id: string
  kind: FeatureKind
  /** Holes this feature matters on. */
  holes: number[]
  /** For tees: which tee colour (matches the scorecard tee id). */
  teeId?: string
  geometry: FeatureGeometry
  trust: TrustLevel
  /** Plain-words origin, e.g. "Traced on LINZ aerial imagery". */
  source: string
  updatedAt: string
  gps?: GpsCapture
  notes: string
}

export interface CourseMap {
  courseId: string
  features: CourseFeature[]
  updatedAt: string
}

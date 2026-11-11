import type { LngLat } from '../geo/geodesic'
import type { CourseFeature, CourseMap, FeatureGeometry, FeatureKind } from '../../types/courseMap'
import type { TrustLevel } from '../../types/course'
import { newId } from '../id'

export type ShapeType = FeatureGeometry['type']

export interface KindInfo {
  label: string
  /** What you draw: a single point, a line, or an outline. */
  shape: ShapeType
  /** Fewest corners/points needed. */
  minPoints: number
  colour: string
  help: string
}

export const KINDS: Record<FeatureKind, KindInfo> = {
  tee: { label: 'Tee', shape: 'Point', minPoints: 1, colour: '#eef3ec', help: 'Centre of the tee box for one tee colour.' },
  green: { label: 'Green', shape: 'Polygon', minPoints: 3, colour: '#5fd38d', help: 'Walk the crosshair round the edge of the putting surface.' },
  'green-middle': { label: 'Green middle (GPS)', shape: 'Point', minPoints: 1, colour: '#5fd38d', help: 'Captured standing in the middle of the green.' },
  bunker: { label: 'Bunker', shape: 'Polygon', minPoints: 3, colour: '#e9d8a6', help: 'Edge of the sand.' },
  water: { label: 'Water / penalty area', shape: 'Polygon', minPoints: 3, colour: '#4fa3e0', help: 'Edge of the penalty area, along its stakes or lines.' },
  'out-of-bounds': { label: 'Out of bounds', shape: 'LineString', minPoints: 2, colour: '#ffffff', help: 'Along the boundary fence or white stakes.' },
  fairway: { label: 'Fairway', shape: 'Polygon', minPoints: 3, colour: '#9fd59f', help: 'Edge of the mown fairway.' },
  'line-of-play': { label: 'Line of play', shape: 'LineString', minPoints: 2, colour: '#f2c230', help: 'From the back tee, through any dog-leg corner, to the green.' },
  trouble: { label: 'Other trouble', shape: 'Polygon', minPoints: 3, colour: '#ec7a64', help: 'Trees, no-play zones, steep banks: anything to avoid.' },
}

export const TRUST_LABEL: Record<TrustLevel, string> = {
  official: 'Official',
  'verified-on-course': 'Verified on course',
  'traced-from-imagery': 'Traced from imagery',
  estimated: 'Estimated',
}

export const TRACED_SOURCE = 'Traced on LINZ aerial imagery'

export function emptyCourseMap(courseId: string): CourseMap {
  return { courseId, features: [], updatedAt: new Date(0).toISOString() }
}

/** Build a feature from the points drawn. Polygons are closed here. */
export function makeFeature(
  kind: FeatureKind,
  points: LngLat[],
  hole: number,
  opts: { teeId?: string; trust?: TrustLevel; source?: string; now?: Date } = {},
): CourseFeature {
  const info = KINDS[kind]
  if (points.length < info.minPoints) throw new Error(`${info.label} needs at least ${info.minPoints} points.`)
  return {
    id: newId(),
    kind,
    holes: [hole],
    teeId: kind === 'tee' ? opts.teeId : undefined,
    geometry: geometryFor(info.shape, points),
    trust: opts.trust ?? 'traced-from-imagery',
    source: opts.source ?? TRACED_SOURCE,
    updatedAt: (opts.now ?? new Date()).toISOString(),
    notes: '',
  }
}

export function geometryFor(shape: ShapeType, points: LngLat[]): FeatureGeometry {
  if (shape === 'Point') return { type: 'Point', coordinates: points[0] }
  if (shape === 'LineString') return { type: 'LineString', coordinates: points }
  return { type: 'Polygon', coordinates: [closeRing(points)] }
}

export function closeRing(points: LngLat[]): LngLat[] {
  const a = points[0]
  const b = points[points.length - 1]
  return a[0] === b[0] && a[1] === b[1] ? points : [...points, a]
}

/** The editable corners of a feature (polygons without the repeated closing corner). */
export function vertices(f: CourseFeature): LngLat[] {
  const g = f.geometry
  if (g.type === 'Point') return [g.coordinates]
  if (g.type === 'LineString') return g.coordinates
  return g.coordinates[0].slice(0, -1)
}

/** Same feature with new corners. Any edit by hand makes it "traced", not "verified". */
export function withVertices(f: CourseFeature, points: LngLat[], now = new Date()): CourseFeature {
  return {
    ...f,
    geometry: geometryFor(f.geometry.type, points),
    trust: f.trust === 'official' ? 'official' : 'traced-from-imagery',
    source: f.trust === 'official' ? f.source : TRACED_SOURCE,
    gps: undefined,
    updatedAt: now.toISOString(),
  }
}

export function onHole(features: CourseFeature[], hole: number): CourseFeature[] {
  return features.filter((f) => f.holes.includes(hole))
}

export function findGreen(features: CourseFeature[], hole: number): CourseFeature | undefined {
  return features.find((f) => f.kind === 'green' && f.holes.includes(hole))
}

export function findTee(features: CourseFeature[], hole: number, teeId: string): CourseFeature | undefined {
  return features.find((f) => f.kind === 'tee' && f.teeId === teeId && f.holes.includes(hole))
}

export function findLineOfPlay(features: CourseFeature[], hole: number): CourseFeature | undefined {
  return features.find((f) => f.kind === 'line-of-play' && f.holes.includes(hole))
}

export function findGreenMiddle(features: CourseFeature[], hole: number): CourseFeature | undefined {
  return features.find((f) => f.kind === 'green-middle' && f.holes.includes(hole))
}

export function pointOf(f: CourseFeature | undefined): LngLat | undefined {
  return f && f.geometry.type === 'Point' ? f.geometry.coordinates : undefined
}

export function ringOf(f: CourseFeature | undefined): LngLat[] | undefined {
  return f && f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : undefined
}

export function lineOf(f: CourseFeature | undefined): LngLat[] | undefined {
  return f && f.geometry.type === 'LineString' ? f.geometry.coordinates : undefined
}

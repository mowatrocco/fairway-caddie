import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre does its heavy lifting in a background worker. Bundling hides the worker's
// default location, so ship the file explicitly and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

maplibregl.setWorkerUrl(workerUrl)
import type { LngLat } from '../geo/geodesic'
import type { CourseFeature, FeatureKind } from '../../types/courseMap'
import type { ShapeType } from '../course/features'
import { KINDS, vertices } from '../course/features'
import { LINZ_ATTRIBUTION, linzAerialTileUrl } from './linzKey'

// The only file that knows about MapLibre. Screens use this adapter, so the map
// provider can be swapped without touching anything else.

export const TEE_COLOURS: Record<string, string> = { blue: '#4a90e2', white: '#ffffff', yellow: '#f2c230' }

export interface MapAdapter {
  setFeatures(features: CourseFeature[], currentHole: number, selectedId: string | null): void
  setDraft(points: LngLat[], shape: ShapeType | null): void
  setEditVertices(points: LngLat[], activeIndex: number | null): void
  setGolfer(point: LngLat | null, accuracyM: number | null): void
  getCentre(): LngLat
  jumpTo(centre: LngLat, zoom?: number, bearing?: number): void
  fitTo(points: LngLat[], bearing: number): void
  onMove(cb: () => void): () => void
  onTapFeature(cb: (id: string | null) => void): () => void
  onImageryError(cb: (status: number | null) => void): () => void
  resize(): void
  destroy(): void
}

const kindColour = ['match', ['get', 'kind'], ...Object.entries(KINDS).flatMap(([k, v]) => [k, v.colour]), '#ffffff']

function style(key: string | null): StyleSpecification {
  return {
    version: 8,
    sources: key
      ? {
          linz: {
            type: 'raster',
            tiles: [linzAerialTileUrl(key)],
            tileSize: 256,
            maxzoom: 22,
            attribution: LINZ_ATTRIBUTION,
          },
        }
      : {},
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#16201b' } },
      ...(key ? [{ id: 'aerial', type: 'raster' as const, source: 'linz' }] : []),
    ],
  }
}

function toGeoJson(features: CourseFeature[], hole: number, selectedId: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: features.map((f) => ({
      type: 'Feature' as const,
      id: undefined,
      geometry: f.geometry,
      properties: {
        fid: f.id,
        kind: f.kind,
        tee: f.teeId ? (TEE_COLOURS[f.teeId] ?? '#ffffff') : '#ffffff',
        here: f.holes.includes(hole) ? 1 : 0,
        selected: f.id === selectedId ? 1 : 0,
      },
    })),
  }
}

const empty = { type: 'FeatureCollection' as const, features: [] }

export function createMap(container: HTMLElement, opts: { key: string | null; centre: LngLat; zoom: number }): MapAdapter {
  const map = new maplibregl.Map({
    container,
    style: style(opts.key),
    center: opts.centre,
    zoom: opts.zoom,
    maxZoom: 21,
    attributionControl: { compact: true },
    pitchWithRotate: false,
    dragRotate: true,
    touchPitch: false,
  })

  // Test hook only: lets the browser test inspect the map engine.
  if (typeof location !== 'undefined' && location.search.includes('e2e')) {
    ;(window as unknown as { __maplibre?: unknown }).__maplibre = map
  }

  // The map must always fill its box exactly: the crosshair is drawn at the box's centre,
  // and getCentre() reads the map's centre, so any mismatch would misplace every point.
  const resizeObserver = new ResizeObserver(() => map.resize())
  resizeObserver.observe(container)

  let pending: (() => void)[] = []
  let loaded = false
  const whenLoaded = (fn: () => void) => (loaded ? fn() : pending.push(fn))

  map.on('load', () => {
    map.addSource('course', { type: 'geojson', data: empty })
    map.addSource('draft', { type: 'geojson', data: empty })
    map.addSource('edit', { type: 'geojson', data: empty })
    map.addSource('golfer', { type: 'geojson', data: empty })

    const isPoly = ['==', ['geometry-type'], 'Polygon'] as const
    const isLine = ['==', ['geometry-type'], 'LineString'] as const
    const isPoint = ['==', ['geometry-type'], 'Point'] as const
    const dim = ['case', ['==', ['get', 'here'], 1], 1, 0.35] as const

    map.addLayer({
      id: 'course-fill',
      type: 'fill',
      source: 'course',
      filter: isPoly as never,
      paint: { 'fill-color': kindColour as never, 'fill-opacity': ['*', 0.32, dim] as never },
    })
    map.addLayer({
      id: 'course-outline',
      type: 'line',
      source: 'course',
      filter: isPoly as never,
      paint: {
        'line-color': kindColour as never,
        'line-width': ['case', ['==', ['get', 'selected'], 1], 4, 2] as never,
        'line-opacity': dim as never,
      },
    })
    map.addLayer({
      id: 'course-lines',
      type: 'line',
      source: 'course',
      filter: isLine as never,
      paint: {
        'line-color': kindColour as never,
        'line-width': ['case', ['==', ['get', 'selected'], 1], 5, 3] as never,
        'line-dasharray': [2, 1.5],
        'line-opacity': dim as never,
      },
    })
    map.addLayer({
      id: 'course-points',
      type: 'circle',
      source: 'course',
      filter: isPoint as never,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 10, 7] as never,
        'circle-color': ['case', ['==', ['get', 'kind'], 'tee'], ['get', 'tee'], kindColour] as never,
        'circle-stroke-color': '#121614',
        'circle-stroke-width': 2,
        'circle-opacity': dim as never,
        'circle-stroke-opacity': dim as never,
      },
    })
    map.addLayer({
      id: 'draft-line',
      type: 'line',
      source: 'draft',
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: { 'line-color': '#f2c230', 'line-width': 3 },
    })
    map.addLayer({
      id: 'draft-points',
      type: 'circle',
      source: 'draft',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': '#f2c230', 'circle-stroke-color': '#121614', 'circle-stroke-width': 2 },
    })
    map.addLayer({
      id: 'edit-points',
      type: 'circle',
      source: 'edit',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'active'], 1], 10, 6] as never,
        'circle-color': ['case', ['==', ['get', 'active'], 1], '#f2c230', '#ffffff'] as never,
        'circle-stroke-color': '#121614',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: 'golfer-accuracy',
      type: 'circle',
      source: 'golfer',
      paint: {
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, ['/', ['get', 'px15'], 1], 20, ['*', ['get', 'px15'], 32]] as never,
        'circle-color': '#4a90e2',
        'circle-opacity': 0.15,
      },
    })
    map.addLayer({
      id: 'golfer-dot',
      type: 'circle',
      source: 'golfer',
      paint: { 'circle-radius': 7, 'circle-color': '#4a90e2', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    })

    map.resize()
    loaded = true
    pending.forEach((fn) => fn())
    pending = []
  })

  const set = (id: string, data: unknown) =>
    whenLoaded(() => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never))

  return {
    setFeatures(features, hole, selectedId) {
      set('course', toGeoJson(features, hole, selectedId))
    },
    setDraft(points, shape) {
      if (!shape || points.length === 0) return set('draft', empty)
      const geoms: unknown[] = points.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }))
      if (points.length >= 2) {
        const coords = shape === 'Polygon' && points.length >= 3 ? [...points, points[0]] : points
        geoms.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })
      }
      set('draft', { type: 'FeatureCollection', features: geoms })
    },
    setEditVertices(points, active) {
      set('edit', {
        type: 'FeatureCollection',
        features: points.map((p, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: p },
          properties: { active: i === active ? 1 : 0 },
        })),
      })
    },
    setGolfer(point, accuracyM) {
      if (!point) return set('golfer', empty)
      // Radius in pixels at zoom 15 for the accuracy circle (Web Mercator, at this latitude).
      const mPerPx15 = (156543.03392 * Math.cos((point[1] * Math.PI) / 180)) / 2 ** 15
      set('golfer', {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { px15: (accuracyM ?? 0) / mPerPx15 } }],
      })
    },
    getCentre() {
      const c = map.getCenter()
      return [c.lng, c.lat]
    },
    jumpTo(centre, zoom, bearing) {
      map.jumpTo({ center: centre, ...(zoom !== undefined ? { zoom } : {}), ...(bearing !== undefined ? { bearing } : {}) })
    },
    fitTo(points, bearing) {
      if (points.length === 0) return
      if (points.length === 1) return map.jumpTo({ center: points[0], zoom: 18, bearing })
      // Fit in a north-up frame, then rotate: approximate but keeps the hole on screen.
      const lngs = points.map((p) => p[0])
      const lats = points.map((p) => p[1])
      const cam = map.cameraForBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 60, bearing },
      )
      if (cam) map.jumpTo({ ...cam, bearing })
    },
    onMove(cb) {
      map.on('move', cb)
      return () => map.off('move', cb)
    },
    onTapFeature(cb) {
      const layers = ['course-points', 'course-lines', 'course-fill', 'course-outline']
      const handler = (e: maplibregl.MapMouseEvent) => {
        const box: [[number, number], [number, number]] = [
          [e.point.x - 12, e.point.y - 12],
          [e.point.x + 12, e.point.y + 12],
        ]
        const hits = map.queryRenderedFeatures(box, { layers: layers.filter((l) => map.getLayer(l)) })
        const here = hits.find((h) => h.properties?.here === 1) ?? hits[0]
        cb(here ? String(here.properties?.fid) : null)
      }
      map.on('click', handler)
      return () => map.off('click', handler)
    },
    onImageryError(cb) {
      const handler = (ev: maplibregl.ErrorEvent) => {
        const e = ev as unknown as { error?: { status?: number }; sourceId?: string }
        if (e.sourceId === 'linz' || String((ev.error as { url?: string } | undefined)?.url ?? '').includes('basemaps.linz')) {
          cb(e.error?.status ?? null)
        }
      }
      map.on('error', handler)
      return () => map.off('error', handler)
    },
    resize() {
      map.resize()
    },
    destroy() {
      resizeObserver.disconnect()
      map.remove()
    },
  }
}

/** Points that describe a hole, for framing the camera. */
export function holePoints(features: CourseFeature[], hole: number, kinds?: FeatureKind[]): LngLat[] {
  return features
    .filter((f) => f.holes.includes(hole) && (!kinds || kinds.includes(f.kind)))
    .flatMap((f) => vertices(f))
}

import { useEffect, useRef, useState } from 'react'
import type { CourseFeature } from '../../types/courseMap'
import type { LngLat } from '../../lib/geo/geodesic'
import { bearingDeg } from '../../lib/geo/geodesic'
import { createMap, holePoints, type MapAdapter } from '../../lib/mapping/mapAdapter'
import { pointOf } from '../../lib/course/features'
import { greenMiddle } from '../../lib/course/holeChecks'
import { getDeviceSetting } from '../../lib/storage/db'

interface Props {
  features: CourseFeature[]
  hole: number
  centre: LngLat
  golfer: { point: LngLat; accuracyM: number | null } | null
  measure: LngLat | null
  onTap: (p: LngLat) => void
}

/** The hole on aerial photos, turned so you play up the screen, with you and any measured point. */
export default function CaddieMap({ features, hole, centre, golfer, measure, onTap }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const adapter = useRef<MapAdapter | null>(null)
  const [key, setKey] = useState<string | null | undefined>(undefined)
  const [ready, setReady] = useState(0)
  // Latest values, read when the map is made or the hole changes (not tracked as triggers).
  const centreRef = useRef(centre)
  const featuresRef = useRef(features)
  useEffect(() => {
    centreRef.current = centre
    featuresRef.current = features
  })

  useEffect(() => {
    getDeviceSetting('linzKey').then(setKey, () => setKey(null))
  }, [])

  useEffect(() => {
    if (key === undefined || !el.current) return
    const a = createMap(el.current, { key, centre: centreRef.current, zoom: 16 })
    adapter.current = a
    if (location.search.includes('e2e')) window.__fairwayMap = a
    setReady((r) => r + 1)
    return () => {
      a.destroy()
      adapter.current = null
    }
  }, [key])

  useEffect(() => {
    adapter.current?.setFeatures(features, hole, null)
  }, [features, hole, ready])

  useEffect(() => {
    adapter.current?.setGolfer(golfer?.point ?? null, golfer?.accuracyM ?? null)
    adapter.current?.setMeasure(measure, measure ? (golfer?.point ?? null) : null)
  }, [golfer, measure, ready])

  // Frame the hole (tee at the bottom, green at the top) when the hole changes.
  useEffect(() => {
    const a = adapter.current
    if (!a) return
    const fs = featuresRef.current
    const pts = holePoints(fs, hole)
    const tee =
      pointOf(fs.find((f) => f.kind === 'tee' && f.holes.includes(hole) && f.teeId === 'blue')) ??
      pointOf(fs.find((f) => f.kind === 'tee' && f.holes.includes(hole)))
    const mid = greenMiddle(fs, hole)
    if (pts.length) a.fitTo(pts, tee && mid ? bearingDeg(tee, mid) : 0)
  }, [hole, ready])

  useEffect(() => {
    const a = adapter.current
    if (!a) return
    return a.onTapPoint(onTap)
  }, [onTap, ready])

  const centreOnMe = () => {
    if (golfer && adapter.current) adapter.current.jumpTo(golfer.point, 18)
  }

  return (
    <div className="caddie-map-wrap">
      <div ref={el} className="caddie-map" data-testid="caddie-map" />
      {golfer && (
        <button className="map-chip map-chip-right" onClick={centreOnMe}>
          Centre on me
        </button>
      )}
      {key === null && <p className="map-note">No LINZ map key yet, so no photos. Add it in Settings.</p>}
    </div>
  )
}


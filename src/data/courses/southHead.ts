import type { Course, ScorecardHole } from '../../types/course'

// Transcribed from the club's official scorecards (DotGolf 2026), photographed 11 Nov 2026.
// Each row: [metres, par, stroke index] for holes 1–18.
// The printed OUT/IN/TOT figures are stored too, and tests check the rows add up to them.

type Row = [metres: number, par: number, si: number]

function holes(rows: Row[]): ScorecardHole[] {
  return rows.map(([metres, par, strokeIndex], i) => ({ hole: i + 1, metres, par, strokeIndex }))
}

export const southHead: Course = {
  id: 'south-head',
  name: 'South Head Golf Club',
  location: '1640 South Head Road, Waioneke, South Head 0874',
  /** Where the map opens before anything is mapped. From the club's Google listing; not course data. */
  mapStart: { lng: 174.317846, lat: -36.560186 },
  distanceMarkers: [
    { colour: 'Blue', toMiddleM: 180 },
    { colour: 'White', toMiddleM: 135 },
    { colour: 'Red', toMiddleM: 90 },
  ],
  source: {
    trust: 'official',
    description: 'Club scorecards, cards 397072 (Blue), 397507 (White), 397071 (Yellow)',
    recordedOn: '2026-11-11',
  },
  tees: [
    {
      id: 'blue',
      name: 'Blue',
      cardNumber: '397072',
      courseRating: 70.4,
      slope: 121,
      holes: holes([
        [324, 4, 7], [198, 3, 11], [339, 4, 15], [174, 3, 13], [468, 5, 3],
        [423, 5, 17], [355, 4, 9], [504, 5, 1], [364, 4, 5],
        [176, 3, 14], [330, 4, 4], [259, 4, 12], [124, 3, 16], [294, 4, 10],
        [328, 4, 6], [377, 4, 2], [382, 5, 18], [332, 4, 8],
      ]),
      printed: { outMetres: 3149, inMetres: 2602, totalMetres: 5751, outPar: 37, inPar: 35, totalPar: 72 },
    },
    {
      id: 'white',
      name: 'White',
      cardNumber: '397507',
      courseRating: 68.7,
      slope: 119,
      holes: holes([
        [315, 4, 7], [183, 3, 11], [305, 4, 15], [160, 3, 13], [465, 5, 3],
        [410, 5, 17], [345, 4, 9], [443, 5, 1], [344, 4, 5],
        [147, 3, 14], [314, 4, 4], [253, 4, 12], [112, 3, 16], [285, 4, 10],
        [317, 4, 6], [351, 4, 2], [376, 5, 18], [294, 4, 8],
      ]),
      // TOT row is cut off in the photo; 5419 = OUT + IN, and the visible "…19" matches.
      printed: { outMetres: 2970, inMetres: 2449, totalMetres: 5419, outPar: 37, inPar: 35, totalPar: 72 },
    },
    {
      id: 'yellow',
      name: 'Yellow',
      cardNumber: '397071',
      courseRating: 72.8,
      slope: 124,
      // Yellow has its own pars and stroke indexes (par 73).
      holes: holes([
        [301, 4, 7], [167, 3, 11], [266, 4, 15], [111, 3, 17], [399, 5, 3],
        [398, 5, 9], [344, 4, 8], [407, 5, 1], [327, 4, 5],
        [132, 3, 10], [220, 4, 14], [247, 4, 12], [100, 3, 18], [279, 4, 16],
        [317, 4, 2], [351, 5, 13], [377, 5, 4], [278, 4, 6],
      ]),
      printed: { outMetres: 2720, inMetres: 2301, totalMetres: 5021, outPar: 37, inPar: 36, totalPar: 73 },
    },
  ],
}

// Course data types. Geometry (greens, hazards) arrives in Stage 2's mapping tool;
// this file covers the scorecard, which comes straight from the club.

/** Where a piece of course information came from. Shown beside anything the caddie uses. */
export type TrustLevel = 'official' | 'verified-on-course' | 'traced-from-imagery' | 'estimated'

export interface ScorecardHole {
  hole: number
  metres: number
  par: number
  strokeIndex: number
}

export interface TeeCard {
  id: string
  name: string
  /** Card number printed on the club's scorecard. */
  cardNumber: string
  courseRating: number
  slope: number
  holes: ScorecardHole[]
  /** Totals exactly as printed on the card, used to check the transcription. */
  printed: {
    outMetres: number
    inMetres: number
    totalMetres: number
    outPar: number
    inPar: number
    totalPar: number
  }
}

export interface Course {
  id: string
  name: string
  location: string
  tees: TeeCard[]
  /** Distance markers on course, measured to the middle of the green. */
  distanceMarkers: { colour: string; toMiddleM: number }[]
  source: {
    trust: TrustLevel
    description: string
    recordedOn: string
  }
}

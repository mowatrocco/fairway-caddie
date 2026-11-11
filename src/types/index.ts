// Core data types for Fairway Caddie.
// All distances are stored in METRES. Conversion to yards happens only for display/input.

export type Units = 'metres' | 'yards'

export type ClubCategory = 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter'

export type ShotShape = 'unknown' | 'straight' | 'draw' | 'fade' | 'hook' | 'slice' | 'varies'

export type MissDirection = 'unknown' | 'left' | 'right' | 'either'
export type MissDepth = 'unknown' | 'short' | 'long' | 'either'

/** How sure the golfer is about this club's numbers. */
export type DistanceConfidence = 'unknown' | 'guess' | 'rough' | 'measured'

/** Where the numbers came from. */
export type DistanceSource = 'estimate' | 'rangefinder' | 'launch-monitor' | 'logged-shots'

export interface Club {
  id: string
  name: string
  category: ClubCategory
  /** Carry distance in metres (in the air). null = not known. */
  carryM: number | null
  /** Total distance in metres (carry + roll). null = not known. */
  totalM: number | null
  /**
   * A rough distance whose type (carry or total) has NOT been confirmed.
   * Kept separate so carry and total are never mixed up.
   */
  roughM: number | null
  shape: ShotShape
  missDirection: MissDirection
  missDepth: MissDepth
  /** How far left of target shots usually finish, metres. */
  spreadLeftM: number | null
  /** How far right of target shots usually finish, metres. */
  spreadRightM: number | null
  confidence: DistanceConfidence
  source: DistanceSource
  notes: string
}

export interface Profile {
  name: string
  handicap: number | null
  homeCourse: string
  usualTees: string
  units: Units
}

export interface AppData {
  profile: Profile
  bag: Club[]
}

export const SCHEMA_VERSION = 1

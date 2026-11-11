import type { AppData, Club, ClubCategory } from '../types'
import { newId } from '../lib/id'
import { emptyCourseMap } from '../lib/course/features'

// Rocco's bag as supplied in the build brief.
// The supplied distances were described as "approximate, not verified carry",
// so they go into `roughM` (type unconfirmed), never into carry or total.

function club(name: string, category: ClubCategory, roughM: number | null): Club {
  return {
    id: newId(),
    name,
    category,
    carryM: null,
    totalM: null,
    roughM,
    shape: 'unknown',
    missDirection: 'unknown',
    missDepth: 'unknown',
    spreadLeftM: null,
    spreadRightM: null,
    confidence: roughM === null ? 'unknown' : 'rough',
    source: 'estimate',
    notes: '',
  }
}

export function starterBag(): Club[] {
  return [
    club('Ping G10 Driver', 'driver', null),
    club('4 Wood', 'wood', null),
    club('4 Hybrid', 'hybrid', null),
    club('Ping Rapture 4 Iron', 'iron', null),
    club('Mizuno 5 Iron', 'iron', 155),
    club('Ping G25 7 Iron', 'iron', 140),
    club('Ping G25 8 Iron', 'iron', 130),
    club('Ping G25 9 Iron', 'iron', 120),
    club('Ping G25 Pitching Wedge', 'wedge', 110),
    club('Ping G25 Utility Wedge', 'wedge', 100),
    club('Cleveland 54°', 'wedge', 90),
    club('Cleveland 58°', 'wedge', null),
    club('Odyssey Putter', 'putter', null),
  ]
}

export function starterData(): AppData {
  return {
    profile: {
      name: 'Rocco',
      handicap: null,
      homeCourse: 'South Head Golf Club',
      usualTees: '',
      units: 'metres',
    },
    bag: starterBag(),
    courseMaps: [emptyCourseMap('south-head')],
  }
}

export function blankClub(): Club {
  return club('New club', 'iron', null)
}

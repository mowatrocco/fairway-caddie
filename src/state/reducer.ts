import type { AppData, Club, Profile } from '../types'
import { confirmRough } from '../lib/calculations/clubs'

export type Action =
  | { type: 'replace'; data: AppData }
  | { type: 'updateClub'; club: Club }
  | { type: 'addClub'; club: Club }
  | { type: 'deleteClub'; id: string }
  | { type: 'moveClub'; id: string; dir: -1 | 1 }
  | { type: 'confirmRough'; id: string; as: 'carry' | 'total' }
  | { type: 'confirmAllRough'; as: 'carry' | 'total' }
  | { type: 'updateProfile'; profile: Partial<Profile> }

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'replace':
      return action.data
    case 'updateClub':
      return { ...state, bag: state.bag.map((c) => (c.id === action.club.id ? action.club : c)) }
    case 'addClub': {
      // New clubs go just above the putter, so the putter stays last.
      const putterAt = state.bag.findIndex((c) => c.category === 'putter')
      const bag = [...state.bag]
      bag.splice(putterAt === -1 ? bag.length : putterAt, 0, action.club)
      return { ...state, bag }
    }
    case 'deleteClub':
      return { ...state, bag: state.bag.filter((c) => c.id !== action.id) }
    case 'moveClub': {
      const i = state.bag.findIndex((c) => c.id === action.id)
      const j = i + action.dir
      if (i === -1 || j < 0 || j >= state.bag.length) return state
      const bag = [...state.bag]
      ;[bag[i], bag[j]] = [bag[j], bag[i]]
      return { ...state, bag }
    }
    case 'confirmRough':
      return {
        ...state,
        bag: state.bag.map((c) => (c.id === action.id ? confirmRough(c, action.as) : c)),
      }
    case 'confirmAllRough':
      return { ...state, bag: state.bag.map((c) => confirmRough(c, action.as)) }
    case 'updateProfile':
      return { ...state, profile: { ...state.profile, ...action.profile } }
  }
}

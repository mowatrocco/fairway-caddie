import { useRef, useState } from 'react'
import type { Club, Units } from '../../types'
import type { CourseFeature } from '../../types/courseMap'
import { answer, parseQuestion, shortName } from '../../lib/caddie/chat'
import type { CaddieInput, CaddieResult } from '../../lib/caddie/engine'
import type { Lie } from '../../lib/caddie/lie'
import { distanceBasis } from '../../lib/calculations/clubs'
import { distanceM, type LngLat } from '../../lib/geo/geodesic'

interface Message {
  id: number
  q: string
  a: string | null
  hole: number
  at: LngLat | null
}

/** Questions belong to one shot: walk on and they clear. */
const SAME_SHOT_M = 15

interface Props {
  input: CaddieInput
  result: CaddieResult
  features: CourseFeature[]
  units: Units
  hole: number
  position: LngLat | null
  onSetLie?: (l: Lie) => void
}

function neighbours(clubs: Club[], id: string, fromTee: boolean): Club[] {
  const list = clubs
    .filter((c) => c.category !== 'putter' && distanceBasis(c) !== null && (fromTee || c.category !== 'driver'))
    .sort((a, b) => distanceBasis(a)!.m - distanceBasis(b)!.m)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return []
  return [list[i + 1], list[i - 1]].filter((c): c is Club => Boolean(c))
}

/** Ask the caddie about this shot: typed, or one tap. Works with no signal. */
export function CaddieChat({ input, result, features, units, hole, position, onSetLie }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const nextId = useRef(1)

  const ask = (q: string) => {
    const question = q.trim()
    if (!question) return
    const id = nextId.current++
    setMessages((m) => [...m, { id, q: question, a: null, hole, at: position }])
    setText('')
    // Let "Working it out…" show before the sums run (lay-up plans take a moment).
    setTimeout(() => {
      const reply = answer(parseQuestion(question, input.clubs), { input, result, features, units })
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, a: reply.text } : x)))
      if (reply.lie) onSetLie?.(reply.lie)
    }, 30)
  }

  const shown = messages
    .filter((m) => m.hole === hole && (!m.at || !position || distanceM(m.at, position) <= SAME_SHOT_M))
    .slice(-6)

  const pick = result.kind === 'advice' ? input.clubs.find((c) => c.id === result.primary.clubId) : undefined
  const chips = [
    'What club?',
    ...(pick ? neighbours(input.clubs, pick.id, input.fromTee).map((c) => `Why not ${shortName(c)}?`) : []),
    ...(pick && pick.category !== 'wedge' ? [`${shortName(pick)} hard?`] : []),
    'Lay up or go?',
    'Safe miss?',
    'What do I need to carry?',
  ]

  return (
    <section className="chat" aria-label="Ask your caddie" data-testid="chat">
      <h2 className="section-title">Ask your caddie</h2>
      {shown.length > 0 && (
        <ol className="chat-log" aria-live="polite">
          {shown.map((m) => (
            <li key={m.id} className="chat-turn">
              <p className="chat-q">{m.q}</p>
              <p className={m.a === null ? 'chat-a chat-wait' : 'chat-a'} data-testid="chat-answer">
                {m.a ?? 'Working it out…'}
              </p>
            </li>
          ))}
        </ol>
      )}
      <div className="chat-chips">
        {chips.map((c) => (
          <button key={c} className="chip" onClick={() => ask(c)}>
            {c}
          </button>
        ))}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <label className="visually-hidden" htmlFor="chat-input">
          Your question
        </label>
        <input
          id="chat-input"
          name="chat"
          className="input"
          autoComplete="off"
          enterKeyHint="send"
          placeholder="e.g. why not 7 iron? I'm in the rough"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" type="submit" disabled={text.trim() === ''}>
          Ask
        </button>
      </form>
    </section>
  )
}

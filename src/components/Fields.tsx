import { useId, useState } from 'react'

function parse(t: string): number | null {
  const trimmed = t.trim().replace(',', '.')
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

interface ChoiceProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: string
}

/** A row of large tap targets; one selected. */
export function Choice<T extends string>({ label, value, options, onChange, hint }: ChoiceProps<T>) {
  const id = useId()
  return (
    <div className="field" role="radiogroup" aria-labelledby={id}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="chips">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? 'chip chip-on' : 'chip'}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

interface NumberProps {
  label: string
  /** Value in display units, or null for blank. */
  value: number | null
  unit: string
  onChange: (v: number | null) => void
  hint?: string
  name?: string
}

/** Number box that allows blank (= unknown). Keeps what you type until you leave the box. */
export function NumberField({ label, value, unit, onChange, hint, name }: NumberProps) {
  const id = useId()
  const format = (v: number | null) => (v === null ? '' : String(Math.round(v)))
  const [text, setText] = useState(format(value))
  const [lastValue, setLastValue] = useState(value)

  // If the value changes from outside (units switched, rough distance confirmed),
  // show the new value. Typing that already matches it is left alone.
  if (value !== lastValue) {
    setLastValue(value)
    const typed = parse(text)
    const same = typed === null ? value === null : value !== null && Math.round(value) === Math.round(typed)
    if (!same) setText(format(value))
  }

  const commit = (t: string) => onChange(parse(t))

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="number-wrap">
        <input
          id={id}
          name={name}
          className="input input-number"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Unknown"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            commit(e.target.value)
          }}
        />
        <span className="number-unit">{unit}</span>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

interface TextProps {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  placeholder?: string
  name?: string
}

export function TextField({ label, value, onChange, multiline, placeholder, name }: TextProps) {
  const id = useId()
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          className="input"
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          name={name}
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

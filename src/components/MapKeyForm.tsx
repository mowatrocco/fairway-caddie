import { useState } from 'react'
import { parseLinzKey } from '../lib/mapping/linzKey'
import { TextField } from './Fields'

interface Props {
  hasKey: boolean
  onSave: (key: string) => void
  onRemove: () => void
}

/** Paste-in form for the LINZ Basemaps key, with the steps to get one. */
export function MapKeyForm({ hasKey, onSave, onRemove }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="map-key-form">
      <ol className="plain-steps">
        <li>
          Open{' '}
          <a href="https://basemaps.linz.govt.nz" target="_blank" rel="noreferrer">
            basemaps.linz.govt.nz
          </a>{' '}
          in Safari.
        </li>
        <li>Open the menu on the right and copy the XYZ or WMTS map address. Your key is inside it.</li>
        <li>Paste the whole address below. The app pulls the key out.</li>
      </ol>
      <p className="field-hint">
        These keys stop working after 90 days; repeat the steps then. For a key that never expires, email
        basemaps@linz.govt.nz and ask for free developer access. The key stays on this phone and isn't included in
        backups.
      </p>
      <TextField
        label={hasKey ? 'Replace map key' : 'LINZ map key or address'}
        name="linz-key"
        value={text}
        placeholder="https://basemaps.linz.govt.nz/…?api=…"
        onChange={(v) => {
          setText(v)
          setError(null)
        }}
      />
      {error && (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        {hasKey && (
          <button className="btn btn-ghost btn-danger-text" onClick={onRemove}>
            Remove key
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={() => {
            const r = parseLinzKey(text)
            if (!r.ok) return setError(r.error)
            onSave(r.key)
            setText('')
          }}
        >
          Save map key
        </button>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import type { AppData, Units } from '../types'
import type { Action } from '../state/reducer'
import { backupFileName, backupToJson, createBackup, readBackup, type RestoreResult } from '../lib/storage/backup'
import { Sheet } from '../components/Sheet'
import { Choice, NumberField, TextField } from '../components/Fields'

interface Props {
  data: AppData
  dispatch: (a: Action) => void
  onClose: () => void
  lastSavedAt: string | null
  persisted: boolean | null
}

const unitOptions: { value: Units; label: string }[] = [
  { value: 'metres', label: 'Metres' },
  { value: 'yards', label: 'Yards' },
]

async function shareOrDownload(json: string, fileName: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([json], fileName, { type: 'application/json' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Fairway Caddie backup' })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // fall through to a plain download
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

function when(iso: string | null): string {
  if (!iso) return 'Not yet'
  return new Date(iso).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })
}

export function SettingsSheet({ data, dispatch, onClose, lastSavedAt, persisted }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [pending, setPending] = useState<RestoreResult | null>(null)
  const [restoredMsg, setRestoredMsg] = useState<string | null>(null)
  const p = data.profile

  const doBackup = async () => {
    const result = await shareOrDownload(backupToJson(createBackup(data)), backupFileName())
    setBackupMsg(
      result === 'cancelled' ? 'Backup cancelled.' : result === 'shared' ? 'Backup shared. Save it somewhere safe, like Files or iCloud Drive.' : 'Backup downloaded.',
    )
  }

  const onFile = async (file: File | undefined) => {
    setRestoredMsg(null)
    if (!file) return
    setPending(readBackup(await file.text()))
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <h3 className="group-title">Golfer</h3>
      <TextField label="Name" name="profile-name" value={p.name} onChange={(name) => dispatch({ type: 'updateProfile', profile: { name } })} />
      <div className="pair">
        <NumberField
          label="Handicap"
          name="handicap"
          unit=""
          value={p.handicap}
          onChange={(handicap) => dispatch({ type: 'updateProfile', profile: { handicap } })}
          hint="Optional"
        />
        <TextField
          label="Usual tees"
          name="tees"
          value={p.usualTees}
          placeholder="e.g. White"
          onChange={(usualTees) => dispatch({ type: 'updateProfile', profile: { usualTees } })}
        />
      </div>
      <Choice label="Distances in" value={p.units} options={unitOptions} onChange={(units) => dispatch({ type: 'updateProfile', profile: { units } })} />

      <h3 className="group-title">Your data</h3>
      <p className="quiet">
        Everything is stored on this phone only. Nothing is sent anywhere. Changes save automatically.
      </p>
      <dl className="facts">
        <dt>Last saved</dt>
        <dd>{when(lastSavedAt)}</dd>
        <dt>Protected from clean-up</dt>
        <dd>
          {persisted === true
            ? 'Yes'
            : persisted === false
              ? 'Not yet. Add the app to your Home Screen and keep backups.'
              : 'Unknown on this browser. Keep backups.'}
        </dd>
      </dl>

      <div className="btn-row">
        <button className="btn" onClick={doBackup}>
          Back up now
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Restore a backup
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        aria-label="Backup file"
        data-testid="restore-input"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {backupMsg && <p className="field-hint" aria-live="polite">{backupMsg}</p>}

      {pending && !pending.ok && (
        <p className="msg msg-error" role="alert">
          {pending.error}
        </p>
      )}
      {pending && pending.ok && (
        <div className="callout" role="group" aria-label="Confirm restore">
          <p>
            This backup has {pending.summary}, saved {when(pending.exportedAt)}. Restoring replaces everything on this
            phone.
          </p>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                dispatch({ type: 'replace', data: pending.data })
                setPending(null)
                setRestoredMsg('Backup restored.')
              }}
            >
              Replace my data
            </button>
          </div>
        </div>
      )}
      {restoredMsg && (
        <p className="field-hint" aria-live="polite">
          {restoredMsg}
        </p>
      )}

      <p className="credit">
        Version 0.1 (Stage 1). Map imagery will be sourced from LINZ, CC BY 4.0.
      </p>
    </Sheet>
  )
}

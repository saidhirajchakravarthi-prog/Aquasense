
/**
 * ManualMeasurement — chemical pH entry and external-TDS entry.
 * These are ALWAYS manual (never ESP32). Values persist to PostgreSQL via
 * POST /api/manual/ph|tds (source: MANUAL_CHEMICAL_TEST / EXTERNAL_TDS_METER).
 */
import { useState } from 'react'
import type { CurrentReadings } from '../types'
import { postManualReading } from '../services/apiService'
import { SensorCard } from './ui'

export function ManualMeasurement({ current, sourceId, onSaved }: { current: CurrentReadings | null; sourceId: string | null; onSaved?: () => void }) {
  const [phValue, setPhValue] = useState('')
  const [tdsValue, setTdsValue] = useState('')
  const [saving, setSaving] = useState<'ph' | 'tds' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const submit = async (parameter: 'ph' | 'tds') => {
    const raw = parameter === 'ph' ? phValue : tdsValue
    const value = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(value)) {
      setMsg({ kind: 'err', text: 'Enter a valid number before saving.' }); return
    }
    if (parameter === 'ph' && (value < 0 || value > 14)) {
      setMsg({ kind: 'err', text: 'pH must be between 0 and 14.' }); return
    }
    if (parameter === 'tds' && value < 0) {
      setMsg({ kind: 'err', text: 'TDS must be non-negative.' }); return
    }
    if (!sourceId) {
      setMsg({ kind: 'err', text: 'No water source selected yet — register the real prototype location first (scripts/register-source.mjs).' })
      return
    }
    setSaving(parameter); setMsg(null)
    try {
      await postManualReading(parameter, sourceId, value)
      setMsg({
        kind: 'ok',
        text: `${parameter.toUpperCase()} saved. ${parameter.toUpperCase()} = ${value} ${parameter === 'tds' ? 'ppm' : ''}. Source: ${parameter === 'ph' ? 'MANUAL_CHEMICAL_TEST' : 'EXTERNAL_TDS_METER'}.`,
      })
      if (parameter === 'ph') setPhValue(''); else setTdsValue('')
      onSaved?.()
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not save measurement.' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="manual-grid">
      <SensorCard label="pH — Manual Chemical Test" value={current?.ph ?? null} source="MANUAL_CHEMICAL_TEST" icon="⚗">
        <label className="field">
          Enter pH
          <input type="number" step="0.1" min="0" max="14" value={phValue}
            onChange={(e) => setPhValue(e.target.value)} placeholder="e.g. 7.1" />
        </label>
        <button type="button" className="btn primary" disabled={saving !== null} onClick={() => void submit('ph')}>
          {saving === 'ph' ? 'Saving…' : 'SAVE pH'}
        </button>
      </SensorCard>

      <SensorCard label="TDS — External Meter" value={current?.tds ?? null} unit="ppm" source="EXTERNAL_TDS_METER" icon="▶">
        <label className="field">
          Enter TDS (ppm)
          <input type="number" step="1" min="0" value={tdsValue}
            onChange={(e) => setTdsValue(e.target.value)} placeholder="e.g. 380" />
        </label>
        <button type="button" className="btn primary" disabled={saving !== null} onClick={() => void submit('tds')}>
          {saving === 'tds' ? 'Saving…' : 'SAVE TDS'}
        </button>
      </SensorCard>

      {msg && <p className={msg.kind === 'ok' ? 'ok-text' : 'err-text'} role="status">{msg.text}</p>}
      <p className="muted note">pH and TDS are entered manually — they are never presented as ESP32 measurements.</p>
    </div>
  )
}
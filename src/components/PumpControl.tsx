/**
 * PumpControl — purification pump.
 * In REAL DATA mode the operator's command is stored in PostgreSQL pump_commands
 * via POST /api/pump/command; the ESP32/relay actually switches the
 * (high-voltage) pump and reports status back through the same channel.
 * No GPIO/high-voltage control lives here.
 */
import { useState } from 'react'
import type { PumpState, Device } from '../types'
import { postPumpCommand } from '../services/apiService'


function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000))
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function PumpControl({ pump, device, onChanged }: { pump: PumpState | null; device: Device | null; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState<'START' | 'STOP' | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const request = (command: 'START' | 'STOP') => {
    setMsg(null)
    if (!confirming) { setConfirming(true); setPending(command); return }
    void doSend(command)
  }

    const doSend = async (command: 'START' | 'STOP') => {
    setConfirming(false); setPending(null); setBusy(true)
    if (!device) {
      setMsg({ kind: 'err', text: 'No device is registered for this water source. Register the real prototype location with scripts/register-source.mjs.' })
      setBusy(false)
      return
    }
    try {
      const queued = await postPumpCommand(device.id, command)
      setMsg({ kind: 'ok', text: `${command} command stored in PostgreSQL pump_commands (id ${queued.id}, status ${queued.status}). The ESP32 will execute it when it next reports online — this dashboard did not switch the pump.` })
      onChanged()
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Command could not be sent.' })
    } finally {
      setBusy(false)
    }
  }


  const running = pump?.status === 'RUNNING'
  const elapsed = pump?.startedAt ? formatElapsed(pump.startedAt) : '—'

  return (
    <div className="pump-panel">
      <div className="pump-status">
        <p className="sensor-label">Pump Status</p>
        <p className={`pump-state ${running ? 'on' : 'off'}`}>{running ? 'ON' : 'OFF'}</p>
        <p className="muted">Status reported by the ESP32 / relay module (not the dashboard).</p>
      </div>

      <div className="pump-actions">
        <button type="button" className="btn primary" disabled={busy || running} onClick={() => request('START')}>
          {confirming && pending === 'START' ? 'Tap again to confirm START' : 'START PURIFICATION'}
        </button>
        <button type="button" className="btn danger" disabled={busy || !running} onClick={() => request('STOP')}>
          {confirming && pending === 'STOP' ? 'Tap again to confirm STOP' : 'STOP PURIFICATION'}
        </button>
      </div>
      {confirming && <p className="warn-text">Confirm before switching the pump.</p>}

      <div className="pump-meta">
        <Metric label="Current cycle" value={running ? 'Running' : 'Idle'} />
        <Metric label="Start time" value={pump?.startedAt ? new Date(pump.startedAt).toLocaleTimeString() : '—'} />
        <Metric label="Elapsed" value={elapsed} />
                <Metric label="Cycle count" value={String(pump?.cycleCount ?? 0)} />
        <Metric label="Device" value={device?.code ?? '—'} />
        <Metric label="Link" value={device ? (device.online ? 'Online (reported)' : 'Offline') : 'Not registered'} />
      </div>

      {msg && <p className={msg.kind === 'ok' ? 'ok-text' : 'err-text'} role="status">{msg.text}</p>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="pump-metric"><span>{label}</span><b>{value}</b></div>
  )
}
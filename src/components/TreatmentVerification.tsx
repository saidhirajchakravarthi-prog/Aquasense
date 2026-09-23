/**
 * TreatmentVerification — professional before/after purification workflow UI.
 *
 * BEFORE real measurement -> AI decision -> purification command (existing Pump
 * Control panel, untouched) -> AFTER real measurement -> verification result.
 *
 * Read-only: it never inserts measurements and never treats a pump command as
 * proof of purification. The before-anchor timestamp is stored locally per water
 * source; all compared values are real PostgreSQL rows fetched by the API.
 */
import { useEffect, useState } from 'react'
import { fetchTreatmentVerification, fetchWaterQualityDecision } from '../services/apiService'
import type { TreatmentVerification, VerificationComparison, WaterQualityDecision } from '../types'
import { EmptyState, ErrorState, Loading } from './ui'

const ANCHOR_KEY = 'aquasense.verification.anchor.v1'

function loadAnchorMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(ANCHOR_KEY) ?? '{}') as Record<string, string> } catch { return {} }
}
function loadAnchor(sourceId: string | null): string | null {
  if (!sourceId) return null
  return loadAnchorMap()[sourceId] ?? null
}
function saveAnchor(sourceId: string, iso: string): void {
  try { localStorage.setItem(ANCHOR_KEY, JSON.stringify({ ...loadAnchorMap(), [sourceId]: iso })) } catch { /* ignore */ }
}
function clearAnchor(sourceId: string): void {
  try {
    const map = loadAnchorMap()
    delete map[sourceId]
    localStorage.setItem(ANCHOR_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

const statusBadge = (s: TreatmentVerification['status']): string =>
  s === 'IMPROVEMENT_VERIFIED' ? 'badge status-good'
    : s === 'PARTIAL_IMPROVEMENT' ? 'badge status-moderate'
      : s === 'NO_IMPROVEMENT' ? 'badge status-critical'
        : 'badge'

const directionBadge = (d: VerificationComparison['direction']): string =>
  d === 'IMPROVED' ? 'badge status-good'
    : d === 'WORSENED' ? 'badge status-critical'
      : d === 'UNCHANGED' ? 'badge status-moderate'
        : 'badge'

export function TreatmentVerification({ waterSourceId }: { waterSourceId: string | null }) {
  const [anchor, setAnchor] = useState<string | null>(() => loadAnchor(waterSourceId))
  const [decision, setDecision] = useState<WaterQualityDecision | null>(null)
  const [result, setResult] = useState<TreatmentVerification | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAnchor(loadAnchor(waterSourceId))
    setResult(null)
    setError(null)
    if (!waterSourceId) { setDecision(null); return }
    let alive = true
    fetchWaterQualityDecision(waterSourceId)
      .then((d) => { if (alive) setDecision(d) })
      .catch(() => { if (alive) setDecision(null) })
    return () => { alive = false }
  }, [waterSourceId])

  if (!waterSourceId) {
    return (
      <EmptyState
        title="No water source selected"
        hint="Select a water source on the Dashboard to run the before/after verification workflow."
      />
    )
  }

  const setBeforeAnchor = () => {
    const iso = new Date().toISOString()
    saveAnchor(waterSourceId, iso)
    setAnchor(iso)
    setResult(null)
    setError(null)
  }
  const reset = () => {
    clearAnchor(waterSourceId)
    setAnchor(null)
    setResult(null)
    setError(null)
  }
  const runVerification = () => {
    if (!anchor || verifying) return
    setVerifying(true)
    setError(null)
    fetchTreatmentVerification(waterSourceId, anchor)
      .then((r) => setResult(r))
      .catch((e) => setError(e instanceof Error ? e.message : 'Verification failed.'))
      .finally(() => setVerifying(false))
  }

  return (
    <div>
      <ol className="stat-list">
        <li><b>1 · Before real measurement</b></li>
        <li><b>2 · AI decision</b></li>
        <li><b>3 · Purification command</b></li>
        <li><b>4 · After real measurement</b></li>
        <li><b>5 · Verification result</b></li>
      </ol>

      <h4>Step 1 — Before real measurement</h4>
      {anchor ? (
        <p className="helper">
          Before-anchor recorded: <b>{new Date(anchor).toLocaleString()}</b>. The before values are the latest real
          PostgreSQL measurements at/before this time (7-day lookback).
        </p>
      ) : (
        <p className="helper">
          Confirm a real baseline measurement exists (ESP32 reading or the Manual Testing panel on the Dashboard),
          then record the before-anchor. No measurement is created here.
        </p>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={setBeforeAnchor}>Record before-anchor (now)</button>
        {anchor && <button type="button" className="ghost" onClick={reset}>Reset workflow</button>}
      </div>

      <h4>Step 2 — AI decision (before treatment)</h4>
      {decision ? (
        <p className="helper">
          Latest decision: <b>{decision.decision}</b> · engine {decision.engine} · confidence {decision.confidence}.
          The decision engine is unchanged — verification is a separate post-treatment result.
        </p>
      ) : (
        <p className="helper">
          No decision fetched yet. Review/run the deterministic decision on the Water Quality page before treating.
        </p>
      )}

      <h4>Step 3 — Purification command</h4>
      <p className="helper">
        Issue the treatment with the <b>Pump Control</b> panel above (operator action only). The command is recorded
        as context — it is never treated as proof that purification succeeded.
      </p>

      <h4>Step 4 — After real measurement</h4>
      <p className="helper">
        After the treatment cycle completes, take a NEW real measurement (ESP32 reading or the Manual Testing panel).
        Verification only proceeds when real after-measurements exist in PostgreSQL.
      </p>

      <h4>Step 5 — Verification result</h4>
      <div className="actions">
        <button type="button" className="primary" disabled={!anchor || verifying} onClick={runVerification}>
          {verifying ? 'Verifying…' : 'Run before/after verification'}
        </button>
      </div>

      {verifying && <Loading label="Comparing real before/after measurements…" />}
      {error && <ErrorState message={error} />}

      {result && <VerificationResult result={result} />}
    </div>
  )
}

function VerificationResult({ result }: { result: TreatmentVerification }) {
  return (
    <>
      <p>
        <span className={statusBadge(result.status)}>{result.status}</span>{' '}
        <span className="pill real">{result.summary.comparedCount} compared</span>
      </p>
      <p className="helper">{result.explanation}</p>
      {result.treatmentAction && (
        <p className="helper">
          Treatment context (NOT proof of purification): {result.treatmentAction.command} command ·
          status {result.treatmentAction.status} · device {result.treatmentAction.deviceCode ?? '—'} ·
          requested {new Date(result.treatmentAction.requestedAt).toLocaleString()}
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Parameter</th><th>Before (real)</th><th>After (real)</th><th>Change</th><th>Direction</th><th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {result.comparisons.map((c) => (
              <tr key={c.parameter}>
                <td>{c.displayName}<span className="sub">{c.interpretation}</span></td>
                <td>
                  {c.before ? <><b>{c.before.value}</b> {c.before.unit ?? ''}<span className="sub">{c.before.source} · {new Date(c.before.timestamp).toLocaleString()}</span></> : '—'}
                </td>
                <td>
                  {c.after ? <><b>{c.after.value}</b> {c.after.unit ?? ''}<span className="sub">{c.after.source} · {new Date(c.after.timestamp).toLocaleString()}</span></> : '—'}
                </td>
                <td>{c.change ? `${c.change.absolute >= 0 ? '+' : ''}${c.change.absolute}${c.change.percentage !== null ? ` (${c.change.percentage >= 0 ? '+' : ''}${c.change.percentage}%)` : ''}` : '—'}</td>
                <td><span className={directionBadge(c.direction)}>{c.direction ?? 'NOT GRADED'}</span></td>
                <td><span className={c.evidenceStatus === 'VERIFIED' ? 'badge status-good' : 'badge'}>{c.evidenceStatus}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Limitations</h4>
      <ul className="stat-list">
        {result.limitations.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </>
  )
}

export default TreatmentVerification

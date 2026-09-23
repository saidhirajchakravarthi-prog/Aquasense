/**
 * Firebase realtime data service.
 *
 * A single subscription set keeps the dashboard live (no polling):
 *   - waterMonitoring/current  -> latest readings + esp32Online + pumpStatus
 *   - waterMonitoring/history   -> historical series
 *   - waterMonitoring/pump      -> command / status / cycle metadata
 *   - waterMonitoring/alerts    -> alert records
 *   - waterMonitoring/ai        -> last AI result mirror (optional)
 *
 * When Firebase is not configured the UI shows "Not Connected" states —
 * nothing here ever invents hardware data.
 */
import { onValue, push, ref, set, type Database } from 'firebase/database'
import { database, initializeFirebase } from '../lib/firebase'
import type { AiResult, CurrentReadings, HistoricalReading, PumpState, QualityStatus, RiskLevel, WaterAlert } from '../types'

export type Unsubscribe = () => void

const DEFAULT_CURRENT: CurrentReadings = {
  temperature: null, turbidity: null, ph: null, tds: null,
  pumpStatus: null, esp32Online: null, timestamp: null,
}

export function firebaseReady(): boolean {
  return initializeFirebase() && database() !== null
}

function db(): Database {
  const d = database()
  if (!d) throw new Error('Firebase is not configured.')
  return d
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function mapCurrent(v: Record<string, unknown> | null): CurrentReadings | null {
  if (!v) return null
  return {
    temperature: num(v.temperature),
    turbidity: num(v.turbidity),
    ph: num(v.ph),
    tds: num(v.tds),
    pumpStatus: typeof v.pumpStatus === 'boolean' ? v.pumpStatus : null,
    esp32Online: typeof v.esp32Online === 'boolean' ? v.esp32Online : null,
    timestamp: num(v.timestamp),
  }
}

function mapPump(v: Record<string, unknown> | null): PumpState | null {
  if (!v) return null
  return {
    command: (v.command as '' | 'START' | 'STOP') ?? '',
    status: (v.status as '' | 'RUNNING' | 'IDLE') ?? '',
    startedAt: num(v.startedAt),
    cycleCount: typeof v.cycleCount === 'number' ? v.cycleCount : 0,
  }
}

function mapHistory(raw: Record<string, unknown> | null): HistoricalReading[] {
  const out: HistoricalReading[] = []
  if (!raw) return out
  for (const v of Object.values(raw)) {
    const row = (v ?? {}) as Record<string, unknown>
    out.push({
      temperature: num(row.temperature),
      turbidity: num(row.turbidity),
      ph: num(row.ph),
      tds: num(row.tds),
      timestamp: num(row.timestamp) ?? 0,
    })
  }
  return out
}

/* ------------------------------------------------------------ subscribe */

function mapAi(v: Record<string, unknown> | null): AiResult | null {
  if (!v) return null
  return {
    status: (v.status as QualityStatus) ?? 'GOOD',
    risk: (v.risk as RiskLevel) ?? 'LOW',
    score: typeof v.score === 'number' && Number.isFinite(v.score) ? v.score : 0,
    analysis: typeof v.analysis === 'string' ? v.analysis : '',
    recommendation: typeof v.recommendation === 'string' ? v.recommendation : '',
    confidence: typeof v.confidence === 'number' && Number.isFinite(v.confidence) ? v.confidence : 0,
    detectedIssues: Array.isArray(v.detectedIssues) ? v.detectedIssues as string[] : [],
    trends: Array.isArray(v.trends) ? v.trends as string[] : [],
    limitations: Array.isArray(v.limitations) ? v.limitations as string[] : [],
    simpleExplanation: typeof v.simpleExplanation === 'string' ? v.simpleExplanation : undefined,
    engine: (v.engine as 'GEMINI' | 'OPENAI' | 'RULE_BASED') ?? 'RULE_BASED',
    timestamp: typeof v.timestamp === 'number' && Number.isFinite(v.timestamp) ? v.timestamp : 0,
  }
}

export function subscribeRealtime(handlers: {
  onCurrent: (c: CurrentReadings | null) => void
  onHistory: (h: HistoricalReading[]) => void
  onPump: (p: PumpState | null) => void
  onAlerts: (a: Record<string, WaterAlert>) => void
  onAi: (a: AiResult | null) => void
}): Unsubscribe {
    if (!firebaseReady()) {
    handlers.onCurrent(null); handlers.onHistory([]); handlers.onPump(null); handlers.onAlerts({}); handlers.onAi(null)
    return () => {}
  }
  const d = db()
  const cleanups: Array<() => void> = []
  cleanups.push(onValue(ref(d, 'waterMonitoring/current'), (snap) => handlers.onCurrent(mapCurrent(snap.val() as Record<string, unknown> | null))))
  cleanups.push(onValue(ref(d, 'waterMonitoring/history'), (snap) => handlers.onHistory(mapHistory(snap.val() as Record<string, unknown> | null))))
  cleanups.push(onValue(ref(d, 'waterMonitoring/pump'), (snap) => handlers.onPump(mapPump(snap.val() as Record<string, unknown> | null))))
    cleanups.push(onValue(ref(d, 'waterMonitoring/alerts'), (snap) => handlers.onAlerts((snap.val() as Record<string, WaterAlert> | null) ?? {})))
  cleanups.push(onValue(ref(d, 'waterMonitoring/ai'), (snap) => handlers.onAi(mapAi(snap.val() as Record<string, unknown> | null))))
  return () => cleanups.forEach((fn) => fn())
}

/* --------------------------------------------------------- write actions */

/** Manual pH (chemical test) / TDS (external meter) -> current + history. */
export async function saveManualMeasurement(
  parameter: 'ph' | 'tds',
  value: number,
  current: CurrentReadings | null,
): Promise<{ current: CurrentReadings; historyKey: string }> {
  const d = db()
  const now = Date.now()
  const base = current ?? DEFAULT_CURRENT
  const next: CurrentReadings = { ...base, [parameter]: value, timestamp: now }
  await set(ref(d, 'waterMonitoring/current'), next)
  const reading: HistoricalReading = {
    temperature: base.temperature,
    turbidity: base.turbidity,
    ph: parameter === 'ph' ? value : base.ph,
    tds: parameter === 'tds' ? value : base.tds,
    timestamp: now,
  }
  const key = push(ref(d, 'waterMonitoring/history')).key ?? String(now)
  await set(ref(d, `waterMonitoring/history/${key}`), reading)
  return { current: next, historyKey: key }
}

/** Send the operator's pump command to Firebase for the ESP32 to consume. */
export async function sendPumpCommand(command: 'START' | 'STOP', currentPump: PumpState | null): Promise<PumpState> {
  const d = firebaseReady() ? db() : null
  const next: PumpState = {
    command,
    status: currentPump?.status ?? '',
    startedAt: currentPump?.startedAt ?? null,
    cycleCount: currentPump?.cycleCount ?? 0,
  }
  if (d) await set(ref(d, 'waterMonitoring/pump'), next)
  return next
}

/** Mark a stored alert as acknowledged. */
export async function acknowledgeAlert(id: string): Promise<void> {
  const d = firebaseReady() ? db() : null
  if (d) await set(ref(d, `waterMonitoring/alerts/${id}/acknowledged`), true)
}

/** Write the AI result back to waterMonitoring/ai (PDF §ai). */
export async function writeAiResult(result: unknown): Promise<void> {
  const d = firebaseReady() ? db() : null
  if (!d) return
  try {
    await set(ref(d, 'waterMonitoring/ai'), { ...(result as object), timestamp: Date.now() })
  } catch {
    /* non-fatal mirror only */
  }
}

/** Read a snapshot once (used by on-demand actions). */
export async function readPumpOnce(): Promise<PumpState | null> {
  if (!firebaseReady()) return null
  const d = db()
  const { get } = await import('firebase/database')
  const snap = await get(ref(d, 'waterMonitoring/pump'))
  return mapPump(snap.val() as Record<string, unknown> | null)
}
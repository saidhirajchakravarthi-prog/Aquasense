/**
 * Alert Producer (P1-2).
 *
 * Writes REAL alert records into the PostgreSQL `alerts` table using ONLY the
 * deterministic water-quality analysis from waterQualityEngine.ts (real
 * measurements + registered standards). An alert is created ONLY when a MEASURED
 * parameter breaches a standard (ABOVE_PERMISSIBLE / ABOVE_ACCEPTABLE /
 * BELOW_LIMIT); NOT_MEASURED and NO_STANDARD_AVAILABLE never alert, and historical
 * government data is never a trigger.
 *
 * Triggered after a real measurement is accepted (POST /api/device/readings,
 * POST /api/manual/ph|tds) or after current analysis is evaluated
 * (GET /api/water-quality/analysis). The 30s poll does NOT invoke this producer,
 * so polling cannot duplicate alerts; an unacknowledged-exists guard also
 * de-duplicates repeated measurements while one alert stays open.
 */
import type { Pool } from 'pg'
import { analyzeWaterQuality, type WQStatus } from './waterQualityEngine.js'

const BREACH_STATUSES: ReadonlySet<WQStatus> = new Set([
  'ABOVE_PERMISSIBLE',
  'ABOVE_ACCEPTABLE',
  'BELOW_LIMIT',
])

type Analysis = NonNullable<Awaited<ReturnType<typeof analyzeWaterQuality>>>

function severityFor(status: WQStatus): 'CRITICAL' | 'WARNING' {
  return status === 'ABOVE_PERMISSIBLE' || status === 'BELOW_LIMIT' ? 'CRITICAL' : 'WARNING'
}

function sourceFor(s: string | null): 'ESP32' | 'MANUAL_CHEMICAL_TEST' | 'EXTERNAL_TDS_METER' {
  if (s && s.startsWith('ESP32')) return 'ESP32'
  if (s === 'MANUAL_CHEMICAL_TEST') return 'MANUAL_CHEMICAL_TEST'
  if (s === 'EXTERNAL_TDS_METER') return 'EXTERNAL_TDS_METER'
  return 'ESP32'
}

function recommendedAction(parameter: string, severity: 'CRITICAL' | 'WARNING'): string {
  if (severity === 'CRITICAL') {
    return `Stop use of this water source immediately, confirm with a laboratory test, and notify the local water authority (parameter: ${parameter}).`
  }
  return `Monitor ${parameter} closely and re-test; treat before consumption if the trend continues.`
}

/** A breaching parameter always has a registered standard -> parameters FK row exists. */
async function parameterId(pool: Pool, code: string): Promise<string | null> {
  const r = await pool.query<{ id: string }>('SELECT id FROM parameters WHERE code=$1', [code])
  return r.rows[0]?.id ?? null
}

/** De-dup: true if an UNACKNOWLEDGED alert already exists for the same
 * (water source, parameter, severity). A persistent breach yields exactly one
 * open alert until acknowledged; a fresh breach re-opens after ack. */
async function hasOpenAlert(
  pool: Pool,
  waterSourceId: string,
  parameterId: string,
  severity: 'CRITICAL' | 'WARNING',
): Promise<boolean> {
  const r = await pool.query(
    'SELECT 1 FROM alerts WHERE water_source_id=$1 AND parameter_id=$2 AND severity=$3 AND acknowledged_at IS NULL LIMIT 1',
    [waterSourceId, parameterId, severity],
  )
  return r.rowCount != null && r.rowCount > 0
}

/** Produce alerts for every breaching measured parameter, reusing an analysis
 * already computed by the caller (no extra query cost). Returns insert count. */
export async function produceAlertsFromAnalysis(
  pool: Pool,
  waterSourceId: string,
  analysis: Analysis,
): Promise<number> {
  let created = 0
  for (const m of analysis.measurements) {
    if (!BREACH_STATUSES.has(m.status)) continue // WITHIN_LIMIT / NO_STANDARD_AVAILABLE / NOT_MEASURED -> no alert
    if (m.value === null) continue // a breach requires a measured value
    const pid = await parameterId(pool, m.parameter)
    if (!pid) continue // no parameter master row -> cannot FK; skip (never invent)
    const severity = severityFor(m.status)
    if (await hasOpenAlert(pool, waterSourceId, pid, severity)) continue // de-duplicate while open
    const unit = m.unit ? ` ${m.unit}` : ''
    const message = `Breach: ${m.displayName} = ${m.value}${unit} (${m.status}). ${m.explanation}`
    await pool.query(
      `INSERT INTO alerts(severity, parameter_id, source, water_source_id, message, recommended_action)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [severity, pid, sourceFor(m.source), waterSourceId, message, recommendedAction(m.parameter, severity)],
    )
    created += 1
  }
  return created
}

/** Convenience entry point used right after a real measurement is accepted
 * (device readings / manual pH-TDS). Runs the full deterministic analysis. */
export async function produceAlertsForSource(pool: Pool, waterSourceId: string): Promise<number> {
  const analysis = await analyzeWaterQuality(pool, waterSourceId)
  if (!analysis) return 0
  return produceAlertsFromAnalysis(pool, waterSourceId, analysis)
}

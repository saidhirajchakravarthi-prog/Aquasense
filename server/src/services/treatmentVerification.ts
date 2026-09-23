/**
 * Before/After Treatment Verification (post-treatment result — separate from the
 * Phase-4 decision engine, which stays untouched).
 *
 * Workflow: BEFORE real measurement -> AI decision -> purification command ->
 * AFTER real measurement -> before/after comparison -> verification result.
 *
 * Read-only over the existing schema (NO new tables, NO inserts):
 *   - BEFORE = latest real PostgreSQL measurements (sensor_readings + manual_measurements)
 *     at/before an operator-set anchor time `beforeAt`, within a 7-day lookback.
 *   - AFTER  = latest real measurements strictly AFTER `beforeAt`.
 *   - Only parameters with a real value on BOTH sides are compared (direction graded
 *     with the existing classifyParameter() rules against water_quality_standards).
 *   - A pump command is reported as context ONLY — never proof of purification.
 *   - No after measurement -> INSUFFICIENT_EVIDENCE. No fake points, no invented limits.
 */
import type { Pool } from 'pg'
import { classifyParameter } from './waterQualityEngine.js'
import type { WQStatus } from './waterQualityEngine.js'

const BEFORE_LOOKBACK_DAYS = 7

const GRADED: Partial<Record<WQStatus, number>> = {
  WITHIN_LIMIT: 0,
  ABOVE_ACCEPTABLE: 1,
  BELOW_LIMIT: 2,
  ABOVE_PERMISSIBLE: 3,
}

export interface VerificationMeasurement {
  value: number
  unit: string | null
  source: string
  timestamp: string
  deviceCode: string | null
  operatorName: string | null
  waterSourceName: string
}

export interface VerificationComparison {
  parameter: string
  displayName: string
  before: VerificationMeasurement | null
  after: VerificationMeasurement | null
  beforeStatus: WQStatus | null
  afterStatus: WQStatus | null
  direction: 'IMPROVED' | 'WORSENED' | 'UNCHANGED' | null
  change: { absolute: number; percentage: number | null } | null
  evidenceStatus: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE'
  interpretation: string
}

export interface TreatmentVerificationResult {
  waterSource: { id: string; name: string; sourceType: string; village: string | null; district: string | null; state: string | null }
  beforeAt: string
  generatedAt: string
  treatmentAction: { command: 'START' | 'STOP'; status: string; requestedAt: string; deviceCode: string | null } | null
  comparisons: VerificationComparison[]
  summary: { comparedCount: number; improved: number; worsened: number; unchanged: number; ungraded: number; insufficientEvidence: number }
  status: 'IMPROVEMENT_VERIFIED' | 'PARTIAL_IMPROVEMENT' | 'NO_IMPROVEMENT' | 'INSUFFICIENT_EVIDENCE'
  explanation: string
  limitations: string[]
}

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x))
const r4 = (x: number): number => Math.round(x * 10000) / 10000
const pretty = (code: string): string => {
  const known: Record<string, string> = { e_coli: 'E. coli', ph: 'pH', tds: 'TDS' }
  if (known[code]) return known[code]
  const s = code.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const meas = (value: unknown, unit: string | null, source: string, ts: Date, deviceCode: string | null, operatorName: string | null, waterSourceName: string): VerificationMeasurement | null => {
  const v = num(value)
  if (v === null || !Number.isFinite(v)) return null
  return { value: v, unit, source, timestamp: ts.toISOString(), deviceCode, operatorName, waterSourceName }
}

/** Entry point. Returns null when the water source does not exist. */
export async function verifyTreatment(pool: Pool, waterSourceId: string, beforeAt: Date): Promise<TreatmentVerificationResult | null> {
  const source = (
    await pool.query(
      `SELECT ws.id, ws.name AS source_name, ws.source_type,
              v.name AS village, d.name AS district, s.name AS state
       FROM water_sources ws
       LEFT JOIN villages v ON v.id = ws.village_id
       LEFT JOIN gram_panchayats gp ON gp.id = v.gram_panchayat_id
       LEFT JOIN blocks b ON b.id = gp.block_id
       LEFT JOIN districts d ON d.id = b.district_id
       LEFT JOIN states s ON s.id = d.state_id
       WHERE ws.id = $1`,
      [waterSourceId],
    )
  ).rows[0]
  if (!source) return null

  const lookback = new Date(beforeAt.getTime() - BEFORE_LOOKBACK_DAYS * 86400000)
  const wsName = source.source_name as string

  // BEFORE: latest real sensor row at/before the anchor (within lookback).
  const sensorBefore = (
    await pool.query(
      `SELECT s.temperature, s.turbidity, s.observed_at, d.device_code
       FROM sensor_readings s JOIN devices d ON d.id = s.device_id
       WHERE s.water_source_id = $1 AND s.observed_at <= $2 AND s.observed_at >= $3
       ORDER BY s.observed_at DESC LIMIT 1`,
      [waterSourceId, beforeAt, lookback],
    )
  ).rows[0] ?? null
  // AFTER: latest real sensor row strictly after the anchor.
  const sensorAfter = (
    await pool.query(
      `SELECT s.temperature, s.turbidity, s.observed_at, d.device_code
       FROM sensor_readings s JOIN devices d ON d.id = s.device_id
       WHERE s.water_source_id = $1 AND s.observed_at > $2
       ORDER BY s.observed_at DESC LIMIT 1`,
      [waterSourceId, beforeAt],
    )
  ).rows[0] ?? null

  // BEFORE / AFTER manual measurements (pH, TDS, or any registered parameter).
  const manualBeforeRows = await pool.query(
    `SELECT DISTINCT ON (p.code) p.code, m.value, m.unit, m.source, m.tested_at, m.operator_name
     FROM manual_measurements m JOIN parameters p ON p.id = m.parameter_id
     WHERE m.water_source_id = $1 AND m.tested_at <= $2 AND m.tested_at >= $3
     ORDER BY p.code, m.tested_at DESC`,
    [waterSourceId, beforeAt, lookback],
  )
  const manualAfterRows = await pool.query(
    `SELECT DISTINCT ON (p.code) p.code, m.value, m.unit, m.source, m.tested_at, m.operator_name
     FROM manual_measurements m JOIN parameters p ON p.id = m.parameter_id
     WHERE m.water_source_id = $1 AND m.tested_at > $2
     ORDER BY p.code, m.tested_at DESC`,
    [waterSourceId, beforeAt],
  )

  const buildManual = (r: Record<string, unknown>): VerificationMeasurement | null =>
    meas(r.value, (r.unit as string | null) ?? null, String(r.source), new Date(r.tested_at as string), null, (r.operator_name as string | null) ?? null, wsName)
  const buildSensor = (r: Record<string, unknown>, parameter: 'temperature' | 'turbidity', unit: string): VerificationMeasurement | null =>
    meas(r[parameter], unit, parameter === 'temperature' ? 'ESP32 (DS18B20)' : 'ESP32 (analog turbidity)', new Date(r.observed_at as string), (r.device_code as string | null) ?? null, null, wsName)

  const before = new Map<string, VerificationMeasurement>()
  const after = new Map<string, VerificationMeasurement>()
  if (sensorBefore) {
    const t = buildSensor(sensorBefore, 'temperature', '°C')
    const tb = buildSensor(sensorBefore, 'turbidity', 'NTU')
    if (t) before.set('temperature', t)
    if (tb) before.set('turbidity', tb)
  }
  if (sensorAfter) {
    const t = buildSensor(sensorAfter, 'temperature', '°C')
    const tb = buildSensor(sensorAfter, 'turbidity', 'NTU')
    if (t) after.set('temperature', t)
    if (tb) after.set('turbidity', tb)
  }
  for (const r of manualBeforeRows.rows) { const m = buildManual(r); if (m) before.set(r.code as string, m) }
  for (const r of manualAfterRows.rows) { const m = buildManual(r); if (m) after.set(r.code as string, m) }

  // Standards for every involved parameter (same preference rules as the engine).
  const codes = [...new Set([...before.keys(), ...after.keys()])]
  const registry = await pool.query('SELECT code, display_name FROM parameters')
  const displayNameOf = (code: string): string => registry.rows.find((r) => r.code === code)?.display_name ?? pretty(code)
  const standards = new Map<string, { minValue: number | null; maxValue: number | null; warningValue: number | null; criticalValue: number | null } | null>()
  if (codes.length) {
    const stdRows = await pool.query(
      `SELECT DISTINCT ON (p.code) p.code, st.min_value, st.max_value, st.warning_value, st.critical_value
       FROM water_quality_standards st JOIN parameters p ON p.id = st.parameter_id
       WHERE p.code = ANY($1)
       ORDER BY p.code, (st.standard_kind = 'MONITORING_THRESHOLD') DESC, st.effective_date DESC NULLS LAST, st.id`,
      [codes],
    )
    for (const r of stdRows.rows)
      standards.set(r.code as string, { minValue: num(r.min_value), maxValue: num(r.max_value), warningValue: num(r.warning_value), criticalValue: num(r.critical_value) })
  }

  const comparisons: VerificationComparison[] = []
  for (const code of codes) {
    const b = before.get(code) ?? null
    const a = after.get(code) ?? null
    const std = standards.has(code) ? standards.get(code)! : null
    const bCls = b ? classifyParameter(b.value, std) : null
    const aCls = a ? classifyParameter(a.value, std) : null
    const graded = (s: WQStatus | null): boolean => s !== null && GRADED[s] !== undefined
    let direction: VerificationComparison['direction'] = null
    let change: VerificationComparison['change'] = null
    if (b && a) {
      change = { absolute: r4(a.value - b.value), percentage: b.value !== 0 ? Math.round(((a.value - b.value) / Math.abs(b.value)) * 1000) / 10 : null }
      if (graded(bCls?.status ?? null) && graded(aCls?.status ?? null)) {
        const br = GRADED[bCls!.status]!
        const ar = GRADED[aCls!.status]!
        direction = ar < br ? 'IMPROVED' : ar > br ? 'WORSENED' : 'UNCHANGED'
      }
    }
    const evidenceStatus: VerificationComparison['evidenceStatus'] = b && a ? 'VERIFIED' : 'INSUFFICIENT_EVIDENCE'
    let interpretation: string
    if (!b && !a) interpretation = 'No real measurement on either side of the treatment anchor.'
    else if (!a) interpretation = 'No real after-treatment measurement exists yet. Take a new real measurement (ESP32 or manual) and re-run the verification.'
    else if (!b) interpretation = `No real before-treatment measurement within the ${BEFORE_LOOKBACK_DAYS}-day lookback before the anchor; comparison not possible.`
    else if (direction === 'IMPROVED') interpretation = `${displayNameOf(code)} compliance moved from ${bCls!.status} to ${aCls!.status} against the registered standard — measured improvement.`
    else if (direction === 'WORSENED') interpretation = `${displayNameOf(code)} compliance moved from ${bCls!.status} to ${aCls!.status} — measured worsening. Inspect the treatment step.`
    else if (direction === 'UNCHANGED') interpretation = `${displayNameOf(code)} compliance status is unchanged (${bCls!.status}).`
    else interpretation = 'Both measurements exist, but no directionally-gradable standard pair applies; improvement cannot be graded.'
    comparisons.push({
      parameter: code, displayName: displayNameOf(code), before: b, after: a,
      beforeStatus: bCls?.status ?? null, afterStatus: aCls?.status ?? null,
      direction, change, evidenceStatus, interpretation,
    })
  }

  const compared = comparisons.filter((c) => c.direction !== null)
  const improved = compared.filter((c) => c.direction === 'IMPROVED').length
  const worsened = compared.filter((c) => c.direction === 'WORSENED').length
  const unchanged = compared.filter((c) => c.direction === 'UNCHANGED').length
  const ungraded = comparisons.filter((c) => c.evidenceStatus === 'VERIFIED' && c.direction === null).length
  const insufficientEvidence = comparisons.filter((c) => c.evidenceStatus === 'INSUFFICIENT_EVIDENCE').length
  const afterAny = after.size > 0

  let status: TreatmentVerificationResult['status']
  let explanation: string
  if (!afterAny) {
    status = 'INSUFFICIENT_EVIDENCE'
    explanation = `No real after-treatment measurement exists after ${beforeAt.toISOString()}. A queued or acknowledged pump command is NOT treated as proof of purification — take a new real measurement, then re-run the verification.`
  } else if (compared.length === 0) {
    status = 'INSUFFICIENT_EVIDENCE'
    explanation = 'After-treatment measurements exist, but no parameter has a gradable before/after pair (missing before measurement or no registered standard). Nothing is claimed.'
  } else if (improved > 0 && worsened === 0) {
    status = 'IMPROVEMENT_VERIFIED'
    explanation = `${improved} compared parameter(s) measurably improved against their registered standards, none worsened. This covers ONLY the compared parameters.`
  } else if (improved > 0 && worsened > 0) {
    status = 'PARTIAL_IMPROVEMENT'
    explanation = `${improved} parameter(s) improved but ${worsened} worsened. Inspect the treatment step before drawing conclusions.`
  } else if (worsened > 0) {
    status = 'NO_IMPROVEMENT'
    explanation = `${worsened} compared parameter(s) measurably worsened and none improved. The treatment did not produce a measurable improvement.`
  } else {
    status = 'NO_IMPROVEMENT'
    explanation = `${unchanged} compared parameter(s) are unchanged after treatment; no measurable improvement was produced.`
  }

  // Pump-command context (read-only). NEVER treated as proof of purification.
  const treatmentActionRow = (
    await pool.query(
      `SELECT pc.command, pc.status, pc.requested_at, d.device_code
       FROM pump_commands pc JOIN devices d ON d.id = pc.device_id
       WHERE d.water_source_id = $1
       ORDER BY pc.requested_at DESC LIMIT 1`,
      [waterSourceId],
    )
  ).rows[0] ?? null

  const limitations = [
    `Verification covers ONLY the ${compared.length} parameter(s) with real before AND after measurements — it is not a potability or safety certificate.`,
    'The recorded pump command is operational context only — a queued or acknowledged command is NOT proof that purification succeeded.',
    `Before-measurements are limited to real readings taken within ${BEFORE_LOOKBACK_DAYS} days before the anchor time; the anchor is set by the operator, not inferred.`,
    'Parameters without a registered standard in water_quality_standards cannot be directionally graded.',
    `Parameters without a real after-treatment measurement remain unverified (${insufficientEvidence} listed as INSUFFICIENT_EVIDENCE).`,
    'Unmeasured parameters (e.g. microbiological tests) were never verified by this workflow.',
  ]

  return {
    waterSource: { id: source.id, name: source.source_name, sourceType: source.source_type, village: source.village, district: source.district, state: source.state },
    beforeAt: beforeAt.toISOString(),
    generatedAt: new Date().toISOString(),
    treatmentAction: treatmentActionRow
      ? { command: treatmentActionRow.command, status: treatmentActionRow.status, requestedAt: new Date(treatmentActionRow.requested_at).toISOString(), deviceCode: treatmentActionRow.device_code }
      : null,
    comparisons,
    summary: { comparedCount: compared.length, improved, worsened, unchanged, ungraded, insufficientEvidence },
    status, explanation, limitations,
  }
}

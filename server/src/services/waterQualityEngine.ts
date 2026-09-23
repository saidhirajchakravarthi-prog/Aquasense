/**
 * Deterministic Water Quality Analysis Engine (Phase 3).
 *
 * Reads ONLY real measurements from PostgreSQL (sensor_readings + manual_measurements)
 * and applicable standards from water_quality_standards. Fully deterministic —
 * no AI, no randomness, no invented standards, no fake data:
 *   measured + registered standard -> WITHIN_LIMIT | ABOVE_LIMIT | BELOW_LIMIT
 *   measured, no standard          -> NO_STANDARD_AVAILABLE (never graded, never "safe")
 *   not measured                   -> NOT_MEASURED (never "safe"; distinct from NOT DETECTED)
 *   measured value 0 (chemical/microbial) -> detection NOT_DETECTED (distinct from NOT_MEASURED)
 */
import type { Pool } from 'pg'

export type WQStatus = 'WITHIN_LIMIT' | 'ABOVE_ACCEPTABLE' | 'ABOVE_PERMISSIBLE' | 'BELOW_LIMIT' | 'NO_STANDARD_AVAILABLE' | 'NOT_MEASURED'

export interface WQStandardRow {
  standard_kind: string
  min_value: string | number | null
  max_value: string | number | null
  warning_value: string | number | null
  critical_value: string | number | null
  unit: string | null
  reference_source: string
  effective_date: string | null
}

export interface WQAssessment {
  parameter: string
  displayName: string
  status: WQStatus
  value: number | null
  unit: string | null
  source: string | null
  timestamp: string | null
  detection: 'DETECTED' | 'NOT_DETECTED' | null
  standard: {
    kind: string
    minValue: number | null
    maxValue: number | null
    warningValue: number | null
    criticalValue: number | null
    unit: string | null
    referenceSource: string
    effectiveDate: string | null
  } | null
  standardStatus: 'AVAILABLE' | 'NO_STANDARD_AVAILABLE' | null
  explanation: string
  provenance: { deviceCode?: string | null; operatorName?: string | null }
}

/** Full prototype checklist: measured now + parameters the prototype is expected to cover. */
const PROTOTYPE_CHECKLIST = [
  'temperature', 'turbidity', 'ph', 'tds',
  'fluoride', 'arsenic', 'iron', 'nitrate', 'chloride', 'sulphate', 'hardness',
  'e_coli', 'total_coliform', 'conductivity',
]

/** Parameters where 0 is a meaningful "absence" reading (0 °C is a real temperature). */
const ABSENCE_MEANINGFUL = new Set(['turbidity', 'ph', 'tds', 'fluoride', 'arsenic', 'iron', 'nitrate', 'chloride', 'sulphate', 'hardness', 'e_coli', 'total_coliform', 'residual_chlorine', 'conductivity', 'alkalinity'])

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x))

const pretty = (code: string): string => {
  const known: Record<string, string> = { e_coli: 'E. coli', ph: 'pH', tds: 'TDS' }
  if (known[code]) return known[code]
  const s = code.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Pure classification rule — unit-testable without a database. */
export function classifyParameter(
  value: number,
  standard: { minValue: number | null; maxValue: number | null; warningValue: number | null; criticalValue: number | null } | null,
): { status: WQStatus; explanation: string } {
  if (!standard || (standard.maxValue === null && standard.minValue === null)) {
    return {
      status: 'NO_STANDARD_AVAILABLE',
      explanation: 'A measurement exists, but no standard is registered in water_quality_standards for this parameter. It is not graded and is never treated as safe.',
    }
  }
  const { minValue, maxValue, warningValue, criticalValue } = standard
  if (maxValue !== null && value > maxValue) {
    if (criticalValue !== null && value <= criticalValue) {
      return {
        status: 'ABOVE_ACCEPTABLE',
        explanation: `Measured value ${value} exceeds the acceptable limit ${maxValue} but remains within the permissible limit ${criticalValue} (absence of an alternate source). Confirmation/treatment is recommended.`,
      }
    }
    return {
      status: 'ABOVE_PERMISSIBLE',
      explanation: criticalValue !== null
        ? `Measured value ${value} exceeds even the permissible limit ${criticalValue} (acceptable ${maxValue}). The water is unsuitable without treatment per the registered standard.`
        : `Measured value ${value} exceeds the registered limit ${maxValue}. The standard permits no relaxation above this limit.`,
    }
  }
  if (minValue !== null && value < minValue) {
    return { status: 'BELOW_LIMIT', explanation: `Measured value ${value} is below the acceptable minimum ${minValue}.` }
  }
  const range = minValue !== null && maxValue !== null ? `${minValue} to ${maxValue}` : maxValue !== null ? `up to ${maxValue}` : `from ${minValue}`
  const warningNote = warningValue !== null && value > warningValue ? ' It is above the registered warning level.' : ''
  return { status: 'WITHIN_LIMIT', explanation: `Measured value ${value} is within the acceptable limit (${range}) of the registered standard.${warningNote}` }
}

/** Full deterministic analysis for one water source. Returns null when the source does not exist. */
export async function analyzeWaterQuality(pool: Pool, waterSourceId: string) {
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

  const sensorLatest = (
    await pool.query(
      `SELECT s.temperature, s.turbidity, s.observed_at, d.device_code, d.online, d.last_seen_at
       FROM sensor_readings s JOIN devices d ON d.id = s.device_id
       WHERE s.water_source_id = $1
       ORDER BY s.observed_at DESC LIMIT 1`,
      [waterSourceId],
    )
  ).rows[0] ?? null
  const latestManual = await pool.query(
    `SELECT DISTINCT ON (p.code) p.code, m.value, m.unit, m.source, m.tested_at, m.operator_name
     FROM manual_measurements m JOIN parameters p ON p.id = m.parameter_id
     WHERE m.water_source_id = $1 AND p.code IN ('ph','tds')
     ORDER BY p.code, m.tested_at DESC`,
    [waterSourceId],
  )
  const registry = await pool.query('SELECT code, display_name, default_unit FROM parameters')
  const displayNameOf = (code: string): string => registry.rows.find((r) => r.code === code)?.display_name ?? pretty(code)
  const unitOf = (code: string): string | null => registry.rows.find((r) => r.code === code)?.default_unit ?? null

  const measured = new Map<string, WQAssessment>()
  if (sensorLatest) {
    const ts = new Date(sensorLatest.observed_at).toISOString()
    const prov = { deviceCode: sensorLatest.device_code as string | null }
    const temperature = num(sensorLatest.temperature)
    const turbidity = num(sensorLatest.turbidity)
    if (temperature !== null && Number.isFinite(temperature)) {
      measured.set('temperature', {
        parameter: 'temperature', displayName: 'Temperature', status: 'NOT_MEASURED',
        value: temperature, unit: '°C', source: 'ESP32 (DS18B20)', timestamp: ts,
        detection: null, standard: null, standardStatus: null, explanation: '', provenance: prov,
      })
    }
    if (turbidity !== null && Number.isFinite(turbidity)) {
      measured.set('turbidity', {
        parameter: 'turbidity', displayName: 'Turbidity', status: 'NOT_MEASURED',
        value: turbidity, unit: 'NTU', source: 'ESP32 (analog turbidity)', timestamp: ts,
        detection: null, standard: null, standardStatus: null, explanation: '', provenance: prov,
      })
    }
  }
  for (const r of latestManual.rows) {
    const value = num(r.value)
    if (value === null || !Number.isFinite(value)) continue
    measured.set(r.code, {
      parameter: r.code, displayName: displayNameOf(r.code), status: 'NOT_MEASURED',
      value, unit: r.unit ?? unitOf(r.code), source: r.source, timestamp: new Date(r.tested_at).toISOString(),
      detection: null, standard: null, standardStatus: null, explanation: '', provenance: { operatorName: r.operator_name },
    })
  }
  const measuredCodes = [...measured.keys()]

  const standards = new Map<string, WQStandardRow>()
  if (measuredCodes.length) {
    const stdRows = await pool.query(
      `SELECT DISTINCT ON (p.code) p.code, st.standard_kind, st.min_value, st.max_value, st.warning_value,
              st.critical_value, st.unit, st.reference_source, st.effective_date
       FROM water_quality_standards st JOIN parameters p ON p.id = st.parameter_id
       WHERE p.code = ANY($1)
       ORDER BY p.code, (st.standard_kind = 'MONITORING_THRESHOLD') DESC, st.effective_date DESC NULLS LAST, st.id`,
      [measuredCodes],
    )
    for (const r of stdRows.rows) standards.set(r.code, r)
  }

  for (const [code, a] of measured) {
    const raw = standards.get(code)
    if (!raw) {
      a.standardStatus = 'NO_STANDARD_AVAILABLE'
      a.standard = null
      const cls = classifyParameter(a.value as number, null)
      a.status = cls.status
      a.explanation = cls.explanation
    } else {
      const st = {
        kind: raw.standard_kind,
        minValue: num(raw.min_value),
        maxValue: num(raw.max_value),
        warningValue: num(raw.warning_value),
        criticalValue: num(raw.critical_value),
        unit: raw.unit,
        referenceSource: raw.reference_source,
        effectiveDate: raw.effective_date ? new Date(raw.effective_date).toISOString().slice(0, 10) : null,
      }
      a.standardStatus = 'AVAILABLE'
      a.standard = st
      const cls = classifyParameter(a.value as number, st)
      a.status = cls.status
      a.explanation = cls.explanation
    }
    a.detection = ABSENCE_MEANINGFUL.has(code) && a.value !== null ? (a.value === 0 ? 'NOT_DETECTED' : 'DETECTED') : null
    if (a.detection === 'NOT_DETECTED') a.explanation += ' The measured value of 0 means the parameter was NOT DETECTED in this sample.'
  }
  const measurements = [...measured.values()]

  const registryCodes = registry.rows.map((r) => r.code as string)
  const allCodes = [...new Set([...PROTOTYPE_CHECKLIST, ...registryCodes])].filter((c) => !measured.has(c)).sort()
  const notMeasured: WQAssessment[] = allCodes.map((code) => ({
    parameter: code,
    displayName: displayNameOf(code),
    status: 'NOT_MEASURED',
    value: null,
    unit: null,
    source: null,
    timestamp: null,
    detection: null,
    standard: null,
    standardStatus: null,
    explanation: 'No current measurement exists for this parameter. Absence of data is never treated as safe (this is NOT the same as NOT DETECTED).',
    provenance: {},
  }))

  const criticalBreaches = measurements.filter((a) => a.status === 'ABOVE_PERMISSIBLE' || a.status === 'BELOW_LIMIT')
  const acceptableBreaches = measurements.filter((a) => a.status === 'ABOVE_ACCEPTABLE')
  const noStd = measurements.filter((a) => a.status === 'NO_STANDARD_AVAILABLE')
  const overallStatus =
    measurements.length === 0
      ? 'NO_DATA'
      : criticalBreaches.length > 0
        ? 'EXCEEDS_STANDARD'
        : acceptableBreaches.length > 0
          ? 'ABOVE_ACCEPTABLE_LIMITS'
          : noStd.length === 0
            ? 'WITHIN_MEASURED_LIMITS'
            : 'PARTIAL_EVIDENCE'
  const overallExplanation =
    overallStatus === 'NO_DATA'
      ? 'No current measurements exist for this water source. Nothing can be assessed and nothing is treated as safe.'
      : overallStatus === 'EXCEEDS_STANDARD'
        ? `${criticalBreaches.length} measured parameter(s) exceed their permissible limit or fall below an acceptable minimum (no relaxation). Treatment/confirmation is required; missing parameters still limit the overall assessment.`
        : overallStatus === 'ABOVE_ACCEPTABLE_LIMITS'
          ? `${acceptableBreaches.length} measured parameter(s) exceed the acceptable limit but remain within the permissible limit of the registered standard. Confirmation and treatment are recommended.`
          : overallStatus === 'WITHIN_MEASURED_LIMITS'
            ? 'All measured parameters are within the acceptable limits of their registered standards. This covers ONLY the measured parameters and is not a potability certificate.'
            : `${measurements.length} parameter(s) measured; ${noStd.length} have no registered standard, so compliance cannot be graded. Missing parameters are never treated as safe.`
  const caveat = 'Deterministic monitoring output is decision support only — not a potability/safety certification. Microbiological and additional chemical testing may be required.'

  const evidence = {
    measuredCount: measurements.length,
    withStandardCount: measurements.length - noStd.length,
    noStandardCount: noStd.length,
    notMeasuredCount: notMeasured.length,
    sufficiency:
      measurements.length === 0
        ? 'NO_DATA'
        : criticalBreaches.length + acceptableBreaches.length > 0
          ? 'ACTION_EVIDENCE'
          : noStd.length === 0 && notMeasured.length === 0
            ? 'ADEQUATE_FOR_MEASURED_PARAMETERS'
            : 'INSUFFICIENT_EVIDENCE',
    summaryLines: [
      'The prototype measures only temperature + turbidity (ESP32) and pH + TDS (manual).',
      `${notMeasured.length} expected parameter(s) are NOT MEASURED and are excluded from any "safe" judgement.`,
      noStd.length > 0 ? `${noStd.length} measurement(s) cannot be graded because water_quality_standards has no row for them (NO_STANDARD_AVAILABLE).` : 'All measured parameters have registered standards.',
      'Government records remain separate historical/external evidence and are not part of this analysis.',
    ],
  }

  return {
    waterSource: {
      id: source.id, name: source.source_name, sourceType: source.source_type,
      village: source.village, district: source.district, state: source.state,
    },
    analysisTimestamp: new Date().toISOString(),
    measurements,
    notMeasured,
    missingParameters: allCodes,
    overall: { status: overallStatus, explanation: overallExplanation, caveat },
    evidence,
  }
}
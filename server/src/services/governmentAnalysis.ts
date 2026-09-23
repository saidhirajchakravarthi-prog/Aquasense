/**
 * Government Historical Analysis service (read-only).
 *
 * Collects ALL valid CGWB LABORATORY_MEASUREMENT records for a selected
 * dataset / year / state / district / location from PostgreSQL, classifies
 * every value through the EXISTING deterministic classifyParameter() engine
 * (NOT a copy), then forwards the structured evidence object to the Python AI
 * engine (/analyze) for interpretation.
 *
 * NEVER writes to government_records, sensor_readings, or manual_measurements.
 * NEVER includes WQ6 affected-village counts in concentration analysis.
 */
import type { Pool } from 'pg'
import { classifyParameter } from './waterQualityEngine.js'
import type { WQStandardRow } from './waterQualityEngine.js'

function aiEngineUrl(): string {
  return (process.env.AI_ENGINE_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')
}
const AI_TIMEOUT_MS = 15000

const num = (x: unknown): number | null =>
  x === null || x === undefined ? null : typeof x === 'number' ? x : Number(x)

/** Parameters CGWB routinely measures and that have BIS drinking-water standards. */
const CGWB_CANONICAL_PARAMS = [
  'ph', 'ec', 'fluoride', 'nitrate', 'tds', 'arsenic', 'iron',
  'chloride', 'sulphate', 'hardness', 'conductivity', 'total_coliform', 'e_coli',
]

export interface GovMeasurement {
  parameter: string
  displayName: string
  value: number
  unit: string
  standard: {
    minValue: number | null
    maxValue: number | null
    warningValue: number | null
    criticalValue: number | null
    unit: string | null
    referenceSource: string
    effectiveDate: string | null
  } | null
  deterministicStatus: string
  sourceFile: string
  pdfPage: number | null
  sourceSerial: string
}

export interface PyAIBadge {
  available: boolean
  source: 'PYTHON_AI' | 'PYTHON_AI_RULE_FALLBACK'
  detail?: string
  httpStatus?: number
  endpoint?: string
}

export interface GovernmentHistoricalAnalysis {
  analysisType: 'HISTORICAL_GOVERNMENT'
  dataScope: 'HISTORICAL'
  source: 'POSTGRESQL'
  dataset: string
  datasetYear: string | null
  state: string
  district: string
  location: string
  observedYear: string | null
  measurements: GovMeasurement[]
  parametersMeasured: number
  parametersWithinLimit: number
  parametersAboveAcceptable: number
  parametersAbovePermissible: number
  parametersBelowLimit: number
  parametersWithoutStandard: number
  parametersNotReported: string[]
  pythonAIStatus: PyAIBadge
  pythonAIResponse: unknown
  pythonAIInterpretation: string
  pythonAnalyzeHttpStatus: number | null
}

function formatHistoricalInterpretation(body: {
  source?: string
  caveat?: string
  historicalInterpretation?: {
    classification?: string
    interpretation?: string
    rankedCases?: Array<{ parameter?: string; historicalValue?: unknown; unit?: string; historicalStatus?: string }>
  }
}): string {
  const hi = body.historicalInterpretation
  const parts: string[] = []
  if (hi?.classification) parts.push(`Classification: ${hi.classification}.`)
  if (hi?.interpretation) parts.push(String(hi.interpretation))
  const ranked = hi?.rankedCases ?? []
  const concern = ranked.filter((c) =>
    c.historicalStatus === 'ABOVE_ACCEPTABLE' || c.historicalStatus === 'ABOVE_PERMISSIBLE' || c.historicalStatus === 'BELOW_LIMIT',
  )
  if (concern.length > 0) {
    parts.push(
      `Government evidence of concern: ${concern.map((c) => `${c.parameter}=${c.historicalValue}${c.unit ? ' ' + c.unit : ''} (${c.historicalStatus})`).join('; ')}.`,
    )
  }
  if (body.caveat) parts.push(body.caveat)
  return parts.join(' ') || 'Python AI returned no interpretation text.'
}

export interface GovLocationOptions {
  states: string[]
  districts: string[]
  locations: string[]
}

/** Read-only probe of the Python AI engine health (GET /health). */
export async function probePythonAIStatus(): Promise<PyAIBadge> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    const res = await fetch(`${aiEngineUrl()}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json() as { status?: string; engine?: string }
    return {
      available: true,
      source: 'PYTHON_AI',
      detail: body.status === 'ok' ? `${body.engine ?? 'python-interpreter'} reachable` : 'unhealthy',
    }
  } catch {
    return { available: false, source: 'PYTHON_AI_RULE_FALLBACK', detail: 'Python AI not reachable' }
  }
}

/** Read-only: distinct states/districts/locations for a dataset+year (LABORATORY_MEASUREMENT only). */
export async function fetchGovernmentLocations(pool: Pool, dataset: string, year: string): Promise<GovLocationOptions> {
  const where: string[] = ["g.record_type = 'LABORATORY_MEASUREMENT'"]
  const args: unknown[] = []
  if (dataset) { args.push(dataset); where.push(`d.dataset_name = $${args.length}`) }
  if (year) { args.push(year); where.push(`d.dataset_year::text = $${args.length}::text`) }

  const [states, districts, locations] = await Promise.all([
    pool.query(
      `SELECT DISTINCT g.state_name FROM government_records g
       JOIN government_datasets d ON d.id = g.dataset_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       AND g.state_name IS NOT NULL ORDER BY g.state_name`,
      args,
    ),
    pool.query(
      `SELECT DISTINCT g.district_name FROM government_records g
       JOIN government_datasets d ON d.id = g.dataset_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       AND g.district_name IS NOT NULL ORDER BY g.district_name`,
      args,
    ),
    pool.query(
      `SELECT DISTINCT COALESCE(g.village_name, g.water_source_name) AS loc
       FROM government_records g
       JOIN government_datasets d ON d.id = g.dataset_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       AND COALESCE(g.village_name, g.water_source_name) IS NOT NULL
       ORDER BY loc`,
      args,
    ),
  ])
  return {
    states: states.rows.map((r) => String(r.state_name)),
    districts: districts.rows.map((r) => String(r.district_name)),
    locations: locations.rows.map((r) => String(r.loc)),
  }
}

export async function analyzeGovernmentHistorical(
  pool: Pool,
  filters: { dataset: string; year: string; state: string; district: string; location: string; parameter: string; mode: 'single' | 'location' },
): Promise<GovernmentHistoricalAnalysis> {
  const where: string[] = ["g.record_type = 'LABORATORY_MEASUREMENT'"]
  const args: unknown[] = []
  if (filters.dataset) { args.push(filters.dataset); where.push(`d.dataset_name = $${args.length}`) }
  if (filters.year) { args.push(filters.year); where.push(`d.dataset_year::text = $${args.length}::text`) }
  if (filters.state) { args.push(filters.state); where.push(`g.state_name = $${args.length}`) }
  if (filters.district) { args.push(filters.district); where.push(`g.district_name = $${args.length}`) }
  if (filters.location) { args.push(filters.location); where.push(`(g.village_name = $${args.length} OR g.water_source_name = $${args.length})`) }
  if (filters.mode === 'single' && filters.parameter) { args.push(filters.parameter); where.push(`p.code = $${args.length}`) }

  const records = await pool.query(
    `SELECT g.id, g.value, g.unit, g.sample_date, g.imported_at,
            p.code AS parameter, p.display_name, d.dataset_name, d.dataset_year,
            d.source_organization, d.source_url, g.state_name, g.district_name,
            g.block_name, g.village_name, g.water_source_name
     FROM government_records g
     JOIN parameters p ON p.id = g.parameter_id
     JOIN government_datasets d ON d.id = g.dataset_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.code, g.sample_date DESC NULLS LAST`,
    args,
  )

  if (records.rows.length === 0) {
    return {
      analysisType: 'HISTORICAL_GOVERNMENT', dataScope: 'HISTORICAL', source: 'POSTGRESQL',
      dataset: filters.dataset, datasetYear: filters.year, state: filters.state,
      district: filters.district, location: filters.location, observedYear: filters.year,
      measurements: [], parametersMeasured: 0, parametersWithinLimit: 0, parametersAboveAcceptable: 0,
      parametersAbovePermissible: 0, parametersBelowLimit: 0, parametersWithoutStandard: 0,
      parametersNotReported: filters.mode === 'single' ? [] : [...CGWB_CANONICAL_PARAMS],
      pythonAIStatus: await probePythonAIStatus(), pythonAIResponse: null,
      pythonAIInterpretation: 'No laboratory measurement records found for this location in the selected dataset.',
      pythonAnalyzeHttpStatus: null,
    }
  }

  const firstRow = records.rows[0]
  const datasetName = firstRow.dataset_name
  const datasetYear = String(firstRow.dataset_year ?? '')
  const measuredCodes = [...new Set(records.rows.map((r) => r.parameter))]

  const standardsRes = await pool.query(
    `SELECT DISTINCT ON (p.code) p.code, st.standard_kind, st.min_value, st.max_value,
            st.warning_value, st.critical_value, st.unit, st.reference_source, st.effective_date
     FROM water_quality_standards st JOIN parameters p ON p.id = st.parameter_id
     WHERE p.code = ANY($1)
     ORDER BY p.code, (st.standard_kind = 'MONITORING_THRESHOLD') DESC,
              st.effective_date DESC NULLS LAST, st.id`,
    [measuredCodes],
  )
  const standardsMap = new Map<string, WQStandardRow & { code: string }>()
  for (const row of standardsRes.rows) { standardsMap.set(row.code, row) }

  const measurements: GovMeasurement[] = []
  const measuredSet = new Set<string>()
  for (const r of records.rows) {
    measuredSet.add(r.parameter)
    const stdRaw = standardsMap.get(r.parameter)
    const standard = stdRaw
      ? { minValue: num(stdRaw.min_value), maxValue: num(stdRaw.max_value),
          warningValue: num(stdRaw.warning_value), criticalValue: num(stdRaw.critical_value),
          unit: stdRaw.unit, referenceSource: stdRaw.reference_source,
          effectiveDate: stdRaw.effective_date ? new Date(stdRaw.effective_date).toISOString().slice(0, 10) : null }
      : null
    const cls = classifyParameter(Number(r.value), standard)
    measurements.push({
      parameter: r.parameter, displayName: r.display_name, value: Number(r.value),
      unit: r.unit ?? stdRaw?.unit ?? '', standard, deterministicStatus: cls.status,
      sourceFile: datasetName, pdfPage: null, sourceSerial: String(r.id),
    })
  }

  const withinLimit = measurements.filter((m) => m.deterministicStatus === 'WITHIN_LIMIT').length
  const aboveAcceptable = measurements.filter((m) => m.deterministicStatus === 'ABOVE_ACCEPTABLE').length
  const abovePermissible = measurements.filter((m) => m.deterministicStatus === 'ABOVE_PERMISSIBLE').length
  const belowLimit = measurements.filter((m) => m.deterministicStatus === 'BELOW_LIMIT').length
  const withoutStandard = measurements.filter((m) => m.deterministicStatus === 'NO_STANDARD_AVAILABLE').length
  const notReported = CGWB_CANONICAL_PARAMS.filter((p) => !measuredSet.has(p))

  const aiStatus = await probePythonAIStatus()
  let pythonResponse: unknown = null
  let pythonInterpretation = ''
  let pythonAnalyzeHttpStatus: number | null = null

  if (aiStatus.available) {
    const pythonPayload = {
      historicalCases: measurements.map((m) => ({
        parameter: m.parameter, displayName: m.displayName, value: m.value, unit: m.unit,
        statusAgainstStandard: m.deterministicStatus, similarity: 'SIMILAR_CASE',
        locationMatch: 'WATER_SOURCE',
        location: { state: filters.state, district: filters.district,
          block: firstRow.block_name ?? null,
          village: firstRow.village_name ?? firstRow.water_source_name ?? null,
          waterSource: firstRow.water_source_name ?? null },
        organization: firstRow.source_organization, datasetName: m.sourceFile,
        datasetYear, sourceUrl: firstRow.source_url ?? null,
        timeContext: datasetYear, actionAvailability: 'NO_DOCUMENTED_ACTION_FOUND',
      })),
      summary: { measured: measurements.length, similar: withinLimit, possible: 0,
        conflicts: 0, noRelevantCase: measurements.length === 0,
        withinLimit, aboveAcceptable, abovePermissible, belowLimit, withoutStandard },
      interpretation: `Government historical analysis for ${filters.state}/${filters.district}/${filters.location} (${datasetYear}). ${measurements.length} laboratory measurements available.`,
      contextualCounts: [{ parameter: 'all', state: filters.state, affectedVillageCount: 0,
        datasetName, sampleDate: firstRow.sample_date ?? null,
        note: 'WQ6 affected-village counts are context-only, not concentrations.' }],
      limitations: ['Government data is historical (not real-time).',
        'WQ6 affected-village counts are context-only, not concentrations.',
        'This is evidence-based historical analysis, not a trained ML prediction.',
        'CGWB provides year only where sample dates are absent.'],
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
      const res = await fetch(`${aiEngineUrl()}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases: pythonPayload }), signal: controller.signal,
      })
      clearTimeout(timeout)
      pythonAnalyzeHttpStatus = res.status
      if (res.ok) {
        const body = await res.json() as { source?: string; engine?: string; historicalInterpretation?: unknown; caveat?: string }
        pythonResponse = body
        pythonInterpretation = formatHistoricalInterpretation(body as Parameters<typeof formatHistoricalInterpretation>[0])
      } else { pythonInterpretation = `Python AI responded with HTTP ${res.status}.` }
    } catch (e) { pythonInterpretation = `Python AI call failed: ${e instanceof Error ? e.message : 'unknown error'}.` }
  }

  return {
    analysisType: 'HISTORICAL_GOVERNMENT', dataScope: 'HISTORICAL', source: 'POSTGRESQL',
    dataset: datasetName, datasetYear, state: filters.state, district: filters.district,
    location: filters.location, observedYear: datasetYear, measurements,
    parametersMeasured: measurements.length, parametersWithinLimit: withinLimit,
    parametersAboveAcceptable: aboveAcceptable, parametersAbovePermissible: abovePermissible,
    parametersBelowLimit: belowLimit, parametersWithoutStandard: withoutStandard,
    parametersNotReported: notReported, pythonAIStatus: aiStatus,
    pythonAIResponse: pythonResponse, pythonAIInterpretation: pythonInterpretation,
    pythonAnalyzeHttpStatus,
  }
}

import type { Pool } from 'pg'

// ---- Types ----

export interface CurrentEvidence {
  parameter: string
  value: number | null
  unit: string
  source: string
  timestamp: string
  waterSourceId: string
  waterSourceName: string
  villageName: string | null
  stateName: string | null
  districtName: string | null
  blockName: string | null
  gpName: string | null
  latitude: number | null
  longitude: number | null
}

export interface HistoricalEvidence {
  id: string
  datasetId: string
  datasetName: string
  sourceOrganization: string
  sourceUrl: string | null
  recordType: string
  parameter: string
  value: number | null
  unit: string | null
  affectedVillageCount: number | null
  stateName: string | null
  districtName: string | null
  blockName: string | null
  gpName: string | null
  villageName: string | null
  waterSourceName: string | null
  sampleDate: string | null
  latitude: number | null
  longitude: number | null
  originalRowReference: string | null
  notes: string | null
  importedAt: string
  isContaminationSummary: boolean
}

export interface Comparison {
  parameter: string
  current: {
    value: number
    unit: string
    source: string
    timestamp: string
    location: string
  } | null
  historical: {
    value: number
    unit: string
    source: string
    dataset: string
    date: string | null
    location: string
    geographicLevel: string
  } | null
  geographicMatchLevel: string
  evidenceStatus: 'AGREEMENT' | 'POSSIBLE_AGREEMENT' | 'CONFLICT'
  difference: { absolute: number; percentage: number | null } | null
  interpretation: string
}

export interface MissingCurrentEvidence {
  /** Parameter code (e.g. 'fluoride'). */
  parameter: string
  /**
   * Machine-readable statuses indicating this state:
   * CURRENT_<PARAM>_NOT_MEASURED, HISTORICAL_EVIDENCE_PRESENT, ADDITIONAL_TEST_REQUIRED.
   */
  statusCodes: string[]
  /** Number of historical laboratory records present for this parameter. */
  historicalRecordCount: number
  /** Representative historical record (never treated as a current measurement). */
  historical: {
    value: number | null
    valueType: 'HISTORICAL_ONLY'
    unit: string | null
    source: string
    dataset: string
    date: string | null
    location: string
    geographicLevel: string
  } | null
}

export interface EvidenceComparisonResult {
  waterSource: {
    id: string
    name: string
    village: string | null
    state: string | null
    district: string | null
    block: string | null
    gp: string | null
    latitude: number | null
    longitude: number | null
  }
  currentEvidence: CurrentEvidence[]
  historicalEvidence: HistoricalEvidence[]
  comparisons: Comparison[]
  agreements: Comparison[]
  conflicts: Comparison[]
  noComparableEvidence: HistoricalEvidence[]
  missingCurrentEvidence: MissingCurrentEvidence[]
  contextualGovernmentEvidence: HistoricalEvidence[]
  limitations: string[]
  generatedAt: string
}

// ---- Unit Compatibility ----

const UNIT_COMPATIBILITY: Record<string, string[]> = {
  'ph': ['ph', 'pH'],
  'mg/l': ['mg/l', 'mg/L', 'milligram/liter'],
  'ntu': ['ntu', 'NTU', 'nephelometric'],
  'ppm': ['ppm', 'mg/l', 'mg/L'],
  'µS/cm': ['µS/cm', 'uS/cm', 'us/cm', 'microsiemens'],
  'colony/100ml': ['colony/100ml', 'cfu/100ml', 'MPN/100ml'],
}

function normalizeUnit(unit: string | null): string {
  if (!unit) return ''
  return unit.toLowerCase().trim().replace(/\s+/g, '')
}

function unitsCompatible(unitA: string | null, unitB: string | null): boolean {
  if (!unitA || !unitB) return false
  const a = normalizeUnit(unitA)
  const b = normalizeUnit(unitB)
  if (a === b) return true
  for (const [canonical, aliases] of Object.entries(UNIT_COMPATIBILITY)) {
    const normAliases = aliases.map(normalizeUnit)
    if (normAliases.includes(a) && normAliases.includes(b)) return true
  }
  return false
}

// ---- Geographic Matching ----

const GEO_LEVELS = ['VILLAGE', 'WATER_SOURCE', 'BLOCK', 'DISTRICT', 'STATE'] as const
type GeoLevel = typeof GEO_LEVELS[number]

function determineGeographicMatch(
  current: CurrentEvidence,
  historical: HistoricalEvidence,
): GeoLevel | null {
  if (current.villageName && historical.villageName &&
      current.villageName.toLowerCase() === historical.villageName.toLowerCase()) {
    return 'VILLAGE'
  }
  if (current.waterSourceName && historical.waterSourceName &&
      current.waterSourceName.toLowerCase() === historical.waterSourceName.toLowerCase()) {
    return 'WATER_SOURCE'
  }
  if (current.blockName && historical.blockName &&
      current.blockName.toLowerCase() === historical.blockName.toLowerCase()) {
    return 'BLOCK'
  }
  if (current.districtName && historical.districtName &&
      current.districtName.toLowerCase() === historical.districtName.toLowerCase()) {
    return 'DISTRICT'
  }
  if (current.stateName && historical.stateName &&
      current.stateName.toLowerCase() === historical.stateName.toLowerCase()) {
    return 'STATE'
  }
  return null
}
/**
 * Deepest geographic level the historical record itself specifies.
 * Used only when no current measurement exists (so there is nothing to
 * pair with) â€” reports the finest available historical location level.
 */
function determineGeographicMatchForMissing(
  historical: HistoricalEvidence,
): string {
  if (historical.villageName) return 'VILLAGE'
  if (historical.waterSourceName) return 'WATER_SOURCE'
  if (historical.blockName) return 'BLOCK'
  if (historical.districtName) return 'DISTRICT'
  if (historical.stateName) return 'STATE'
  return 'UNKNOWN'
}

// ---- Comparison Logic ----

function compareValues(
  current: number,
  historical: number,
  parameter: string,
): 'AGREEMENT' | 'POSSIBLE_AGREEMENT' | 'CONFLICT' {
  if (current === 0 && historical === 0) return 'AGREEMENT'
  if (current === 0 || historical === 0) return 'POSSIBLE_AGREEMENT'
  const ratio = Math.max(current, historical) / Math.min(current, historical)
  if (ratio <= 1.2) return 'AGREEMENT'
  if (ratio <= 2.0) return 'POSSIBLE_AGREEMENT'
  return 'CONFLICT'
}

function buildInterpretation(
  status: string,
  param: string,
  current: number | null,
  historical: number | null,
  geoLevel: string,
  unit: string,
): string {
  const parts: string[] = []
  if (status === 'AGREEMENT') {
    parts.push(`Historical and current ${param} values are consistent`)
    if (current !== null && historical !== null) {
      parts.push(`(current: ${current} ${unit}, historical: ${historical} ${unit})`)
    }
    parts.push(`at the ${geoLevel.toLowerCase().replace('_', ' ')} level.`)
  } else if (status === 'POSSIBLE_AGREEMENT') {
    parts.push(`Some variation detected in ${param} between current and historical readings`)
    if (current !== null && historical !== null) {
      parts.push(`(current: ${current} ${unit}, historical: ${historical} ${unit})`)
    }
    parts.push(`at the ${geoLevel.toLowerCase().replace('_', ' ')} level.`)
    parts.push('Historical data provides context but does not prove current contamination.')
  } else {
    parts.push(`Significant difference detected in ${param}`)
    if (current !== null && historical !== null) {
      parts.push(`(current: ${current} ${unit}, historical: ${historical} ${unit})`)
    }
    parts.push(`at the ${geoLevel.toLowerCase().replace('_', ' ')} level.`)
    parts.push('Historical contamination does NOT prove current contamination. Current measurement is primary evidence.')
  }
  return parts.join(' ')
}

// ---- Main Function ----

export async function compareEvidence(
  pool: Pool,
  waterSourceId: string,
): Promise<EvidenceComparisonResult> {
  const limitations: string[] = []

  // Get water source with full location hierarchy
  const wsResult = await pool.query(
    `SELECT ws.id, ws.name, v.name AS village_name, v.gram_panchayat_id,
            b.id AS block_parent_id, b.name AS block_name,
            d.name AS district_name, s.name AS state_name,
            ws.latitude, ws.longitude
     FROM water_sources ws
     LEFT JOIN villages v ON v.id = ws.village_id
     LEFT JOIN gram_panchayats gp ON gp.id = v.gram_panchayat_id
     LEFT JOIN blocks b ON b.id = gp.block_id
     LEFT JOIN districts d ON d.id = b.district_id
     LEFT JOIN states s ON s.id = d.state_id
     WHERE ws.id = $1`,
    [waterSourceId],
  )

  if (wsResult.rows.length === 0) {
    throw new Error('Water source not found')
  }

  const ws = wsResult.rows[0]
  const waterSource = {
    id: ws.id,
    name: ws.name,
    village: ws.village_name || null,
    state: ws.state_name || null,
    district: ws.district_name || null,
    block: ws.block_name || null,
    gp: null,
    latitude: ws.latitude || null,
    longitude: ws.longitude || null,
  }

  // Get current evidence
  const currentEvidence: CurrentEvidence[] = []

  // Latest sensor reading (temperature + turbidity)
  const sensorResult = await pool.query(
    `SELECT s.temperature, s.turbidity, s.observed_at
     FROM sensor_readings s
     WHERE s.water_source_id = $1
     ORDER BY s.observed_at DESC LIMIT 1`,
    [waterSourceId],
  )

  if (sensorResult.rows.length > 0) {
    const row = sensorResult.rows[0]
    currentEvidence.push({
      parameter: 'temperature',
      value: row.temperature,
      unit: '°C',
      source: 'ESP32',
      timestamp: row.observed_at.toISOString(),
      waterSourceId: ws.id,
      waterSourceName: ws.name,
      villageName: ws.village_name || null,
      stateName: ws.state_name || null,
      districtName: ws.district_name || null,
      blockName: ws.block_name || null,
      gpName: null,
      latitude: ws.latitude || null,
      longitude: ws.longitude || null,
    })
    currentEvidence.push({
      parameter: 'turbidity',
      value: row.turbidity,
      unit: 'NTU',
      source: 'ESP32',
      timestamp: row.observed_at.toISOString(),
      waterSourceId: ws.id,
      waterSourceName: ws.name,
      villageName: ws.village_name || null,
      stateName: ws.state_name || null,
      districtName: ws.district_name || null,
      blockName: ws.block_name || null,
      gpName: null,
      latitude: ws.latitude || null,
      longitude: ws.longitude || null,
    })
  }

  // Latest manual measurements (pH + TDS)
  const manualResult = await pool.query(
    `SELECT p.code AS parameter, m.value, m.unit, m.source, m.tested_at
     FROM manual_measurements m
     JOIN parameters p ON p.id = m.parameter_id
     WHERE m.water_source_id = $1
     AND m.tested_at = (
       SELECT MAX(mm.tested_at) FROM manual_measurements mm
       WHERE mm.water_source_id = m.water_source_id
       AND mm.parameter_id = m.parameter_id
     )`,
    [waterSourceId],
  )

  for (const row of manualResult.rows) {
    currentEvidence.push({
      parameter: row.parameter,
      value: row.value,
      unit: row.unit,
      source: row.source,
      timestamp: row.tested_at.toISOString(),
      waterSourceId: ws.id,
      waterSourceName: ws.name,
      villageName: ws.village_name || null,
      stateName: ws.state_name || null,
      districtName: ws.district_name || null,
      blockName: ws.block_name || null,
      gpName: null,
      latitude: ws.latitude || null,
      longitude: ws.longitude || null,
    })
  }

  // Get historical government records that share parameters with current evidence
  const currentParams = [...new Set(currentEvidence.map(e => e.parameter))]

  const historicalEvidence: HistoricalEvidence[] = []
  const contextualGovernmentEvidence: HistoricalEvidence[] = []

  if (currentParams.length > 0) {
    const govResult = await pool.query(
      `SELECT gr.id, gr.dataset_id, gd.dataset_name, gd.source_organization,
              gd.source_url, gr.record_type, p.code AS parameter,
              gr.value, gr.unit, gr.affected_village_count,
              gr.state_name, gr.district_name, gr.block_name,
              gr.gram_panchayat_name, gr.village_name, gr.water_source_name,
              gr.sample_date, gr.latitude, gr.longitude,
              gr.original_row_reference, gr.notes, gr.imported_at
       FROM government_records gr
       JOIN government_datasets gd ON gd.id = gr.dataset_id
       JOIN parameters p ON p.id = gr.parameter_id
       WHERE p.code = ANY($1)
       AND gr.record_type = 'LABORATORY_MEASUREMENT'`,
      [currentParams],
    )

    for (const row of govResult.rows) {
      const isContaminationSummary = row.record_type === 'CONTAMINATION_SUMMARY'
      const he: HistoricalEvidence = {
        id: row.id,
        datasetId: row.dataset_id,
        datasetName: row.dataset_name,
        sourceOrganization: row.source_organization,
        sourceUrl: row.source_url,
        recordType: row.record_type,
        parameter: row.parameter,
        value: row.value,
        unit: row.unit,
        affectedVillageCount: row.affected_village_count,
        stateName: row.state_name || null,
        districtName: row.district_name || null,
        blockName: row.block_name || null,
        gpName: row.gram_panchayat_name || null,
        villageName: row.village_name || null,
        waterSourceName: row.water_source_name || null,
        sampleDate: row.sample_date ? row.sample_date.toISOString() : null,
        latitude: row.latitude || null,
        longitude: row.longitude || null,
        originalRowReference: row.original_row_reference || null,
        notes: row.notes || null,
        importedAt: row.imported_at.toISOString(),
        isContaminationSummary,
      }
      if (isContaminationSummary) {
        contextualGovernmentEvidence.push(he)
      } else if (row.value !== null) {
        historicalEvidence.push(he)
      } else {
        contextualGovernmentEvidence.push(he)
      }
    }

    // Also fetch WQ6 contamination summaries for contextual evidence
    const wq6Result = await pool.query(
      `SELECT gr.id, gr.dataset_id, gd.dataset_name, gd.source_organization,
              gd.source_url, gr.record_type, p.code AS parameter,
              gr.value, gr.unit, gr.affected_village_count,
              gr.state_name, gr.district_name, gr.block_name,
              gr.gram_panchayat_name, gr.village_name, gr.water_source_name,
              gr.sample_date, gr.latitude, gr.longitude,
              gr.original_row_reference, gr.notes, gr.imported_at
       FROM government_records gr
       JOIN government_datasets gd ON gd.id = gr.dataset_id
       JOIN parameters p ON p.id = gr.parameter_id
       WHERE p.code = ANY($1)
       AND gr.record_type = 'CONTAMINATION_SUMMARY'`,
      [currentParams],
    )

    for (const row of wq6Result.rows) {
      contextualGovernmentEvidence.push({
        id: row.id,
        datasetId: row.dataset_id,
        datasetName: row.dataset_name,
        sourceOrganization: row.source_organization,
        sourceUrl: row.source_url,
        recordType: row.record_type,
        parameter: row.parameter,
        value: null,
        unit: row.unit,
        affectedVillageCount: row.affected_village_count,
        stateName: row.state_name || null,
        districtName: row.district_name || null,
        blockName: row.block_name || null,
        gpName: row.gram_panchayat_name || null,
        villageName: row.village_name || null,
        waterSourceName: row.water_source_name || null,
        sampleDate: row.sample_date ? row.sample_date.toISOString() : null,
        latitude: row.latitude || null,
        longitude: row.longitude || null,
        originalRowReference: row.original_row_reference || null,
        notes: row.notes || null,
        importedAt: row.imported_at.toISOString(),
        isContaminationSummary: true,
      })
    }
  }

  // Build comparisons
  const comparisons: Comparison[] = []
  const agreements: Comparison[] = []
  const conflicts: Comparison[] = []
  const noComparableEvidence: HistoricalEvidence[] = []
  const missingCurrentEvidence: MissingCurrentEvidence[] = []

  for (const hist of historicalEvidence) {
    const curr = currentEvidence.find(e => e.parameter === hist.parameter)

    // Historical lab evidence for a parameter with NO current measurement.
    // Never treated as a current reading; never implies current safety.
    if (!curr) {
      const paramUpper = hist.parameter.toUpperCase()
      const existing = missingCurrentEvidence.find(m => m.parameter === hist.parameter)
      if (existing) {
        existing.historicalRecordCount += 1
      } else {
        missingCurrentEvidence.push({
          parameter: hist.parameter,
          statusCodes: [
            `CURRENT_${paramUpper}_NOT_MEASURED`,
            'HISTORICAL_EVIDENCE_PRESENT',
            'ADDITIONAL_TEST_REQUIRED',
          ],
          historicalRecordCount: 1,
          historical: {
            value: hist.value,
            valueType: 'HISTORICAL_ONLY',
            unit: hist.unit || null,
            source: hist.sourceOrganization,
            dataset: hist.datasetName,
            date: hist.sampleDate,
            location: [hist.villageName, hist.districtName, hist.stateName].filter(Boolean).join(', ') || hist.waterSourceName || '',
            geographicLevel: determineGeographicMatchForMissing(hist),
          },
        })
      }
      continue
    }

    const geoLevel = determineGeographicMatch(curr, hist)
    if (!geoLevel) {
      noComparableEvidence.push(hist)
      continue
    }

    if (!unitsCompatible(curr.unit, hist.unit)) {
      noComparableEvidence.push(hist)
      continue
    }

    if (curr.value === null || hist.value === null) {
      noComparableEvidence.push(hist)
      continue
    }

    const status = compareValues(curr.value, hist.value, hist.parameter)
    const absolute = Math.abs(curr.value - hist.value)
    const percentage = curr.value !== 0 ? (absolute / Math.abs(curr.value)) * 100 : null

    const comparison: Comparison = {
      parameter: hist.parameter,
      current: {
        value: curr.value,
        unit: curr.unit,
        source: curr.source,
        timestamp: curr.timestamp,
        location: [curr.villageName, curr.districtName, curr.stateName].filter(Boolean).join(', ') || curr.waterSourceName,
      },
      historical: {
        value: hist.value,
        unit: hist.unit || curr.unit,
        source: hist.sourceOrganization,
        dataset: hist.datasetName,
        date: hist.sampleDate,
        location: [hist.villageName, hist.districtName, hist.stateName].filter(Boolean).join(', ') || hist.waterSourceName || '',
        geographicLevel: geoLevel,
      },
      geographicMatchLevel: geoLevel,
      evidenceStatus: status,
      difference: { absolute, percentage },
      interpretation: buildInterpretation(status, hist.parameter, curr.value, hist.value, geoLevel, curr.unit),
    }

    comparisons.push(comparison)
    if (status === 'AGREEMENT' || status === 'POSSIBLE_AGREEMENT') {
      agreements.push(comparison)
    } else {
      conflicts.push(comparison)
    }
  }

  // Add limitations
  if (currentEvidence.length === 0) {
    limitations.push('No current measurements available. Government evidence is contextual only and cannot be compared.')
  }
  if (historicalEvidence.length === 0 && contextualGovernmentEvidence.length > 0) {
    limitations.push('No comparable laboratory measurements found. Only contamination summaries available as context.')
  }
  if (contextualGovernmentEvidence.length > 0) {
    limitations.push('WQ6 contamination summary counts represent affected villages, NOT contaminant concentrations. They cannot be compared against current measurements.')
  }
  limitations.push('Historical contamination does NOT prove current contamination. Historical absence of contamination does NOT prove current safety.')
  limitations.push('Current prototype measures only temperature, turbidity, pH, and TDS. Other parameters are NOT measured.')
limitations.push('Historical laboratory evidence exists for parameter(s) with no current measurement (CURRENT_<PARAM>_NOT_MEASURED). Historical data is NOT a current measurement and does NOT prove current safety; additional testing of those parameters is required.')

  return {
    waterSource,
    currentEvidence,
    historicalEvidence,
    comparisons,
    agreements,
    conflicts,
    noComparableEvidence,
    missingCurrentEvidence,
    contextualGovernmentEvidence,
    limitations,
    generatedAt: new Date().toISOString(),
  }
}
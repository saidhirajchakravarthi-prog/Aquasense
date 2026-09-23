/**
 * Historical Case Intelligence (new module — previously missing).
 *
 * Flow: CURRENT PROBLEM (deterministic breaches from the water-quality engine)
 *   -> SEARCH historical government records (government_records ONLY)
 *   -> same parameter + compatible unit + similar value/range
 *   -> location relevance (water source -> village -> block -> district -> state)
 *   -> time relevance (sample_date where actually present)
 *   -> documented action IF the source row actually contains one (notes column)
 *   -> interpretation + limitations.
 *
 * Hard rules:
 *   - ONLY value-based records (record_type='LABORATORY_MEASUREMENT' AND value IS
 *     NOT NULL) can be case-matched. WQ6 CONTAMINATION_SUMMARY affected-village
 *     counts are NEVER matched as concentrations — they appear as context only.
 *   - NO DOCUMENTED ACTION FOUND is reported honestly when the row has no notes.
 *   - Historical evidence is never converted into current evidence.
 *   - Classification is conservative: SIMILAR_CASE requires same parameter,
 *     compatible unit AND the same deterministic status band against the same
 *     registered standard. Anything looser is POSSIBLE_SIMILAR_CASE /
 *     HISTORICAL_CONFLICT / NO_RELEVANT_CASE.
 */
import type { Pool } from 'pg'
import { analyzeWaterQuality, classifyParameter } from './waterQualityEngine.js'

export interface HistoricalCase {
  recordId: string
  parameter: string
  displayName: string
  value: number
  unit: string | null
  statusAgainstStandard: string
  organization: string
  datasetName: string
  datasetYear: string | null
  sourceUrl: string | null
  location: { state: string | null; district: string | null; block: string | null; village: string | null; waterSource: string | null }
  sampleDate: string | null
  locationMatch: 'WATER_SOURCE' | 'VILLAGE' | 'BLOCK' | 'DISTRICT' | 'STATE' | 'NONE'
  valueDifference: { absolute: number; percentage: number | null }
  similarity: 'SIMILAR_CASE' | 'POSSIBLE_SIMILAR_CASE' | 'HISTORICAL_CONFLICT'
  documentedAction: string | null
  actionAvailability: 'DOCUMENTED_ACTION_PRESENT' | 'NO_DOCUMENTED_ACTION_FOUND'
  timeContext: string
}

export interface HistoricalCaseIntelResult {
  waterSource: { id: string; name: string; village: string | null; district: string | null; state: string | null } | null
  generatedAt: string
  currentEvidence: Array<{ parameter: string; displayName: string; value: number | null; unit: string | null; status: string; timestamp: string | null; source: string | null }>
  historicalCases: HistoricalCase[]
  contextualCounts: Array<{ parameter: string; state: string | null; affectedVillageCount: number; datasetName: string; sampleDate: string | null; note: string }>
  summary: { searchedParameters: number; casesFound: number; similar: number; possible: number; conflicts: number; noRelevantCase: boolean }
  interpretation: string
  limitations: string[]
}

function locationMatchLevel(
  rec: { state_name: string | null; district_name: string | null; block_name: string | null; village_name: string | null; water_source_name: string | null },
  loc: { state: string | null; district: string | null; block: string | null; village: string | null },
): HistoricalCase['locationMatch'] {
  if (loc.village && rec.village_name && rec.village_name.toLowerCase() === loc.village.toLowerCase()) return 'VILLAGE'
  if (loc.block && rec.block_name && rec.block_name.toLowerCase() === loc.block.toLowerCase()) return 'BLOCK'
  if (loc.district && rec.district_name && rec.district_name.toLowerCase() === loc.district.toLowerCase()) return 'DISTRICT'
  if (loc.state && rec.state_name && rec.state_name.toLowerCase() === loc.state.toLowerCase()) return 'STATE'
  return 'NONE'
}

function unitCompatible(a: string | null, b: string | null): boolean {
  const norm = (u: string | null) => (u ?? '').trim().toLowerCase().replace('µ', 'u')
  if (!a && !b) return true
  if (!a || !b) return false
  return norm(a) === norm(b)
}

/** Entry point. Returns null when the water source does not exist. */
export async function findHistoricalCases(pool: Pool, waterSourceId: string): Promise<HistoricalCaseIntelResult | null> {
  const analysis = await analyzeWaterQuality(pool, waterSourceId)
  if (!analysis) return null
  const src = analysis.waterSource
  const loc = { state: src?.state ?? null, district: src?.district ?? null, block: null as string | null, village: src?.village ?? null }

  const currentEvidence = analysis.measurements.map((m) => ({
    parameter: m.parameter, displayName: m.displayName, value: m.value, unit: m.unit,
    status: m.status, timestamp: m.timestamp, source: m.source,
  }))
  const measured = analysis.measurements.filter((m) => m.value !== null)
  const cases: HistoricalCase[] = []
  const contextualCounts: HistoricalCaseIntelResult['contextualCounts'] = []

  for (const m of measured) {
    // Value-based historical records for this parameter ONLY (never WQ6 counts).
    const rows = (
      await pool.query(
        `SELECT gr.id, gr.value, gr.unit, gr.state_name, gr.district_name, gr.block_name,
                gr.village_name, gr.water_source_name, gr.sample_date, gr.notes,
                gd.source_organization, gd.dataset_name, gd.dataset_year, gd.source_url
         FROM government_records gr
         JOIN government_datasets gd ON gd.id = gr.dataset_id
         JOIN parameters p ON p.id = gr.parameter_id
         WHERE p.code = $1 AND gr.record_type = 'LABORATORY_MEASUREMENT' AND gr.value IS NOT NULL`,
        [m.parameter],
      )
    ).rows

    for (const r of rows) {
      const value = Number(r.value)
      if (!Number.isFinite(value)) continue
      // Classify the HISTORICAL value with the SAME registered standard as now.
      const histCls = m.standard ? classifyParameter(value, m.standard) : null
      const histStatus = histCls ? histCls.status : 'NO_STANDARD_AVAILABLE'
      const diff = value - (m.value as number)
      const percentage = m.value !== 0 ? Math.round((diff / Math.abs(m.value as number)) * 1000) / 10 : null
      const match = locationMatchLevel(r, loc)
      let similarity: HistoricalCase['similarity']
      if (unitCompatible(m.unit, r.unit) && histStatus === m.status) similarity = 'SIMILAR_CASE'
      else if (unitCompatible(m.unit, r.unit)) similarity = 'HISTORICAL_CONFLICT'
      else similarity = 'POSSIBLE_SIMILAR_CASE'
      const notes = typeof r.notes === 'string' && r.notes.trim() !== '' ? r.notes.trim() : null
      cases.push({
        recordId: r.id, parameter: m.parameter, displayName: m.displayName,
        value, unit: r.unit ?? null, statusAgainstStandard: histStatus,
        organization: r.source_organization, datasetName: r.dataset_name,
        datasetYear: r.dataset_year ?? null, sourceUrl: r.source_url ?? null,
        location: { state: r.state_name ?? null, district: r.district_name ?? null, block: r.block_name ?? null, village: r.village_name ?? null, waterSource: r.water_source_name ?? null },
        sampleDate: r.sample_date ? new Date(r.sample_date).toISOString().slice(0, 10) : null,
        locationMatch: match, valueDifference: { absolute: Math.round(diff * 10000) / 10000, percentage },
        similarity,
        documentedAction: notes, actionAvailability: notes ? 'DOCUMENTED_ACTION_PRESENT' : 'NO_DOCUMENTED_ACTION_FOUND',
        timeContext: r.sample_date ? `sample dated ${new Date(r.sample_date).toISOString().slice(0, 10)}` : 'no sample date in the source record',
      })
    }

    // WQ6 / summary context for the same parameter — counts, NEVER concentrations.
    const summaryRows = (
      await pool.query(
        `SELECT gr.affected_village_count, gr.state_name, gr.sample_date, gd.dataset_name
         FROM government_records gr
         JOIN government_datasets gd ON gd.id = gr.dataset_id
         JOIN parameters p ON p.id = gr.parameter_id
         WHERE p.code = $1 AND gr.record_type = 'CONTAMINATION_SUMMARY' AND gr.affected_village_count IS NOT NULL`,
        [m.parameter],
      )
    ).rows
    for (const r of summaryRows)
      contextualCounts.push({
        parameter: m.parameter, state: r.state_name ?? null, affectedVillageCount: Number(r.affected_village_count),
        datasetName: r.dataset_name, sampleDate: r.sample_date ? new Date(r.sample_date).toISOString().slice(0, 10) : null,
        note: 'AFFECTED VILLAGE COUNT — CONTEXT ONLY (never a concentration, never a current sensor value)',
      })
  }

  const similar = cases.filter((c) => c.similarity === 'SIMILAR_CASE').length
  const possible = cases.filter((c) => c.similarity === 'POSSIBLE_SIMILAR_CASE').length
  const conflicts = cases.filter((c) => c.similarity === 'HISTORICAL_CONFLICT').length
  const noRelevantCase = cases.length === 0

  let interpretation: string
  if (measured.length === 0) {
    interpretation = 'No current measurement exists, so there is no current problem to search historical cases for (NO_RELEVANT_CASE).'
  } else if (noRelevantCase) {
    interpretation = `NO_RELEVANT_CASE: the government reference module currently contains NO value-based laboratory records for the ${measured.length} measured parameter(s). The imported WQ6 dataset holds affected-village counts, which are context only and cannot be case-matched against measured values.`
  } else {
    interpretation = `${cases.length} value-based historical record(s) matched on parameter: ${similar} SIMILAR_CASE (same parameter, compatible unit, same status band), ${possible} POSSIBLE_SIMILAR_CASE (unit mismatch — treat with caution), ${conflicts} HISTORICAL_CONFLICT (historical value differs in status from the current measurement). Historical evidence provides context only and never becomes current evidence.`
  }

  return {
    waterSource: src ? { id: src.id, name: src.name, village: src.village, district: src.district, state: src.state } : null,
    generatedAt: new Date().toISOString(),
    currentEvidence,
    historicalCases: cases,
    contextualCounts,
    summary: { searchedParameters: measured.length, casesFound: cases.length, similar, possible, conflicts, noRelevantCase },
    interpretation,
    limitations: [
      'Only value-based LABORATORY_MEASUREMENT government records are case-matched; WQ6 affected-village counts are context only and are never converted to concentrations (mg/L, NTU) or sensor values.',
      'Historical evidence never becomes current evidence and never triggers alerts.',
      'Documented actions are shown ONLY when the source record actually contains one; otherwise NO_DOCUMENTED_ACTION_FOUND is reported. No action is ever invented.',
      'Some historical records may lack sample dates or unit declarations; such cases are downgraded to POSSIBLE_SIMILAR_CASE or carry an explicit unknown time context.',
      'Location matching uses verbatim text equality (water source/village/block/district/state); the imported WQ6 locations are administrative summaries, not the prototype location.',
      'Similarity is based on the same registered standard status band — it is not a guarantee of the same underlying cause.',
    ],
  }
}

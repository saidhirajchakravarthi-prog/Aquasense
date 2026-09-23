/**
 * Government CSV/XLSX import service.
 *
 * Guarantees:
 * - Original source fields are preserved verbatim wherever possible.
 * - Affected-village counts stay counts (affected_village_count) and are never
 *   written into value/unit.
 * - Unknown parameters FAIL THE ROW with a clear error; nothing is silently
 *   invented. Only curated catalogue entries below may auto-register.
 * - Duplicate detection is null-safe and includes record type/value/count.
 */
import * as XLSX from 'xlsx'
import type { z } from 'zod'
import { pool } from '../database/pool.js'
import { importSchema } from '../validation.js'

type Config = z.infer<typeof importSchema>

interface CatalogEntry {
  code: string
  display: string
  unit: string
}

/** Curated master-data catalogue: canonical code, display name, default unit. */
const CATALOG_LIST: CatalogEntry[] = [
  { code: 'temperature', display: 'Temperature', unit: '°C' },
  { code: 'turbidity', display: 'Turbidity', unit: 'NTU' },
  { code: 'ph', display: 'pH', unit: '' },
  { code: 'tds', display: 'TDS', unit: 'ppm' },
  { code: 'fluoride', display: 'Fluoride', unit: 'mg/L' },
  { code: 'arsenic', display: 'Arsenic', unit: 'mg/L' },
  { code: 'iron', display: 'Iron', unit: 'mg/L' },
  { code: 'nitrate', display: 'Nitrate', unit: 'mg/L' },
  { code: 'nitrite', display: 'Nitrite', unit: 'mg/L' },
  { code: 'chloride', display: 'Chloride', unit: 'mg/L' },
  { code: 'residual_chlorine', display: 'Residual Chlorine', unit: 'mg/L' },
  { code: 'sulphate', display: 'Sulphate', unit: 'mg/L' },
  { code: 'hardness', display: 'Total Hardness', unit: 'mg/L' },
  { code: 'calcium', display: 'Calcium', unit: 'mg/L' },
  { code: 'magnesium', display: 'Magnesium', unit: 'mg/L' },
  { code: 'sodium', display: 'Sodium', unit: 'mg/L' },
  { code: 'potassium', display: 'Potassium', unit: 'mg/L' },
  { code: 'alkalinity', display: 'Alkalinity', unit: 'mg/L' },
  { code: 'bicarbonate', display: 'Bicarbonate', unit: 'mg/L' },
  { code: 'dissolved_oxygen', display: 'Dissolved Oxygen', unit: 'mg/L' },
  { code: 'bod', display: 'BOD', unit: 'mg/L' },
  { code: 'cod', display: 'COD', unit: 'mg/L' },
  { code: 'conductivity', display: 'Electrical Conductivity', unit: 'µS/cm' },
  { code: 'e_coli', display: 'E. coli', unit: 'MPN/100mL' },
  { code: 'total_coliform', display: 'Total Coliform', unit: 'MPN/100mL' },
  { code: 'carbonate', display: 'Carbonate', unit: 'mg/L' },
  { code: 'silica', display: 'Silica', unit: 'mg/L' },
]

const CATALOG_LIST_TAIL: CatalogEntry[] = [
  { code: 'faecal_coliform', display: 'Faecal Coliform', unit: 'MPN/100mL' },
  { code: 'aluminium', display: 'Aluminium', unit: 'mg/L' },
  { code: 'cadmium', display: 'Cadmium', unit: 'mg/L' },
  { code: 'chromium', display: 'Chromium', unit: 'mg/L' },
  { code: 'lead', display: 'Lead', unit: 'mg/L' },
  { code: 'copper', display: 'Copper', unit: 'mg/L' },
  { code: 'manganese', display: 'Manganese', unit: 'mg/L' },
  { code: 'zinc', display: 'Zinc', unit: 'mg/L' },
  { code: 'nickel', display: 'Nickel', unit: 'mg/L' },
  { code: 'selenium', display: 'Selenium', unit: 'mg/L' },
  { code: 'cyanide', display: 'Cyanide', unit: 'mg/L' },
  { code: 'ammonia', display: 'Ammonia', unit: 'mg/L' },
  { code: 'phosphate', display: 'Phosphate', unit: 'mg/L' },
  { code: 'boron', display: 'Boron', unit: 'mg/L' },
  { code: 'uranium', display: 'Uranium', unit: 'µg/L' },
]

/** Normalise free-text parameter names to a comparable key ("E-coli." → ecOli). */
const normKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Aliases seen across CGWB / JJM-WQMIS exports, keyed by normalised text. */
const ALIASES: Record<string, string> = {
  ecol: 'e_coli',
  fecalcolform: 'faecal_coliform',
  faecalcolform: 'faecal_coliform',
  totalcolform: 'total_coliform',
  totalhardness: 'hardness',
  dissolveoxygen: 'dissolved_oxygen',
  electricalconductvty: 'conductivity',
  specconductivity: 'conductivity',
  totalalkalinity: 'alkalinity',
  totalarsenic: 'arsenic',
}
for (const entry of [...CATALOG_LIST, ...CATALOG_LIST_TAIL]) {
  ALIASES[normKey(entry.display)] ??= entry.code
  ALIASES[normKey(entry.code)] ??= entry.code
}

const CATALOG: Record<string, CatalogEntry> = {}
for (const entry of [...CATALOG_LIST, ...CATALOG_LIST_TAIL]) CATALOG[entry.code] = entry

function resolveParameter(raw: string): CatalogEntry | undefined {
  const key = normKey(raw)
  const code = ALIASES[key] ?? key
  return CATALOG[code]
}

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(typeof value === 'string' ? value.trim() : value)
  return Number.isFinite(n) ? n : null
}

const blank = (value: unknown) =>
  value === null || value === undefined || String(value).trim() === ''

/** Convert Excel dates (Date objects or serial numbers) or strings to ISO yyyy-mm-dd. */
function isoDate(value: unknown): string | null {
  if (blank(value)) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number')
    return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10)
  const text = String(value).trim()
  if (!Number.isNaN(Date.parse(text))) return new Date(text).toISOString().slice(0, 10)
  return null
}

const coordOk = (value: unknown, min: number, max: number) => {
  if (blank(value)) return true
  const n = numeric(value)
  return n !== null && n >= min && n <= max
}

/**
 * Read the first worksheet as { headers, rows }. Long-format files behave
 * exactly as before (first spreadsheet row is the header). Wide-format
 * exports (e.g. JJM-WQMIS WQ6) set `headerRow` (0-based) and, optionally,
 * `wide.dataStartRow`; blank/merged header cells become stable `__COL_<i>`
 * keys so contaminant columns can be addressed by position without
 * depending on merged header text.
 */
function readSheet(file: Express.Multer.File, config: Config): {
  headers: string[]
  rows: Array<Record<string, unknown>>
  dataStart: number
} {
  const book = XLSX.read(file.buffer, { type: 'buffer', cellDates: true })
  const sheet = book.Sheets[book.SheetNames[0]]
  if (!sheet) throw new Error('The uploaded workbook has no worksheet.')
  if (!config.wide && config.headerRow === undefined) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })
    if (!rows.length) throw new Error('The uploaded file contains no data rows beneath its header row.')
    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as unknown as string[]
    return { headers, rows, dataStart: 0 }
  }
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  if (!grid.length) throw new Error('The uploaded file contains no data rows beneath its header row.')
  const headerIndex = config.headerRow ?? 0
  const headerRow = (grid[headerIndex] ?? []) as unknown[]
  const seen = new Set<string>()
  const headers = headerRow.map((cell, index) => {
    const text = cell === null || cell === undefined ? '' : String(cell).trim()
    let key = text || `__COL_${index}`
    while (seen.has(key)) key = `${key}__COL_${index}`
    seen.add(key)
    return key
  })
  const dataStart = config.wide?.dataStartRow ?? headerIndex + 1
  const rows = grid
    .slice(dataStart)
    .map((cells) => Object.fromEntries(headers.flatMap((header, index): Array<[string, unknown]> => [
      [header, cells[index] ?? null],
      [`__COL_${index}`, cells[index] ?? null], // positional alias: wide configs address columns by index, not merged header text
    ])) as Record<string, unknown>)
    .filter((row) => Object.values(row).some((cell) => cell !== null && String(cell).trim() !== ''))
  if (!rows.length) throw new Error('The uploaded file contains no data rows beneath its header row.')
  return { headers, rows, dataStart }
}

async function ensureParameter(entry: CatalogEntry): Promise<{ id: string } | undefined> {
  const existing = await pool.query<{ id: string }>('SELECT id FROM parameters WHERE code=$1', [entry.code])
  if (existing.rows.length) return existing.rows[0]
  const inserted = await pool.query<{ id: string }>(
    'INSERT INTO parameters(code,display_name,default_unit) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING RETURNING id',
    [entry.code, entry.display, entry.unit],
  )
  if (inserted.rows.length) return inserted.rows[0]
  return (await pool.query<{ id: string }>('SELECT id FROM parameters WHERE code=$1', [entry.code])).rows[0]
}

/**
 * Validate a file WITHOUT writing to the database.
 * Returns headers, row count, and per-row validation issues so the operator
 * can fix mapping before the real import.
 */
export async function previewGovernmentFile(file: Express.Multer.File, config: Config): Promise<{
  headers: string[]
  totalRows: number
  validRows: number
  issues: Array<{ row: number; message: string }>
  skippedRows: number
}> {
  const { headers, rows, dataStart } = readSheet(file, config)
  const issues: Array<{ row: number; message: string }> = []
  let validRows = 0
  let skippedRows = 0
  const isLab = config.recordType === 'LABORATORY_MEASUREMENT'

  if (config.wide) {
    const { labelColumn, measures } = config.wide
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const rowNumber = dataStart + index + 1 // 1-based spreadsheet row
      const label = String(row[labelColumn] ?? '').trim()
      if (!label || normKey(label) === 'total' || normKey(label) === 'grandtotal') {
        skippedRows++ // aggregate rows are never imported as if they were locations
        continue
      }
      for (const measure of measures) {
        const catalogEntry = resolveParameter(measure.parameter)
        const cell = numeric(row[measure.column])
        const where = `${label} / ${measure.parameter}`
        if (!catalogEntry)
          issues.push({ row: rowNumber, message: `${where}: parameter is not in the AquaSense parameter catalogue.` })
        else if (cell === null || cell < 0 || !Number.isInteger(cell))
          issues.push({ row: rowNumber, message: `${where}: affected-village count is missing, negative, or not a whole number (counts are never concentrations).` })
        else validRows++
      }
    }
    return { headers, totalRows: validRows + issues.length, validRows, issues, skippedRows }
  }

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const get = (field: string) => row[config.mapping[field]]
    const rawParameter = String(get('parameter') ?? '').trim()
    const catalogEntry = resolveParameter(rawParameter)
    const value = numeric(get('value'))
    const affected = numeric(get('affectedVillageCount'))
    const latitude = numeric(get('latitude'))
    const longitude = numeric(get('longitude'))
    const rowNumber = index + 2

    let reason = ''
    if (!config.mapping.parameter || !config.mapping.parameter.trim())
      reason = 'Column mapping for "parameter" is required.'
    else if (!catalogEntry)
      reason = `Parameter "${rawParameter}" is not in the AquaSense parameter catalogue.`
    else if (isLab && value === null)
      reason = 'Laboratory measurement requires a numeric value.'
    else if (!isLab && (affected === null || affected < 0))
      reason = 'Contamination summary requires a non-negative affected-village count (never a concentration).'
    else if (!blank(get('sampleDate')) && isoDate(get('sampleDate')) === null)
      reason = 'Sample date is present but cannot be parsed.'
    else if (!coordOk(latitude, -90, 90))
      reason = 'Latitude is out of range (-90 to 90).'
    else if (!coordOk(longitude, -180, 180))
      reason = 'Longitude is out of range (-180 to 180).'

    if (reason) issues.push({ row: rowNumber, message: reason })
    else validRows++
  }

  return { headers, totalRows: rows.length, validRows, issues, skippedRows }
}

export async function importGovernmentFile(file: Express.Multer.File, config: Config) {
  const { rows, dataStart } = readSheet(file, config)

  const dataset = (
    await pool.query<{ id: string }>(
      'INSERT INTO government_datasets(source_organization,dataset_name,dataset_year,source_url) VALUES($1,$2,$3,$4) RETURNING id',
      [config.sourceOrganization, config.datasetName, config.datasetYear ?? null, config.sourceUrl ?? null],
    )
  ).rows[0]
  const job = (
    await pool.query<{ id: string }>(
      'INSERT INTO import_jobs(dataset_id,status,total_rows) VALUES($1,$2,$3) RETURNING id',
      [dataset.id, 'VALIDATING', rows.length],
    )
  ).rows[0]

  let valid = 0, invalid = 0, duplicates = 0, imported = 0

  if (config.wide) {
    const { labelColumn, measures } = config.wide
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const rowNumber = dataStart + index + 1
      const label = String(row[labelColumn] ?? '').trim()
      if (!label || normKey(label) === 'total' || normKey(label) === 'grandtotal') continue
      for (const measure of measures) {
        const catalogEntry = resolveParameter(measure.parameter)
        const cell = numeric(row[measure.column])
        let reason = ''
        if (!catalogEntry)
          reason = `Parameter "${measure.parameter}" (wide column "${measure.column}") is not in the AquaSense parameter catalogue; extend the catalogue deliberately instead of importing unknown codes.`
        else if (cell === null || cell < 0 || !Number.isInteger(cell))
          reason = 'This record type requires a whole affected-village count (counts are never concentration values).'
        if (reason) {
          invalid++
          await pool.query(
            'INSERT INTO import_errors(import_job_id,row_number,message,original_row) VALUES($1,$2,$3,$4)',
            [job.id, rowNumber, `${label}: ${reason}`, JSON.stringify(row)],
          )
          continue
        }
        const parameterRow = await ensureParameter(catalogEntry!)
        if (!parameterRow) {
          invalid++
          continue
        }
        const count = Math.trunc(cell!)
        const duplicate = await pool.query(
          `SELECT 1 FROM government_records
           WHERE dataset_id=$1 AND parameter_id=$2 AND record_type=$3::government_record_type
             AND value IS NOT DISTINCT FROM $4
             AND affected_village_count IS NOT DISTINCT FROM $5
             AND COALESCE(sample_date::text,'') = COALESCE($6,'')
             AND COALESCE(village_name,'') = COALESCE($7,'')
             AND COALESCE(state_name,'') = COALESCE($8,'')`,
          [dataset.id, parameterRow.id, config.recordType, null, count, '', '', label],
        )
        if (duplicate.rowCount) {
          duplicates++
          continue
        }
        await pool.query(
          `INSERT INTO government_records(dataset_id,record_type,parameter_id,value,unit,affected_village_count,state_name,village_name,original_row_reference)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [dataset.id, config.recordType, parameterRow.id, null, null, count, label, null, String(rowNumber)],
        )
        valid++
        imported++
      }
    }
  }

  if (!config.wide) for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const get = (field: string) => row[config.mapping[field]]
    const rawParameter = String(get('parameter') ?? '').trim()
    const catalogEntry = resolveParameter(rawParameter)
    const value = numeric(get('value'))
    const affected = numeric(get('affectedVillageCount'))
    const isLab = config.recordType === 'LABORATORY_MEASUREMENT'
    const latitude = numeric(get('latitude'))
    const longitude = numeric(get('longitude'))

    let reason = ''
    if (!catalogEntry)
      reason = `Parameter "${rawParameter}" is not in the AquaSense parameter catalogue; extend the catalogue deliberately instead of importing unknown codes.`
    else if (isLab && value === null)
      reason = 'Laboratory measurement requires a numeric value.'
    else if (!isLab && (affected === null || affected < 0))
      reason = 'This record type requires a whole affected-village count (counts are never concentration values).'
    else if (!blank(get('sampleDate')) && isoDate(get('sampleDate')) === null)
      reason = 'Sample date is present but cannot be parsed.'
    else if (!coordOk(latitude, -90, 90))
      reason = 'Latitude is out of range.'
    else if (!coordOk(longitude, -180, 180))
      reason = 'Longitude is out of range.'

    if (reason) {
      invalid++
      await pool.query(
        'INSERT INTO import_errors(import_job_id,row_number,message,original_row) VALUES($1,$2,$3,$4)',
        [job.id, index + 2, reason, JSON.stringify(row)],
      )
      continue
    }

    const parameterRow = await ensureParameter(catalogEntry!)
    if (!parameterRow) {
      invalid++
      continue
    }

    const sampleDate = isoDate(get('sampleDate'))
    const village = blank(get('village')) ? null : String(get('village')).trim()
    const unitCell = blank(get('unit')) ? null : String(get('unit')).trim()
    const unit = unitCell ?? (catalogEntry!.unit || null)
    const origRef = blank(get('originalRowReference')) ? String(index + 2) : String(get('originalRowReference')).trim()
    const notes = blank(get('notes')) ? null : String(get('notes')).trim()

    const duplicate = await pool.query(
      `SELECT 1 FROM government_records
       WHERE dataset_id=$1 AND parameter_id=$2 AND record_type=$3::government_record_type
         AND value IS NOT DISTINCT FROM $4
         AND affected_village_count IS NOT DISTINCT FROM $5
         AND COALESCE(sample_date::text,'') = COALESCE($6,'')
         AND COALESCE(village_name,'') = COALESCE($7,'')`,
      [
        dataset.id, parameterRow.id, config.recordType,
        isLab ? value : null,
        isLab ? null : Math.trunc(affected!),
        sampleDate ?? '', village ?? '',
      ],
    )
    if (duplicate.rowCount) {
      duplicates++
      continue
    }

    await pool.query(
      `INSERT INTO government_records(dataset_id,record_type,parameter_id,value,unit,affected_village_count,state_name,district_name,block_name,gram_panchayat_name,village_name,water_source_name,sample_date,latitude,longitude,original_row_reference,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        dataset.id, config.recordType, parameterRow.id,
        isLab ? value : null,
        isLab ? unit : null,
        isLab ? null : Math.trunc(affected!),
        blank(get('state')) ? null : String(get('state')).trim(),
        blank(get('district')) ? null : String(get('district')).trim(),
        blank(get('block')) ? null : String(get('block')).trim(),
        blank(get('gramPanchayat')) ? null : String(get('gramPanchayat')).trim(),
        village,
        blank(get('waterSource')) ? null : String(get('waterSource')).trim(),
        sampleDate, latitude, longitude, origRef, notes,
      ],
    )
    valid++
    imported++
  }

  await pool.query(
    'UPDATE import_jobs SET status=$2,valid_rows=$3,invalid_rows=$4,duplicate_rows=$5,imported_rows=$6 WHERE id=$1',
    [job.id, 'COMPLETED', valid, invalid, duplicates, imported],
  )
  const errors = (
    await pool.query(
      'SELECT row_number AS "rowNumber",field_name AS "fieldName",message FROM import_errors WHERE import_job_id=$1 ORDER BY row_number LIMIT 100',
      [job.id],
    )
  ).rows
  return {
    jobId: job.id, totalRows: rows.length,
    validRows: valid, invalidRows: invalid, duplicateRows: duplicates, importedRows: imported, errors,
  }
}




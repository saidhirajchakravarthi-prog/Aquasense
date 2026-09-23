// Import extracted CGWB CSV through the existing government importer service.
// Run: npx tsx scripts/import-cgwb.mjs <csv> <year>
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

// Use tsx to handle TypeScript imports
const csvPath = process.argv[2]
const year = process.argv[3] // "2022" or "2023"

// Minimal CSV parser (no deps)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.length)
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, ''))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.replace(/^"|"$/g, ''))
    const row = {}
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? '' })
    rows.push(row)
  }
  return rows
}

const csvText = readFileSync(csvPath, 'utf8')
const rows = parseCSV(csvText)
console.log(`Parsed ${rows.length} rows from ${csvPath}`)

// Build an Excel-like object the importer expects. The importer uses XLSX.utils.sheet_to_json
// which needs a worksheet. We'll construct a minimal XLSX-compatible structure by writing
// a real .xlsx via a tiny builder is overkill; instead we monkey-patch by creating a buffer
// that the xlsx lib can read. Simplest: write CSV to temp and let xlsx parse it as CSV.
import { writeFileSync } from 'node:fs'
const tmpCsv = csvPath.replace('.csv', '_import.csv')
writeFileSync(tmpCsv, csvText)

// Dynamically import the importer (TypeScript) via tsx loader
const { importGovernmentFile } = await import('../server/src/services/governmentImport.js')

const config = {
  sourceOrganization: 'CGWB',
  datasetName: `CGWB Ground Water Quality Data - ${year}`,
  datasetYear: year,
  sourceUrl: 'https://cgwb.gov.in/',
  recordType: 'LABORATORY_MEASUREMENT',
  mapping: {
    parameter: 'parameter',
    value: 'value',
    unit: 'unit',
    state: 'state',
    district: 'district',
    block: 'block',
    village: 'village',
    latitude: 'latitude',
    longitude: 'longitude',
    sampleDate: 'sampleDate',
    originalRowReference: 'originalRowReference',
  },
}

const file = { buffer: readFileSync(tmpCsv), originalname: `${year}.csv`, mimetype: 'text/csv', size: readFileSync(tmpCsv).length }

console.log(`Importing ${year}...`)
const result = await importGovernmentFile(file, config)
console.log(JSON.stringify(result, null, 2))

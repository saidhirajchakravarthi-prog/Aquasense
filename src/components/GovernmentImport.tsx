/**
 * Government Data Import — production importer.
 * CSV/XLSX -> column mapping -> validation -> import with per-row errors.
 * Values are never invented here: every field comes from the operator's file,
 * and affected-village counts stay counts (never concentrations).
 */
import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { importFile } from '../providers/governmentProvider'
import type { ImportConfig, ImportResult } from '../types'
const FIELD_LABELS: Record<string, string> = {
  parameter: 'Parameter',
  value: 'Value',
  unit: 'Unit',
  affectedVillageCount: 'Affected village count',
  state: 'State',
  district: 'District',
  block: 'Block',
  gramPanchayat: 'Gram panchayat',
  village: 'Village',
  waterSource: 'Water source',
  sampleDate: 'Sample date',
  latitude: 'Latitude',
  longitude: 'Longitude',
}
const FIELDS = Object.keys(FIELD_LABELS)
const REQUIRED = {
  LABORATORY_MEASUREMENT: ['parameter', 'value'],
  CONTAMINATION_SUMMARY: ['parameter', 'affectedVillageCount'],
  TESTING_STATISTIC: ['parameter', 'affectedVillageCount'],
} as const

const ORGANISATIONS = ['CGWB', 'JJM-WQMIS', 'DATA.GOV.IN', 'OTHER_GOVERNMENT'] as const
const RECORD_TYPES = ['LABORATORY_MEASUREMENT', 'CONTAMINATION_SUMMARY', 'TESTING_STATISTIC'] as const

export function GovernmentImport({ onComplete }: { onComplete: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [config, setConfig] = useState<ImportConfig>({
    sourceOrganization: 'CGWB',
    datasetName: '',
    datasetYear: '',
    sourceUrl: '',
    recordType: 'LABORATORY_MEASUREMENT',
    mapping: {},
  })

  const needed: string[] = useMemo(() => [...REQUIRED[config.recordType]], [config.recordType])
  const missingMappings = needed.filter((key) => !config.mapping[key])

  /** Pre-import row validation; returns short reasons keyed by spreadsheet row. */
  const problems = useMemo(() => {
    const getCell = (row: Record<string, unknown>, key: string) =>
      config.mapping[key] ? row[config.mapping[key]] : undefined
    const issues = new Map<number, string>()
    rows.forEach((row, index) => {
      const rawValue = getCell(row, config.recordType === 'LABORATORY_MEASUREMENT' ? 'value' : 'affectedVillageCount')
      const numeric =
        rawValue === null || rawValue === undefined || String(rawValue).trim() === '' ? null : Number(rawValue)
      const date = getCell(row, 'sampleDate')
      const lat = getCell(row, 'latitude')
      const lng = getCell(row, 'longitude')
      let reason = ''
      if (!String(getCell(row, 'parameter') ?? '').trim()) reason = 'Parameter is empty.'
      else if (numeric === null || !Number.isFinite(numeric)) reason = 'Required numeric field is missing or invalid.'
      else if (
        date !== null && date !== undefined && String(date).trim() !== '' &&
        Number.isNaN(Date.parse(String(date)))
      ) reason = 'Sample date cannot be parsed.'
      else if (
        lat !== null && lat !== undefined && String(lat).trim() !== '' &&
        (!Number.isFinite(Number(lat)) || Number(lat) < -90 || Number(lat) > 90)
      ) reason = 'Latitude out of range.'
      else if (
        lng !== null && lng !== undefined && String(lng).trim() !== '' &&
        (!Number.isFinite(Number(lng)) || Number(lng) < -180 || Number(lng) > 180)
      ) reason = 'Longitude out of range.'
      if (reason) issues.set(index + 2, reason)
    })
    return issues
  }, [rows, config])


  const choose = (selected: File | undefined) => {
    if (!selected) return
    setFile(selected)
    setResult(null)
    setError('')
    setRows([])
    setHeaders([])
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const book = XLSX.read(event.target?.result, { type: 'array', cellDates: true })
        const sheet = book.Sheets[book.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })
        setRows(data)
        setHeaders(data.length ? Object.keys(data[0]) : [])
        if (!data.length) setError('This file has a header but no data rows.')
      } catch {
        setError('Cannot read this file. Use CSV or XLSX with a header row.')
      }
    }
    reader.readAsArrayBuffer(selected)
  }

  const submit = async () => {
    setError('')
    if (!file || !config.datasetName.trim()) return setError('Select a CSV/XLSX file and enter a dataset name.')
    if (missingMappings.length)
      return setError(`Map the required fields first: ${missingMappings.map((k) => FIELD_LABELS[k] ?? k).join(', ')}.`)
    if (problems.size)
      return setError(
        `Pre-import validation found ${problems.size} invalid row(s). Fix numeric values, supplied dates, or coordinates before importing — rows are never silently corrected.`,
      )
    const payload: ImportConfig = {
      sourceOrganization: config.sourceOrganization,
      datasetName: config.datasetName.trim(),
      datasetYear: (config.datasetYear ?? '').trim() || undefined,
      sourceUrl: (config.sourceUrl ?? '').trim() || undefined,
      recordType: config.recordType,
      mapping: { ...config.mapping },
    }
    try {
      setProgress(0)
      const output = await importFile(file, payload, setProgress)
      setResult(output)
      onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setProgress(null)
    }
  }

  const reset = () => {
    setFile(null); setHeaders([]); setRows([]); setResult(null); setError('')
    setConfig({ sourceOrganization: 'CGWB', datasetName: '', datasetYear: '', sourceUrl: '', recordType: 'LABORATORY_MEASUREMENT', mapping: {} })
  }

  const preview = rows.slice(0, 5)

  const isLab = config.recordType === 'LABORATORY_MEASUREMENT'

  return (
    <section className="panel import" aria-label="Government data import">
      <h3>GOVERNMENT DATA IMPORT</h3>
      <p className="helper">
        Import only real official files (for example CGWB laboratory records or JJM-WQMIS
        contamination summaries). Every source field is preserved exactly as supplied — missing
        values are never filled in.
        {isLab
          ? ' Laboratory measurement rows store a concentration value.'
          : ' Summary rows store an affected-village COUNT; a count is never a concentration.'}
      </p>

      <div className="form-grid">
        <label htmlFor="gi-file">File — CSV or XLSX with header row</label>
        <input id="gi-file" type="file" accept=".csv,.xlsx" onChange={(e) => choose(e.target.files?.[0])} />

        <label htmlFor="gi-org">Source organisation</label>
        <select
          id="gi-org"
          value={config.sourceOrganization}
          onChange={(e) => setConfig({ ...config, sourceOrganization: e.target.value as ImportConfig['sourceOrganization'] })}
        >
          {ORGANISATIONS.map((organisation) => (
            <option key={organisation}>{organisation}</option>
          ))}
        </select>

        <label htmlFor="gi-name">Dataset name *</label>
        <input
          id="gi-name"
          value={config.datasetName}
          placeholder="As printed in the publication"
          onChange={(e) => setConfig({ ...config, datasetName: e.target.value })}
        />

        <label htmlFor="gi-year">Dataset year</label>
        <input
          id="gi-year"
          value={config.datasetYear}
          placeholder="e.g. 2024"
          onChange={(e) => setConfig({ ...config, datasetYear: e.target.value })}
        />

        <label htmlFor="gi-url">Official source URL</label>
        <input
          id="gi-url"
          type="url"
          value={config.sourceUrl}
          placeholder="https://…"
          onChange={(e) => setConfig({ ...config, sourceUrl: e.target.value })}
        />

        <label htmlFor="gi-type">Record type *</label>
        <select
          id="gi-type"
          value={config.recordType}
          onChange={(e) =>
            setConfig({
              ...config,
              recordType: e.target.value as ImportConfig['recordType'],
              mapping: {},
            })
          }
        >
          {RECORD_TYPES.map((recordType) => (
            <option key={recordType}>{recordType}</option>
          ))}
        </select>
      </div>

      {headers.length > 0 && (
        <>
          <h4>Column mapping</h4>
          <p className="helper">
            Required: {needed.map((field) => FIELD_LABELS[field]).join(', ')}.
            {isLab
              ? ' The value column must contain concentration values with their unit column.'
              : ' Map affectedVillageCount — never map a count into the value/unit columns.'}
          </p>
          {missingMappings.length > 0 && (
            <p className="callout warn" role="status">
              Still required: {missingMappings.map((field) => FIELD_LABELS[field] ?? field).join(', ')}
            </p>
          )}
          <div className="mapping-grid">
            {FIELDS.map((field) => (
              <label key={field} htmlFor={`gi-map-${field}`}>
                {FIELD_LABELS[field]}
                {needed.includes(field) ? ' *' : ''}
                <select
                  id={`gi-map-${field}`}
                  value={config.mapping[field] ?? ''}
                  onChange={(e) =>
                    setConfig({ ...config, mapping: { ...config.mapping, [field]: e.target.value } })
                  }
                >
                  <option value="">Not mapped</option>
                  {headers.map((header) => (
                    <option key={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <h4>Preview — first {preview.length} of {rows.length} rows</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((row, index) => (
                  <tr key={index}>
                    {headers.map((header) => (
                      <td key={header}>{row[header] === null ? '' : String(row[header])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > 0 && (
            <p className={`callout ${problems.size ? 'warn' : 'ok'}`} role="status" aria-live="polite">
              {problems.size === 0
                ? `Validation passed: all ${rows.length} rows have the required fields.`
                : `Validation found ${problems.size} invalid row(s). First issues: ${[...problems.entries()]
                    .slice(0, 5)
                    .map(([line, reason]) => `row ${line} — ${reason}`)
                    .join('; ')}. Invalid rows are rejected at import; nothing is corrected automatically.`}
            </p>
          )}
        </>
      )}

      {progress !== null && (
        <p className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          Uploading: {progress}%
        </p>
      )}

      {error && (
        <p className="callout error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="import-result" role="status" aria-live="polite">
          <h4>Import completed — job {result.jobId}</h4>
          <ul className="stat-list">
            <li><b>{result.importedRows}</b> rows imported</li>
            <li><b>{result.duplicateRows}</b> duplicates skipped</li>
            <li><b>{result.invalidRows}</b> invalid rows rejected</li>
            <li>out of <b>{result.totalRows}</b> total</li>
          </ul>
          {result.errors.length > 0 && (
            <>
              <h5>Row errors ({result.errors.length}, first 100 shown)</h5>
              <div className="table-wrap tall">
                <table>
                  <thead>
                    <tr><th>Source row</th><th>Field</th><th>Reason</th></tr>
                  </thead>
                  <tbody>
                    {result.errors.map((rowError) => (
                      <tr key={`${rowError.rowNumber}-${rowError.fieldName ?? ''}`}>
                        <td>{rowError.rowNumber}</td>
                        <td>{rowError.fieldName ?? '—'}</td>
                        <td>{rowError.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          disabled={!file || !config.datasetName.trim() || missingMappings.length > 0 || problems.size > 0 || progress !== null}
          onClick={submit}
        >
          Validate &amp; import
        </button>
        <button type="button" className="ghost" onClick={reset}>
          Reset form
        </button>
      </div>

    </section>
  )
}

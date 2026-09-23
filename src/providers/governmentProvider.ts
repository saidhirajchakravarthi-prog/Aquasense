/**
 * Government reference data provider — talks to the PostgreSQL backend.
 *
 * SEPARATE data module from the Firebase sensor stream. Government data is
 * imported from real CGWB / JJM-WQMIS sources via CSV/XLSX and stored in
 * PostgreSQL smart_water. The frontend only READS what actually exists — no
 * placeholder datasets are ever created.
 */
import { useState, type Dispatch, type SetStateAction } from 'react'
import type {
  GovernmentDataset, GovernmentRecord, GovernmentSummary,
  ImportConfig, ImportResult, SourceOrganization,
} from '../types'

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

const ORGS: SourceOrganization[] = ['CGWB', 'JJM-WQMIS', 'DATA.GOV.IN', 'OTHER_GOVERNMENT']
const RECORD_TYPES = ['LABORATORY_MEASUREMENT', 'CONTAMINATION_SUMMARY', 'TESTING_STATISTIC'] as const
const PARAMS = ['temperature', 'turbidity', 'ph', 'tds', 'fluoride', 'arsenic', 'e_coli', 'total_coliform']
const MAPPING_FIELDS = ['parameter', 'value', 'affectedVillageCount', 'sampleDate', 'state', 'district', 'village', 'latitude', 'longitude', 'unit']

export interface GovFilters {
  parameter: string
  sourceOrganization: string
  state: string
  district: string
  search: string
}

export interface GovernmentState {
  loading: boolean
  error: string | null
  datasets: GovernmentDataset[]
  records: GovernmentRecord[]
  summary: GovernmentSummary | null
  filters: GovFilters
  importConfig: ImportConfig
  file: File | null
  preview: { valid: boolean; issues: string[]; headers: string[] } | null
  isImporting: boolean
  importError: string | null
  importResult: ImportResult | null
}

export function initialGovernmentState(): GovernmentState {
  return {
    loading: false, error: null, datasets: [], records: [], summary: null,
    filters: { parameter: '', sourceOrganization: '', state: '', district: '', search: '' },
    importConfig: {
      sourceOrganization: 'CGWB', datasetName: '', recordType: 'LABORATORY_MEASUREMENT', mapping: {},
    },
    file: null, preview: null, isImporting: false, importError: null, importResult: null,
  }
}

export const ORGANIZATIONS = ORGS
export const RECORDS_TYPES = RECORD_TYPES
export const MAPPING_FIELDS_LIST = MAPPING_FIELDS
export const PARAMETER_OPTIONS = PARAMS

export async function fetchDatasets(): Promise<GovernmentDataset[]> {
  const data = await request<{ datasets: GovernmentDataset[] }>('/government/datasets')
  return data.datasets
}

export async function fetchSummary(): Promise<GovernmentSummary> {
  return request<GovernmentSummary>('/government/summary')
}

export async function fetchRecords(filters: GovFilters): Promise<GovernmentRecord[]> {
  const params = new URLSearchParams()
  if (filters.parameter) params.set('parameter', filters.parameter)
  if (filters.sourceOrganization) params.set('sourceOrganization', filters.sourceOrganization)
  if (filters.state) params.set('state', filters.state)
  if (filters.district) params.set('district', filters.district)
  if (filters.search) params.set('search', filters.search)
  const data = await request<{ records: GovernmentRecord[] }>(`/government/records?${params.toString()}`)
  return data.records
}

export async function previewFile(file: File, config: ImportConfig): Promise<{ valid: boolean; issues: string[]; headers: string[] }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('config', JSON.stringify(config))
  const res = await fetch(`${API}/government/preview`, { method: 'POST', body: formData })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error((body as { error?: string }).error ?? 'Preview failed.')
  }
  return res.json() as Promise<{ valid: boolean; issues: string[]; headers: string[] }>
}

export async function importFile(file: File, config: ImportConfig, onProgress: (pct: number) => void): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('config', JSON.stringify(config))
    return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API}/government/import`)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      let data: Record<string, unknown>
      try { data = JSON.parse(xhr.responseText) } catch { data = { error: 'Invalid API response' } }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as ImportResult)
      else reject(new Error(String(data.error ?? 'Import failed.')))
    }
    xhr.onerror = () => reject(new Error('Network error during import.'))
    xhr.send(formData)
  })
}

export function useGovernment(initialState = initialGovernmentState()): [GovernmentState, Dispatch<SetStateAction<GovernmentState>>] {
  return useState(initialState)
}


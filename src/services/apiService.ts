/**
 * Database-backed API client for the REAL DATA path.
 * PostgreSQL (via the Express API) is the single source of truth.
 * Every function surfaces "No data available" states as null/empty —
 * nothing here substitutes mock, demo, or placeholder values.
 */
import type { CurrentPayload, Device, EvidenceComparisonResponse, FirebaseSourceStatus, HistoricalCaseIntelResult, PumpCommandResponse, ServerAlert, TreatmentVerification, WaterQualityAnalysis, WaterQualityDecision, WaterSourceInfo } from '../types'

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchWaterSources(): Promise<WaterSourceInfo[]> {
  const data = await request<{ sources: WaterSourceInfo[] }>('/water-sources')
  return data.sources
}

export async function fetchCurrentPayload(waterSourceId: string): Promise<CurrentPayload> {
  return request<CurrentPayload>(`/readings/current?waterSourceId=${encodeURIComponent(waterSourceId)}`)
}

/** Registered devices (PostgreSQL). Used to resolve a device id for pump commands. */
export async function fetchDevices(): Promise<Device[]> {
  const data = await request<{ devices: Device[] }>('/devices')
  return data.devices
}

/** Queue a manual START/STOP command in PostgreSQL pump_commands via POST /api/pump/command. */
export async function postPumpCommand(
  deviceId: string,
  command: 'START' | 'STOP',
): Promise<PumpCommandResponse> {
  return request<PumpCommandResponse>('/pump/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, command }),
  })
}

/** Manual pH (chemical test) / TDS (external meter) -> PostgreSQL. */
export async function postManualReading(
  parameter: 'ph' | 'tds',
  waterSourceId: string,
  value: number,
  operatorName?: string,
): Promise<void> {
  await request(`/manual/${parameter}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waterSourceId, value, testedAt: new Date().toISOString(), operatorName: operatorName || undefined }),
  })
}

/** Deterministic Water Quality Analysis (Phase 3) — PostgreSQL measurements + registered standards. */
export async function fetchWaterQualityAnalysis(waterSourceId: string): Promise<WaterQualityAnalysis> {
  return request<WaterQualityAnalysis>(`/water-quality/analysis?waterSourceId=${encodeURIComponent(waterSourceId)}`)
}

/** AI Decision Engine (Phase 4) — deterministic core + optional Gemini refinement. */
export async function fetchWaterQualityDecision(waterSourceId: string): Promise<WaterQualityDecision> {
  return request<WaterQualityDecision>(`/water-quality/decision?waterSourceId=${encodeURIComponent(waterSourceId)}`)
}

/** Evidence Comparison (Phase 6) — current prototype evidence vs historical government evidence. */
export async function fetchEvidenceComparison(waterSourceId: string): Promise<EvidenceComparisonResponse> {
  return request<EvidenceComparisonResponse>(`/water-quality/evidence-comparison?waterSourceId=${encodeURIComponent(waterSourceId)}`)
}

/** Before/After Treatment Verification — real PostgreSQL before/after measurements
 * around the operator-set anchor. Read-only; never treats a pump command as proof. */
export async function fetchTreatmentVerification(waterSourceId: string, beforeAt: string): Promise<TreatmentVerification> {
  return request<TreatmentVerification>(`/water-quality/treatment-verification?waterSourceId=${encodeURIComponent(waterSourceId)}&beforeAt=${encodeURIComponent(beforeAt)}`)
}

/** Honest status of the REAL Firebase prototype bridge (is it configured/polling?). */
export async function fetchFirebaseSourceStatus(): Promise<FirebaseSourceStatus> {
  return request<FirebaseSourceStatus>('/firebase-source/status')
}

/** Historical Case Intelligence — current problem vs value-based government records. */
export async function fetchHistoricalCases(waterSourceId: string): Promise<HistoricalCaseIntelResult> {
  return request<HistoricalCaseIntelResult>(`/water-quality/historical-cases?waterSourceId=${encodeURIComponent(waterSourceId)}`)
}

/** Real stored alerts from PostgreSQL. Read on the 30s poll; never written here
 * (alert creation lives in the server-side producer). Optional waterSourceId
 * scopes the result to one source. */
export async function fetchAlerts(waterSourceId?: string): Promise<ServerAlert[]> {
  const qs = waterSourceId ? `?waterSourceId=${encodeURIComponent(waterSourceId)}` : ''
  const data = await request<{ alerts: ServerAlert[] }>(`/alerts${qs}`)
  return data.alerts
}

/** Acknowledge a stored alert against PostgreSQL (PATCH /api/alerts/:id/acknowledge).
 * Idempotent: a second acknowledge returns 404 and throws, which the caller
 * treats as best-effort. */
export async function acknowledgeDbAlert(id: string): Promise<void> {
  await request<{ acknowledged: boolean }>(`/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'PATCH' })
}

/* ---------------------------------------------------- government AI (HISTORICAL) */

export interface PythonAIStatus { status: string; source: string; available: boolean; detail?: string }

export async function fetchPythonAIStatus(): Promise<PythonAIStatus> {
  return request<PythonAIStatus>('/python-ai/status')
}

export interface GovMeasurement {
  parameter: string
  displayName: string
  value: number
  unit: string
  standard: { minValue: number | null; maxValue: number | null; warningValue: number | null; criticalValue: number | null; unit: string | null; referenceSource: string; effectiveDate: string | null } | null
  deterministicStatus: string
  sourceFile: string
  pdfPage: number | null
  sourceSerial: string
}

export interface GovHistoricalAnalysis {
  analysisType: string; dataScope: string; source: string
  dataset: string; datasetYear: string | null; state: string; district: string
  location: string; observedYear: string | null
  measurements: GovMeasurement[]
  parametersMeasured: number; parametersWithinLimit: number; parametersAboveAcceptable: number
  parametersAbovePermissible: number; parametersBelowLimit: number; parametersWithoutStandard: number
  parametersNotReported: string[]
  pythonAIStatus: { available: boolean; source: string; detail?: string }
  pythonAIResponse: unknown; pythonAIInterpretation: string
}

export interface GovLocationOptions { states: string[]; districts: string[]; locations: string[] }

export async function fetchGovernmentLocations(dataset: string, year: string): Promise<GovLocationOptions> {
  const params = new URLSearchParams()
  if (dataset) params.set('dataset', dataset)
  if (year) params.set('year', year)
  return request<GovLocationOptions>(`/government/locations-options?${params.toString()}`)
}

export async function fetchGovernmentAnalysis(params: {
  dataset: string; year: string; state: string; district: string; location: string
  parameter?: string; mode: 'single' | 'location'
}): Promise<GovHistoricalAnalysis> {
  const qs = new URLSearchParams()
  if (params.dataset) qs.set('dataset', params.dataset)
  if (params.year) qs.set('year', params.year)
  if (params.state) qs.set('state', params.state)
  if (params.district) qs.set('district', params.district)
  if (params.location) qs.set('location', params.location)
  if (params.parameter) qs.set('parameter', params.parameter)
  qs.set('mode', params.mode)
  return request<GovHistoricalAnalysis>(`/government/historical-analysis?${qs.toString()}`)
}



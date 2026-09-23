/**
 * AquaSense domain types.
 *
 * Architecture (per prooo sih prompt.pdf):
 *   ESP32 -> WiFi -> Firebase RTDB -> Dashboard -> History -> AI -> Pump
 * Government reference datasets remain a SEPARATE PostgreSQL module.
 */

export type QualityStatus = 'GOOD' | 'MODERATE' | 'POOR' | 'CRITICAL'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type DataMode = 'REAL DATA' | 'DEMO MODE'

/** waterMonitoring/current node */
export interface CurrentReadings {
  /** DS18B20 waterproof probe on ESP32 (automatic). */
  temperature: number | null
  /** Analog turbidity sensor on ESP32 (automatic). */
  turbidity: number | null
  /** Chemical test result entered manually. Never written by the ESP32. */
  ph: number | null
  /** External TDS meter value entered manually. Never written by the ESP32. */
  tds: number | null
  /** Mirror of pump/status published by the ESP32 relay firmware. */
  pumpStatus: boolean | null
  /** Heartbeat written by the ESP32 (true while sketch runs). */
  esp32Online: boolean | null
  /** UTC milliseconds of the last sensor write. */
  timestamp: number | null
}

/** waterMonitoring/history/{readingId} node */
export interface HistoricalReading {
  temperature: number | null
  turbidity: number | null
  ph: number | null
  tds: number | null
  timestamp: number
}

/** waterMonitoring/pump node */
export interface PumpState {
  /** Command written by THIS dashboard for the ESP32 to consume. */
  command: 'START' | 'STOP' | ''
  /** Status reported back by the ESP32 relay firmware. */
  status: 'RUNNING' | 'IDLE' | ''
  /** UTC ms set by the ESP32 when it energises the relay. */
  startedAt: number | null
  /** Number of START commands acknowledged by the ESP32. */
  cycleCount: number
}

/** waterMonitoring/alerts/{alertId} node */
export interface WaterAlert {
    type: 'HIGH_TURBIDITY' | 'ABNORMAL_PH' | 'HIGH_TDS' | 'TEMPERATURE_ABNORMAL' | 'SUDDEN_CHANGE' | 'ESP32_DISCONNECTED' | 'BREACH'
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  message: string
  explanation?: string
  recommendedAction?: string
  parameter?: string
  value?: number | null
  timestamp: number
    acknowledged: boolean
}

/** Row of GET /api/alerts: PostgreSQL alerts table joined to parameters/water_sources. */
export interface ServerAlert {
  id: string
  severity: string
  parameter: string | null
  source: string
  waterSource: string | null
  message: string
  recommendedAction: string
  occurredAt: string
  acknowledgedAt: string | null
}


/** waterMonitoring/ai node (latest analysis mirrored back) */
export interface AiResult {
  status: QualityStatus
  risk: RiskLevel
  score: number
  analysis: string
  recommendation: string
  confidence: number
  detectedIssues: string[]
  trends: string[]
  limitations: string[]
  simpleExplanation?: string
  engine: 'GEMINI' | 'OPENAI' | 'RULE_BASED'
  timestamp: number
}

/** Configurable monitoring thresholds (Settings page). NOT certification limits. */
export interface Thresholds {
  temperatureMin: number
  temperatureMax: number
  turbidityWarning: number
  turbidityCritical: number
  phMin: number
  phMax: number
  phCriticalSpread: number
  tdsWarning: number
  tdsCritical: number
  /** Sudden-change factor: delta >= avg * factor triggers SUDDEN_CHANGE. */
  suddenChangeFactor: number
}

export type Page =
  | 'Dashboard' | 'Live Monitoring' | 'History' | 'Water Quality' | 'Purification'
  | 'AI Analysis' | 'Historical Cases' | 'Alerts' | 'Settings' | 'Government Data'
  | 'Government Historical AI' | 'Evidence Comparison' | 'Treatment Verification'

/* ------------------------------------------------ prototype data pipeline */

/** Row of GET /api/water-sources (PostgreSQL registry). */
export interface WaterSourceInfo {
  id: string
  name: string
  sourceType: string
  latitude: number | null
  longitude: number | null
  village: string | null
    district: string | null
  state: string | null
}

/** Row of GET /api/devices (PostgreSQL-backed device registry). */
export interface Device {
  id: string
  code: string
  online: boolean
  lastSeenAt: string | null
  waterSource: string | null
}

/** POST /api/pump/command — command queued in PostgreSQL pump_commands. */
export interface PumpCommandResponse {
  id: string
  status: string
  requested_at: string
}

/** Latest value with full provenance (what measured it, when, by whom). */
export interface LatestValue {
  value: number
  timestamp: string
  source: string
  unit?: string | null
  deviceCode?: string | null
  operatorName?: string | null
}

/** GET /api/readings/current — PostgreSQL-backed dashboard payload. */
export interface CurrentPayload {
  waterSource: {
    id: string
    name: string
    sourceType: string
    latitude: number | null
    longitude: number | null
    village: string | null
    district: string | null
    state: string | null
  } | null
  device: { deviceCode: string; online: boolean; lastSeenAt: string | null } | null
  deviceStatus?: DeviceStatus
  latest: {
    temperature: LatestValue | null
    turbidity: LatestValue | null
    ph: LatestValue | null
    tds: LatestValue | null
  }
  history: Array<{ timestamp: number; temperature?: number; turbidity?: number; ph?: number; tds?: number }>
}

/** Per-parameter provenance for the REAL DATA path (what measured it, when). */
export interface ReadingSourceMeta {
  source: string
  timestamp: string | null
  deviceCode?: string | null
  operatorName?: string | null
}
export type SourceMetaMap = Record<'temperature' | 'turbidity' | 'ph' | 'tds', ReadingSourceMeta | null>

/* ------------------------------------------------ water quality analysis */

export type WQParameterStatus =
  | 'WITHIN_LIMIT' | 'ABOVE_ACCEPTABLE' | 'ABOVE_PERMISSIBLE' | 'BELOW_LIMIT'
  | 'NO_STANDARD_AVAILABLE' | 'NOT_MEASURED'

export interface WQStandard {
  kind: string
  minValue: number | null
  maxValue: number | null
  warningValue: number | null
  criticalValue: number | null
  unit: string | null
  referenceSource: string
  effectiveDate: string | null
}

export interface WQParameterAssessment {
  parameter: string
  displayName: string
  status: WQParameterStatus
  value: number | null
  unit: string | null
  source: string | null
  timestamp: string | null
  detection: 'DETECTED' | 'NOT_DETECTED' | null
  standard: WQStandard | null
  standardStatus: 'AVAILABLE' | 'NO_STANDARD_AVAILABLE' | null
  explanation: string
  provenance: { deviceCode?: string | null; operatorName?: string | null }
}



export interface WaterQualityAnalysis {
  waterSource: {
    id: string
    name: string
    sourceType: string
    village: string | null
    district: string | null
    state: string | null
  } | null
  analysisTimestamp: string
  measurements: WQParameterAssessment[]
  notMeasured: WQParameterAssessment[]
  missingParameters: string[]
  overall: {
    status: 'EXCEEDS_STANDARD' | 'ABOVE_ACCEPTABLE_LIMITS' | 'WITHIN_MEASURED_LIMITS' | 'PARTIAL_EVIDENCE' | 'NO_DATA'
    explanation: string
    caveat: string
  }
  evidence: {
    measuredCount: number
    withStandardCount: number
    noStandardCount: number
    notMeasuredCount: number
    sufficiency: string
    summaryLines: string[]
  }
}

export type WQDecision = 'PURIFY' | 'DO_NOT_PURIFY' | 'RETEST' | 'ADDITIONAL_TEST_REQUIRED' | 'CHANGE_TREATMENT' | 'INSUFFICIENT_EVIDENCE'

export interface WaterQualityDecision {
  decision: WQDecision
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  currentCondition: string
  detectedProblems: string[]
  missingEvidence: string[]
  recommendedAction: string
  additionalTests: string[]
  reasoning: string[]
  evidence: Array<{ parameter: string; value: number | null; status: string; standard: string }>
  engine: 'RULE_BASED' | 'GEMINI'
  analysisTimestamp: string
  caveat: string
  /** Optional interpretation from the Python AI engine (backend AI_ENGINE_URL). Never changes the decision. */
  aiInterpretation?: {
    engine: string
    source?: string
    summary?: string
    currentCondition: { deterministicOverall?: string; summaryLines?: string[]; measuredCount?: number; notMeasuredCount?: number; caveat?: string }
    detectedProblems: Array<{ rank?: number; displayName: string; status: string; value: number | null; unit: string | null }>
    evidenceSufficiency: { deterministicSufficiency?: string; verdict?: string; notMeasuredCount?: number; missingParameters?: string[] }
    recommendedActionSupport: { deterministicDecision?: string; supportNotes?: string[] }
    treatmentRecommendation?: { sequence?: string[]; evidenceSufficiency?: string; executionStatus?: string; limitations?: string[] }
    limitations?: string[]
    caveat: string
  }
  aiInterpretationError?: string
  treatmentRecommendation: TreatmentRecommendation
}

export type DeviceFreshnessStatus = 'ONLINE' | 'STALE' | 'OFFLINE'

export interface DeviceStatus {
  status: DeviceFreshnessStatus
  ageMs: number | null
  lastAcceptedReadingAt: string | null
  deviceCode: string | null
  onlineMaxAgeMs: number
  staleMaxAgeMs: number
}

export interface TreatmentRecommendation {
  applicable: boolean
  evidenceSufficiency: 'SUFFICIENT_FOR_TARGETED_TREATMENT' | 'LIMITED' | 'INSUFFICIENT'
  primaryIssues: Array<{ parameter: string; displayName: string; value: number | null; unit: string | null; status: string; standard: string; why: string }>
  processRecommendations: Array<{ parameter: string; displayName: string; stages: string[]; rationale: string }>
  stages: Array<{
    parameter: string
    fault: string
    processCategory: 'PRETREATMENT' | 'PRIMARY_TREATMENT' | 'POLISHING' | 'DISINFECTION' | 'POST_TREATMENT_VERIFICATION'
    sequenceOrder: number
    method: string
    rationale: string
    requiredEvidence: string[]
    postTreatmentVerification: string
    limitations: string[]
  }>
  sequence: string[]
  additionalTests: string[]
  engineeringReview: string[]
  executionStatus: 'NOT_STARTED'
  executionNote: string
}

/* ---------------------------------------------------- evidence comparison */

export type EvidenceStatus = 'AGREEMENT' | 'POSSIBLE_AGREEMENT' | 'CONFLICT'

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
  evidenceStatus: EvidenceStatus
  difference: { absolute: number; percentage: number | null } | null
  interpretation: string
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
  generatedAt: string
  currentEvidence: CurrentEvidence[]
  historicalEvidence: HistoricalEvidence[]
  comparisons: Comparison[]
  agreements: Comparison[]
  conflicts: Comparison[]
  noComparableEvidence: HistoricalEvidence[]
  contextualGovernmentEvidence: HistoricalEvidence[]
  limitations: string[]
}

export type EvidenceComparisonResponse = EvidenceComparisonResult


export type SourceOrganization = 'CGWB' | 'JJM-WQMIS' | 'DATA.GOV.IN' | 'OTHER_GOVERNMENT'
export type RecordType = 'LABORATORY_MEASUREMENT' | 'CONTAMINATION_SUMMARY' | 'TESTING_STATISTIC'

export interface GovernmentDataset {
  id: string
  sourceOrganization: SourceOrganization
  datasetName: string
  datasetYear: string | null
  sourceUrl: string | null
  importedAt: string
  recordCount: number
  parameterCount: number
}

/**
 * Row of GET /api/government/records — FLAT snake_case fields exactly as the
 * backend returns them (see server/src/index.ts `/api/government/records`).
 * Do NOT rename to camelCase/nested: the API does not transform these.
 * NB: original_row_reference is stored in the database but is NOT part of this
 * endpoint's SELECT, so it is not present on this type.
 */
export interface GovernmentRecord {
  id: string
  record_type: RecordType
  value: number | null
  unit: string | null
  affected_village_count: number | null
  sample_date: string | null
  state_name: string | null
  district_name: string | null
  block_name: string | null
  gram_panchayat_name: string | null
  village_name: string | null
  water_source_name: string | null
  latitude: number | null
  longitude: number | null
  imported_at: string
  parameter: string
  display_name: string
  source_organization: SourceOrganization
  dataset_name: string
  dataset_year: string | null
  source_url: string | null
}

export interface GovernmentSummary {
  records: number
  datasets: number
  parameters: number
  villages: number
  latestImport: string | null
}

export interface ImportConfig {
  sourceOrganization: SourceOrganization
  datasetName: string
  datasetYear?: string
  sourceUrl?: string
  recordType: RecordType
  mapping: Record<string, string>
}

export interface ValidationIssue {
  row: number
  field: string | null
  message: string
  valid: boolean
}

export interface ImportResult {
  jobId: string
  totalRows: number
  validRows: number
  invalidRows: number
  duplicateRows: number
  importedRows: number
  errors: Array<{ rowNumber: number; fieldName: string | null; message: string }>
}

/* --------------- Before/After Treatment Verification (post-treatment) --------------- */

export type VerificationStatus = 'IMPROVEMENT_VERIFIED' | 'PARTIAL_IMPROVEMENT' | 'NO_IMPROVEMENT' | 'INSUFFICIENT_EVIDENCE'

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
  beforeStatus: string | null
  afterStatus: string | null
  direction: 'IMPROVED' | 'WORSENED' | 'UNCHANGED' | null
  change: { absolute: number; percentage: number | null } | null
  evidenceStatus: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE'
  interpretation: string
}

export interface TreatmentVerification {
  waterSource: { id: string; name: string; sourceType: string; village: string | null; district: string | null; state: string | null }
  beforeAt: string
  generatedAt: string
  treatmentAction: { command: 'START' | 'STOP'; status: string; requestedAt: string; deviceCode: string | null } | null
  comparisons: VerificationComparison[]
  summary: { comparedCount: number; improved: number; worsened: number; unchanged: number; ungraded: number; insufficientEvidence: number }
  status: VerificationStatus
  explanation: string
  limitations: string[]
}

/* -------------------------- Firebase prototype bridge -------------------------- */

export interface FirebaseSourceStatus {
  enabled: boolean
  configured: boolean
  missingFields: string[]
  path: string | null
  pollIntervalMs: number | null
  deviceStatus: DeviceStatus
  fields: { temperature: string | null; turbidity: string | null; timestamp: string | null; deviceId: string | null; deviceCode: string | null } | null
  lastPollAt: string | null
  lastSuccessAt: string | null
  lastReadingAt: string | null
  lastError: string | null
  polls: number
  readingsAccepted: number
  readingsRejected: number
  rejectionReasons: string[]
}

/* ----------------------- Historical Case Intelligence -------------------------- */

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

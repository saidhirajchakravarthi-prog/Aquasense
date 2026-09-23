import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { Activity, Bell, BellRing, Brain, Building2, ChartLine, Cpu, Database, Droplets, Filter, History, Landmark, LayoutDashboard, MapPin, Menu, Palette, Radio, RefreshCw, Scale, Server, Settings as SettingsIcon, ShieldCheck, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import AIHistoricalAnalysisPage from './pages/GovernmentData/AIHistoricalAnalysis'
import './App.css'
import { useWaterData } from './hooks/useWaterData'
import { computeQuality } from './utils/quality'
import { detectTrends, explainReading } from './utils/trends'
import { deriveUnitFromField } from './utils/unitHelper'
import { analyzeWater } from './services/aiServe'
import { acknowledgeDbAlert, fetchPythonAIStatus, fetchWaterQualityAnalysis, fetchWaterQualityDecision, fetchFirebaseSourceStatus } from './services/apiService'
import { acknowledgeAlert, writeAiResult } from './services/firebaseService'
import { LiveChart, buildSeries } from './components/LiveChart'
import { ManualMeasurement } from './components/ManualMeasurement'
import { PumpControl } from './components/PumpControl'
import { GovernmentImport } from './components/GovernmentImport'
import { EvidenceComparison } from './components/EvidenceComparison'
import { TreatmentVerification } from './components/TreatmentVerification'
import { HistoricalCaseIntelPage } from './components/HistoricalCaseIntel'
import {
  CoverageRow, DemoBanner, EmptyState, ErrorState, Loading, Panel,
  DeviceStatusBadge, SensorCard, WaterQualityScore,
} from './components/ui'
import { fetchDatasets, fetchRecords, fetchSummary } from './providers/governmentProvider'
import type {
  AiResult, CurrentReadings, FirebaseSourceStatus, GovernmentDataset, GovernmentRecord, GovernmentSummary,
  HistoricalReading, Page, Thresholds, WaterQualityAnalysis, WaterQualityDecision,
} from './types'
import type { TimeWindow } from './components/LiveChart'

export const PAGES: Page[] = [
  'Dashboard', 'Live Monitoring', 'History', 'Water Quality', 'Purification',
  'AI Analysis', 'Historical Cases', 'Alerts', 'Settings', 'Government Data',
  'Government Historical AI', 'Evidence Comparison', 'Treatment Verification',
]
export const META: Record<Page, { icon: LucideIcon; title: string; subtitle: string }> = {
  Dashboard: { icon: LayoutDashboard, title: 'Smart Water Dashboard', subtitle: 'AquaSense' },
  'Live Monitoring': { icon: Activity, title: 'Live Monitoring', subtitle: 'Real-time ESP32 readings' },
  History: { icon: ChartLine, title: 'Historical Analytics', subtitle: 'Trends over time' },
  'Water Quality': { icon: Droplets, title: 'Water Quality Analysis', subtitle: 'Deterministic engine' },
  Purification: { icon: Filter, title: 'Purification Control', subtitle: 'Pump & purification' },
  'AI Analysis': { icon: Brain, title: 'AI Water Quality Assistant', subtitle: 'Decision support' },
  Alerts: { icon: Bell, title: 'Alerts', subtitle: 'Monitoring conditions' },
  Settings: { icon: SettingsIcon, title: 'Settings', subtitle: 'Configuration' },
  'Government Data': { icon: Building2, title: 'Government Water Data', subtitle: 'Reference module (PostgreSQL)' },
  'Evidence Comparison': { icon: Scale, title: 'Evidence Comparison', subtitle: 'Current vs historical government evidence' },
  'Historical Cases': { icon: History, title: 'Historical Case Intelligence', subtitle: 'Current problem vs government records' },
  'Treatment Verification': { icon: ShieldCheck, title: 'Treatment Verification', subtitle: 'Before/after purification' },
  'Government Historical AI': { icon: Landmark, title: 'Government Historical AI', subtitle: 'Historical government intelligence' },
}

const NAVIGATION: Array<{ label: string; pages: Page[] }> = [
  { label: 'Overview', pages: ['Dashboard', 'Live Monitoring'] },
  { label: 'Intelligence', pages: ['Water Quality', 'AI Analysis', 'History', 'Evidence Comparison', 'Historical Cases'] },
  { label: 'Operations', pages: ['Purification', 'Treatment Verification', 'Alerts'] },
  { label: 'Government', pages: ['Government Data', 'Government Historical AI'] },
  { label: 'System', pages: ['Settings'] },
]

/** Maps every Page to its URL path (for router links). */
export const ROUTE_MAP: Record<Page, string> = {
  Dashboard: '/',
  'Live Monitoring': '/live-monitoring',
  History: '/history',
  'Water Quality': '/water-quality',
  Purification: '/purification',
  'AI Analysis': '/ai-analysis',
  'Historical Cases': '/historical-cases',
  Alerts: '/alerts',
  Settings: '/settings',
  'Government Data': '/government-data',
  'Government Historical AI': '/government-data/historical-ai',
  'Evidence Comparison': '/evidence-comparison',
  'Treatment Verification': '/treatment-verification',
}

function useDashboard() {
  const data = useWaterData()
  const alerts = useMemo(
    () => Object.entries(data.alerts)
      .map(([id, alert]) => ({ id, alert }))
      .sort((a, b) => b.alert.timestamp - a.alert.timestamp),
    [data.alerts],
  )
  const snapshot = useMemo(
    () => (data.current ? computeQuality(data.current, data.thresholds) : null),
    [data.current, data.thresholds],
  )
  return { ...data, alerts, snapshot }
}

function useCurrentDecision(sourceId: string | null) {
  const [decision, setDecision] = useState<WaterQualityDecision | null>(null)
  useEffect(() => {
    if (!sourceId) { setDecision(null); return }
    let alive = true
    void fetchWaterQualityDecision(sourceId).then((value) => { if (alive) setDecision(value) }).catch(() => { if (alive) setDecision(null) })
    return () => { alive = false }
  }, [sourceId])
  return decision
}

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}
function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }): JSX.Element {
  return <article className="metric-card"><p>{label}</p><b>{value}</b>{sub && <small>{sub}</small>}</article>
}

function TreatmentMethodPanel({ treatment, compact = false, showExecution = true }: { treatment: WaterQualityDecision['treatmentRecommendation']; compact?: boolean; showExecution?: boolean }): JSX.Element {
  const issues = treatment.primaryIssues ?? []
  const stages = treatment.stages ?? (treatment.sequence ?? []).map((method, sequenceOrder) => ({
    parameter: issues[0]?.parameter ?? 'treatment',
    fault: issues[0]?.status ?? 'Detected current fault',
    processCategory: 'PRIMARY_TREATMENT' as const,
    sequenceOrder: sequenceOrder + 1,
    method,
    rationale: 'Treatment stage supplied by the deterministic decision engine.',
    requiredEvidence: [],
    postTreatmentVerification: 'Re-measure the affected parameter after treatment.',
    limitations: [],
  }))
  const issueByParameter = new Map(issues.map((issue) => [issue.parameter, issue]))
  if (compact) {
    return (
      <div className="callout">
        <b>Recommended purification method</b>
        {issues.length > 0 && <p className="helper">Detected: {issues.map((issue) => `${issue.displayName} — ${issue.value ?? '—'} ${issue.unit ?? ''}`).join('; ')}</p>}
        {stages.length > 0
          ? <p><b>{stages.map((stage) => stage.method).join(' → ')}</b></p>
          : <p className="helper">Requires Engineering Review — no validated treatment rule is configured for the detected fault.</p>}
        <p className="legend-note">View full treatment reasoning in Current AI. Execution: {treatment.executionStatus}.</p>
      </div>
    )
  }
  return (
    <section className="panel-grid">
      <Panel title="RECOMMENDED PURIFICATION METHOD" className="wide">
        {issues.length === 0 && <p className="helper">No actionable measured fault is currently detected.</p>}
        {stages.length > 0 ? stages.map((stage, index) => {
          const issue = issueByParameter.get(stage.parameter)
          return (
            <article className="callout" key={`${stage.parameter}-${stage.method}-${index}`}>
              <p><b>Stage {index + 1} · {stage.method}</b> <span className="pill real">{stage.processCategory}</span></p>
              <p><b>Parameter:</b> {issue?.displayName ?? stage.parameter}</p>
              <p><b>Fault:</b> {stage.fault}</p>
              {issue && <p><b>Observed:</b> {issue.value ?? '—'} {issue.unit ?? ''} · <b>Standard:</b> {issue.standard}</p>}
              <p><b>Why this method:</b> {stage.rationale}</p>
              <p><b>Required evidence:</b> {stage.requiredEvidence.length > 0 ? stage.requiredEvidence.join('; ') : 'Current measured fault'}</p>
              <p><b>Post-treatment verification:</b> {stage.postTreatmentVerification}</p>
              {stage.limitations.length > 0 && <p className="helper"><b>Limitations:</b> {stage.limitations.join('; ')}</p>}
            </article>
          )
        }) : <p className="callout"><b>Treatment method:</b> Requires Engineering Review<br /><span className="helper">No validated treatment rule is configured for this detected fault.</span></p>}
        {treatment.engineeringReview?.map((note) => <p className="helper" key={note}><b>Engineering review:</b> {note}</p>)}
        {showExecution && <p className="legend-note"><b>Execution status:</b> {treatment.executionStatus}. {treatment.executionNote}</p>}
      </Panel>
    </section>
  )
}

function DiagnosticPanel({ decision }: { decision: WaterQualityDecision }): JSX.Element {
  const treatment = decision.treatmentRecommendation
  const primaryIssues = treatment.primaryIssues ?? []
  return (
    <section className="panel-grid">
      <Panel title="Detected Water-Quality Issue" className="wide">
        {primaryIssues.length > 0
          ? <ul className="stat-list">{primaryIssues.map((problem) => (
            <li key={problem.parameter}>
              <b>{problem.displayName}</b> {problem.value ?? '—'} {problem.unit ?? ''} <span className="pill real">{problem.status}</span>
              <br /><small>Standard: {problem.standard}. {problem.why}</small>
            </li>
          ))}</ul>
          : <EmptyState title="No detected fault" hint="No measured current parameter is outside its registered standard." />}
        <p className="helper"><b>Evidence status:</b> {treatment.evidenceSufficiency}</p>
        <p className="helper"><b>Decision confidence:</b> {decision.confidence}</p>
      </Panel>
      <TreatmentMethodPanel treatment={treatment} />
    </section>
  )
}
function lastUpdated(current: CurrentReadings | null): string {
  if (!current?.timestamp) return '—'
  const age = Math.round((Date.now() - current.timestamp) / 1000)
  return age < 60 ? `${age}s ago` : new Date(current.timestamp).toLocaleTimeString()
}

function ExplainModal({ onClose, current, history, thresholds }: {
  onClose: () => void; current: CurrentReadings; history: HistoricalReading[]; thresholds: Thresholds
}): JSX.Element {
  const snap = useMemo(() => computeQuality(current, thresholds), [current, thresholds])
  const trends = useMemo(() => detectTrends(history, thresholds), [history, thresholds])
  const explanation = useMemo(() => explainReading(snap, trends, current), [snap, trends, current])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h3>Reading Explanation</h3>
        <div className="callout ok">{explanation}</div>
        <button type="button" className="ghost small" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

function Dashboard({ onNavigate }: { onNavigate?: (p: Page) => void }): JSX.Element {
  const { current, history, alerts, snapshot, thresholds, loading, error, waterSource, sourceId, refresh, sourceMeta, deviceStatus, apiOnline, firebaseStatus, device } = useDashboard()
  const decision = useCurrentDecision(sourceId)
  const trends = useMemo(() => detectTrends(history, thresholds), [history, thresholds])
  const [explainMode, setExplainMode] = useState(false)
  const [pythonOnline, setPythonOnline] = useState(false)
  useEffect(() => {
    let alive = true
    void fetchPythonAIStatus().then((status) => { if (alive) setPythonOnline(status.available) }).catch(() => { if (alive) setPythonOnline(false) })
    return () => { alive = false }
  }, [])
  if (loading) return <Loading label="Connecting to ESP32…" />
  const qualityIssues = decision?.treatmentRecommendation.primaryIssues ?? []
  const treatmentStages = decision?.treatmentRecommendation.stages ?? []
  const statusText = (status: boolean | string | null | undefined) => status === true || status === 'ONLINE' ? 'ONLINE' : status === 'STALE' ? 'STALE' : 'OFFLINE'
  const latestAlert = alerts[0]?.alert
  return (
    <>
      <header className="dashboard-hero">
        <div><p className="eyebrow">AQUASENSE</p><h1>Water Intelligence Dashboard</h1><p className="helper">{waterSource?.name ?? 'No water source selected'} · Last updated {lastUpdated(current)}</p></div>
        <div className="topbar-actions"><button className="primary" onClick={() => { if (!current) return; void analyzeWater(current, history, thresholds).then((r) => void writeAiResult(r.result)) }}>Run AI Analysis</button><span className="pill real">REAL DATA</span></div>
      </header>
      {error && <ErrorState message={error} />}
      <section className="dashboard-status-strip" aria-label="System status">
        {[['Backend API', statusText(apiOnline)], ['PostgreSQL', statusText(apiOnline)], ['Firebase Bridge', statusText(firebaseStatus?.enabled && firebaseStatus.configured && !firebaseStatus.lastError)], ['Python AI', statusText(pythonOnline)], ['ESP32', deviceStatus.status]].map(([label, status]) => <div className="dashboard-status-item" key={label}><span className={`status-dot ${status.toLowerCase()}`} /> <span>{label}</span><b>{status}</b></div>)}
      </section>
      <section className="dashboard-section">
        <div className="dashboard-section-heading"><div><p className="eyebrow">CURRENT WATER OVERVIEW</p><h2>Live measurements</h2></div><span className="dashboard-section-meta">{waterSource?.name ?? 'No source selected'}</span></div>
        <div className="dashboard-readings">
          <SensorCard label="Temperature" value={current?.temperature ?? null} unit="°C" source={sourceMeta?.temperature?.source ?? 'DS18B20 → ESP32 → API → PostgreSQL'} timestamp={sourceMeta?.temperature?.timestamp ?? null} icon="" />
          <SensorCard label="Turbidity" value={current?.turbidity ?? null} unit={deriveUnitFromField('turbidity_NTU')} source={sourceMeta?.turbidity?.source ?? 'Turbidity sensor → ESP32 → API → PostgreSQL'} timestamp={sourceMeta?.turbidity?.timestamp ?? null} icon="" />
          <SensorCard label="pH" value={current?.ph ?? null} unit="" source={sourceMeta?.ph?.source ?? 'Manual Chemical Test → API → PostgreSQL'} timestamp={sourceMeta?.ph?.timestamp ?? null} icon="" />
          <SensorCard label="TDS" value={current?.tds ?? null} unit="ppm" source={sourceMeta?.tds?.source ?? 'External TDS Meter → API → PostgreSQL'} timestamp={sourceMeta?.tds?.timestamp ?? null} icon="" />
        </div>
      </section>
      <section className="dashboard-grid">
        <Panel title="Current Water Quality">
          {snapshot ? <WaterQualityScore score={snapshot.score} status={snapshot.status} risk={snapshot.risk} onExplain={() => setExplainMode(true)} /> : <EmptyState title="No data available" hint="Connect an ESP32 or add manual measurements." />}
          {decision && <><p className="dashboard-count"><b>{qualityIssues.length}</b> active quality issue{qualityIssues.length === 1 ? '' : 's'}</p>{qualityIssues.length > 0 && <ul className="stat-list">{qualityIssues.map((issue) => <li key={issue.parameter}><b>{issue.displayName}</b> — {issue.value ?? '—'} {issue.unit ?? ''} <span className="pill real">{issue.status}</span></li>)}</ul>}<p className="helper">Evidence sufficiency: <b>{decision.treatmentRecommendation.evidenceSufficiency}</b></p><p className="helper">Missing evidence: {decision.missingEvidence.length}</p></>}
        </Panel>
        <Panel title="Current AI Decision">
          {decision ? <><p className={`dashboard-decision decision-${decision.decision.toLowerCase()}`}>{decision.decision}</p><p className="helper">Confidence: <b>{decision.confidence}</b></p><p className="helper">{decision.currentCondition}</p>{decision.aiInterpretation?.summary && <p className="helper"><b>AI interpretation:</b> {decision.aiInterpretation.summary}</p>}</> : <p className="helper">No decision available.</p>}
        </Panel>
        <Panel title="Recommended Treatment">
          {treatmentStages.length > 0 ? <p className="treatment-sequence">{treatmentStages.map((stage) => stage.method).join(' → ')}</p> : <p className="helper">No treatment method available.</p>}
          <p className="helper">Execution: <b>{decision?.treatmentRecommendation.executionStatus ?? 'NOT_STARTED'}</b></p>
          {onNavigate && <button className="ghost small" onClick={() => onNavigate('AI Analysis')}>View full AI analysis</button>}
        </Panel>
        <Panel title="Recent Activity / Alerts">
          <ul className="activity-list">
            <li><b>Latest sensor reading</b><span>{current?.timestamp ? fmtTime(current.timestamp) : 'No data available'}</span></li>
            <li><b>Latest manual measurement</b><span>{sourceMeta?.ph?.timestamp || sourceMeta?.tds?.timestamp ? fmtTime(Date.parse(sourceMeta.ph?.timestamp ?? sourceMeta.tds?.timestamp ?? '')) : 'No data available'}</span></li>
            <li><b>Latest alert</b><span>{latestAlert ? latestAlert.message : 'No data available'}</span></li>
            <li><b>Latest Firebase accepted reading</b><span>{firebaseStatus?.lastReadingAt ? fmtTime(Date.parse(firebaseStatus.lastReadingAt)) : 'No data available'}</span></li>
          </ul>
        </Panel>
      </section>
      <section className="dashboard-grid">
        <Panel title="Government Context"><GovernmentReferenceSection onNavigate={onNavigate} /></Panel>
        <Panel title="Manual Testing"><ManualMeasurement current={current} sourceId={sourceId} onSaved={refresh} /></Panel>
        <Panel title="Quick Navigation"><div className="quick-links">{(['Live Monitoring', 'Water Quality', 'AI Analysis', 'Government Data', 'Government Historical AI'] as Page[]).map((page) => <button className="quick-link" key={page} onClick={() => onNavigate?.(page)}>{page}<span>→</span></button>)}</div></Panel>
      </section>
      {trends && trends.length > 0 && <Panel title="Recent Activity"><ul className="stat-list">{trends.map((trend) => <li key={trend}>{trend}</li>)}</ul></Panel>}
      <footer className="legal"><p>Temperature & turbidity: ESP32 → Firebase. pH/TDS: manual entry. GOV: PostgreSQL (separate).</p><p>Monitoring thresholds ≠ drinking-water certification. Microbiological testing may be required.</p></footer>
      {explainMode && current && <ExplainModal onClose={() => setExplainMode(false)} current={current} history={history} thresholds={thresholds} />}
    </>
  )
}

function LiveMonitoringPage(): JSX.Element {
  const { current, loading, error, sourceMeta, waterSource, device, deviceStatus, sourceId, refresh } = useDashboard()
  const decision = useCurrentDecision(sourceId)
  const [fb, setFb] = useState<FirebaseSourceStatus | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => { void fetchFirebaseSourceStatus().then((s) => { if (alive) setFb(s) }).catch(() => { if (alive) setFb(null) }) }
    load()
    const t = window.setInterval(load, 30000)
    return () => { alive = false; window.clearInterval(t) }
  }, [])
  if (loading) return <Loading label="Connecting to ESP32…" />
  if (error) return <ErrorState message={error} onRetry={() => void 0} />
  const activeStatus = fb?.deviceStatus ?? deviceStatus
  const bridgeLive = fb !== null && fb.enabled && fb.configured
  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Live Monitoring</p><h1>Live Monitoring</h1></div></header>
      <section className="panel-grid">
        <Panel title="Prototype Connection" className="wide">
          {!bridgeLive ? (
            <p className="callout">Waiting for real prototype connection — the Firebase bridge is not configured yet (FIREBASE_SOURCE_ENABLED + RTDB path/field names pending from the hardware team). No reading will ever be simulated.</p>
          ) : (
            <ul className="stat-list">
                <li><b>Device status:</b> <DeviceStatusBadge deviceStatus={activeStatus} /></li>
              <li>Bridge configured: path <b>{fb?.path}</b> every {fb?.pollIntervalMs} ms</li>
              <li>Last poll: {fb?.lastPollAt ? new Date(fb.lastPollAt).toLocaleString() : '—'} · last accepted reading: {fb?.lastReadingAt ? new Date(fb.lastReadingAt).toLocaleString() : '—'}</li>
              <li>Accepted: {fb?.readingsAccepted ?? 0} · rejected: {fb?.readingsRejected ?? 0}{fb?.lastError ? ` · last issue: ${fb.lastError}` : ''}</li>
              {fb?.lastReadingAt === null && <li><b>No live data available</b> — the bridge is configured but no real reading has arrived yet.</li>}
            </ul>
          )}
          <div className="connection-summary" aria-label="Current device connection details">
            <div><span>Device</span><b>{activeStatus.deviceCode ?? device?.code ?? sourceMeta?.temperature?.deviceCode ?? 'No accepted device reading'}</b></div>
            <div><span>Water source</span><b>{waterSource?.name ?? 'No source selected'}</b></div>
            <div><span>Connection</span><b>{activeStatus.status}</b></div>
            <div><span>Data freshness</span><b>{current?.timestamp ? lastUpdated(current) : 'No current data'}</b></div>
            <div><span>Last update</span><b>{current?.timestamp ? fmtTime(current.timestamp) : '—'}</b></div>
          </div>
        </Panel>
        <SensorCard label="Temperature" value={current?.temperature ?? null} unit="°C" source={sourceMeta?.temperature?.source ?? 'DS18B20 → ESP32 → API → PostgreSQL'} timestamp={sourceMeta?.temperature?.timestamp ?? null} icon="" />
        <SensorCard label="Turbidity" value={current?.turbidity ?? null} unit="NTU" source={sourceMeta?.turbidity?.source ?? 'Turbidity sensor → ESP32 → API → PostgreSQL'} timestamp={sourceMeta?.turbidity?.timestamp ?? null} icon="" />
        <SensorCard label="pH" value={current?.ph ?? null} unit="" source={sourceMeta?.ph?.source ?? 'Manual Chemical Test → API → PostgreSQL'} timestamp={sourceMeta?.ph?.timestamp ?? null} icon="" />
        <SensorCard label="TDS" value={current?.tds ?? null} unit="ppm" source={sourceMeta?.tds?.source ?? 'External TDS Meter → API → PostgreSQL'} timestamp={sourceMeta?.tds?.timestamp ?? null} icon="" />
        <Panel title="Manual Current Testing" className="wide">
          <ManualMeasurement current={current} sourceId={sourceId} onSaved={refresh} />
        </Panel>
        {decision && (
          <Panel title="Current Water Quality" className="wide">
            {decision.detectedProblems.length > 0
              ? <>
                <b>Detected issues</b>
                <ul className="stat-list">{decision.detectedProblems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
              </>
              : <p className="helper">No fault detected in the currently available measured evidence.</p>}
            <p className="helper"><b>Evidence status:</b> {decision.treatmentRecommendation.evidenceSufficiency}</p>
            {decision.missingEvidence.length > 0 && (
              <p className="helper"><b>Missing evidence:</b> {decision.missingEvidence.map((item) => item.split(':')[0]).join(', ')}</p>
            )}
          </Panel>
        )}
      </section>
    </>
  )
}

function HistoryPage(): JSX.Element {
  const { history, loading, error } = useDashboard()
  const [window, setWindow] = useState('24h' as TimeWindow)
  const series = useMemo(() => ({
    temperature: buildSeries(history, 'temperature', window),
    turbidity: buildSeries(history, 'turbidity', window),
    ph: buildSeries(history, 'ph', window),
    tds: buildSeries(history, 'tds', window),
  }), [history, window])
  if (loading) return <Loading label="Loading…" />
  if (error) return <ErrorState message={error} />
  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Historical Analytics</p><h1>History</h1></div></header>
      <div className="chips">
        {(['1h', '6h', '24h', '7d'] as TimeWindow[]).map((w) => (<button key={w} className={window === w ? 'active' : ''} onClick={() => setWindow(w)}>{w}</button>))}
      </div>
      <section className="panel-grid">
        {history.length >= 2 ? (<>
          <Panel title="Temperature"><LiveChart points={series.temperature} unit="°C" /></Panel>
          <Panel title="Turbidity"><LiveChart points={series.turbidity} unit="NTU" /></Panel>
          <Panel title="pH"><LiveChart points={series.ph} unit="" /></Panel>
          <Panel title="TDS"><LiveChart points={series.tds} unit="ppm" /></Panel>
        </>) : (<EmptyState title="No historical data available" hint="Charts render when 2+ readings exist for the selected water source." />)}
      </section>
    </>
  )
}
function GovernmentReferenceSection({ onNavigate }: { onNavigate?: (p: Page) => void }): JSX.Element {
  const [state, setState] = useState<{ loading: boolean; error: string | null; summary: GovernmentSummary | null; datasets: GovernmentDataset[] }>({
    loading: true, error: null, summary: null, datasets: [],
  })
  useEffect(() => {
    let alive = true
    void Promise.all([fetchSummary(), fetchDatasets()])
      .then(([summary, datasets]) => { if (alive) setState({ loading: false, error: null, summary, datasets }) })
      .catch((e) => { if (alive) setState({ loading: false, error: e instanceof Error ? e.message : 'Could not reach the government data API.', summary: null, datasets: [] }) })
    return () => { alive = false }
  }, [])
  if (state.loading) return <Loading label="Loading government reference…" />
  if (state.error) return <ErrorState message={state.error} />
  if (!state.summary || state.summary.records === 0)
    return <EmptyState title="No government data yet" hint="Import official datasets on the Government Data page." />
  return (
    <div>
      <ul className="stat-list">
        <li><b>{state.summary.records}</b> records</li>
        <li><b>{state.summary.datasets}</b> datasets</li>
        <li><b>{state.summary.parameters}</b> parameters</li>
        <li><b>{state.summary.villages}</b> villages</li>
      </ul>
      {state.datasets.slice(0, 3).map((d) => (
        <p key={d.id} className="legend-note">{d.datasetName} — {d.sourceOrganization}{d.datasetYear ? ` (${d.datasetYear})` : ''}, {d.recordCount} records</p>
      ))}
      {onNavigate && (
        <div className="actions">
          <button type="button" className="ghost" onClick={() => onNavigate('Government Data')}>Open Government Data</button>
        </div>
      )}
    </div>
  )
}

function WaterQualityPage(): JSX.Element {
  const { sourceId, thresholds, setThresholds } = useDashboard()
  const [analysis, setAnalysis] = useState<WaterQualityAnalysis | null>(null)
  const [decision, setDecision] = useState<WaterQualityDecision | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [draft, setDraft] = useState<Thresholds>(thresholds)
  const [saved, setSaved] = useState(false)
  const fields: Array<[keyof Thresholds, string, string]> = [
    ['temperatureMin', 'Temperature min (°C)', '0.1'], ['temperatureMax', 'Temperature max (°C)', '0.1'],
    ['turbidityWarning', 'Turbidity warning (NTU)', '0.1'], ['turbidityCritical', 'Turbidity critical (NTU)', '0.1'],
    ['phMin', 'pH minimum', '0.1'], ['phMax', 'pH maximum', '0.1'], ['phCriticalSpread', 'pH critical spread', '0.1'],
    ['tdsWarning', 'TDS warning (ppm)', '1'], ['tdsCritical', 'TDS critical (ppm)', '1'], ['suddenChangeFactor', 'Sudden-change factor (×)', '0.1'],
  ]
  const monitoringRules = (
    <Panel title="Monitoring Rules" className="wide">
      <p className="helper">Operational alert thresholds for dashboard monitoring. These are not drinking-water certification limits.</p>
      <div className="form-grid">
        {fields.map(([key, label, step]) => <label className="field" key={key}>{label}<input type="number" step={step} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} /></label>)}
      </div>
      <div className="actions"><button type="button" className="primary" onClick={() => { setThresholds(draft); setSaved(true); window.setTimeout(() => setSaved(false), 2500) }}>Save Monitoring Rules</button>{saved && <span className="pill online">Saved</span>}</div>
    </Panel>
  )
  useEffect(() => {
    if (!sourceId) { setAnalysis(null); setDecision(null); setError(null); setDecisionError(null); return }
    let alive = true
    setLoading(true)
    fetchWaterQualityAnalysis(sourceId)
      .then((a) => { if (alive) { setAnalysis(a); setError(null) } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Analysis failed.') })
      .finally(() => { if (alive) setLoading(false) })
    fetchWaterQualityDecision(sourceId)
      .then((d) => { if (alive) { setDecision(d); setDecisionError(null) } })
      .catch((e) => { if (alive) setDecisionError(e instanceof Error ? e.message : 'Decision engine unavailable.') })
    return () => { alive = false }
  }, [sourceId, tick])
  if (!sourceId) {
    return (
      <>
        <header className="topbar"><div><p className="eyebrow">Deterministic engine — PostgreSQL measurements + registered standards</p><h1>Water Quality Analysis</h1></div></header>
        <section className="panel-grid">{monitoringRules}</section>
        <EmptyState title="No water source registered" hint="Register the real prototype location with scripts/register-source.mjs, then reload." />
      </>
    )
  }
  const noData = analysis !== null && analysis.overall.status === 'NO_DATA'
  const pillFor = (s: string) => (s === 'WITHIN_LIMIT' ? 'online' : s === 'ABOVE_LIMIT' || s === 'BELOW_LIMIT' ? 'error' : 'real')
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Deterministic engine — PostgreSQL measurements + registered standards</p>
          <h1>Water Quality Analysis</h1>
          {analysis?.waterSource && (
            <p className="helper">
              {analysis.waterSource.name}
              {analysis.waterSource.village ? `, ${analysis.waterSource.village}` : ''}
              {analysis.waterSource.district ? `, ${analysis.waterSource.district}` : ''}
              {analysis.waterSource.state ? `, ${analysis.waterSource.state}` : ''}
            </p>
          )}
        </div>
        <div className="topbar-actions">
          <button className="primary" onClick={() => setTick((t) => t + 1)}>Re-run analysis</button>
        </div>
      </header>
      {error && <ErrorState message={error} />}
      {loading && <Loading label="Analysing…" />}
      <section className="panel-grid">{monitoringRules}</section>
      {!loading && !error && analysis && noData && (
        <EmptyState title="No data available" hint="No ESP32 or manual measurements exist yet for this water source. Nothing is assumed." />
      )}
      {!loading && !error && analysis && !noData && (
        <>
          <div className={`callout ${analysis.overall.status === 'EXCEEDS_STANDARD' ? 'error' : 'ok'}`}>
            <strong>CURRENT WATER CONDITION: {analysis.overall.status}</strong> — {analysis.overall.explanation}
          </div>
          <section className="panel-grid">
            <Panel title="Current Water Quality (parameter by parameter)" className="wide">
              {analysis.measurements.length === 0 ? (
                <EmptyState title="No data available" hint="No ESP32 or manual measurements exist yet." />
              ) : (
                <ul className="stat-list">
                  {analysis.measurements.map((m) => (
                    <li key={m.parameter}>
                      <b>{m.displayName}</b> — {m.value} {m.unit ?? ''}{' '}
                      <span className={`pill ${pillFor(m.status)}`}>{m.status}</span>
                      {m.detection ? <span className="pill real">{m.detection}</span> : null}
                      <br />
                      <small>
                        Source: {m.source} · {m.timestamp ? new Date(m.timestamp).toLocaleString() : '—'} · Standard:{' '}
                        {m.standard ? `${m.standard.kind} — ${m.standard.referenceSource} — limit ${m.standard.maxValue ?? m.standard.minValue ?? 'n/a'}` : 'NO_STANDARD_AVAILABLE'}
                      </small>
                      <br />
                      <small className="muted">{m.explanation}</small>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Missing / Not Measured" className="wide">
              <ul className="stat-list">
                {analysis.notMeasured.map((m) => (
                  <li key={m.parameter}>
                    <b>{m.displayName}</b> <span className="pill real">NOT_MEASURED</span> — {m.explanation}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Evidence Summary" className="wide">
              <ul className="stat-list">
                <li>Measured parameters: <b>{analysis.evidence.measuredCount}</b></li>
                <li>With registered standard: <b>{analysis.evidence.withStandardCount}</b></li>
                <li>NO_STANDARD_AVAILABLE: <b>{analysis.evidence.noStandardCount}</b></li>
                <li>NOT MEASURED: <b>{analysis.evidence.notMeasuredCount}</b></li>
                <li>Evidence sufficiency: <b>{analysis.evidence.sufficiency}</b></li>
                {analysis.evidence.summaryLines.map((l) => <li key={l}>{l}</li>)}
              </ul>
              <p className="muted note">Analysis timestamp: {new Date(analysis.analysisTimestamp).toLocaleString()}</p>
            </Panel>
            <Panel title="AI Decision Engine" className="wide">
              {decisionError ? (
                <p className="err-text">Decision engine unavailable: {decisionError}</p>
              ) : !decision ? (
                <p className="muted">Decision pending…</p>
              ) : (
                <>
                  <p>
                    <b>{decision.decision}</b>{' '}
                    <span className="pill real">{decision.engine}</span>{' '}
                    <span className="pill online">confidence: {decision.confidence}</span>
                  </p>
                  <p>{decision.currentCondition}</p>
                  {decision.detectedProblems.length > 0 && (
                    <>
                      <b>Detected problems</b>
                      <ul className="stat-list">{decision.detectedProblems.map((p) => <li key={p}>{p}</li>)}</ul>
                    </>
                  )}
                  {decision.missingEvidence.length > 0 && (
                    <>
                      <b>Missing evidence</b>
                      <ul className="stat-list">{decision.missingEvidence.map((p) => <li key={p}>{p}</li>)}</ul>
                    </>
                  )}
                  <p><b>Recommended action:</b> {decision.recommendedAction}</p>
                  {decision.additionalTests.length > 0 && (
                    <>
                      <b>Additional tests required</b>
                      <ul className="stat-list">{decision.additionalTests.map((t) => <li key={t}>{t}</li>)}</ul>
                    </>
                  )}
                  <TreatmentMethodPanel treatment={decision.treatmentRecommendation} compact />
                  <b>Reasoning (traceable to the evidence above)</b>
                  <ul className="stat-list">{decision.reasoning.map((r) => <li key={r}>{r}</li>)}</ul>
                  <p className="muted note">{decision.caveat}</p>
                </>
              )}
            </Panel>
            <Panel title="Overall Status" className="wide">
              <p><b>{analysis.overall.status}</b> — {analysis.overall.explanation}</p>
              <p className="muted note">{analysis.overall.caveat}</p>
            </Panel>
          </section>
        </>
      )}
    </>
  )
}

function PurificationPage(): JSX.Element {
  const { current, pump, loading, error, sourceMeta, device, refresh, sourceId } = useDashboard()
  if (loading) return <Loading label="Connecting to ESP32…" />
  if (error) return <ErrorState message={error} />
  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Purification Control</p><h1>Purification</h1></div></header>
      <section className="panel-grid">
        <Panel title="Pump Control" className="wide">
                    <PumpControl pump={pump} device={device} onChanged={() => refresh()} />
        </Panel>
        <Panel title="Current Readings">
          <div className="panel-grid">
            <SensorCard label="Temperature" value={current?.temperature ?? null} unit="°C" source={sourceMeta?.temperature?.source ?? 'DS18B20 → ESP32 → API → PostgreSQL'} timestamp={sourceMeta?.temperature?.timestamp ?? null} />
            <SensorCard label="Turbidity" value={current?.turbidity ?? null} unit="NTU" source={sourceMeta?.turbidity?.source ?? 'Turbidity sensor → ESP32 → API → PostgreSQL'} timestamp={sourceMeta?.turbidity?.timestamp ?? null} />
          </div>
        </Panel>
        <Panel title="Safety Notes">
          <ul className="stat-list">
            <li>The dashboard only writes a command to Firebase — the ESP32 relay switches the pump.</li>
            <li>RUNNING / IDLE status is reported by the ESP32 firmware, never assumed here.</li>
            <li>Confirm the area around the pump is safe before starting a cycle.</li>
          </ul>
        </Panel>
        <Panel title="Treatment Verification (Before / After)" className="wide">
          <p className="helper">
            Full workflow: BEFORE real measurement → AI decision → purification command → AFTER real measurement →
            before/after comparison → verification result. Read-only: this section never inserts measurements and a
            pump command is never treated as proof that purification succeeded.
          </p>
          <TreatmentVerification waterSourceId={sourceId} />
        </Panel>
      </section>
    </>
  )
}


function AiAnalysisPage(): JSX.Element {
  const { current, history, ai, thresholds, loading, error, sourceId, deviceStatus, apiOnline, firebaseStatus, sourceMeta, device } = useDashboard()
  const [running, setRunning] = useState(false)
  const [local, setLocal] = useState<AiResult | null>(null)
  const [decision, setDecision] = useState<WaterQualityDecision | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [decisionLoading, setDecisionLoading] = useState(false)
  const result = local ?? ai
  const run = () => {
    if (!current || running) return
    setRunning(true)
    void analyzeWater(current, history, thresholds)
      .then(({ result: r }) => { setLocal(r); void writeAiResult(r) })
      .finally(() => setRunning(false))
  }
  useEffect(() => {
    if (!sourceId) { setDecision(null); setDecisionError(null); return }
    let alive = true
    setDecisionLoading(true)
    void fetchWaterQualityDecision(sourceId)
      .then((value) => { if (alive) { setDecision(value); setDecisionError(null) } })
      .catch((e) => { if (alive) setDecisionError(e instanceof Error ? e.message : 'Decision engine unavailable.') })
      .finally(() => { if (alive) setDecisionLoading(false) })
    return () => { alive = false }
  }, [sourceId])
  if (loading) return <Loading label="Loading readings…" />
  if (error) return <ErrorState message={error} />
  const evidence = decision?.evidence ?? []
  const evidenceByParameter = new Map(evidence.map((item) => [item.parameter, item]))
  const evidenceFields: Array<{ key: 'temperature' | 'turbidity' | 'ph' | 'tds'; label: string; unit: string; fallbackSource: string; metaKey: 'temperature' | 'turbidity' | 'ph' | 'tds' }> = [
    { key: 'temperature', label: 'Temperature', unit: '°C', fallbackSource: 'ESP32 (DS18B20)', metaKey: 'temperature' },
    { key: 'turbidity', label: 'Turbidity', unit: 'NTU', fallbackSource: 'ESP32 (analog turbidity)', metaKey: 'turbidity' },
    { key: 'ph', label: 'pH', unit: '', fallbackSource: 'MANUAL_CHEMICAL_TEST', metaKey: 'ph' },
    { key: 'tds', label: 'TDS', unit: 'ppm', fallbackSource: 'EXTERNAL_TDS_METER', metaKey: 'tds' },
  ]
  const treatment = decision?.treatmentRecommendation
  const verification = treatment?.stages.flatMap((stage) => [stage.postTreatmentVerification]).filter((value, index, values) => value && values.indexOf(value) === index) ?? []
  const statusLabel = (online: boolean, degraded = false) => online ? (degraded ? 'DEGRADED' : 'ONLINE') : 'OFFLINE'
  return (
    <>
      <header className="topbar">
        <div><p className="eyebrow">CURRENT AI ANALYSIS</p><h1>AI Analysis</h1><p className="helper">Real-time water-quality assessment and treatment decision support.</p></div>
        <div className="topbar-actions">
          <button className="primary" disabled={!current || running} onClick={run}>{running ? 'Analysing…' : 'Run AI Analysis'}</button>
        </div>
      </header>
      {!current && <EmptyState title="No readings yet" hint="AI analysis needs a current reading from the ESP32 or a manual measurement." />}
      <section className="panel-grid">
        <Panel title="Device + Data Status" className="wide">
          <div className="metrics">
            <MetricCard label="Active Device" value={deviceStatus.deviceCode ?? device?.code ?? '—'} />
            <MetricCard label="Device Status" value={deviceStatus.status} />
            <MetricCard label="Firebase Bridge" value={statusLabel(Boolean(firebaseStatus?.enabled && firebaseStatus.configured), Boolean(firebaseStatus?.lastError))} />
            <MetricCard label="Backend API" value={statusLabel(apiOnline)} />
          </div>
          <p className="helper">Last accepted reading: {fmtTime(deviceStatus.lastAcceptedReadingAt ? Date.parse(deviceStatus.lastAcceptedReadingAt) : null)}</p>
        </Panel>
        <Panel title="Current Evidence" className="wide">
          <div className="panel-grid">
            {evidenceFields.map((field) => {
              const item = evidenceByParameter.get(field.key)
              const meta = sourceMeta?.[field.metaKey]
              return <Panel title={field.label} key={field.key}>
                <p><b>{item?.value ?? '—'} {field.unit}</b>{item && <span className="pill real"> {item.status}</span>}</p>
                <p className="helper">Source: {meta?.source ?? field.fallbackSource}</p>
                <p className="helper">Timestamp: {fmtTime(meta?.timestamp ? Date.parse(meta.timestamp) : null)}</p>
              </Panel>
            })}
          </div>
        </Panel>
        <Panel title="Evidence Sufficiency" className="wide">
          <p><b>{decision?.treatmentRecommendation.evidenceSufficiency ?? '—'}</b></p>
          <p>Measured: <b>{evidence.length}</b></p>
          <p>Missing: <b>{decision?.missingEvidence.length ?? '—'}</b></p>
          <p className="helper">Missing ≠ zero. Missing ≠ normal. Missing ≠ safe.</p>
        </Panel>
        <Panel title="Detected Water-Quality Problems" className="wide">
          {treatment?.primaryIssues?.length
            ? <ul className="stat-list">{treatment.primaryIssues.map((issue) => <li key={issue.parameter}><b>{issue.displayName}</b> — {issue.value ?? '—'} {issue.unit ?? ''} · {issue.status}<br /><small>Standard: {issue.standard}. Why flagged: {issue.why}</small></li>)}</ul>
            : <p className="helper">No current quality fault detected from the available evidence.</p>}
        </Panel>
        <Panel title="Missing Current Evidence" className="wide">
          {decision?.missingEvidence.length
            ? <ul className="stat-list">{decision.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
            : <p className="helper">No missing evidence reported.</p>}
          <p className="helper">Missing ≠ Zero · Missing ≠ Normal · Missing ≠ Safe</p>
        </Panel>
        <Panel title="AI Interpretation" className="wide">
          {decision?.aiInterpretation ? <>
            <p><b>Current condition:</b> {decision.aiInterpretation.summary ?? decision.currentCondition}</p>
            <p><b>Primary concern:</b> {decision.detectedProblems[0] ?? 'No measured fault detected.'}</p>
            <p><b>Evidence limitations:</b> {decision.aiInterpretation.caveat}</p>
          </> : result ? <>
            <p><b>Current condition:</b> {result.analysis}</p><p><b>Primary concern:</b> {result.recommendation}</p>
            <ul className="stat-list">{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          </> : <p className="helper">Python AI interpretation is not available; the deterministic decision remains authoritative.</p>}
        </Panel>
        {treatment && <TreatmentMethodPanel treatment={treatment} showExecution={false} />}
        <Panel title="Why This Treatment?" className="wide">
          {treatment?.processRecommendations?.length
            ? <ul className="stat-list">{treatment.processRecommendations.map((item) => <li key={item.parameter}><b>{item.displayName}:</b> {item.rationale}</li>)}</ul>
            : <p className="helper">No supported treatment rationale is available for the current evidence.</p>}
        </Panel>
        <Panel title="Post-Treatment Verification" className="wide">
          {verification.length > 0 ? <ul className="stat-list">{verification.map((item) => <li key={item}>✓ {item}</li>)}</ul> : <p className="helper">Real after-treatment measurements are required to verify any result.</p>}
          <p className="helper">Treatment success must not be claimed before new real measurements exist.</p>
        </Panel>
        <Panel title="AI Decision" className="wide">
          {decisionLoading ? <Loading label="Evaluating decision…" /> : decision ? <><p><b>Decision:</b> {decision.decision}</p><p><b>Confidence:</b> {decision.confidence}</p><p><b>Reason:</b> {decision.currentCondition}</p><p className="helper">This is decision support, not proof that treatment occurred.</p></> : <p className="helper">{decisionError ?? 'Decision unavailable.'}</p>}
        </Panel>
        <Panel title="Execution Status" className="wide">
          <p className="badge status-moderate">{treatment?.executionStatus ?? 'NOT_STARTED'}</p>
          <p className="helper">No pump, relay, purification, or treatment command was executed by this analysis.</p>
        </Panel>
        <Panel title="Safety & Limitations" className="wide">
          <ul className="stat-list">
            <li>Treatment recommendation is process guidance.</li><li>Engineering validation is required where stated.</li>
            <li>No dosage, pump settings, flow, pressure, or contact-time values are generated.</li>
            <li>Missing measurements do not imply safety.</li><li>Treatment success requires real post-treatment measurements.</li>
          </ul>
        </Panel>
      </section>
    </>
  )
}

export function DecisionPanel({ sourceId }: { sourceId: string | null }): JSX.Element {
  const [decision, setDecision] = useState<WaterQualityDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!sourceId) { setDecision(null); setError(null); return }
    let alive = true
    setLoading(true)
    setError(null)
    fetchWaterQualityDecision(sourceId)
      .then((d) => { if (alive) setDecision(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Decision engine unavailable.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sourceId, tick])
  return (
    <section className="panel-grid">
      <Panel title="Decision Engine (deterministic — authoritative)" className="wide">
        <div className="topbar-actions">
          <button className="primary" disabled={!sourceId || loading} onClick={() => setTick((t) => t + 1)}>{loading ? 'Evaluating…' : 'Refresh decision'}</button>
        </div>
        {!sourceId && <EmptyState title="No water source selected" hint="Select a water source on the Dashboard to evaluate the decision." />}
        {sourceId && error && <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />}
        {sourceId && !error && decision && (
          <>
            <p><span className={`badge ${decision.decision === 'PURIFY' || decision.decision === 'CHANGE_TREATMENT' ? 'status-critical' : decision.decision === 'DO_NOT_PURIFY' ? 'status-good' : 'status-moderate'}`}>{decision.decision}</span>{' '}
              <span className="pill real">engine {decision.engine}</span> <span className="pill real">confidence {decision.confidence}</span></p>
            <p className="helper"><strong>Current condition:</strong> {decision.currentCondition}</p>
            <div className="panel-grid">
              <Panel title="Detected Problems">
                {decision.detectedProblems.length
                  ? <ul className="stat-list">{decision.detectedProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  : <EmptyState title="No breach detected" hint="Measured parameters are within their registered standards." />}
              </Panel>
              <Panel title="Missing Evidence (NOT MEASURED ≠ SAFE)">
                {decision.missingEvidence.length
                  ? <ul className="stat-list">{decision.missingEvidence.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  : <EmptyState title="No missing evidence" />}
              </Panel>
              <Panel title="Recommended Action & Additional Tests">
                <p className="helper">{decision.recommendedAction}</p>
                {decision.additionalTests.length > 0 && <ul className="stat-list">{decision.additionalTests.map((t, i) => <li key={i}>{t}</li>)}</ul>}
              </Panel>
              <Panel title="Reasoning (evidence trail)">
                <ul className="stat-list">{decision.reasoning.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </Panel>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Parameter</th><th>Value</th><th>Status</th><th>Standard</th></tr></thead>
                <tbody>
                  {decision.evidence.map((e) => (
                    <tr key={e.parameter}><td>{e.parameter}</td><td>{e.value ?? '—'}</td><td>{e.status}</td><td>{e.standard}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {decision.aiInterpretation ? (
              <div>
                <h4>AI Interpretation (Python engine — never changes the decision)</h4>
                {decision.aiInterpretation.summary && <p className="helper"><b>Summary:</b> {decision.aiInterpretation.summary}</p>}
                <p className="helper">{decision.aiInterpretation.caveat}</p>
                <ul className="stat-list">
                  {(decision.aiInterpretation.currentCondition.summaryLines ?? []).map((l, i) => <li key={i}>{l}</li>)}
                  {(decision.aiInterpretation.evidenceSufficiency.verdict ? [<li key="v">{decision.aiInterpretation.evidenceSufficiency.verdict}</li>] : []).map((n) => n)}
                  {(decision.aiInterpretation.recommendedActionSupport?.supportNotes ?? []).map((note, i) => <li key={`support-${i}`}>{note}</li>)}
                  {(decision.aiInterpretation.treatmentRecommendation?.limitations ?? []).map((limitation, i) => <li key={`treatment-limitation-${i}`}>{limitation}</li>)}
                  {(decision.aiInterpretation.limitations ?? []).map((limitation, i) => <li key={`limitation-${i}`}>{limitation}</li>)}
                </ul>
              </div>
            ) : (
              <p className="helper">
                {decision.aiInterpretationError
                  ? `Python AI interpretation unavailable: ${decision.aiInterpretationError}`
                  : 'Python AI interpretation not connected (set AI_ENGINE_URL on the backend). The deterministic decision above remains fully authoritative.'}
              </p>
            )}
            <TreatmentMethodPanel treatment={decision.treatmentRecommendation} />
            <p className="legend-note">
              Data classification: CURRENT = live prototype measurements (ESP32/manual) · HISTORICAL = past prototype readings ·
              GOVERNMENT = imported reference records — context only, never current evidence, never a trigger here.
            </p>
            <p className="helper">{decision.caveat}</p>
          </>
        )}
      </Panel>
    </section>
  )
}

function HistoricalCasesPage(): JSX.Element {
  const { sourceId } = useDashboard()
  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Current problem vs government records</p><h1>Historical Case Intelligence</h1></div></header>
      <HistoricalCaseIntelPage waterSourceId={sourceId} />
    </>
  )
}

function TreatmentVerificationPage(): JSX.Element {
  const { sourceId } = useDashboard()
  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Before/after purification</p><h1>Treatment Verification</h1></div></header>
      <p className="helper">
        Record the before-anchor below, issue the purification with <b>Pump Control</b> on the Purification page
        (a queued command is NOT proof of purification), take a NEW real measurement, then run the verification.
      </p>
      <section className="panel-grid">
        <Panel title="Verification Workflow" className="wide">
          <TreatmentVerification waterSourceId={sourceId} />
        </Panel>
      </section>
    </>
  )
}

function AlertsPage(): JSX.Element {
  const { alerts, loading } = useDashboard()
  const [busyId, setBusyId] = useState<string | null>(null)
  const ack = (id: string) => {
    setBusyId(id)
    const p = (async () => {
      try { await acknowledgeDbAlert(id) } catch { /* best-effort: DB acknowledgement */ }
      try { await acknowledgeAlert(id) } catch { /* preserve existing Firebase ack behaviour */ }
    })()
    void p.finally(() => setBusyId(null))
  }
  if (loading) return <Loading label="Loading alerts…" />
  const unacknowledged = alerts.filter(({ alert }) => !alert.acknowledged).length
  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Alerts & Notifications</p><h1>Alerts</h1></div></header>
      {alerts.length === 0
        ? <EmptyState title="No active alerts" hint="Threshold breaches and connection issues will appear here." />
        : (
          <Panel title={`Alerts (${unacknowledged} unacknowledged of ${alerts.length})`} className="wide">
            {alerts.map(({ id, alert }) => (
              <div key={id} className={`callout ${alert.severity === 'CRITICAL' ? 'error' : ''}`}>
                <p><strong>{alert.type}</strong> — {alert.message} <small className="legend-note">{fmtTime(alert.timestamp)}</small></p>
                {alert.explanation && <p className="helper">{alert.explanation}</p>}
                {alert.recommendedAction && <p className="helper"><strong>Recommended:</strong> {alert.recommendedAction}</p>}
                {!alert.acknowledged
                  ? <button type="button" className="ghost" disabled={busyId === id} onClick={() => ack(id)}>{busyId === id ? 'Acknowledging…' : 'Acknowledge'}</button>
                  : <small className="legend-note">Acknowledged</small>}
              </div>
            ))}
          </Panel>
        )}
    </>
  )
}

function SettingsPage(): JSX.Element {
  const { apiOnline, waterSources, waterSource, sourceId, setSourceId, firebaseStatus, device, deviceStatus } = useDashboard()
  const [pythonOnline, setPythonOnline] = useState(false)
  useEffect(() => { void fetchPythonAIStatus().then((status) => setPythonOnline(status.available)).catch(() => setPythonOnline(false)) }, [])
  const [notifications, setNotifications] = useState(() => localStorage.getItem('aquasense.notifications.v1') !== 'off')
  const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem('aquasense.auto-refresh.v1') !== 'off')
  const [refreshInterval, setRefreshInterval] = useState(() => localStorage.getItem('aquasense.refresh-interval.v1') ?? '30 seconds')
  const savePreference = (key: string, value: string) => localStorage.setItem(key, value)
  const formatSettingTime = (value: string | null): string => value ? new Date(value).toLocaleString() : 'No accepted reading yet'
  const location = waterSource ? [waterSource.village, waterSource.district, waterSource.state].filter(Boolean).join(', ') : 'No location registered'
  const connectionStatus = (online: boolean, degraded = false): 'ONLINE' | 'OFFLINE' | 'DEGRADED' => online ? (degraded ? 'DEGRADED' : 'ONLINE') : 'OFFLINE'
  const statusClass = (status: 'ONLINE' | 'OFFLINE' | 'DEGRADED'): string => status === 'ONLINE' ? 'status-good' : status === 'DEGRADED' ? 'status-moderate' : 'status-critical'
  const Status = ({ status }: { status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' }): JSX.Element => <span className={`badge ${statusClass(status)}`}>{status}</span>
  return (
    <>
      <header className="topbar settings-header"><div><p className="eyebrow">Workspace configuration</p><h1>Settings</h1></div><span className="pill real">REAL DATA</span></header>
      <section className="settings-grid">
        <Panel title="System Preferences" className="settings-panel">
          <div className="settings-list">
            <label className="setting-row"><span><Palette size={17} aria-hidden="true" /><b>Theme</b><small>AquaSense light theme</small></span><select aria-label="Theme" value="AquaSense" disabled><option>AquaSense</option></select></label>
            <label className="setting-row"><span><BellRing size={17} aria-hidden="true" /><b>Notifications</b><small>Show monitoring alerts</small></span><input type="checkbox" role="switch" checked={notifications} onChange={(e) => { setNotifications(e.target.checked); savePreference('aquasense.notifications.v1', e.target.checked ? 'on' : 'off') }} /></label>
            <label className="setting-row"><span><RefreshCw size={17} aria-hidden="true" /><b>Auto refresh</b><small>Refresh live data in the background</small></span><input type="checkbox" role="switch" checked={autoRefresh} onChange={(e) => { setAutoRefresh(e.target.checked); savePreference('aquasense.auto-refresh.v1', e.target.checked ? 'on' : 'off') }} /></label>
            <label className="setting-row"><span><span className="setting-icon" aria-hidden="true" /> <b>Refresh interval</b><small>Current data polling cadence</small></span><select aria-label="Refresh interval" value={refreshInterval} onChange={(e) => { setRefreshInterval(e.target.value); savePreference('aquasense.refresh-interval.v1', e.target.value) }}><option>15 seconds</option><option>30 seconds</option><option>60 seconds</option></select></label>
          </div>
        </Panel>
        <Panel title="Active Water Source" className="settings-panel">
          <label className="setting-field">Selected source<select value={sourceId ?? ''} onChange={(e) => setSourceId(e.target.value || null)}>{waterSources.length === 0 && <option value="">No source registered</option>}{waterSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
          <div className="settings-facts"><span><b>Source type</b>{waterSource?.sourceType ?? '—'}</span><span><MapPin size={15} aria-hidden="true" /><b>Location</b>{location}</span></div>
        </Panel>
        <Panel title="Active Device" className="settings-panel">
          <div className="device-summary"><Cpu size={22} aria-hidden="true" /><div><b>{device?.code ?? deviceStatus.deviceCode ?? 'No device registered'}</b><small>Active ESP32 device</small></div><DeviceStatusBadge deviceStatus={deviceStatus} /></div>
          <div className="settings-facts"><span><b>Last reading</b>{formatSettingTime(deviceStatus.lastAcceptedReadingAt)}</span><span><b>Last seen</b>{formatSettingTime(device?.lastSeenAt ?? null)}</span></div>
        </Panel>
        <Panel title="System Connectivity" className="settings-panel settings-panel-wide">
          <div className="connectivity-grid"><div><Server size={18} aria-hidden="true" /><span>Backend API</span><Status status={connectionStatus(apiOnline)} /></div><div><Database size={18} aria-hidden="true" /><span>PostgreSQL</span><Status status={connectionStatus(apiOnline)} /></div><div><Radio size={18} aria-hidden="true" /><span>Firebase Bridge</span><Status status={connectionStatus(Boolean(firebaseStatus?.enabled && firebaseStatus.configured), Boolean(firebaseStatus?.lastError))} /></div><div><Brain size={18} aria-hidden="true" /><span>Python AI</span><Status status={connectionStatus(pythonOnline)} /></div></div>
        </Panel>
        <Panel title="Data Mode" className="settings-panel">
          <div className="mode-display"><Radio size={20} aria-hidden="true" /><div><b>REAL DATA</b><small>Live operational data is active.</small></div></div>
        </Panel>
        <Panel title="Application" className="settings-panel">
          <div className="settings-facts"><span><b>Version</b>0.0.0</span><span><b>About</b>AquaSense Smart Water Intelligence</span></div>
          <details className="technical-details"><summary>Advanced / Technical Details</summary><p>Operational service endpoints and environment configuration are maintained in project documentation.</p></details>
        </Panel>
      </section>
    </>
  )
}

function GovernmentDataPage(): JSX.Element {
  const [summary, setSummary] = useState<GovernmentSummary | null>(null)
  const [datasets, setDatasets] = useState<GovernmentDataset[]>([])
  const [records, setRecords] = useState<GovernmentRecord[]>([])
  const [recordsError, setRecordsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = () => {
    void Promise.all([fetchSummary(), fetchDatasets()])
      .then(([s, ds]) => { setSummary(s); setDatasets(ds); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not reach the government data API.'))
    void fetchRecords({ parameter: '', sourceOrganization: '', state: '', district: '', search: '' })
      .then((r) => { setRecords(r.slice(0, 100)); setRecordsError(null) })
      .catch((e) => setRecordsError(e instanceof Error ? e.message : 'Could not load government records.'))
  }
  useEffect(() => { reload() }, [])
  return (
    <>
            <header className="topbar">
        <div><p className="eyebrow">Reference Module (PostgreSQL)</p><h1>Government Data</h1></div>
        <div className="topbar-actions"><button className="primary" onClick={reload}>Refresh</button></div>
      </header>
      <section className="gov-ai-banner-entry">
        <div className="gov-ai-entry-content">
          <span className="gov-ai-entry-tag">NEW</span>
          <h2>Government Historical AI Analysis</h2>
          <p>Deep historical intelligence over CGWB records — classify parameters, surface concern values, and interpret with the Python AI engine.</p>
        </div>
        <NavLink to={ROUTE_MAP['Government Historical AI']} className="gov-ai-entry-link">
          Open Historical AI &rarr;
        </NavLink>
      </section>
      {error && <ErrorState message={error} onRetry={reload} />}
      <section className="panel-grid">
        <Panel title="Import Official Dataset" className="wide">
          <p className="helper">Upload CGWB / JJM-WQMIS / data.gov.in CSV or XLSX files. Data is validated and stored in the separate PostgreSQL module — it never mixes with ESP32 readings.</p>
          <GovernmentImport onComplete={reload} />
        </Panel>
        <Panel title="Stored Datasets" className="wide">
          {error
            ? <EmptyState title="Unable to connect to government data service" hint="The government data API is not responding. Check the backend connection." />
            : (!summary || datasets.length === 0
              ? <EmptyState title="No datasets imported yet" hint="Import an official file above to populate the reference module." />
              : (
              <>
                <ul className="stat-list">
                  <li><b>{summary.records}</b> records</li>
                  <li><b>{summary.datasets}</b> datasets</li>
                  <li><b>{summary.parameters}</b> parameters</li>
                  <li><b>{summary.villages}</b> villages</li>
                  {summary.latestImport && <li>Last import: {fmtTime(Date.parse(summary.latestImport))}</li>}
                </ul>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Dataset</th><th>Organization</th><th>Year</th><th>Records</th><th>Imported</th></tr></thead>
                    <tbody>
                      {datasets.map((d) => (
                        <tr key={d.id}>
                          <td>{d.datasetName}</td>
                          <td>{d.sourceOrganization}</td>
                          <td>{d.datasetYear ?? '—'}</td>
                          <td>{d.recordCount}</td>
                          <td>{fmtTime(Date.parse(d.importedAt))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ))}
        </Panel>
        <Panel title="Stored Records (showing first 100)" className="wide">
          {recordsError && <ErrorState message={recordsError} onRetry={reload} />}
          {!recordsError && records.length === 0
            ? <EmptyState title="No records imported yet" hint="Import an official file above to populate the reference records." />
            : !recordsError && (
              <>
                <p className="helper">
                  WQ6 records are <b>AFFECTED VILLAGE COUNTS — CONTEXT ONLY</b>; they are never a contaminant concentration (mg/L, NTU) and never a current sensor value.
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th>Record type</th>
                        <th>Value / Count</th>
                        <th>Location (state · district · block · GP · village)</th>
                        <th>Sample date</th>
                        <th>Organization · Dataset (provenance)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.id}>
                          <td>{r.display_name}<span className="sub">{r.parameter}</span></td>
                          <td><span className="badge">{r.record_type}</span></td>
                          <td>
                            {r.value !== null
                              ? <><b>{r.value}</b> {r.unit ?? ''}</>
                              : r.affected_village_count !== null
                                ? <span className="badge summary"><b>{r.affected_village_count}</b> AFFECTED VILLAGE COUNT — CONTEXT ONLY</span>
                                : '—'}
                          </td>
                          <td>{[r.state_name, r.district_name, r.block_name, r.gram_panchayat_name, r.village_name, r.water_source_name].filter(Boolean).join(' · ') || '—'}</td>
                          <td>{r.sample_date ?? '—'}</td>
                          <td>
                            {r.source_organization} · {r.dataset_name}{r.dataset_year ? ` (${r.dataset_year})` : ''}
                            {r.source_url && <a className="sub" href={r.source_url} target="_blank" rel="noreferrer">{r.source_url}</a>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
        </Panel>
      </section>
    </>
  )
}

function App(): JSX.Element {
  const { mode, apiOnline, deviceStatus, sourceId } = useDashboard()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)
  const goTo = (p: Page) => navigate(ROUTE_MAP[p])
  return (
    <div className={`shell${navOpen ? ' navigation-open' : ''}`}>
      <button className="mobile-menu-trigger" type="button" aria-label="Open navigation menu" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
        <Menu size={20} aria-hidden="true" />
      </button>
      {navOpen && <button className="nav-backdrop" type="button" aria-label="Close navigation menu" onClick={() => setNavOpen(false)} />}
      <aside className={navOpen ? 'nav-open' : ''}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Droplets size={25} /></span>
          <div>
            <b>Aqua<span>Sense</span></b>
            <small>Smart Water Intelligence</small>
          </div>
          <button className="nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}>
            {navOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        <nav>
          {NAVIGATION.map(({ label, pages }) => (
            <section className="nav-group" key={label} aria-label={label}>
              <p>{label}</p>
              {pages.map((p) => {
                const Icon = META[p].icon
                return <NavLink key={p} to={ROUTE_MAP[p]} title={p} onClick={() => setNavOpen(false)} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <Icon size={18} strokeWidth={1.9} aria-hidden="true" /><span>{p === 'AI Analysis' ? 'Current AI' : p === 'History' ? 'Historical Analytics' : p}</span>
                </NavLink>
              })}
            </section>
          ))}
        </nav>
        <div className="conn">
          <span className={`dot ${apiOnline ? 'ok' : 'down'}`} />
          {apiOnline ? 'API connected' : 'API unreachable'}
          <small>
            <DeviceStatusBadge deviceStatus={deviceStatus} />
            {` · mode: ${mode}`}
          </small>
        </div>
      </aside>
      <main>
          <DemoBanner mode={mode} />
          <div className="content-wrapper">
            <Routes>
              <Route path="/" element={<Dashboard onNavigate={goTo} />} />
              <Route path="/live-monitoring" element={<LiveMonitoringPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/water-quality" element={<WaterQualityPage />} />
              <Route path="/purification" element={<PurificationPage />} />
              <Route path="/treatment-verification" element={<TreatmentVerificationPage />} />
              <Route path="/ai-analysis" element={<AiAnalysisPage />} />
              <Route path="/historical-cases" element={<HistoricalCasesPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/government-data" element={<GovernmentDataPage />} />
              <Route path="/government-data/historical-ai" element={<AIHistoricalAnalysisPage />} />
              <Route path="/evidence-comparison" element={<EvidenceComparison waterSourceId={sourceId} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
      </main>
    </div>
  )
}

export default App

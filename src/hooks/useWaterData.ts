/**
 * useWaterData â€” single source of truth for the dashboard streams.
 *
 * REAL DATA -> PostgreSQL via the Express API (GET /api/readings/current,
 * polled every 30s). Phase-2 pipeline: ESP32 -> API -> PostgreSQL -> UI and
 * manual pH/TDS -> API -> PostgreSQL -> UI. Firebase is no longer the REAL
 * DATA transport (kept only for the future ESP32-direct-publish option).
 * DEMO MODE -> clearly-labelled local sample data (demoService).
 */
import { useEffect, useState } from 'react'
import { getReadableApiError } from '../utils/apiError'
import { fetchAlerts, fetchCurrentPayload, fetchDevices, fetchFirebaseSourceStatus, fetchWaterSources } from '../services/apiService'
import { demoCurrent, demoHistory, demoPump, tickDemo } from '../services/demoService'
import { loadThresholds, saveThresholds } from '../utils/quality'
import type { AiResult, CurrentReadings, DataMode, Device, DeviceStatus, FirebaseSourceStatus, HistoricalReading, PumpState, ServerAlert, SourceMetaMap, WaterAlert, WaterSourceInfo, Thresholds } from '../types'

const MODE_KEY = 'aquasense.mode.v1'
const SOURCE_KEY = 'aquasense.source.v1'
const POLL_MS = 30000

function loadMode(): DataMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    return saved === 'DEMO MODE' ? 'DEMO MODE' : 'REAL DATA'
  } catch {
    return 'REAL DATA'
  }
}

function loadSourceId(): string | null {
  try { return localStorage.getItem(SOURCE_KEY) } catch { return null }
}

function alertTypeFor(parameter: string | null): WaterAlert['type'] {
  switch (parameter) {
    case 'ph': return 'ABNORMAL_PH'
    case 'tds': return 'HIGH_TDS'
    case 'turbidity': return 'HIGH_TURBIDITY'
    case 'temperature': return 'TEMPERATURE_ABNORMAL'
    default: return 'BREACH'
  }
}

// Map PostgreSQL alerts rows (GET /api/alerts) into the WaterAlert records the
// existing Alerts page already consumes -- read-only on the 30s poll; row
// creation happens in the server-side alert producer.
function mapServerAlerts(rows: ServerAlert[]): Record<string, WaterAlert> {
  const out: Record<string, WaterAlert> = {}
  for (const r of rows) {
    out[r.id] = {
      type: alertTypeFor(r.parameter),
      severity: r.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
      message: r.message,
      recommendedAction: r.recommendedAction,
      parameter: r.parameter ?? undefined,
      value: null,
      timestamp: Date.parse(r.occurredAt),
      acknowledged: !!r.acknowledgedAt,
    }
  }
  return out
}

export interface WaterData {
  mode: DataMode
  setMode: (m: DataMode) => void
  apiOnline: boolean
  apiError: string | null
  waterSources: WaterSourceInfo[]
  waterSource: WaterSourceInfo | null
  sourceId: string | null
  setSourceId: (id: string | null) => void
    refresh: () => void
  sourceMeta: SourceMetaMap | null
  device: Device | null
  current: CurrentReadings | null
  history: HistoricalReading[]
  pump: PumpState | null
  loading: boolean
  error: string | null
  alerts: Record<string, WaterAlert>
  ai: AiResult | null
  thresholds: Thresholds
  setThresholds: (t: Thresholds) => void
  demoAdvance: () => void
  firebaseStatus: FirebaseSourceStatus | null
  deviceStatus: DeviceStatus
}

export function useWaterData(): WaterData {
  const [mode, setModeState] = useState<DataMode>(loadMode)
  const [current, setCurrent] = useState<CurrentReadings | null>(null)
  const [history, setHistory] = useState<HistoricalReading[]>([])
  const [pump, setPump] = useState<PumpState | null>(null)
  const [alerts, setAlerts] = useState<Record<string, WaterAlert>>({})
  const [ai, setAi] = useState<AiResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [thresholds, setThresholdsState] = useState<Thresholds>(() => loadThresholds())
  const [waterSources, setWaterSources] = useState<WaterSourceInfo[]>([])
  const [waterSource, setWaterSource] = useState<WaterSourceInfo | null>(null)
  const [sourceId, setSourceIdState] = useState<string | null>(loadSourceId)
  const [refreshTick, setRefreshTick] = useState(0)
  const [apiOnline, setApiOnline] = useState(false)
      const [sourceMeta, setSourceMeta] = useState<SourceMetaMap | null>(null)
  const [device, setDevice] = useState<Device | null>(null)
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseSourceStatus | null>(null)
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>({
    status: 'OFFLINE', ageMs: null, lastAcceptedReadingAt: null, deviceCode: null, onlineMaxAgeMs: 15000, staleMaxAgeMs: 60000,
  })

  const setMode = (m: DataMode) => {
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
    setModeState(m)
  }
  const setThresholds = (t: Thresholds) => {
    setThresholdsState(t)
    saveThresholds(t)
  }
  const setSourceId = (id: string | null) => {
    try { if (id) localStorage.setItem(SOURCE_KEY, id); else localStorage.removeItem(SOURCE_KEY) } catch { /* ignore */ }
    setSourceIdState(id)
  }
  const refresh = () => setRefreshTick((t) => t + 1)
  const demoAdvance = () => {
    tickDemo()
    setCurrent(demoCurrent())
    setHistory(demoHistory())
    setPump(demoPump())
    setAlerts({})
  }

  // REAL DATA: PostgreSQL via the Express API (PostgreSQL is the source of truth).
  useEffect(() => {
    if (mode !== 'REAL DATA') return
    let alive = true
    const tick = async () => {
      try {
        const sources = await fetchWaterSources()
        if (!alive) return
        setWaterSources(sources)
        setApiOnline(true)
        let sid = sourceId
        if (!sid || !sources.some((s) => s.id === sid)) {
          sid = sources[0]?.id ?? null
          if (sid) {
            try { localStorage.setItem(SOURCE_KEY, sid) } catch { /* ignore */ }
            setSourceIdState(sid)
          }
        }
        if (!sid) {
          setCurrent(null); setHistory([]); setPump(null); setAlerts({}); setAi(null); setWaterSource(null); setSourceMeta(null)
          setError('No water source is registered yet. Register the real prototype location with scripts/register-source.mjs, then reload.')
          setLoading(false)
          return
        }
        const payload = await fetchCurrentPayload(sid)
        if (!alive) return
        setWaterSource(payload.waterSource)
        const l = payload.latest
        const times = [
          l.temperature ? new Date(l.temperature.timestamp).getTime() : 0,
          l.ph ? new Date(l.ph.timestamp).getTime() : 0,
          l.tds ? new Date(l.tds.timestamp).getTime() : 0,
        ]
        setCurrent({
          temperature: l.temperature?.value ?? null,
          turbidity: l.turbidity?.value ?? null,
          ph: l.ph?.value ?? null,
          tds: l.tds?.value ?? null,
          pumpStatus: null, // pump status reporting is Phase 7 â€” never assumed
          esp32Online: payload.deviceStatus?.status === 'ONLINE' ? true : payload.deviceStatus ? false : null,
          timestamp: Math.max(...times) || null,
        })
        setHistory(payload.history.map((h) => ({
          temperature: h.temperature ?? null,
          turbidity: h.turbidity ?? null,
          ph: h.ph ?? null,
          tds: h.tds ?? null,
          timestamp: h.timestamp,
        })))
        setSourceMeta({
          temperature: l.temperature
            ? { source: 'DS18B20 → ESP32 → API → PostgreSQL', timestamp: l.temperature.timestamp, deviceCode: l.temperature.deviceCode ?? null }
            : null,
          turbidity: l.turbidity
            ? { source: 'Turbidity sensor → ESP32 → API → PostgreSQL', timestamp: l.turbidity.timestamp, deviceCode: l.turbidity.deviceCode ?? null }
            : null,
          ph: l.ph
            ? { source: 'Manual Chemical Test → API → PostgreSQL', timestamp: l.ph.timestamp, operatorName: l.ph.operatorName ?? null }
            : null,
          tds: l.tds
            ? { source: 'External TDS Meter → API → PostgreSQL', timestamp: l.tds.timestamp, operatorName: l.tds.operatorName ?? null }
            : null,
        })
        try { setAlerts(mapServerAlerts(await fetchAlerts(sid))) } catch { setAlerts({}) } // P1-2: real alerts from PostgreSQL (read-only on the 30s poll) â€” no invented alerts
        setAi(null)
        setError(null)
        setLoading(false)
      } catch (e) {
        if (!alive) return
        setApiOnline(false)
        setError(getReadableApiError(e, 'backend'))
        setLoading(false)
      }
    }
    void tick()
    const timer = window.setInterval(tick, POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [mode, sourceId, refreshTick])

  // Firebase bridge freshness is polled independently so ONLINE -> STALE -> OFFLINE
  // is reflected without waiting for a full readings refresh.
  useEffect(() => {
    if (mode !== 'REAL DATA') return
    let alive = true
    const load = () => {
      void fetchFirebaseSourceStatus()
        .then((status) => {
          if (!alive) return
          setFirebaseStatus(status)
          setDeviceStatus(status.deviceStatus)
        })
        .catch(() => {
          if (alive) setDeviceStatus((previous) => ({ ...previous, status: 'OFFLINE' }))
        })
    }
    load()
    const timer = window.setInterval(load, 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [mode])

    // REAL DATA: resolve the device registered against the selected water source
  // so pump commands can be addressed to POST /api/pump/command by device id.
  // Device existence/online state is the server's truth (pump_commands / devices),
  // never assumed.
  useEffect(() => {
    if (mode !== 'REAL DATA' || !waterSource) {
      setDevice(null)
      return
    }
    let alive = true
    void (async () => {
      try {
        const devices = await fetchDevices()
        const match =
          devices.find((d) => d.waterSource === waterSource.name) ??
          (devices.length === 1 ? devices[0] : null)
        if (alive) setDevice(match ?? null)
      } catch {
        if (alive) setDevice(null)
      }
    })()
    return () => { alive = false }
  }, [mode, waterSource])

  // DEMO MODE: populate local sample data (clearly labelled by the UI).
  useEffect(() => {
    if (mode !== 'DEMO MODE') return
    setCurrent(demoCurrent()); setHistory(demoHistory()); setPump(demoPump()); setAlerts({}); setAi(null)
    setError(null); setLoading(false)
    const timer = setInterval(demoAdvance, 60000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  return {
    mode, setMode, apiOnline, apiError: error,
        waterSources, waterSource, sourceId, setSourceId, refresh, sourceMeta, device,
    current, history, thresholds, setThresholds, pump, alerts, ai, demoAdvance, firebaseStatus, deviceStatus,
    loading, error,
  }
}

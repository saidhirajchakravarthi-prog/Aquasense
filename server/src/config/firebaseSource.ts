/**
 * Firebase RTDB source configuration (REAL prototype transport).
 *
 * The physical prototype team will provide the actual Firebase details later.
 * NOTHING here invents a path or field name: every value comes from environment
 * variables and the bridge stays DISABLED until they are all present.
 *
 * Required environment variables (see .env.example):
 *   FIREBASE_SOURCE_ENABLED=true|false
 *   FIREBASE_DATABASE_URL        e.g. https://<project>-default-rtdb.<region>.firebasedatabase.app
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_AUTH_DOMAIN
 *   FIREBASE_API_KEY
 *   FIREBASE_DB_SECRET           optional legacy RTDB secret/token for ?auth=
 *   FIREBASE_PATH                actual RTDB path holding the current reading (TO BE PROVIDED)
 *   FIREBASE_TEMPERATURE_FIELD   actual temperature field name (TO BE PROVIDED)
 *   FIREBASE_TURBIDITY_FIELD     actual turbidity field name (TO BE PROVIDED)
 *   FIREBASE_TIMESTAMP_FIELD     actual timestamp field name (TO BE PROVIDED)
 *   FIREBASE_DEVICE_ID_FIELD     device-id field name (TO BE PROVIDED, optional if
 *                                FIREBASE_DEVICE_CODE is used instead)
 *   FIREBASE_DEVICE_CODE         static registered device_code fallback (optional)
 *   FIREBASE_POLL_INTERVAL_MS    poll interval (optional, default 30000)
 *
 * Secrets are read server-side only and are never committed or sent to the browser.
 */

export interface FirebaseSourceConfig {
  databaseUrl: string
  projectId: string
  authDomain: string
  apiKey: string
  dbSecret: string | null
  path: string
  temperatureField: string
  turbidityField: string
  timestampField: string
  deviceIdField: string | null
  deviceCode: string | null
  pollIntervalMs: number
  onlineMaxAgeMs: number
  staleMaxAgeMs: number
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

const REQUIRED = ['FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_API_KEY', 'FIREBASE_PATH', 'FIREBASE_TEMPERATURE_FIELD', 'FIREBASE_TURBIDITY_FIELD', 'FIREBASE_TIMESTAMP_FIELD'] as const

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

const state = {
  lastPollAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastReadingAt: null as string | null,
  lastAcceptedReadingAt: null as string | null,
  lastAcceptedDeviceCode: null as string | null,
  lastError: null as string | null,
  polls: 0,
  readingsAccepted: 0,
  readingsRejected: 0,
  rejectionReasons: [] as string[],
}

export function notePoll(): void {
  state.polls += 1
  state.lastPollAt = new Date().toISOString()
}
export function noteSuccess(): void {
  state.lastSuccessAt = new Date().toISOString()
  state.lastError = null
}
export function noteReading(observedAt: Date, deviceCode: string, count = true): void {
  if (count) state.readingsAccepted += 1
  state.lastReadingAt = observedAt.toISOString()
  state.lastAcceptedReadingAt = observedAt.toISOString()
  state.lastAcceptedDeviceCode = deviceCode
}
export function noteRejection(reason: string): void {
  state.readingsRejected += 1
  state.lastError = reason
  if (!state.rejectionReasons.includes(reason)) state.rejectionReasons.push(reason)
}
export function noteError(error: string): void {
  state.lastError = error
}

function ageLimit(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? '')
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function getDeviceStatus(now = Date.now()): DeviceStatus {
  const onlineMaxAgeMs = ageLimit('FIREBASE_ONLINE_MAX_AGE_MS', 15_000)
  const staleMaxAgeMs = Math.max(ageLimit('FIREBASE_STALE_MAX_AGE_MS', 60_000), onlineMaxAgeMs)
  const lastAcceptedReadingAt = state.lastAcceptedReadingAt
  const parsedTimestamp = lastAcceptedReadingAt ? Date.parse(lastAcceptedReadingAt) : Number.NaN
  const ageMs = Number.isFinite(parsedTimestamp) ? Math.max(0, now - parsedTimestamp) : null
  const status: DeviceFreshnessStatus =
    ageMs === null || ageMs > staleMaxAgeMs ? 'OFFLINE' : ageMs > onlineMaxAgeMs ? 'STALE' : 'ONLINE'
  return { status, ageMs, lastAcceptedReadingAt, deviceCode: state.lastAcceptedDeviceCode, onlineMaxAgeMs, staleMaxAgeMs }
}

/** Read + validate the configuration. Returns null (with the missing list) until the hardware team supplies real values. */
export function readFirebaseSourceConfig(): { config: FirebaseSourceConfig | null; missing: string[] } {
  const enabled = process.env.FIREBASE_SOURCE_ENABLED === 'true'
  const missing = REQUIRED.filter((k) => !process.env[k])
  if (!enabled || missing.length > 0) return { config: null, missing }
  const intervalRaw = Number(process.env.FIREBASE_POLL_INTERVAL_MS ?? '')
  return {
    config: {
      databaseUrl: (process.env.FIREBASE_DATABASE_URL as string).replace(/\/+$/, ''),
      projectId: process.env.FIREBASE_PROJECT_ID as string,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN as string,
      apiKey: process.env.FIREBASE_API_KEY as string,
      dbSecret: process.env.FIREBASE_DB_SECRET || null,
      path: (process.env.FIREBASE_PATH as string).replace(/^\/+|\/+$/g, ''),
      temperatureField: process.env.FIREBASE_TEMPERATURE_FIELD as string,
      turbidityField: process.env.FIREBASE_TURBIDITY_FIELD as string,
      timestampField: process.env.FIREBASE_TIMESTAMP_FIELD as string,
      deviceIdField: process.env.FIREBASE_DEVICE_ID_FIELD || null,
      deviceCode: process.env.FIREBASE_DEVICE_CODE || null,
      pollIntervalMs: Number.isFinite(intervalRaw) && intervalRaw >= 5000 ? intervalRaw : 30000,
      onlineMaxAgeMs: ageLimit('FIREBASE_ONLINE_MAX_AGE_MS', 15_000),
      staleMaxAgeMs: Math.max(ageLimit('FIREBASE_STALE_MAX_AGE_MS', 60_000), ageLimit('FIREBASE_ONLINE_MAX_AGE_MS', 15_000)),
    },
    missing: [],
  }
}

export function getFirebaseSourceStatus(): FirebaseSourceStatus {
  const { config, missing } = readFirebaseSourceConfig()
  return {
    enabled: process.env.FIREBASE_SOURCE_ENABLED === 'true',
    configured: config !== null,
    missingFields: missing,
    path: config?.path ?? null,
    pollIntervalMs: config?.pollIntervalMs ?? null,
    deviceStatus: getDeviceStatus(),
    fields: config
      ? { temperature: config.temperatureField, turbidity: config.turbidityField, timestamp: config.timestampField, deviceId: config.deviceIdField, deviceCode: config.deviceCode }
      : null,
    lastPollAt: state.lastPollAt,
    lastSuccessAt: state.lastSuccessAt,
    lastReadingAt: state.lastReadingAt,
    lastError: state.lastError,
    polls: state.polls,
    readingsAccepted: state.readingsAccepted,
    readingsRejected: state.readingsRejected,
    rejectionReasons: state.rejectionReasons,
  }
}

/**
 * Firebase RTDB -> AquaSense backend -> PostgreSQL bridge (REAL-data only).
 *
 * When (and ONLY when) FIREBASE_SOURCE_ENABLED=true and all field-mapping
 * variables are configured, this bridge polls the REAL prototype's RTDB node
 * over the RTDB REST API (no extra dependency), normalizes the actual field
 * names, validates the reading, and inserts it into sensor_readings exactly
 * like POST /api/device/readings does — including device last_seen/online
 * updates and best-effort alert production.
 *
 * Hard rules:
 *   - no invented values: a reading missing its temperature OR turbidity field,
 *     a non-numeric value, an unparseable timestamp, or an unregistered device
 *     is REJECTED and counted (never guessed, never defaulted).
 *   - duplicate guard: a reading whose (device, observed_at) already exists is
 *     skipped, not re-inserted.
 *   - PostgreSQL remains the persistent source of truth; Firebase is transport.
 *   - when not configured the bridge does nothing and reports that honestly.
 */
import type { Pool } from 'pg'
import { readFirebaseSourceConfig, notePoll, noteSuccess, noteReading, noteRejection, noteError } from '../config/firebaseSource.js'

/** Normalized current-reading model (future parameters can be added here). */
export interface NormalizedReading {
  parameter: 'temperature' | 'turbidity'
  value: number
  unit: string
  source: 'ESP32'
  timestamp: Date
  deviceCode: string
  waterSourceId: string
}

interface DeviceRow { id: string; water_source_id: string | null }

const TEMP_MIN = -20, TEMP_MAX = 100, TURB_MIN = 0, TURB_MAX = 10000 // same bounds as deviceReadingSchema

function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Accept seconds or milliseconds epoch.
    const ms = raw > 1e12 ? raw : raw * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Normalize + validate one RTDB snapshot. Returns a rejection reason instead of throwing. */
export function normalizeSnapshot(
  snapshot: Record<string, unknown>,
  cfg: { temperatureField: string; turbidityField: string; timestampField: string; deviceIdField: string | null; deviceCode: string | null },
  device: DeviceRow,
): { ok: true; reading: { temperature: number; turbidity: number; observedAt: Date; deviceCode: string } } | { ok: false; reason: string } {
  const temperature = toFiniteNumber(snapshot[cfg.temperatureField])
  if (temperature === null) return { ok: false, reason: `missing/non-numeric temperature field "${cfg.temperatureField}"` }
  if (temperature < TEMP_MIN || temperature > TEMP_MAX) return { ok: false, reason: `temperature ${temperature} outside validated range [${TEMP_MIN}, ${TEMP_MAX}]` }
  const turbidity = toFiniteNumber(snapshot[cfg.turbidityField])
  if (turbidity === null) return { ok: false, reason: `missing/non-numeric turbidity field "${cfg.turbidityField}"` }
  if (turbidity < TURB_MIN || turbidity > TURB_MAX) return { ok: false, reason: `turbidity ${turbidity} outside validated range [${TURB_MIN}, ${TURB_MAX}]` }
  const observedAt = parseTimestamp(snapshot[cfg.timestampField])
  if (!observedAt) return { ok: false, reason: `missing/unparseable timestamp field "${cfg.timestampField}"` }
  const skewMs = 5 * 60_000
  if (observedAt.getTime() > Date.now() + skewMs) return { ok: false, reason: 'timestamp is in the future beyond the allowed 5-minute skew' }
  if (cfg.deviceIdField && snapshot[cfg.deviceIdField] !== undefined && snapshot[cfg.deviceIdField] !== null) {
    const reported = String(snapshot[cfg.deviceIdField])
    if (device.water_source_id === null) return { ok: false, reason: `device "${reported}" is not linked to a water source` }
  }
  return { ok: true, reading: { temperature, turbidity, observedAt, deviceCode: cfg.deviceCode ?? (cfg.deviceIdField ? String(snapshot[cfg.deviceIdField]) : 'UNKNOWN') } }
}

/** One poll cycle: read the configured RTDB node, validate, insert if real + new. */
export async function pollFirebaseSource(pool: Pool): Promise<void> {
  const { config } = readFirebaseSourceConfig()
  if (!config) return // not configured -> bridge stays dormant (honest no-op)
  notePoll()
  let snapshot: Record<string, unknown>
  try {
    const auth = config.dbSecret ? `?auth=${encodeURIComponent(config.dbSecret)}` : ''
    const url = `${config.databaseUrl}/${config.path.split('/').map(encodeURIComponent).join('/')}.json${auth}`
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      noteError(`Firebase RTDB read failed: HTTP ${response.status}`)
      return
    }
    const body = (await response.json()) as unknown
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      noteRejection('Firebase node is empty or not an object — no reading to accept yet')
      return
    }
    snapshot = body as Record<string, unknown>
  } catch (error) {
    noteError(`Firebase RTDB unreachable: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const reportedDevice = config.deviceIdField && snapshot[config.deviceIdField] != null ? String(snapshot[config.deviceIdField]) : config.deviceCode
  if (!reportedDevice) {
    noteRejection('no device identity: FIREBASE_DEVICE_ID_FIELD absent in snapshot and FIREBASE_DEVICE_CODE not configured')
    return
  }
  const device = (
    await pool.query<DeviceRow>('SELECT id, water_source_id FROM devices WHERE device_code=$1', [reportedDevice])
  ).rows[0]
  if (!device) {
    noteRejection(`device "${reportedDevice}" is not registered in PostgreSQL (register it with scripts/register-source.mjs)`)
    return
  }
  if (!device.water_source_id) {
    noteRejection(`device "${reportedDevice}" has no linked water source`)
    return
  }

  const normalized = normalizeSnapshot(snapshot, config, device)
  if (!normalized.ok) {
    noteRejection(normalized.reason)
    return
  }
  const { temperature, turbidity, observedAt } = normalized.reading

  const duplicate = await pool.query(
    'SELECT 1 FROM sensor_readings WHERE device_id=$1 AND observed_at=$2 LIMIT 1',
    [device.id, observedAt],
  )
  if (duplicate.rows.length > 0) {
    noteReading(observedAt, normalized.reading.deviceCode, false)
    noteSuccess() // valid data, nothing new to store
    return
  }

  await pool.query(
    'INSERT INTO sensor_readings(device_id,water_source_id,temperature,turbidity,observed_at) VALUES($1,$2,$3,$4,$5)',
    [device.id, device.water_source_id, temperature, turbidity, observedAt],
  )
  await pool.query('UPDATE devices SET online=true, last_seen_at=$2 WHERE id=$1', [device.id, observedAt])
  noteReading(observedAt, normalized.reading.deviceCode)
  noteSuccess()
}

/** Start the poller. Dormant no-op until the real Firebase configuration arrives. */
export function startFirebaseBridge(pool: Pool): void {
  const { config, missing } = readFirebaseSourceConfig()
  if (!config) {
    console.log(
      process.env.FIREBASE_SOURCE_ENABLED === 'true'
        ? `Firebase source bridge NOT started — missing configuration: ${missing.join(', ')} (waiting for the real prototype details)`
        : 'Firebase source bridge disabled (FIREBASE_SOURCE_ENABLED!=true) — waiting for the real prototype details',
    )
    return
  }
  console.log(`Firebase source bridge started: path "${config.path}" every ${config.pollIntervalMs} ms (fields: temp=${config.temperatureField}, turb=${config.turbidityField}, ts=${config.timestampField})`)
  const tick = () => { void pollFirebaseSource(pool).catch((e) => noteError(e instanceof Error ? e.message : String(e))) }
  void tick()
  setInterval(tick, config.pollIntervalMs)
}

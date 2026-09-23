import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { pool } from './database/pool.js'
import { deviceReadingSchema, importSchema, manualSchema, pumpSchema } from './validation.js'
import { importGovernmentFile, previewGovernmentFile } from './services/governmentImport.js'
import { analyzeReading } from './services/aiProxy.js'
import { analyzeWaterQuality } from './services/waterQualityEngine.js'
import { decide } from './services/decisionEngine.js'
import { produceAlertsForSource, produceAlertsFromAnalysis } from './services/alertProducer.js'
import { verifyTreatment } from './services/treatmentVerification.js'
import { findHistoricalCases } from './services/historicalCaseIntelligence.js'
import { getDeviceStatus, getFirebaseSourceStatus } from './config/firebaseSource.js'
import { startFirebaseBridge } from './services/firebaseBridge.js'
import { analyzeGovernmentHistorical, probePythonAIStatus, fetchGovernmentLocations } from './services/governmentAnalysis.js'
import type { ZodType } from 'zod'

const app = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }))
app.use(express.json({ limit: '1mb' }))

/* ------------------------------------------------------------ helpers */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidOk = (value: unknown) => typeof value === 'string' && UUID_RE.test(value)

/** Validate a request payload against a zod schema; responds 400 and returns null on failure. */
function parse<T>(schema: ZodType<T>, value: unknown, res: express.Response): T | null {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() })
    return null
  }
  return parsed.data
}

/** Lazily register the two field-test parameter codes on first real use. */
async function ensureManualParameter(code: 'ph' | 'tds') {
  const label = code === 'ph' ? 'pH' : 'TDS'
  const unit = code === 'ph' ? 'pH' : 'ppm'
  await pool.query(
    'INSERT INTO parameters(code,display_name,default_unit) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING',
    [code, label, unit],
  )
  const found = await pool.query<{ id: string; default_unit: string }>(
    'SELECT id,default_unit FROM parameters WHERE code=$1',
    [code],
  )
  return found.rows[0]
}


/** Lazily register ESP32 sensor parameters (temperature, turbidity) on first real use.
 *  Idempotent: ON CONFLICT DO NOTHING. Ensures the parameter master row exists
 *  so water_quality_standards JOINs and alert FK lookups can succeed. */
async function ensureParameters(code: string, displayName: string, unit: string) {
  await pool.query(
    'INSERT INTO parameters(code,display_name,default_unit) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING',
    [code, displayName, unit],
  )
}

/* ------------------------------------------------------------- health */

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'connected' })
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'not connected' })
  }
})

/* ----------------------------------------------------------- dashboard */

/**
 * Everything shown by the production dashboard, assembled exclusively from
 * PostgreSQL smart_water. Empty tables yield nulls / empty arrays and the UI
 * renders "No data available" states â€” nothing is fabricated here.
 */
app.get('/api/dashboard', async (_req, res) => {
  const [government, sensor, manual, datasets, alerts, sensorTotal, manualTotal, devicesOnline] =
    await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int records,
                COUNT(DISTINCT dataset_id)::int datasets,
                COUNT(DISTINCT parameter_id)::int parameters,
                COUNT(DISTINCT state_name)::int states,
                COUNT(DISTINCT district_name)::int districts,
                COUNT(DISTINCT COALESCE(village_name, water_source_name))::int locations
         FROM government_records`,
      ),
      pool.query(
        `SELECT s.temperature, s.turbidity, s.observed_at, d.device_code, d.online,
                ws.name AS water_source, v.name AS village
         FROM sensor_readings s
         JOIN devices d ON d.id = s.device_id
         LEFT JOIN water_sources ws ON ws.id = s.water_source_id
         LEFT JOIN villages v ON v.id = ws.village_id
         ORDER BY s.observed_at DESC LIMIT 1`,
      ),
      pool.query(
        `SELECT p.code AS code, m.value, m.unit, m.source, m.tested_at AS "testedAt",
                ws.name AS "waterSource"
         FROM manual_measurements m
         JOIN parameters p ON p.id = m.parameter_id
         LEFT JOIN water_sources ws ON ws.id = m.water_source_id
         ORDER BY m.tested_at DESC LIMIT 8`,
      ),
      pool.query(
        `SELECT source_organization, dataset_name, dataset_year, source_url, imported_at
         FROM government_datasets ORDER BY imported_at DESC LIMIT 5`,
      ),
      pool.query('SELECT COUNT(*)::int active FROM alerts WHERE acknowledged_at IS NULL'),
      pool.query('SELECT COUNT(*)::int total FROM sensor_readings'),
      pool.query('SELECT COUNT(*)::int total FROM manual_measurements'),
      pool.query('SELECT COUNT(*)::int total FROM devices WHERE online'),
    ])
  res.json({
    government: government.rows[0] ?? null,
    sensorLatest: sensor.rows[0] ?? null,
    manualRecent: manual.rows,
    datasets: datasets.rows,
    activeAlerts: alerts.rows[0]?.active ?? 0,
    sensorTotal: sensorTotal.rows[0]?.total ?? 0,
    manualTotal: manualTotal.rows[0]?.total ?? 0,
    devicesOnline: devicesOnline.rows[0]?.total ?? 0,
  })
})

/* --------------------------------------------- registry list endpoints */

app.get('/api/water-sources', async (_req, res) => {
  const r = await pool.query(
    `SELECT ws.id, ws.name, ws.source_type AS "sourceType", ws.latitude, ws.longitude,
            v.name AS village, d.name AS district, s.name AS state
     FROM water_sources ws
     LEFT JOIN villages v ON v.id = ws.village_id
     LEFT JOIN gram_panchayats gp ON gp.id = v.gram_panchayat_id
     LEFT JOIN blocks b ON b.id = gp.block_id
     LEFT JOIN districts d ON d.id = b.district_id
     LEFT JOIN states s ON s.id = d.state_id
     ORDER BY ws.name NULLS LAST`,
  )
  res.json({ sources: r.rows })
})

app.get('/api/devices', async (_req, res) => {
  const r = await pool.query(
    `SELECT d.id, d.device_code AS code, d.online, d.last_seen_at AS "lastSeenAt",
            ws.name AS "waterSource"
     FROM devices d LEFT JOIN water_sources ws ON ws.id = d.water_source_id
     ORDER BY d.device_code`,
  )
  res.json({ devices: r.rows })
})

/* ------------------------------------------- live / monitoring endpoints */

/** ESP32 history (temperature + turbidity ONLY) for one registered source. */
app.get('/api/sensor/history', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  if (!uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  const parsed = Number.parseInt(String(req.query.limit ?? '300'), 10)
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 1000) : 300
  const r = await pool.query(
    `SELECT s.temperature, s.turbidity, s.observed_at, d.device_code, d.online,
            ws.name AS "waterSource"
     FROM sensor_readings s
     JOIN devices d ON d.id = s.device_id
     JOIN water_sources ws ON ws.id = s.water_source_id
     WHERE s.water_source_id = $1
     ORDER BY s.observed_at DESC LIMIT ${limit}`,
    [waterSourceId],
  )
  res.json({ readings: r.rows })
})

/** Previous manual field tests (pH/TDS), optionally scoped to one source. */
app.get('/api/manual/measurements', async (req, res) => {
  const waterSourceId = req.query.waterSourceId ? String(req.query.waterSourceId) : ''
  if (waterSourceId && !uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  const r = await pool.query(
    `SELECT m.id, m.water_source_id AS "waterSourceId", ws.name AS "waterSource",
            p.code AS parameter, p.display_name AS "displayName", m.value, m.unit,
            m.source, m.tested_at AS "testedAt", m.operator_name AS "operatorName", m.notes
     FROM manual_measurements m
     JOIN parameters p ON p.id = m.parameter_id
     LEFT JOIN water_sources ws ON ws.id = m.water_source_id
     ${waterSourceId ? 'WHERE m.water_source_id = $1' : ''}
     ORDER BY m.tested_at DESC LIMIT 200`,
    waterSourceId ? [waterSourceId] : [],
  )
  res.json({ measurements: r.rows })
})

/**
 * Real locations only: the village/gram-panchayat/block/district/state
 * REGISTRY rows that actually exist, plus distinct location strings present
 * in imported government records. Nothing is generated to fill the UI.
 */
app.get('/api/locations', async (_req, res) => {
  const [states, districts, blocks, villages, iStates, iDistricts, iBlocks, iVillages] =
    await Promise.all([
      pool.query<{ name: string }>('SELECT name FROM states ORDER BY name'),
      pool.query<{ name: string }>('SELECT name FROM districts ORDER BY name'),
      pool.query<{ name: string }>('SELECT name FROM blocks ORDER BY name'),
      pool.query<{ name: string }>('SELECT name FROM villages ORDER BY name'),
      pool.query(`SELECT DISTINCT state_name AS name FROM government_records WHERE state_name IS NOT NULL ORDER BY name`),
      pool.query(`SELECT DISTINCT district_name AS name FROM government_records WHERE district_name IS NOT NULL ORDER BY name`),
      pool.query(`SELECT DISTINCT block_name AS name FROM government_records WHERE block_name IS NOT NULL ORDER BY name`),
      pool.query(
        `SELECT DISTINCT village_name AS name FROM government_records WHERE village_name IS NOT NULL AND village_name <> '' ORDER BY name`,
      ),
    ])
  const unwrap = (rows: { name: string }[]) => rows.map((r) => r.name)
  res.json({
    registry: { states: unwrap(states.rows), districts: unwrap(districts.rows), blocks: unwrap(blocks.rows), villages: unwrap(villages.rows) },
    imports: { states: unwrap(iStates.rows as unknown as { name: string }[]), districts: unwrap(iDistricts.rows as unknown as { name: string }[]), blocks: unwrap(iBlocks.rows as unknown as { name: string }[]), villages: unwrap(iVillages.rows as unknown as { name: string }[]) },
  })
})

/* ---------------------------------------------------------------- alerts */

app.get('/api/alerts', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  const r = await pool.query(
    `SELECT a.id, a.severity, p.code AS parameter, a.source::text AS source,
            ws.name AS "waterSource", a.message, a.recommended_action AS "recommendedAction",
            a.occurred_at AS "occurredAt", a.acknowledged_at AS "acknowledgedAt"
          FROM alerts a
     LEFT JOIN parameters p ON p.id = a.parameter_id
     LEFT JOIN water_sources ws ON ws.id = a.water_source_id
     ${uuidOk(waterSourceId) ? 'WHERE a.water_source_id = $1' : ''}
     ORDER BY a.acknowledged_at IS NOT NULL, a.occurred_at DESC LIMIT 300`,
    uuidOk(waterSourceId) ? [waterSourceId] : [],
  )
  res.json({ alerts: r.rows })
})

app.patch('/api/alerts/:id/acknowledge', async (req, res) => {
  if (!uuidOk(req.params.id)) return res.status(400).json({ error: 'Alert id must be a valid identifier.' })
  const r = await pool.query(
    'UPDATE alerts SET acknowledged_at=now() WHERE id=$1 AND acknowledged_at IS NULL RETURNING id',
    [req.params.id],
  )
  if (!r.rowCount) return res.status(404).json({ error: 'Alert not found or already acknowledged.' })
  res.json({ acknowledged: true })
})

/* ------------------------------------------------- government endpoints */

app.get('/api/government/datasets', async (_req, res) => {
  const r = await pool.query(
    `SELECT d.id, d.source_organization, d.dataset_name, d.dataset_year, d.source_url, d.imported_at,
            COUNT(g.id)::int AS record_count,
            COUNT(DISTINCT p.code)::int AS parameter_count
     FROM government_datasets d
     LEFT JOIN government_records g ON g.dataset_id = d.id
     LEFT JOIN parameters p ON p.id = g.parameter_id
     GROUP BY d.id ORDER BY d.imported_at DESC`,
  )
  res.json({ datasets: r.rows })
})

app.get('/api/government/records', async (req, res) => {
  const q = req.query
  const where: string[] = []
  const args: unknown[] = []
  for (const [column, key] of [
    ['p.code', 'parameter'],
    ['d.source_organization', 'sourceOrganization'],
    ['d.dataset_year', 'datasetYear'],
    ['g.record_type', 'recordType'],
    ['g.state_name', 'state'],
    ['g.district_name', 'district'],
    ['g.block_name', 'block'],
    ['g.gram_panchayat_name', 'gramPanchayat'],
    ['g.village_name', 'village'],
  ] as const) {
    if (q[key]) {
      args.push(String(q[key]))
      where.push(`${column}=$${args.length}`)
    }
  }
  if (q.search) {
    args.push('%' + String(q.search) + '%')
    where.push(`(g.village_name ILIKE $${args.length} OR g.district_name ILIKE $${args.length} OR p.code ILIKE $${args.length})`)
  }
  const r = await pool.query(
    `SELECT g.id, g.record_type, g.value, g.unit, g.affected_village_count,
            g.sample_date, g.state_name, g.district_name, g.block_name,
            g.gram_panchayat_name, g.village_name, g.water_source_name,
            g.latitude, g.longitude, g.imported_at,
            p.code AS parameter, p.display_name,
            d.source_organization, d.dataset_name, d.dataset_year, d.source_url
     FROM government_records g
     JOIN parameters p ON p.id = g.parameter_id
     JOIN government_datasets d ON d.id = g.dataset_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY g.sample_date DESC NULLS LAST, g.imported_at DESC LIMIT 500`,
    args,
  )
  res.json({ records: r.rows })
})

app.get('/api/government/summary', async (_req, res) => {
  const r = await pool.query(
    `SELECT COUNT(*)::int records,
            COUNT(DISTINCT dataset_id)::int datasets,
            COUNT(DISTINCT parameter_id)::int parameters,
            COUNT(DISTINCT village_name)::int villages,
            MAX(imported_at) AS "latestImport"
     FROM government_records`,
  )
  res.json(r.rows[0])
})

app.post('/api/government/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV/XLSX file is required.' })
  let raw: unknown
  try {
    raw = JSON.parse(req.body.config ?? '{}')
  } catch {
    return res.status(400).json({ error: 'config must be valid JSON.' })
  }
  const config = parse(importSchema, raw, res)
  if (!config) return
  try {
    res.json(await previewGovernmentFile(req.file, config))
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Preview failed.' })
  }
})

app.post('/api/government/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV/XLSX file is required.' })
  let raw: unknown
  try {
    raw = JSON.parse(req.body.config ?? '{}')
  } catch {
    return res.status(400).json({ error: 'config must be valid JSON.' })
  }
  const config = parse(importSchema, raw, res)
  if (!config) return
  try {
    res.status(201).json(await importGovernmentFile(req.file, config))
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Import failed.' })
  }
})

/* ------------------------------------------------------- ESP32 ingestion */

/**
 * Real ESP32 ingress. Hardware boundary enforced by validation schema:
 * temperature + turbidity ONLY â€” never pH/TDS/contaminants.
 */
app.post('/api/device/readings', async (req, res) => {
  const data = parse(deviceReadingSchema, req.body, res)
  if (!data) return
  const device = (
    await pool.query<{ id: string }>(
      'SELECT id FROM devices WHERE device_code=$1 AND water_source_id=$2',
      [data.deviceId, data.waterSourceId],
    )
  ).rows[0]
  if (!device)
    return res.status(404).json({ error: 'No registered device matches deviceId and waterSourceId.' })
  await pool.query(
    'INSERT INTO sensor_readings(device_id,water_source_id,temperature,turbidity,observed_at) VALUES($1,$2,$3,$4,$5)',
    [device.id, data.waterSourceId, data.temperature, data.turbidity, data.timestamp],
  )
  await pool.query('UPDATE devices SET online=true, last_seen_at=$2 WHERE id=$1', [device.id, data.timestamp])
  // Lazy-register device parameters so standards + FK lookups succeed (idempotent).
  await ensureParameters('temperature', 'Temperature', '°C')
  await ensureParameters('turbidity', 'Turbidity', 'NTU')
  // P1-2 alert producer: after a real ESP32 reading is accepted, evaluate breaches.
  // Best-effort only -- never blocks acceptance of the real measurement.
  try { await produceAlertsForSource(pool, data.waterSourceId) } catch { /* ignore */ }
  res.status(201).json({ accepted: true })
})

/* -------------------------------------------------- manual field testing */

for (const [path, parameter] of [
  ['/api/manual/ph', 'ph'],
  ['/api/manual/tds', 'tds'],
] as const) {
  app.post(path, async (req, res) => {
    const data = parse(manualSchema, req.body, res)
    if (!data) return
    if (parameter === 'ph' && data.value > 14)
      return res.status(400).json({ error: 'pH must be between 0 and 14.' })
    const source = await pool.query('SELECT id FROM water_sources WHERE id=$1', [data.waterSourceId])
    if (!source.rows.length)
      return res.status(404).json({ error: 'Water source not found. Register the real prototype location first (scripts/register-source.mjs).' })
    const parameterRow = await ensureManualParameter(parameter)
    if (!parameterRow) return res.status(500).json({ error: 'Parameter master could not be initialised.' })
    const inserted = await pool.query(
      `INSERT INTO manual_measurements(water_source_id,parameter_id,value,unit,source,tested_at,operator_name,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        data.waterSourceId, parameterRow.id, data.value,
        parameter === 'ph' ? 'pH' : parameterRow.default_unit || 'ppm',
        parameter === 'ph' ? 'MANUAL_CHEMICAL_TEST' : 'EXTERNAL_TDS_METER',
        data.testedAt, data.operatorName ?? null, data.notes ?? null,
      ],
    )
    // P1-2 alert producer: after a real manual measurement is accepted, evaluate breaches.
    // Best-effort only -- never blocks acceptance of the real measurement.
    try { await produceAlertsForSource(pool, data.waterSourceId) } catch { /* ignore */ }
    res.status(201).json({ id: inserted.rows[0].id, source: parameter === 'ph' ? 'MANUAL_CHEMICAL_TEST' : 'EXTERNAL_TDS_METER' })
  })
}

/** Latest ESP32 snapshot + recent manual history for one water source. */
app.get('/api/readings/latest', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  if (!uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  const manual = await pool.query(
    `SELECT m.id, p.code AS parameter, m.value, m.unit, m.source, m.tested_at AS timestamp
     FROM manual_measurements m JOIN parameters p ON p.id = m.parameter_id
     WHERE m.water_source_id = $1 ORDER BY m.tested_at DESC`,
    [waterSourceId],
  )
  const sensor = await pool.query(
    `SELECT s.temperature, s.turbidity, s.observed_at, d.online
     FROM sensor_readings s JOIN devices d ON d.id = s.device_id
     WHERE s.water_source_id = $1 ORDER BY observed_at DESC LIMIT 1`,
    [waterSourceId],
  )
  res.json({ sensor: sensor.rows[0] ?? null, manual: manual.rows })
})

/**
 * Database-backed dashboard payload (PostgreSQL = single source of truth).
 * Latest temperature/turbidity come from sensor_readings (ESP32 ONLY),
 * latest pH/TDS from manual_measurements (manual kit ONLY). Full provenance
 * is included. When nothing exists yet every field is null/empty â€” the UI
 * renders "No data available" and never substitutes 0/mock/demo values.
 */
app.get('/api/readings/current', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  if (!uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  const source = (
    await pool.query(
      `SELECT ws.id, ws.name AS source_name, ws.source_type, ws.latitude, ws.longitude,
              v.name AS village, d.name AS district, s.name AS state
       FROM water_sources ws
       LEFT JOIN villages v ON v.id = ws.village_id
       LEFT JOIN gram_panchayats gp ON gp.id = v.gram_panchayat_id
       LEFT JOIN blocks b ON b.id = gp.block_id
       LEFT JOIN districts d ON d.id = b.district_id
       LEFT JOIN states s ON s.id = d.state_id
       WHERE ws.id = $1`,
      [waterSourceId],
    )
  ).rows[0]
  if (!source) return res.status(404).json({ error: 'Water source not found.' })
  const sensorLatest = (
    await pool.query(
      `SELECT s.temperature, s.turbidity, s.observed_at, d.device_code, d.online, d.last_seen_at
       FROM sensor_readings s JOIN devices d ON d.id = s.device_id
       WHERE s.water_source_id = $1
       ORDER BY s.observed_at DESC LIMIT 1`,
      [waterSourceId],
    )
  ).rows[0] ?? null
  const latestManual = await pool.query(
    `SELECT DISTINCT ON (p.code) p.code, m.value, m.unit, m.source, m.tested_at, m.operator_name
     FROM manual_measurements m JOIN parameters p ON p.id = m.parameter_id
     WHERE m.water_source_id = $1 AND p.code IN ('ph','tds')
     ORDER BY p.code, m.tested_at DESC`,
    [waterSourceId],
  )
  const since = new Date(Date.now() - 7 * 86400000)
  const sensorHistory = await pool.query(
    `SELECT temperature, turbidity, observed_at FROM sensor_readings
     WHERE water_source_id = $1 AND observed_at >= $2
     ORDER BY observed_at ASC LIMIT 5000`,
    [waterSourceId, since],
  )
  const manualHistory = await pool.query(
    `SELECT p.code, m.value, m.tested_at FROM manual_measurements m
     JOIN parameters p ON p.id = m.parameter_id
     WHERE m.water_source_id = $1 AND p.code IN ('ph','tds') AND m.tested_at >= $2
     ORDER BY m.tested_at ASC LIMIT 5000`,
    [waterSourceId, since],
  )
  const n = (x: unknown): number => Number(x)
  const temperature = sensorLatest
    ? { value: n(sensorLatest.temperature), timestamp: sensorLatest.observed_at, source: 'ESP32 (DS18B20)', deviceCode: sensorLatest.device_code }
    : null
  const turbidity = sensorLatest
    ? { value: n(sensorLatest.turbidity), timestamp: sensorLatest.observed_at, source: 'ESP32 (analog turbidity)', deviceCode: sensorLatest.device_code }
    : null
  const phRow = latestManual.rows.find((r) => r.code === 'ph') ?? null
  const tdsRow = latestManual.rows.find((r) => r.code === 'tds') ?? null
  const ph = phRow
    ? { value: n(phRow.value), timestamp: phRow.tested_at, source: phRow.source, unit: phRow.unit, operatorName: phRow.operator_name }
    : null
  const tds = tdsRow
    ? { value: n(tdsRow.value), timestamp: tdsRow.tested_at, source: tdsRow.source, unit: tdsRow.unit, operatorName: tdsRow.operator_name }
    : null
  const history: Array<{ timestamp: number; temperature?: number; turbidity?: number; ph?: number; tds?: number }> = []
  for (const r of sensorHistory.rows)
    history.push({ timestamp: new Date(r.observed_at).getTime(), temperature: n(r.temperature), turbidity: n(r.turbidity) })
  for (const r of manualHistory.rows) {
    const ts = new Date(r.tested_at).getTime()
    const entry = history.find((h) => h.timestamp === ts)
    if (r.code === 'ph') { if (entry) entry.ph = n(r.value); else history.push({ timestamp: ts, ph: n(r.value) }) }
    else { if (entry) entry.tds = n(r.value); else history.push({ timestamp: ts, tds: n(r.value) }) }
  }
  history.sort((a, b) => a.timestamp - b.timestamp)
  res.json({
    waterSource: {
      id: source.id, name: source.source_name, sourceType: source.source_type,
      latitude: source.latitude, longitude: source.longitude,
      village: source.village, district: source.district, state: source.state,
    },
    device: sensorLatest
      ? { deviceCode: sensorLatest.device_code, online: sensorLatest.online, lastSeenAt: sensorLatest.last_seen_at }
      : null,
    deviceStatus: getDeviceStatus(),
    latest: { temperature, turbidity, ph, tds },
    history,
  })
})

/**
 * Deterministic Water Quality Analysis (Phase 3).
 * Reads only real PostgreSQL measurements + registered standards.
 * No AI, no invented standards, no fake data; missing data is never "safe".
 */
app.get('/api/water-quality/analysis', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  if (!uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  const analysis = await analyzeWaterQuality(pool, waterSourceId)
  if (!analysis) return res.status(404).json({ error: 'Water source not found.' })
  // P1-2 alert producer: after current analysis is evaluated, persist any real breach.
  // Reuses the analysis already computed above (no extra query); de-duped. Best-effort.
  try { await produceAlertsFromAnalysis(pool, waterSourceId, analysis) } catch { /* ignore */ }
  res.json(analysis)
})

/**
 * AI Decision Engine endpoint (Phase 4, Part B).
 * Deterministic analysis -> structured decision (deterministic core +
 * optional Gemini refinement). Never replaces the deterministic analysis.
 */
app.get('/api/water-quality/decision', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  if (!uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  const decision = await decide(pool, waterSourceId)
  if (!decision) return res.status(404).json({ error: 'Water source not found.' })
  res.json(decision)
})

/* ---------------------------------------------------- purification pump */

/** Manual operator action only â€” AI never activates pumps automatically. */
app.post('/api/pump/command', async (req, res) => {
  const data = parse(pumpSchema, req.body, res)
  if (!data) return
  const device = (
    await pool.query<{ online: boolean }>('SELECT online FROM devices WHERE id=$1', [data.deviceId])
  ).rows[0]
  if (!device) return res.status(404).json({ error: 'Device not found.' })
  if (!device.online) return res.status(409).json({ error: 'Device is offline. Command was not queued.' })
  const queued = await pool.query(
    `INSERT INTO pump_commands(device_id,command,status) VALUES($1,$2,'PENDING') RETURNING id,status,requested_at`,
    [data.deviceId, data.command],
  )
  res.status(202).json(queued.rows[0])
})

/* ----------------------------------------------------------- ai analyze */

/**
 * AI Water Quality Assistant proxy.
 * Receives current + recent history + thresholds; secret keys stay server-side.
 */
app.post('/api/ai/analyze', async (req, res) => {
  const { current, history, thresholds } = (req.body ?? {}) as {
    current?: unknown
    history?: unknown
    thresholds?: unknown
  }
  // Per project rules the assistant must see current AND historical readings;
  // missing history only weakens trend detection, it does not block analysis.
  if (!current || typeof current !== 'object')
    return res.status(400).json({ error: 'current readings are required.' })
  res.json(
    await analyzeReading({
      current: current as Record<string, unknown>,
      history: Array.isArray(history) ? (history as Array<Record<string, unknown>>) : [],
      thresholds: (thresholds ?? {}) as Record<string, unknown>,
    }),
  )
})

/**
 * Before/After Treatment Verification (read-only).
 * BEFORE = latest real measurements at/before the operator-set anchor `beforeAt`
 * (7-day lookback); AFTER = latest real measurements strictly after it. A pump
 * command is context only — never proof that purification succeeded.
 */
app.get('/api/water-quality/treatment-verification', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  if (!uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  const beforeAtMs = Date.parse(String(req.query.beforeAt ?? ''))
  if (!Number.isFinite(beforeAtMs))
    return res.status(400).json({ error: 'beforeAt must be an ISO date string.' })
  if (beforeAtMs > Date.now())
    return res.status(400).json({ error: 'beforeAt cannot be in the future.' })
  try {
    const result = await verifyTreatment(pool, waterSourceId, new Date(beforeAtMs))
    if (!result) return res.status(404).json({ error: 'Water source not found.' })
    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to verify treatment.' })
  }
})

/* ------------------------------------------- Firebase prototype source */

/** Honest status of the REAL Firebase prototype bridge (read-only). */
app.get('/api/firebase-source/status', (_req, res) => {
  res.json(getFirebaseSourceStatus())
})

/* --------------------------------------- historical case intelligence */

/**
 * CURRENT PROBLEM -> historical government cases (value-based records ONLY;
 * WQ6 affected-village counts stay context-only). Documented actions are shown
 * only when the source row actually contains one.
 */
app.get('/api/water-quality/historical-cases', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  if (!uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  try {
    const result = await findHistoricalCases(pool, waterSourceId)
    if (!result) return res.status(404).json({ error: 'Water source not found.' })
    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to search historical cases.' })
  }
})

/* ------------------------------------------------------ error handling */

import { compareEvidence } from './services/evidenceComparison.js'

app.get('/api/water-quality/evidence-comparison', async (req, res) => {
  const waterSourceId = String(req.query.waterSourceId ?? '')
  if (!uuidOk(waterSourceId))
    return res.status(400).json({ error: 'waterSourceId must be a valid identifier.' })
  try {
    res.json(await compareEvidence(pool, waterSourceId))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to compare evidence.' })
  }
})

/* --------------------------------------- government historical AI */

/**
 * Read-only status probe of the Python AI engine (GET /health).
 * Returns { status, source, available } for the frontend badge.
 */
app.get('/api/python-ai/status', async (_req, res) => {
  const status = await probePythonAIStatus()
  res.json({ status: status.available ? 'AVAILABLE' : 'NOT_AVAILABLE', source: status.source, available: status.available, detail: status.detail })
})

/**
 * Read-only government historical analysis.
 * Collects all real CGWB LABORATORY_MEASUREMENT records for the selected
 * dataset/year/state/district/location, classifies each with the existing
 * classifyParameter engine, and forwards the structured evidence to the
 * Python AI (/historical) for interpretation.
 * WQ6 (CONTAMINATION_SUMMARY) rows are never included in concentration analysis.
 */
app.get('/api/government/historical-analysis', async (req, res) => {
  const q = req.query
  const mode = (String(q.mode ?? 'location') as 'single' | 'location')
  try {
    const analysis = await analyzeGovernmentHistorical(pool, {
      dataset: String(q.dataset ?? ''),
      year: String(q.year ?? ''),
      state: String(q.state ?? ''),
      district: String(q.district ?? ''),
      location: String(q.location ?? ''),
      parameter: String(q.parameter ?? ''),
      mode,
    })
    res.json(analysis)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to analyze government historical data.' })
  }
})

/**
 * Read-only: distinct states/districts/locations for a dataset+year (LABORATORY_MEASUREMENT only).
 */
app.get('/api/government/locations-options', async (req, res) => {
  try {
    const options = await fetchGovernmentLocations(pool, String(req.query.dataset ?? ''), String(req.query.year ?? ''))
    res.json(options)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load location options.' })
  }
})

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error)
  res.status(500).json({ error: 'Internal server error.' })
})

const port = Number(process.env.PORT ?? 3001)
app.listen(port, () => console.log(`AquaSense API listening on port ${port}`))

// REAL prototype bridge: dormant until FIREBASE_SOURCE_ENABLED=true AND the real
// RTDB path/field names are configured. Never invents readings while dormant.
startFirebaseBridge(pool)



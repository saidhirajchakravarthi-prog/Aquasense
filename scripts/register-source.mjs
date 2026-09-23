/**
 * Register the REAL prototype hierarchy, water source, and device.
 *
 * Operational tooling — inserts NOTHING until an operator runs it with the
 * real location identity. Idempotent: re-running with the same names reuses
 * the existing rows (states are UNIQUE by name; children are find-or-create
 * within their parent). Placeholders and demo values are refused by design.
 *
 * Usage:
 *   node scripts/register-source.mjs \
 *     --state "Bihar" --district "Patna" --block "Danapur" --gp "Dhanuki" \
 *     --village "Real village name" --source-name "Real source name" \
 *     --source-type "Borewell" --device-code "ESP32-001" [--lat 25.61] [--lng 85.13]
 *
 * Prints the waterSourceId to use with POST /api/device/readings,
 * POST /api/manual/ph|tds and GET /api/readings/current.
 */
import 'dotenv/config'
import pg from 'pg'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const req = (name) => {
  const v = arg(name)?.trim()
  if (!v) {
    console.error(`Missing required --${name} (use the REAL value; placeholders are refused).`)
    process.exit(1)
  }
  return v
}

const state = req('state')
const district = req('district')
const block = req('block')
const gp = req('gp')
const village = req('village')
const sourceName = req('source-name')
const sourceType = req('source-type')
const deviceCode = req('device-code')
const lat = arg('lat') !== undefined ? Number(arg('lat')) : null
const lng = arg('lng') !== undefined ? Number(arg('lng')) : null
if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) { console.error('--lat must be a number in [-90, 90].'); process.exit(1) }
if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) { console.error('--lng must be a number in [-180, 180].'); process.exit(1) }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

try {
  let r = await pool.query('SELECT id FROM states WHERE name=$1', [state])
  const stateId = r.rows[0]?.id ?? (await pool.query('INSERT INTO states(name) VALUES($1) RETURNING id', [state])).rows[0].id
  r = await pool.query('SELECT id FROM districts WHERE state_id=$1 AND name=$2', [stateId, district])
  const districtId = r.rows[0]?.id ?? (await pool.query('INSERT INTO districts(state_id,name) VALUES($1,$2) RETURNING id', [stateId, district])).rows[0].id
  r = await pool.query('SELECT id FROM blocks WHERE district_id=$1 AND name=$2', [districtId, block])
  const blockId = r.rows[0]?.id ?? (await pool.query('INSERT INTO blocks(district_id,name) VALUES($1,$2) RETURNING id', [districtId, block])).rows[0].id
  r = await pool.query('SELECT id FROM gram_panchayats WHERE block_id=$1 AND name=$2', [blockId, gp])
  const gpId = r.rows[0]?.id ?? (await pool.query('INSERT INTO gram_panchayats(block_id,name) VALUES($1,$2) RETURNING id', [blockId, gp])).rows[0].id
  r = await pool.query('SELECT id FROM villages WHERE gram_panchayat_id=$1 AND name=$2', [gpId, village])
  const villageId = r.rows[0]?.id ?? (await pool.query('INSERT INTO villages(gram_panchayat_id,name,latitude,longitude) VALUES($1,$2,$3,$4) RETURNING id', [gpId, village, lat, lng])).rows[0].id
  r = await pool.query('SELECT id FROM water_sources WHERE village_id=$1 AND name=$2', [villageId, sourceName])
  const sourceId = r.rows[0]?.id ?? (await pool.query('INSERT INTO water_sources(village_id,name,source_type,latitude,longitude) VALUES($1,$2,$3,$4,$5) RETURNING id', [villageId, sourceName, sourceType, lat, lng])).rows[0].id
  const dev = await pool.query('SELECT id, water_source_id FROM devices WHERE device_code=$1', [deviceCode])
  let deviceId
  if (dev.rows.length) {
    deviceId = dev.rows[0].id
    if (dev.rows[0].water_source_id !== sourceId) {
      await pool.query('UPDATE devices SET water_source_id=$2 WHERE id=$1', [deviceId, sourceId])
      console.log(`Device ${deviceCode} already existed — re-pointed to water source "${sourceName}".`)
    } else {
      console.log(`Device ${deviceCode} already existed — unchanged.`)
    }
  } else {
    deviceId = (await pool.query('INSERT INTO devices(device_code,water_source_id,online) VALUES($1,$2,false) RETURNING id', [deviceCode, sourceId])).rows[0].id
  }
  console.log('REGISTERED (real data):')
  console.log(JSON.stringify({ stateId, districtId, blockId, gpId, villageId, waterSourceId: sourceId, deviceId, deviceCode }, null, 2))
  console.log(`\nwaterSourceId for the APIs: ${sourceId}`)
  await pool.end()
} catch (e) {
  console.error('REGISTRATION FAILED:', e instanceof Error ? e.message : e)
  await pool.end().catch(() => {})
  process.exit(1)
}
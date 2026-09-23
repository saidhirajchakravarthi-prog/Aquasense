// Simple read-only verification utility: counts rows in the production tables.
import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const tables = [
  'government_datasets',
  'government_records',
  'sensor_readings',
  'manual_measurements',
  'parameters',
  'water_sources',
  'devices',
  'villages',
  'alerts',
  'pump_commands',
  'ai_analyses',
]

const result = {}
for (const table of tables) {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`)
    result[table] = r.rows[0].count
  } catch (error) {
    result[table] = -1
    console.error(`Could not query ${table}:`, error instanceof Error ? error.message : error)
  }
}
console.log(JSON.stringify(result, null, 2))
await pool.end()

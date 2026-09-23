const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:1966@localhost:5432/smart_water' });

async function main() {
  const r = await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1', ['government_records']);
  console.log('Columns:', r.rows.map(x => x.column_name).join('\n'));
  
  const locs = await pool.query(`
    SELECT d.dataset_name, d.dataset_year, g.state_name, g.district_name, COALESCE(g.village_name, g.water_source_name) as loc, COUNT(*) as cnt
    FROM government_records g JOIN government_datasets d ON d.id = g.dataset_id
    WHERE g.record_type = 'LABORATORY_MEASUREMENT'
    GROUP BY d.dataset_name, d.dataset_year, g.state_name, g.district_name, loc
    ORDER BY cnt DESC LIMIT 5
  `);
  console.log('\nTop CGWB locations with lab measurements:');
  console.log(locs.rows);
  
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

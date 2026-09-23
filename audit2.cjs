const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1966@localhost:5432/smart_water' });

async function audit() {
  const client = await pool.connect();
  try {
    // Government records columns
    const cols = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'government_records' ORDER BY ordinal_position`);
    console.log('government_records columns:');
    cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));
    
    // Distinct parameter_ids
    const params = await client.query('SELECT COUNT(DISTINCT parameter_id) as cnt FROM government_records');
    console.log('\nDistinct parameter_ids:', params.rows[0].cnt);
    
    // Sample records from CGWB 2022
    console.log('\nSample CGWB 2022 records:');
    const samples = await client.query(`SELECT * FROM government_records WHERE dataset_id = 'c66e63d7-541a-4fdc-8666-ad4d3e9ce5ba' LIMIT 5`);
    samples.rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
    
    // Check for source_file / source_page / source_serial
    console.log('\nChecking source columns in CGWB 2022:');
    const sourceInfo = await client.query(`SELECT DISTINCT source_file, source_page, source_serial FROM government_records WHERE dataset_id = 'c66e63d7-541a-4fdc-8666-ad4d3e9ce5ba' LIMIT 10`);
    sourceInfo.rows.forEach(r => console.log(JSON.stringify(r)));
    
    // Count distinct locations in CGWB 2022
    const locations = await client.query(`SELECT COUNT(DISTINCT village_name) as villages, COUNT(DISTINCT district_name) as districts, COUNT(DISTINCT state_name) as states FROM government_records WHERE dataset_id = 'c66e63d7-541a-4fdc-8666-ad4d3e9ce5ba'`);
    console.log('\nCGWB 2022 distinct locations:');
    console.log('  States:', locations.rows[0].states);
    console.log('  Districts:', locations.rows[0].districts);
    console.log('  Villages:', locations.rows[0].villages);
    
  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(e => { console.error(e); process.exit(1); });

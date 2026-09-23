const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1966@localhost:5432/smart_water' });

async function audit() {
  const client = await pool.connect();
  try {
    // Distinct locations in CGWB 2022
    const locations = await client.query(`SELECT COUNT(DISTINCT village_name) as villages, COUNT(DISTINCT district_name) as districts, COUNT(DISTINCT state_name) as states FROM government_records WHERE dataset_id = 'c66e63d7-541a-4fdc-8666-ad4d3e9ce5ba'`);
    console.log('CGWB 2022 distinct locations:');
    console.log('  States:', locations.rows[0].states);
    console.log('  Districts:', locations.rows[0].districts);
    console.log('  Villages:', locations.rows[0].villages);
    
    // Check for Jharkhand/Bokaro/Baramasia
    const jharkhand = await client.query(`SELECT COUNT(*) as cnt FROM government_records WHERE dataset_id = 'c66e63d7-541a-4fdc-8666-ad4d3e9ce5ba' AND state_name = 'Jharkhand' AND district_name = 'Bokaro' AND village_name = 'Baramasia'`);
    console.log('\nJharkhand/Bokaro/Baramasia records:', jharkhand.rows[0].cnt);
    
    // Check the routes in App.tsx
    console.log('\n=== ROUTE VERIFICATION ===');
    console.log('Need to check App.tsx for /government vs /government-data routes');
    
  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(e => { console.error(e); process.exit(1); });

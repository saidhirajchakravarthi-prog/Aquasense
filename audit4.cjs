const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1966@localhost:5432/smart_water' });

async function audit() {
  const client = await pool.connect();
  try {
    // Check for any other government-related tables
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%government%' OR table_name LIKE '%cgwb%' OR table_name LIKE '%wqm%'`);
    console.log('Government-related tables:');
    tables.rows.forEach(r => console.log(`  ${r.table_name}`));
    
    // Check import_errors for any issues
    const errors = await client.query(`SELECT * FROM import_errors LIMIT 10`);
    console.log('\nImport errors:', errors.rowCount);
    errors.rows.forEach(e => console.log(`  ${e.job_id}: ${e.error_message}`));
    
    // Check the actual CGWB 2022 data structure
    // How many distinct parameters are there?
    const params = await client.query(`SELECT p.display_name, COUNT(*) as cnt FROM government_records gr JOIN parameters p ON gr.parameter_id = p.id WHERE gr.dataset_id = 'c66e63d7-541a-4fdc-8666-ad4d3e9ce5ba' GROUP BY p.display_name ORDER BY cnt DESC`);
    console.log('\nParameters in CGWB 2022:');
    params.rows.forEach(p => console.log(`  ${p.display_name}: ${p.cnt}`));
    
    // Check if there's a raw/source table
    const rawTables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%raw%' OR table_name LIKE '%source%' OR table_name LIKE '%extract%')`);
    console.log('\nRaw/source tables:');
    rawTables.rows.forEach(r => console.log(`  ${r.table_name}`));
    
  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(e => { console.error(e); process.exit(1); });

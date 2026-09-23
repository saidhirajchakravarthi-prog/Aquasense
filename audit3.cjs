const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1966@localhost:5432/smart_water' });

async function audit() {
  const client = await pool.connect();
  try {
    // Distinct original_row_reference in CGWB 2022
    const distinctRows = await client.query(`SELECT COUNT(DISTINCT original_row_reference) as cnt FROM government_records WHERE dataset_id = 'c66e63d7-541a-4fdc-8666-ad4d3e9ce5ba'`);
    console.log('CGWB 2022 distinct original rows:', distinctRows.rows[0].cnt);
    
    // Parameters per row
    const paramsPerRow = await client.query(`SELECT original_row_reference, COUNT(*) as param_count FROM government_records WHERE dataset_id = 'c66e63d7-541a-4fdc-8666-ad4d3e9ce5ba' GROUP BY original_row_reference LIMIT 10`);
    console.log('\nParameters per original row (sample):');
    paramsPerRow.rows.forEach(r => console.log(`  ${r.original_row_reference}: ${r.param_count} params`));
    
    // Check for any CGWB 2023 data
    const cgwb2023 = await client.query(`SELECT * FROM government_datasets WHERE dataset_name LIKE '%2023%'`);
    console.log('\nCGWB 2023 datasets found:', cgwb2023.rowCount);
    cgwb2023.rows.forEach(d => console.log(`  ${d.dataset_name} (${d.dataset_year})`));
    
    // Check import_jobs for any 2023 imports
    const importJobs = await client.query(`SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 10`);
    console.log('\nRecent import jobs:');
    importJobs.rows.forEach(j => console.log(`  ${j.id}: ${j.dataset_name} (${j.status}) - ${j.created_at}`));
    
    // Check for any other CGWB datasets
    const cgwbDatasets = await client.query(`SELECT * FROM government_datasets WHERE source_organization LIKE '%CGWB%'`);
    console.log('\nAll CGWB datasets:');
    cgwbDatasets.rows.forEach(d => console.log(`  ${d.dataset_name} (${d.dataset_year}) - ${d.record_count || 'undefined'} records`));
    
  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(e => { console.error(e); process.exit(1); });

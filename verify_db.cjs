const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1966@localhost:5432/smart_water' });

async function audit() {
  const client = await pool.connect();
  try {
    console.log('=== CURRENT DATABASE STATE ===\n');
    
    // Government datasets
    const datasets = await client.query('SELECT * FROM government_datasets ORDER BY dataset_name');
    console.log('Government datasets:', datasets.rowCount);
    datasets.rows.forEach(d => console.log(`  ${d.dataset_name} (${d.dataset_year}) - ID: ${d.id}`));
    
    // Government records count
    const total = await client.query('SELECT COUNT(*) as cnt FROM government_records');
    console.log('\nTotal government records:', total.rows[0].cnt);
    
    // Records by dataset
    const byDataset = await client.query(`SELECT gd.dataset_name, COUNT(*) as cnt FROM government_records gr JOIN government_datasets gd ON gr.dataset_id = gd.id GROUP BY gd.dataset_name ORDER BY gd.dataset_name`);
    console.log('\nRecords by dataset:');
    byDataset.rows.forEach(r => console.log(`  ${r.dataset_name}: ${r.cnt}`));
    
    // Records by type
    const byType = await client.query('SELECT record_type, COUNT(*) as cnt FROM government_records GROUP BY record_type');
    console.log('\nRecords by type:');
    byType.rows.forEach(r => console.log(`  ${r.record_type}: ${r.cnt}`));
    
    // Distinct parameters
    const params = await client.query('SELECT COUNT(DISTINCT parameter_id) as cnt FROM government_records');
    console.log('\nDistinct parameters:', params.rows[0].cnt);
    
    // Import jobs
    const jobs = await client.query('SELECT * FROM import_jobs ORDER BY created_at');
    console.log('\nImport jobs:', jobs.rowCount);
    jobs.rows.forEach(j => console.log(`  ${j.id}: ${j.status} - ${j.created_at}`));
    
    // Import errors
    const errors = await client.query('SELECT COUNT(*) as cnt FROM import_errors');
    console.log('\nImport errors:', errors.rows[0].cnt);
    
  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(e => { console.error(e); process.exit(1); });

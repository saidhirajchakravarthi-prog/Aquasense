const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1966@localhost:5432/smart_water' });
async function audit() {
  const client = await pool.connect();
  try {
    console.log('=== DATABASE AUDIT ===\n');
    
    // Government datasets
    console.log('=== GOVERNMENT DATASETS ===');
    const datasets = await client.query('SELECT * FROM government_datasets ORDER BY imported_at');
    console.log('Count:', datasets.rowCount);
    datasets.rows.forEach(d => {
      console.log('  ID: ' + d.id);
      console.log('    Name: ' + d.dataset_name);
      console.log('    Org: ' + d.source_organization);
      console.log('    Year: ' + d.dataset_year);
      console.log('    Imported: ' + d.imported_at);
      console.log('');
    });
    
    // Government records count
    console.log('=== GOVERNMENT RECORDS ===');
    const totalRecords = await client.query('SELECT COUNT(*) as cnt FROM government_records');
    console.log('Total records:', totalRecords.rows[0].cnt);
    
    // Records by dataset
    console.log('\nRecords by dataset:');
    const byDataset = await client.query(`
      SELECT gd.id, gd.dataset_name, gd.dataset_year, COUNT(*) as cnt 
      FROM government_records gr 
      JOIN government_datasets gd ON gr.dataset_id = gd.id 
      GROUP BY gd.id, gd.dataset_name, gd.dataset_year 
      ORDER BY gd.dataset_name
    `);
    byDataset.rows.forEach(r => console.log('  ' + r.dataset_name + ' (' + r.dataset_year + '): ' + r.cnt));
    
    // Records by type
    console.log('\nRecords by type:');
    const byType = await client.query('SELECT record_type, COUNT(*) as cnt FROM government_records GROUP BY record_type ORDER BY record_type');
    byType.rows.forEach(r => console.log('  ' + r.record_type + ': ' + r.cnt));
    
    // Distinct parameters via parameter_id
    const paramIds = await client.query('SELECT COUNT(DISTINCT parameter_id) as cnt FROM government_records WHERE parameter_id IS NOT NULL');
    console.log('\nDistinct parameter_ids:', paramIds.rows[0].cnt);
    
    // Distinct original_row_reference per dataset
    console.log('\n=== DISTINCT ORIGINAL ROW REFERENCES ===');
    const origRows = await client.query(`
      SELECT gd.dataset_name, COUNT(DISTINCT gr.original_row_reference) as cnt 
      FROM government_records gr 
      JOIN government_datasets gd ON gr.dataset_id = gd.id 
      WHERE gr.original_row_reference IS NOT NULL
      GROUP BY gd.dataset_name
    `);
    origRows.rows.forEach(r => console.log('  ' + r.dataset_name + ': ' + r.cnt + ' distinct original_row_references'));
    
    // Import jobs
    console.log('\n=== IMPORT JOBS ===');
    const jobs = await client.query('SELECT * FROM import_jobs ORDER BY created_at');
    console.log('Count:', jobs.rowCount);
    jobs.rows.forEach(j => {
      console.log('  ID: ' + j.id);
      console.log('    Status: ' + j.status);
      console.log('    Dataset: ' + j.dataset_id);
      console.log('    Created: ' + j.created_at);
      console.log('');
    });
    
    // Import errors
    console.log('\n=== IMPORT ERRORS ===');
    const errors = await client.query('SELECT COUNT(*) as cnt FROM import_errors');
    console.log('Count:', errors.rows[0].cnt);
    
    // Check for duplicates in government_records
    console.log('\n=== DUPLICATE CHECK ===');
    const dupes = await client.query(`
      SELECT dataset_id, parameter_id, original_row_reference, COUNT(*) as cnt
      FROM government_records
      WHERE original_row_reference IS NOT NULL
      GROUP BY dataset_id, parameter_id, original_row_reference
      HAVING COUNT(*) > 1
      LIMIT 10
    `);
    console.log('Duplicate groups (same dataset+parameter+original_row):', dupes.rowCount);
    dupes.rows.forEach(r => console.log('  dataset=' + r.dataset_id + ' param=' + r.parameter_id + ' row=' + r.original_row_reference + ' count=' + r.cnt));
    
    // CGWB 2023 sample
    console.log('\n=== CGWB 2023 SAMPLE ===');
    const sample2023 = await client.query(`
      SELECT gr.parameter_id, p.display_name, gr.value, gr.unit, gr.village_name, gr.district_name, gr.state_name, gr.original_row_reference
      FROM government_records gr
      JOIN government_datasets gd ON gr.dataset_id = gd.id
      LEFT JOIN parameters p ON gr.parameter_id = p.id
      WHERE gd.dataset_year = '2023' AND gr.record_type = 'LABORATORY_MEASUREMENT'
      LIMIT 10
    `);
    sample2023.rows.forEach(r => console.log('  state=' + r.state_name + ' district=' + r.district_name + ' village=' + r.village_name + ' param=' + r.display_name + ' value=' + r.value + ' unit=' + r.unit));
    
    // Find a location with multiple parameters for CGWB 2023
    console.log('\n=== CGWB 2023 LOCATION WITH MOST PARAMETERS ===');
    const location2023 = await client.query(`
      SELECT gr.state_name, gr.district_name, gr.village_name, COUNT(*) as param_count
      FROM government_records gr
      JOIN government_datasets gd ON gr.dataset_id = gd.id
      WHERE gd.dataset_year = '2023' AND gr.record_type = 'LABORATORY_MEASUREMENT'
      GROUP BY gr.state_name, gr.district_name, gr.village_name
      ORDER BY param_count DESC
      LIMIT 5
    `);
    location2023.rows.forEach(r => console.log('  state=' + r.state_name + ' district=' + r.district_name + ' village=' + r.village_name + ' params=' + r.param_count));
    
  } finally {
    client.release();
    await pool.end();
  }
}
audit().catch(e => { console.error(e); process.exit(1); });
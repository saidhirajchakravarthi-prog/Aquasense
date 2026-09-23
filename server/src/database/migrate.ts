import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pool } from './pool.js'
const directory=join(process.cwd(),'database','migrations')
try { await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'); const done=new Set((await pool.query<{filename:string}>('SELECT filename FROM schema_migrations')).rows.map(x=>x.filename)); for(const name of (await readdir(directory)).filter(x=>x.endsWith('.sql')).sort()){if(done.has(name))continue;await pool.query('BEGIN');try{await pool.query(await readFile(join(directory,name),'utf8'));await pool.query('INSERT INTO schema_migrations(filename) VALUES($1)',[name]);await pool.query('COMMIT');console.log(`Applied ${name}`)}catch(error){await pool.query('ROLLBACK');throw error}} } finally { await pool.end() }

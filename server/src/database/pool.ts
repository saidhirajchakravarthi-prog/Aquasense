import 'dotenv/config'
import { Pool } from 'pg'
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized:false } : undefined })

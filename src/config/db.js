import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // полезные таймауты
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  max: 10,
});

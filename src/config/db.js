// src/config/db.js
import pg from 'pg';

const { Pool } = pg;

/**
 * Tempasi — ESM db config.
 *
 * Important:
 * - the project is "type":"module" → this file is used by ESM code
 * - if no host is set, pg will try a unix socket:
 *   /var/run/postgresql/.s.PGSQL.5432 → ENOENT
 * So by default we use TCP: 127.0.0.1:5432
 */

const DATABASE_URL = process.env.DATABASE_URL || '';

function makeConfig() {
  if (DATABASE_URL) {
    return {
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    };
  }
  console.log('[db] using DATABASE_URL?', Boolean(DATABASE_URL));
  console.log(
    '[db] PGHOST/PGPORT/PGDATABASE:',
    process.env.PGHOST,
    process.env.PGPORT,
    process.env.PGDATABASE,
  );
  console.log('[db] DATABASE_URL:', DATABASE_URL);

  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'aleks',
    password: process.env.PGPASSWORD || 'aleks_password_strong',
    database: process.env.PGDATABASE || 'tempasi',
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  };
}

export const pool = new Pool(makeConfig());

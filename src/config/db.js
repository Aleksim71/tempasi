// src/config/db.js
import pg from 'pg';

const { Pool } = pg;

/**
 * Tempasi — ESM db config.
 *
 * Важно:
 * - проект "type":"module" → этот файл используется ESM-кодом
 * - если не задать host, pg попробует unix-socket:
 *   /var/run/postgresql/.s.PGSQL.5432 → ENOENT
 * Поэтому по умолчанию используем TCP: 127.0.0.1:5432
 */

const DATABASE_URL = process.env.DATABASE_URL || '';

function makeConfig() {
  if (DATABASE_URL) {
    return {
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    };
  }

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

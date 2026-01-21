// src/db/pool.js
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildConfig() {
  // Приоритет: DATABASE_URL, иначе PG* переменные
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    };
  }

  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: num(process.env.PGPORT, 5432),
    database: process.env.PGDATABASE ?? 'tempasi_dev',
    user: process.env.PGUSER ?? 'tempasi',
    password: process.env.PGPASSWORD ?? '',
  };
}

const cfg = buildConfig();

export const pool = new Pool({
  ...cfg,
  max: num(process.env.PGPOOL_MAX, 10),
  idleTimeoutMillis: num(process.env.PGPOOL_IDLE_MS, 30_000),
  connectionTimeoutMillis: num(process.env.PGPOOL_CONN_MS, 5_000),
});

// Dev: один раз показываем, куда реально подключились
if (process.env.NODE_ENV !== 'production') {
  pool
    .query('select current_database() as db, current_user as usr, current_schema() as schema')
    .then((r) => {
       
      console.log('[db] connected:', r.rows?.[0]);
    })
    .catch((e) => {
       
      console.error('[db] connection check failed:', e?.message || e);
    });
}

process.on('SIGTERM', async () => {
  try {
    await pool.end();
  } catch {
    // ignore
  }
});

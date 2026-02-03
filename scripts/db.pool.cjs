'use strict';

/**
 * scripts/db.pool.cjs
 * Singleton pg Pool helper.
 *
 * ✅ IMPORTANT:
 * Many tests start a "real server" in a separate Node process (not under Jest),
 * so JEST_WORKER_ID/NODE_ENV=test may be missing there.
 *
 * Therefore priority is:
 * 1) DATABASE_URL_TEST (if provided)  <-- ALWAYS wins
 * 2) DATABASE_URL
 * 3) PG* env fallback
 */

const pg = require('pg');
const { Pool } = pg;

let _pool = null;
let _cfgKey = null;

function buildConfig() {
  // ✅ ALWAYS prefer DATABASE_URL_TEST when it exists
  if (process.env.DATABASE_URL_TEST) {
    return { connectionString: process.env.DATABASE_URL_TEST };
  }

  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  // PG* fallback
  const host = process.env.PGHOST || '127.0.0.1';
  const port = Number(process.env.PGPORT || 5432);
  const user = process.env.PGUSER || 'postgres';
  const database = process.env.PGDATABASE || 'postgres';
  const password = process.env.PGPASSWORD || '';
  const ssl = process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false;

  return { host, port, user, database, password, ssl };
}

function configKey(cfg) {
  if (cfg.connectionString) return `url:${cfg.connectionString}`;
  return `pg:${cfg.host}:${cfg.port}:${cfg.user}:${cfg.database}:${Boolean(cfg.ssl)}`;
}

function getPool() {
  const cfg = buildConfig();
  const key = configKey(cfg);

  if (_pool && _cfgKey === key) return _pool;

  // If config changed, recreate pool (useful for tests)
  if (_pool) {
    try {
      _pool.end().catch(() => {});
    } catch {
      // ignore
    }
    _pool = null;
    _cfgKey = null;
  }

  _pool = new Pool({
    ...cfg,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_MS || 10_000),
    connectionTimeoutMillis: Number(process.env.PGPOOL_CONN_TIMEOUT_MS || 2_000),
  });

  _cfgKey = key;
  return _pool;
}

module.exports = { getPool };

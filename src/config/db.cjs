// src/config/db.cjs
/* eslint-env node */
'use strict';

const pg = require('pg');
const { Pool } = pg;

/**
 * Tempasi — CommonJS db config.
 *
 * Важно:
 * - проект "type":"module", но B12-модули на .cjs → им нужен CJS db
 * - если подключаться без host, pg может уйти в unix-socket:
 *   /var/run/postgresql/.s.PGSQL.5432 → ENOENT
 *
 * Правило приоритета:
 * 1) Если есть явные PG* переменные (PGHOST/PGUSER/PGDATABASE/PGPORT/PGPASSWORD) — используем TCP-конфиг.
 * 2) Иначе, если есть DATABASE_URL — используем connectionString.
 * 3) Иначе fallback на 127.0.0.1 + дефолты.
 */

function hasPgEnv() {
  return Boolean(
    process.env.PGHOST ||
      process.env.PGPORT ||
      process.env.PGUSER ||
      process.env.PGDATABASE ||
      process.env.PGPASSWORD
  );
}

function makeConfig() {
  const databaseUrl = ((process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) ? (process.env.DATABASE_URL_TEST || process.env.DATABASE_URL) : process.env.DATABASE_URL) || '';

  // 1) PG* env → TCP
  if (hasPgEnv()) {
    return {
      __mode: 'PG*',
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'tempasi',
      password: process.env.PGPASSWORD || 'tempasi',
      database: process.env.PGDATABASE || 'tempasi_dev',
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    };
  }

  // 2) DATABASE_URL → только если PG* не задан
  if (databaseUrl) {
    return {
      __mode: 'DATABASE_URL',
      connectionString: databaseUrl,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    };
  }

  // 3) fallback
  return {
    __mode: 'fallback',
    host: '127.0.0.1',
    port: 5433,
    user: 'tempasi',
    password: 'tempasi',
    database: 'tempasi_dev',
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  };
}

const cfg = makeConfig();

console.log('[DB:CJS] using', {
  file: 'src/config/db.cjs',
  mode: cfg.__mode || (cfg.connectionString ? 'DATABASE_URL' : 'PG*'),
  hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  database: cfg.database,
  ssl: Boolean(cfg.ssl),
});

const { __mode, ...poolCfg } = cfg;
const pool = new Pool(poolCfg);

module.exports = { pool };

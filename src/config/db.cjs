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
 * 1) Если есть явные PG* переменные (PGHOST/PGUSER/PGDATABASE) — используем TCP-конфиг (Docker port 5432).
 * 2) Иначе, если есть DATABASE_URL — используем connectionString.
 * 3) Иначе fallback на 127.0.0.1:5432 + дефолты.
 */

function hasPgEnv() {
  return Boolean(process.env.PGHOST || process.env.PGUSER || process.env.PGDATABASE);
}

function makeConfig() {
  const databaseUrl = process.env.DATABASE_URL || '';

  // 1) PG* env → всегда TCP
  if (hasPgEnv()) {
    return {
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'aleks',
      password: process.env.PGPASSWORD || 'aleks_password_strong',
      database: process.env.PGDATABASE || 'tempasi',
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    };
  }

  // 2) DATABASE_URL → только если PG* не задан
  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    };
  }

  // 3) fallback
  return {
    host: '127.0.0.1',
    port: 5433,
    user: 'tempasi',
    password: 'tempasi',
    database: 'tempasi_tempasi',
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  };
}

const cfg = makeConfig();

console.log('[DB:CJS] using', {
  file: 'src/config/db.cjs',
  mode: cfg.connectionString ? 'DATABASE_URL' : 'PG*',
  hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  database: cfg.database,
  ssl: Boolean(cfg.ssl),
});

const pool = new Pool(cfg);

module.exports = { pool };

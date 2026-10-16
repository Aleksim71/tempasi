// src/config/env.cjs
'use strict';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

function loadDotenv() {
  // Important: load .env as early and predictably as possible
  const root = path.resolve(__dirname, '..', '..');

  const candidates = [
    path.join(root, '.env.local'),
    path.join(root, '.env'),
  ];

  let loaded = false;

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const res = dotenv.config({ path: p });
      if (!res.error) loaded = true;
      // if there's an error, don't crash — it'll be visible in the logs below
    }
  }

  return { root, loaded };
}

const { root, loaded } = loadDotenv();

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pick(v, fallback) {
  return (typeof v === 'string' && v.trim() !== '') ? v.trim() : fallback;
}

const NODE_ENV = pick(process.env.NODE_ENV, 'development');

// Priority: DATABASE_URL > PG* variables > defaults
const DATABASE_URL = pick(process.env.DATABASE_URL, '');

const PGHOST = pick(process.env.PGHOST, '127.0.0.1');
const PGPORT = toInt(process.env.PGPORT, 5433);
const PGUSER = pick(process.env.PGUSER, 'tempasi');
const PGPASSWORD = pick(process.env.PGPASSWORD, 'tempasi');
const PGDATABASE = pick(process.env.PGDATABASE, 'tempasi_dev');

// Handy to see in the logs what actually got picked up
const debug = {
  root,
  dotenvLoaded: loaded,
  mode: DATABASE_URL ? 'DATABASE_URL' : 'PG*',
  hasDatabaseUrl: Boolean(DATABASE_URL),
  host: DATABASE_URL ? '(from url)' : PGHOST,
  port: DATABASE_URL ? '(from url)' : PGPORT,
  user: DATABASE_URL ? '(from url)' : PGUSER,
  database: DATABASE_URL ? '(from url)' : PGDATABASE,
};

module.exports = {
  NODE_ENV,

  DATABASE_URL,

  PGHOST,
  PGPORT,
  PGUSER,
  PGPASSWORD,
  PGDATABASE,

  debug,
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

function mustGetTestDbUrl() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  return url;
}

async function withDb(fn) {
  const client = new Client({ connectionString: mustGetTestDbUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function migrateDb() {
  const migrationsDir = path.resolve(process.cwd(), 'src', 'db', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  await withDb(async (db) => {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      if (sql.trim()) await db.query(sql);
    }
  });
}

async function safeTruncate() {
  await withDb(async (db) => {
    const tables = ['entitlements', 'orders', 'sessions', 'users'];

    for (const t of tables) {
      const r = await db.query(`SELECT to_regclass($1) AS name`, [`public.${t}`]);
      const exists = r.rows[0] && r.rows[0].name;
      if (!exists) continue;
      await db.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
    }
  });
}

module.exports = {
  withDb,
  migrateDb,
  safeTruncate,
};

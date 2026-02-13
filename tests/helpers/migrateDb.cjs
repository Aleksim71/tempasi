// tests/helpers/migrateDb.cjs
/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');
const pg = require('pg');

function resolveMigrationsDir() {
  const candidates = [
    path.resolve(process.cwd(), 'src/db/migrations'),
    path.resolve(process.cwd(), 'db/migrations'),
    path.resolve(process.cwd(), 'src/migrations'),
    path.resolve(process.cwd(), 'migrations'),
  ];

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch (_e) {
      // continue
    }
  }

  throw new Error(
    `[migrateDb] Cannot find migrations directory. Tried:\n` + candidates.join('\n'),
  );
}

function listSqlMigrations(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.sql'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    throw new Error(`[migrateDb] No .sql migrations found in: ${dir}`);
  }

  return files.map((f) => path.join(dir, f));
}

async function execSqlFile(db, filepath) {
  const sql = fs.readFileSync(filepath, 'utf8');
  if (!sql.trim()) return;
  await db.query(sql);
}

async function resetPublicSchema(db) {
  await db.query('DROP SCHEMA IF EXISTS public CASCADE;');
  await db.query('CREATE SCHEMA public;');
  await db.query('GRANT ALL ON SCHEMA public TO public;');
}

async function ensureExtensions(db) {
  await db.query('CREATE EXTENSION IF NOT EXISTS citext;');
}

/**
 * IMPORTANT:
 * Some migrations (e.g. orders/entitlements) may reference users table.
 * So we must ensure users exists BEFORE applying migrations.
 */
async function ensureUsersTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id bigserial PRIMARY KEY,
      email text,
      password_hash text,
      role text NOT NULL DEFAULT 'user',
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.query(`
    DO $$
    BEGIN
      CREATE UNIQUE INDEX users_email_uniq ON users (email);
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

async function ensureEntitlementsKind(db) {
  await db.query(`
    ALTER TABLE entitlements
      ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'buy';
  `);

  await db.query(`
    DO $$
    BEGIN
      ALTER TABLE entitlements
        ADD CONSTRAINT entitlements_kind_check CHECK (kind IN ('buy', 'rent'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

async function ensureOrdersDealType(db) {
  await db.query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS deal_type text NOT NULL DEFAULT 'BUY';
  `);

  await db.query(`
    DO $$
    BEGIN
      ALTER TABLE orders
        ADD CONSTRAINT orders_deal_type_check CHECK (deal_type IN ('BUY', 'RENT'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

async function ensureOrdersAmountCents(db) {
  await db.query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0;
  `);

  await db.query(`
    DO $$
    BEGIN
      ALTER TABLE orders
        ADD CONSTRAINT orders_amount_cents_nonneg CHECK (amount_cents >= 0);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

async function ensureOrdersCurrency(db) {
  // BUY flow expects orders.currency (usually 'EUR')
  await db.query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';
  `);

  // Optional: limit to sane 3-letter codes
  await db.query(`
    DO $$
    BEGIN
      ALTER TABLE orders
        ADD CONSTRAINT orders_currency_len CHECK (char_length(currency) = 3);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

async function migrateDb() {
  const connectionString = process.env.DATABASE_URL_TEST || '';
  if (!connectionString) {
    throw new Error('[migrateDb] DATABASE_URL_TEST is required');
  }

  const migrationsDir = resolveMigrationsDir();
  const files = listSqlMigrations(migrationsDir);

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await resetPublicSchema(client);
    await ensureExtensions(client);

    // 🔥 FIX: users must exist before migrations that reference it
    await ensureUsersTable(client);

    for (const f of files) {
      // eslint-disable-next-line no-console
      console.log('[migrateDb] applying', path.basename(f));
      await execSqlFile(client, f);
    }

    // Post-migration compatibility patches (safe no-ops if already present)
    await ensureEntitlementsKind(client);
    await ensureOrdersDealType(client);
    await ensureOrdersAmountCents(client);
    await ensureOrdersCurrency(client);

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { migrateDb };

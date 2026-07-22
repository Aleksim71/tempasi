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

  // TEMPASI_STEP_7J_TEST_SCHEMA_BACKFILL
  // Keep older test DB migration sets compatible with current MVP schema.
  await client.query(`
    ALTER TABLE seller_templates
      ADD COLUMN IF NOT EXISTS owner_hold_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS owner_hold_days INTEGER,
      ADD COLUMN IF NOT EXISTS owner_hold_reason TEXT,
      ADD COLUMN IF NOT EXISTS owner_withdrawn_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS owner_withdraw_reason TEXT,
      ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Template',
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS zip_path TEXT,
      ADD COLUMN IF NOT EXISTS zip_original_name TEXT,
      ADD COLUMN IF NOT EXISTS zip_mime TEXT,
      ADD COLUMN IF NOT EXISTS zip_size_bytes BIGINT,
      ADD COLUMN IF NOT EXISTS zip_uploaded_at TIMESTAMPTZ;

      ALTER TABLE seller_templates
        ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id BIGINT PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL DEFAULT '',
      nickname VARCHAR(120) NOT NULL DEFAULT '',
      about TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      role_title TEXT,
      location TEXT,
      website_url TEXT,
      public_profile BOOLEAN NOT NULL DEFAULT false,
      public_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS catalog_categories (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO catalog_categories (slug, label) VALUES
      ('landing', 'Landing pages'),
      ('ecommerce', 'E-commerce'),
      ('blog', 'Blog / Media'),
      ('portfolio', 'Portfolio'),
      ('saas', 'SaaS / IT'),
      ('restaurant', 'Restaurant / Caf\u00e9'),
      ('real-estate', 'Real estate'),
      ('education', 'Education'),
      ('events', 'Events'),
      ('health', 'Healthcare'),
      ('other', 'Other')
    ON CONFLICT (slug) DO NOTHING;

    CREATE TABLE IF NOT EXISTS commission_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      rent_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
      sale_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by BIGINT,
      CONSTRAINT commission_settings_single_row CHECK (id = 1),
      CONSTRAINT commission_settings_rent_percent_range CHECK (rent_percent >= 0 AND rent_percent <= 100),
      CONSTRAINT commission_settings_sale_percent_range CHECK (sale_percent >= 0 AND sale_percent <= 100)
    );

    INSERT INTO commission_settings (id, rent_percent, sale_percent)
    VALUES (1, 0, 0)
    ON CONFLICT (id) DO NOTHING;
  `);


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

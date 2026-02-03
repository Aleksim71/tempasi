// tests/helpers/user.cjs
/* eslint-env node */
'use strict';

/**
 * createTestUser(db) — robust helper for test DB.
 *
 * Why:
 * - our test migrateDb resets schema (DROP SCHEMA public CASCADE)
 * - current migrations set does not create "users" table
 * - many tests assume a real user id exists (dev-login, FK checks, etc.)
 *
 * Strategy:
 * - ensure users table exists (minimal schema)
 * - insert with DEFAULT VALUES and return id
 */

async function ensureUsersTable(db) {
  // If table exists, do nothing
  try {
    await db.query('SELECT 1 FROM users LIMIT 1;');
    return;
  } catch (err) {
    // 42P01 = undefined_table
    if (!err || err.code !== '42P01') throw err;
  }

  // Minimal "users" table for tests.
  // Keep it tiny: only id is required by dev-login and our tests.
  // Add created_at as nice-to-have.
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Create and return a new user id.
 * Works with minimal schema.
 */
async function createTestUser(db) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('[createTestUser] db.query required');
  }

  await ensureUsersTable(db);

  // Works for our minimal table; also works if users has defaults for required cols.
  // If your real schema requires more NOT NULL columns without defaults,
  // we will adjust this insert later (but right now users table didn't exist at all).
  const { rows } = await db.query('INSERT INTO users DEFAULT VALUES RETURNING id;');
  return rows[0].id;
}

module.exports = { createTestUser };

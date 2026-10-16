/* global process */
'use strict';

// Safety net for destructive test helpers (DROP SCHEMA, TRUNCATE).
// A test database is recognised by its name ending in "_test"; anything
// else (tempasi_dev, a production URL pasted by mistake) is refused.

const TEST_DB_NAME = /_test$/;

function databaseNameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

function assertTestDatabaseUrl(url) {
  if (!url) {
    throw new Error('DATABASE_URL_TEST is not set. Refusing to run tests.');
  }
  const name = databaseNameFromUrl(url);
  if (!TEST_DB_NAME.test(name)) {
    throw new Error(
      `DATABASE_URL_TEST points to "${name || '?'}", not a *_test database. Refusing to run tests.`,
    );
  }
  return url;
}

// Checks the database a live connection is actually attached to, right
// before a destructive statement. Catches cases the URL check cannot
// (PG* environment overrides, connection poolers, typos).
async function assertConnectedToTestDb(db) {
  const { rows } = await db.query('SELECT current_database() AS name');
  const name = rows[0] && rows[0].name;
  if (!TEST_DB_NAME.test(name || '')) {
    throw new Error(
      `Refusing destructive test operation on database "${name}" (expected *_test).`,
    );
  }
}

module.exports = { assertTestDatabaseUrl, assertConnectedToTestDb };

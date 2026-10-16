/* global process */
'use strict';

// Runs in every Jest worker before any test file (jest.config.cjs ->
// setupFiles). Makes the test run independent of the developer's shell:
// even if .env was sourced (NODE_ENV=development, PGDATABASE=tempasi_dev,
// ...), application code inside tests must only ever reach the test DB.

const { assertTestDatabaseUrl } = require('../helpers/testDbGuard.cjs');

process.env.NODE_ENV = 'test';

// src/config/db.cjs prefers PG* variables when they are present; drop them
// so the app resolves the connection from DATABASE_URL below.
for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSERVICE']) {
  delete process.env[key];
}

const testUrl = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
process.env.DATABASE_URL = testUrl;

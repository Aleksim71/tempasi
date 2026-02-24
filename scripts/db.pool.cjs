'use strict';

// scripts/db.pool.cjs
// Root-level CJS helper used by legacy modules (e.g. auth.middleware.cjs).
// Single source of truth for pool is src/config/db.cjs.
//
// IMPORTANT:
// This file lives in /scripts (repo root), so paths must include /src.

let _pool;

function getPool() {
  if (_pool) return _pool;

  // From /scripts -> /src/config/db.cjs
  // This MUST be sync because many CJS modules expect getPool() synchronously.
  // eslint-disable-next-line global-require
  const db = require('../src/config/db.cjs');

  // Support common export shapes
  // 1) module.exports = { pool }
  if (db && db.pool) {
    _pool = db.pool;
    return _pool;
  }

  // 2) module.exports = { getPool }
  if (typeof db.getPool === 'function') {
    _pool = db.getPool();
    return _pool;
  }

  // 3) module.exports = pool (rare)
  if (db && typeof db.query === 'function') {
    _pool = db;
    return _pool;
  }

  throw new Error(
    [
      'DB_POOL_NOT_EXPORTED_FROM_SRC_CONFIG:',
      'Expected ../src/config/db.cjs to export { pool } or getPool().',
      'Got keys: ' + Object.keys(db || {}).join(', '),
    ].join('\n')
  );
}

module.exports = { getPool };

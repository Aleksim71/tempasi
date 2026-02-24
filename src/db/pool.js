'use strict';

// src/scripts/db.pool.cjs
// CJS helper: provides getPool() for legacy/commonjs modules.
// Pool is created in src/config/db.cjs (single source of truth).

let _pool;

function getPool() {
  if (_pool) return _pool;

  // src/scripts -> src/config/db.cjs
  // (this file lives in src/scripts, so ../config/db.cjs is correct)
  const db = require('../config/db.cjs');

  // Support several export shapes:
  // - module.exports = { pool }
  // - module.exports = pool
  // - module.exports = { getPool }
  if (typeof db.getPool === 'function') {
    _pool = db.getPool();
    return _pool;
  }

  if (db && db.pool) {
    _pool = db.pool;
    return _pool;
  }

  // Some projects export the pool directly (rare, but safe to support)
  if (db && typeof db.query === 'function') {
    _pool = db;
    return _pool;
  }

  throw new Error(
    [
      'DB_POOL_NOT_EXPORTED_FROM_CONFIG:',
      'Expected src/config/db.cjs to export { pool } or getPool().',
      'Got keys: ' + Object.keys(db || {}).join(', '),
    ].join('\n'),
  );
}

module.exports = { getPool };

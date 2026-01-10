'use strict';

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
  });

  return pool;
}

module.exports = {
  getPool,
};

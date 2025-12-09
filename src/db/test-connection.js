// src/db/test-connection.js
import { pool } from './pool.js';

async function main() {
  try {
    const res = await pool.query('SELECT now() AS now');
    console.log('DB time:', res.rows[0].now);
  } catch (err) {
    console.error('DB error:', err);
  } finally {
    await pool.end();
  }
}

main();

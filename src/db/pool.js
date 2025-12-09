// src/db/pool.js
import pg from 'pg';

export const pool = new pg.Pool({
  host: 'localhost',
  port: 5433, // тот порт, который показал pg_lsclusters и где работает psql
  user: 'tempasi',
  password: 'tempasi', // тот пароль, которым ты сейчас заходишь
  database: 'tempasi_dev',
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  max: 10,
});

'use strict';

const { getPool } = require('../scripts/db.pool.cjs');

describe('profile schema integration contract', () => {
  afterAll(async () => {
    const pool = getPool();
    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
  });

  test('user_profiles table exists for cabinet profile persistence', async () => {
    const pool = getPool();

    const result = await pool.query(`
      SELECT to_regclass('public.user_profiles') AS table_name
    `);

    expect(result.rows[0].table_name).toBe('user_profiles');
  });

  test('user_profiles supports basic profile fields used by /api/profile and /cabinet/profile', async () => {
    const pool = getPool();

    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_profiles'
      ORDER BY column_name
    `);

    const columns = result.rows.map((row) => row.column_name);

    expect(columns).toEqual(expect.arrayContaining([
      'user_id',
      'full_name',
      'nickname',
      'about',
      'avatar_url',
      'role_title',
      'location',
      'website_url',
      'public_profile',
      'created_at',
      'updated_at',
    ]));
  });
});

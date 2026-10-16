'use strict';

describe('dev flags (src/config/devFlags.js)', () => {
  const saved = { skip: process.env.TEMPASI_SKIP_AUTH, env: process.env.NODE_ENV };
  let isAuthSkipped;

  beforeAll(async () => {
    ({ isAuthSkipped } = await import('../src/config/devFlags.js'));
  });

  afterEach(() => {
    if (saved.skip === undefined) delete process.env.TEMPASI_SKIP_AUTH;
    else process.env.TEMPASI_SKIP_AUTH = saved.skip;
    process.env.NODE_ENV = saved.env;
  });

  test('auth is not skipped when the flag is unset', () => {
    delete process.env.TEMPASI_SKIP_AUTH;
    expect(isAuthSkipped()).toBe(false);
  });

  test('the flag works outside production', () => {
    process.env.TEMPASI_SKIP_AUTH = '1';
    process.env.NODE_ENV = 'development';
    expect(isAuthSkipped()).toBe(true);
  });

  test('the flag is refused in production', () => {
    process.env.TEMPASI_SKIP_AUTH = '1';
    process.env.NODE_ENV = 'production';
    expect(() => isAuthSkipped()).toThrow(/Refusing to bypass authentication/);
  });
});

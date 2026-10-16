'use strict';

const { hashPassword, verifyPassword } = require('../src/lib/password.cjs');

describe('password hashing (src/lib/password.cjs)', () => {
  test('hash and verify round-trip', async () => {
    const hash = await hashPassword('Passw0rd-roundtrip!');
    expect(hash).toMatch(/^\$2[ab]\$/);
    await expect(verifyPassword('Passw0rd-roundtrip!', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  test('verifies hashes created earlier by the native "bcrypt" package', async () => {
    // $2b$ hash produced by native bcrypt (cost 4) before the switch to bcryptjs.
    const legacyHash = '$2b$04$IfpeY5tsTRp6Byc3uTaEX.jT1/ij/mewkxdlohtd4t2Q8C4PBT4yO';
    await expect(verifyPassword('correct horse battery staple', legacyHash)).resolves.toBe(true);
    await expect(verifyPassword('correct horse battery stapl', legacyHash)).resolves.toBe(false);
  });

  test('a missing hash never verifies', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });
});

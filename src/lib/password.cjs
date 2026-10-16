'use strict';

// One place for password hashing and checking.
//
// bcryptjs is pure JavaScript, so the server needs no native build step.
// It produces and verifies standard bcrypt hashes ($2a$ / $2b$), so hashes
// created earlier with the native "bcrypt" package keep working.

const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), String(hash));
}

module.exports = { hashPassword, verifyPassword, BCRYPT_ROUNDS };

'use strict';

const crypto = require('crypto');
const { sendMail } = require('../../lib/mailer.cjs');

const EMAIL_VERIFICATION_TTL_SECONDS = Number(
  process.env.EMAIL_VERIFICATION_TTL_SECONDS || 60 * 60 * 24
);

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getBaseUrl() {
  const fromEnv = String(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return `http://127.0.0.1:${Number(process.env.PORT || 3000)}`;
}

async function createEmailVerification({ db, userId, email, ttlSeconds = EMAIL_VERIFICATION_TTL_SECONDS }) {
  const token = makeToken();
  const tokenHash = sha256Hex(token);

  await db.query(
    `
      UPDATE users
      SET email_verified = false,
          verification_token_hash = $2,
          verification_expires_at = NOW() + ($3 || ' seconds')::interval,
          updated_at = NOW()
      WHERE id = $1
    `,
    [userId, tokenHash, String(ttlSeconds)],
  );

  const verifyUrl = `${getBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  await sendMail({
    to: email,
    subject: 'Verify your email',
    text: [
      'Welcome to Tempasi.',
      '',
      'Please verify your email by opening this link:',
      verifyUrl,
      '',
      'If you did not create this account, you can ignore this email.',
    ].join('\n'),
  });

  return { token, verifyUrl };
}

async function resendEmailVerificationForUser({ db, userId }) {
  const { rows } = await db.query(
    `
      SELECT id, email, email_verified
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );

  const user = rows[0] || null;
  if (!user) return { ok: false, error: 'USER_NOT_FOUND' };
  if (user.email_verified) return { ok: true, status: 'already_verified' };

  await createEmailVerification({ db, userId: user.id, email: user.email });
  return { ok: true, status: 'sent' };
}

async function verifyEmailToken({ db, token }) {
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, error: 'TOKEN_REQUIRED' };

  const tokenHash = sha256Hex(raw);
  const { rows } = await db.query(
    `
      SELECT id, email_verified, verification_expires_at
      FROM users
      WHERE verification_token_hash = $1
      LIMIT 1
    `,
    [tokenHash],
  );

  const user = rows[0] || null;
  if (!user) return { ok: false, error: 'TOKEN_INVALID' };
  if (user.email_verified) return { ok: true, status: 'already_verified' };

  const expiresAt = user.verification_expires_at ? new Date(user.verification_expires_at) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'TOKEN_EXPIRED' };
  }

  await db.query(
    `
      UPDATE users
      SET email_verified = true,
          verification_token_hash = NULL,
          verification_expires_at = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
    [user.id],
  );

  return { ok: true, status: 'verified', userId: user.id };
}

module.exports = {
  createEmailVerification,
  resendEmailVerificationForUser,
  verifyEmailToken,
};

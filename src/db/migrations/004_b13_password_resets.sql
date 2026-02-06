-- 004_b13_password_resets.sql
-- Password reset tokens (MVP)
-- Safe defaults: hashed tokens, expiry, one-time use, minimal PII.

BEGIN;

CREATE TABLE IF NOT EXISTS password_resets (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Store only a hash of the token, never the raw token
  token_hash   text NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT NOW(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz NULL,

  -- optional diagnostics (do not rely on it for auth)
  request_ip   text NULL,
  user_agent   text NULL
);

-- One active token per user (MVP: last request wins).
-- Used tokens are excluded from uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS ux_password_resets_user_active
ON password_resets (user_id)
WHERE used_at IS NULL;

-- Fast lookup by token hash (and ensure only unused tokens are considered)
CREATE INDEX IF NOT EXISTS ix_password_resets_token_hash_unused
ON password_resets (token_hash)
WHERE used_at IS NULL;

COMMIT;

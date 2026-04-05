ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_token_hash text,
  ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_users_verification_token_hash
  ON users (verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;

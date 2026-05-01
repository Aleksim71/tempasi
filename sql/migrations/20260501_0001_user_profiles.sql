-- 20260501_0001_user_profiles.sql
-- Profile persistence table for /api/profile and /cabinet/profile.

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(120),
  nickname VARCHAR(50),
  about TEXT,
  avatar_url TEXT,
  role_title TEXT,
  location TEXT,
  website_url TEXT,
  public_profile BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_nickname_unique_idx
  ON user_profiles (LOWER(nickname))
  WHERE nickname IS NOT NULL AND nickname <> '';

CREATE INDEX IF NOT EXISTS user_profiles_public_profile_idx
  ON user_profiles (public_profile);

CREATE OR REPLACE FUNCTION set_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;

CREATE TRIGGER trg_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW
EXECUTE FUNCTION set_user_profiles_updated_at();

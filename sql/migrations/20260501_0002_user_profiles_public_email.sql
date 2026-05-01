-- 20260501_0002_user_profiles_public_email.sql
-- Optional public contact email for seller/author profile display.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS public_email VARCHAR(254);

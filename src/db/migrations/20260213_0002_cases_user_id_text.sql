-- src/db/migrations/20260213_0002_cases_user_id_text.sql
-- Make cases.user_id TEXT to support numeric/string/uuid user ids.

BEGIN;

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type
    INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'cases'
    AND column_name = 'user_id';

  -- If table doesn't exist yet, do nothing (another migration will create it)
  IF col_type IS NULL THEN
    RAISE NOTICE 'cases.user_id: column not found (table may not exist yet), skipping';
    RETURN;
  END IF;

  -- Only alter if currently uuid (or something else non-text)
  IF col_type <> 'text' THEN
    RAISE NOTICE 'Altering cases.user_id type from % to text', col_type;

    -- From uuid -> text safe
    ALTER TABLE cases
      ALTER COLUMN user_id TYPE text
      USING user_id::text;
  ELSE
    RAISE NOTICE 'cases.user_id already text, skipping';
  END IF;
END;
$$;

-- Index stays valid, but rebuild to be safe (optional)
DROP INDEX IF EXISTS cases_user_id_idx;
CREATE INDEX IF NOT EXISTS cases_user_id_idx ON cases(user_id);

COMMIT;

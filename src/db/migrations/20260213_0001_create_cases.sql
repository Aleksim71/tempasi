-- src/db/migrations/20260213_0001_create_cases.sql
-- Cases (client shortlists) + case_templates join table.

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) >= 1 AND char_length(title) <= 160),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cases_user_id_idx ON cases(user_id);
CREATE INDEX IF NOT EXISTS cases_updated_at_idx ON cases(updated_at DESC);

-- Join table: templates inside a case, with ordering for client presentation
-- template_id as TEXT (MVP) to avoid coupling to templates schema early.
CREATE TABLE IF NOT EXISTS case_templates (
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  template_id text NOT NULL,
  position int NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, template_id)
);

CREATE INDEX IF NOT EXISTS case_templates_case_pos_idx ON case_templates(case_id, position);

-- updated_at trigger (shared helper; safe to redefine)
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cases_set_updated_at ON cases;
CREATE TRIGGER trg_cases_set_updated_at
BEFORE UPDATE ON cases
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

COMMIT;

-- src/db/migrations/20260506_0003_cases_public_preview_token.sql
-- TASER-NEXT-B: tokenized public Case Preview URLs.
-- Internal /cabinet/cases/:id/preview stays auth-protected.
-- Public /cabinet/cases/:id/preview/public?token=... is safe to share with a client.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS public_preview_token text;

UPDATE public.cases
SET public_preview_token = gen_random_uuid()::text
WHERE public_preview_token IS NULL
   OR btrim(public_preview_token) = '';

ALTER TABLE public.cases
  ALTER COLUMN public_preview_token SET DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX IF NOT EXISTS cases_public_preview_token_idx
  ON public.cases(public_preview_token)
  WHERE public_preview_token IS NOT NULL;

COMMIT;

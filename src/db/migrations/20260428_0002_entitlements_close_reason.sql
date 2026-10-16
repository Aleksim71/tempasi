-- src/db/migrations/20260428_0002_entitlements_close_reason.sql
-- Active RENT can be closed early when renter buys the template.

BEGIN;

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS closed_reason text NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_entitlements_closed_reason
  ON public.entitlements(closed_reason);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entitlements_user_template_uniq'
  ) THEN
    ALTER TABLE public.entitlements
      DROP CONSTRAINT entitlements_user_template_uniq;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entitlements_user_id_template_slug_key'
  ) THEN
    ALTER TABLE public.entitlements
      DROP CONSTRAINT entitlements_user_id_template_slug_key;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entitlements_user_template_deal_uniq'
  ) THEN
    ALTER TABLE public.entitlements
      DROP CONSTRAINT entitlements_user_template_deal_uniq;
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.entitlements_user_template_uniq;
DROP INDEX IF EXISTS public.entitlements_user_id_template_slug_key;
DROP INDEX IF EXISTS public.entitlements_user_template_deal_uniq;

COMMIT;

-- src/db/migrations/20260217_0002_entitlements_unique_order_id_fix.sql
-- Ensure we have a UNIQUE index for entitlements.order_id compatible with:
--   ON CONFLICT (order_id)
--
-- IMPORTANT: Do NOT use partial index (WHERE ...), because ON CONFLICT (order_id)
-- won't match it ("no unique or exclusion constraint matching...").

BEGIN;

-- Drop possible previous attempts (safe)
DROP INDEX IF EXISTS public.entitlements_order_id_idx;
DROP INDEX IF EXISTS public.entitlements_order_id_key;
DROP INDEX IF EXISTS public.entitlements_unique_order_id;
DROP INDEX IF EXISTS public.entitlements_order_id_unique;
DROP INDEX IF EXISTS public.entitlements_unique_order_id_idx;

-- Canonical unique index.
-- Postgres allows multiple NULLs under UNIQUE, so this is safe even if order_id is nullable.
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_order_id_unique
  ON public.entitlements (order_id);

COMMIT;

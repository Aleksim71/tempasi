-- path: src/db/migrations/20260427_0001_orders_provider_payment_fields.sql
-- Tempasi P0/P1: align orders schema with orders.repo.cjs provider payment fields.
-- The runtime code updates provider_payment_intent_id in markOrderPaid(),
-- so the column must exist in dev/test/prod schemas.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS provider_session_id TEXT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS provider_payment_intent_id TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_session_id_ux
  ON public.orders(provider_session_id)
  WHERE provider_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_payment_intent_id_ux
  ON public.orders(provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;

COMMIT;

-- src/db/migrations/20260428_0001_orders_rent_selection.sql
-- RENT checkout selection: rental period + selected Cases.
-- RENT is activated only after payment completion creates entitlement.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rent_days integer NULL,
  ADD COLUMN IF NOT EXISTS case_ids jsonb NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_rent_days_positive_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_rent_days_positive_check
  CHECK (
    rent_days IS NULL
    OR (rent_days >= 1 AND rent_days <= 365)
  );

CREATE TABLE IF NOT EXISTS public.order_case_assignments (
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  case_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_order_case_assignments_case_id
  ON public.order_case_assignments(case_id);

COMMIT;

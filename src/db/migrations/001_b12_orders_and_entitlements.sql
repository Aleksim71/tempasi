-- src/db/migrations/001_b12_orders_and_entitlements.sql
-- B12: orders + entitlements
-- IMPORTANT: idempotent & test-safe

BEGIN;

-- =============================
-- orders
-- =============================
CREATE TABLE IF NOT EXISTS public.orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  template_slug TEXT NOT NULL,

  -- license tier: PU | CU | EL | ML | EX ...
  license TEXT NOT NULL,

  -- deal type: BUY | RENT | SUBSCRIPTION ...
  deal_type TEXT NOT NULL DEFAULT 'BUY',

  -- status: created | paid | canceled | refunded ...
  status TEXT NOT NULL DEFAULT 'created',

  -- payment provider info (optional)
  provider TEXT NULL,
  provider_session_id TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_id_idx
  ON public.orders(user_id);

CREATE INDEX IF NOT EXISTS orders_template_slug_idx
  ON public.orders(template_slug);

CREATE INDEX IF NOT EXISTS orders_status_idx
  ON public.orders(status);

-- =============================
-- entitlements (download gate)
-- =============================
CREATE TABLE IF NOT EXISTS public.entitlements (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  template_slug TEXT NOT NULL,

  -- MUST exist before UNIQUE(user_id, template_slug, deal_type)
  deal_type TEXT NOT NULL DEFAULT 'BUY',

  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- safety for already-existing tables (old schema) ---
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS deal_type TEXT NOT NULL DEFAULT 'BUY';

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ NULL;

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- unique entitlement per (user, template, deal_type)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entitlements_user_template_deal_uniq'
  ) THEN
    ALTER TABLE public.entitlements
      ADD CONSTRAINT entitlements_user_template_deal_uniq
      UNIQUE (user_id, template_slug, deal_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS entitlements_user_id_idx
  ON public.entitlements(user_id);

CREATE INDEX IF NOT EXISTS entitlements_template_slug_idx
  ON public.entitlements(template_slug);

COMMIT;

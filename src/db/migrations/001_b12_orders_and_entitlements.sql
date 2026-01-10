-- src/db/migrations/001_b12_orders_and_entitlements.sql
-- B12: orders + entitlements (минимально, чтобы /api/orders/:slug/buy заработал)
-- Idempotent: можно запускать повторно.

BEGIN;

-- 1) ORDERS
CREATE TABLE IF NOT EXISTS public.orders (
  id BIGSERIAL PRIMARY KEY,

  user_id BIGINT NOT NULL,
  template_slug TEXT NOT NULL,

  -- "deal_type" можно использовать под: "buy" | "rent" | "subscription" и т.п.
  deal_type TEXT NOT NULL DEFAULT 'buy',

  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',

  -- payment provider: 'fake' | 'stripe' | ...
  provider TEXT NOT NULL DEFAULT 'fake',

  -- status: 'pending' | 'paid' | 'failed' | 'refunded' ...
  status TEXT NOT NULL DEFAULT 'pending',

  -- связывание с провайдером
  provider_session_id TEXT,
  provider_checkout_url TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- удобные индексы
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON public.orders (user_id);
CREATE INDEX IF NOT EXISTS orders_template_slug_idx ON public.orders (template_slug);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders (status);
CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_session_id_uq
  ON public.orders (provider_session_id)
  WHERE provider_session_id IS NOT NULL;

-- auto updated_at (простым триггером)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at_orders') THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at_orders()
    RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_orders_updated_at'
  ) THEN
    CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at_orders();
  END IF;
END $$;

-- 2) ENTITLEMENTS (право на скачивание/доступ)
CREATE TABLE IF NOT EXISTS public.entitlements (
  id BIGSERIAL PRIMARY KEY,

  user_id BIGINT NOT NULL,
  template_slug TEXT NOT NULL,

  order_id BIGINT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT entitlements_order_fk
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL
);

-- один entitlement на (user, template)
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_user_template_uq
  ON public.entitlements (user_id, template_slug);

CREATE INDEX IF NOT EXISTS entitlements_user_id_idx ON public.entitlements (user_id);
CREATE INDEX IF NOT EXISTS entitlements_template_slug_idx ON public.entitlements (template_slug);

COMMIT;

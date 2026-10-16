-- src/db/migrations/20260428_0003_account_credits.sql
-- Internal Tempasi credit created from unused RENT value after early BUY.
-- MVP: credit is created and visible in finance overview.
-- Applying credit to future checkout is a later step.

BEGIN;

CREATE TABLE IF NOT EXISTS public.account_credits (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  source_type text NOT NULL,
  source_order_id bigint NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  related_order_id bigint NULL REFERENCES public.orders(id) ON DELETE SET NULL,

  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'EUR',

  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_credits_status_check
    CHECK (status IN ('active', 'used', 'expired', 'void'))
);

CREATE UNIQUE INDEX IF NOT EXISTS account_credits_source_related_uniq
  ON public.account_credits(source_type, source_order_id, related_order_id);

CREATE INDEX IF NOT EXISTS idx_account_credits_user_status
  ON public.account_credits(user_id, status);

CREATE INDEX IF NOT EXISTS idx_account_credits_expires_at
  ON public.account_credits(expires_at);

COMMIT;

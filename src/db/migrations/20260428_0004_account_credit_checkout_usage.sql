-- path: src/db/migrations/20260428_0004_account_credit_checkout_usage.sql
-- Tempasi Step 5C: auditable usage ledger for applying internal account credit to checkout.

BEGIN;

CREATE TABLE IF NOT EXISTS account_credit_usages (
  id BIGSERIAL PRIMARY KEY,
  credit_id BIGINT NOT NULL REFERENCES account_credits(id) ON DELETE RESTRICT,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'applied', 'released', 'void')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS account_credit_usages_one_active_reservation
  ON account_credit_usages(credit_id, order_id, status);

CREATE INDEX IF NOT EXISTS idx_account_credit_usages_credit_id
  ON account_credit_usages(credit_id);

CREATE INDEX IF NOT EXISTS idx_account_credit_usages_order_id
  ON account_credit_usages(order_id);

CREATE INDEX IF NOT EXISTS idx_account_credit_usages_status
  ON account_credit_usages(status);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS credit_applied_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payable_amount_cents INTEGER;

UPDATE orders
SET
  gross_amount_cents = COALESCE(gross_amount_cents, amount_cents, 0),
  payable_amount_cents = COALESCE(
    payable_amount_cents,
    GREATEST(0, COALESCE(amount_cents, 0) - COALESCE(credit_applied_cents, 0))
  )
WHERE gross_amount_cents IS NULL OR payable_amount_cents IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_credit_applied_non_negative'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_credit_applied_non_negative
      CHECK (credit_applied_cents >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_gross_amount_non_negative'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_gross_amount_non_negative
      CHECK (gross_amount_cents IS NULL OR gross_amount_cents >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_payable_amount_non_negative'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_payable_amount_non_negative
      CHECK (payable_amount_cents IS NULL OR payable_amount_cents >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_credit_not_above_gross'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_credit_not_above_gross
      CHECK (
        gross_amount_cents IS NULL
        OR credit_applied_cents <= gross_amount_cents
      ) NOT VALID;
  END IF;
END $$;

COMMIT;

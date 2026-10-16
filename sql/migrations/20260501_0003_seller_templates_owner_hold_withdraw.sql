-- 20260501_0003_seller_templates_owner_hold_withdraw.sql
-- Owner-only template reservation/withdraw workflow.
-- This is not commercial BUY/RENT and must not create orders, payments, revenue, or entitlements.

ALTER TABLE seller_templates
  ADD COLUMN IF NOT EXISTS owner_hold_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_hold_days INTEGER,
  ADD COLUMN IF NOT EXISTS owner_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS owner_withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_withdraw_reason TEXT;

CREATE INDEX IF NOT EXISTS seller_templates_owner_hold_until_idx
  ON seller_templates(owner_hold_until);

CREATE INDEX IF NOT EXISTS seller_templates_owner_withdrawn_at_idx
  ON seller_templates(owner_withdrawn_at);

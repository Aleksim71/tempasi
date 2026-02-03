-- 20260201_0001_add_orders_deal_type.sql
-- Ensure orders.deal_type exists for BUY/RENT flows.
-- Safe to run multiple times.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS deal_type text NOT NULL DEFAULT 'BUY';

DO $$
BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_deal_type_check CHECK (deal_type IN ('BUY', 'RENT'));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

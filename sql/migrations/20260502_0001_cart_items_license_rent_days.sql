-- sql/migrations/20260502_0001_cart_items_license_rent_days.sql
-- Allow explicit RENT duration encoding for MVP cart flow.
--
-- MVP format:
--   BUY      = exclusive purchase
--   RENT     = legacy rent marker
--   PU       = legacy paid usage marker
--   PU:<N>d  = rent reservation for explicit N days, e.g. PU:3d

ALTER TABLE cart_items
  DROP CONSTRAINT IF EXISTS cart_items_license_check;

ALTER TABLE cart_items
  ADD CONSTRAINT cart_items_license_check
  CHECK (
    license = 'BUY'
    OR license = 'RENT'
    OR license = 'PU'
    OR license ~ '^PU:[1-9][0-9]*d$'
  );

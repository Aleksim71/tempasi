ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS license text;

UPDATE orders
SET license = COALESCE(NULLIF(license, ''), 'PU')
WHERE license IS NULL;

ALTER TABLE orders
  ALTER COLUMN license SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_license_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_license_check
      CHECK (license IN ('PU', 'CU', 'EL', 'ML', 'EX'));
  END IF;
END $$;

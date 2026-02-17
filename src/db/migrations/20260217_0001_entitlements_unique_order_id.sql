-- migrations/20260217_0001_entitlements_unique_order_id.sql
-- Ensure a single entitlement per order_id (idempotency hard guarantee).
-- 1) Clean possible historical duplicates (keep the newest by created_at).
-- 2) Add UNIQUE index on order_id (only when order_id IS NOT NULL).

BEGIN;

-- 1) Deduplicate by order_id (keep rn=1, delete rn>1)
WITH ranked AS (
  SELECT
    ctid,
    order_id,
    row_number() OVER (
      PARTITION BY order_id
      ORDER BY created_at DESC NULLS LAST
    ) AS rn
  FROM entitlements
  WHERE order_id IS NOT NULL
)
DELETE FROM entitlements e
USING ranked r
WHERE e.ctid = r.ctid
  AND r.rn > 1;

-- 2) Add unique index (partial)
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_order_id_unique
ON entitlements (order_id)
WHERE order_id IS NOT NULL;

COMMIT;

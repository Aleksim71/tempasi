BEGIN;

WITH ranked AS (
  SELECT
    id,
    template_slug,
    ROW_NUMBER() OVER (
      PARTITION BY template_slug
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM orders
  WHERE deal_type = 'BUY'
    AND status = 'paid'
),
duplicates AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
UPDATE orders
SET status = 'refunded',
    updated_at = NOW()
WHERE id IN (SELECT id FROM duplicates);

CREATE UNIQUE INDEX IF NOT EXISTS orders_unique_paid_buy_per_template
ON orders(template_slug)
WHERE deal_type = 'BUY' AND status = 'paid';

COMMIT;

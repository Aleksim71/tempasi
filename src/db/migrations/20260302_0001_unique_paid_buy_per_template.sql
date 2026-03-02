-- Ensure only one paid BUY per template_slug
-- Safe to run multiple times

CREATE UNIQUE INDEX IF NOT EXISTS orders_unique_paid_buy_per_template
ON orders(template_slug)
WHERE deal_type = 'BUY' AND status = 'paid';

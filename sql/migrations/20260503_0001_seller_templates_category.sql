-- sql/migrations/20260503_0001_seller_templates_category.sql
-- Add catalog category for real template details metadata.

ALTER TABLE seller_templates
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Template';

UPDATE seller_templates
SET category = CASE slug
  WHEN 'seed-001' THEN 'Landing pages'
  WHEN 'seed-002' THEN 'E-commerce'
  WHEN 'seed-003' THEN 'Blog / Media'
  WHEN 'seed-004' THEN 'Portfolio'
  WHEN 'seed-005' THEN 'SaaS / IT'
  WHEN 'seed-006' THEN 'Restaurant / Café'
  WHEN 'seed-007' THEN 'Real estate'
  WHEN 'seed-008' THEN 'Education'
  WHEN 'seed-009' THEN 'Events'
  WHEN 'seed-010' THEN 'Healthcare'
  ELSE category
END
WHERE slug LIKE 'seed-%';

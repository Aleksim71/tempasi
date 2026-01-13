-- 003_b12_entitlements_fix_order_id.sql
-- Цель:
-- 1) добавить order_id в entitlements (его ждут repo + tests)
-- 2) гарантировать UNIQUE(user_id, template_slug) под ON CONFLICT (user_id, template_slug)
-- 3) аккуратно убрать старый UNIQUE(user_id, template_slug, deal_type) если он был

BEGIN;

-- 1) columns
ALTER TABLE IF EXISTS entitlements
  ADD COLUMN IF NOT EXISTS order_id BIGINT;

ALTER TABLE IF EXISTS entitlements
  ADD COLUMN IF NOT EXISTS deal_type TEXT NOT NULL DEFAULT 'BUY';

-- 2) drop older constraint if exists (если его создавали в 002)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entitlements_user_template_deal_uniq'
  ) THEN
    ALTER TABLE entitlements DROP CONSTRAINT entitlements_user_template_deal_uniq;
  END IF;
END $$;

-- 3) ensure UNIQUE(user_id, template_slug)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'entitlements_user_template_uniq'
  ) THEN
    ALTER TABLE entitlements
      ADD CONSTRAINT entitlements_user_template_uniq UNIQUE (user_id, template_slug);
  END IF;
END $$;

COMMIT;

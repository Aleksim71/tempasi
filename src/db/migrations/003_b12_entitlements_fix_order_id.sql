-- src/db/migrations/003_b12_entitlements_fix_order_id.sql
-- Fix entitlements schema for repo/tests:
-- - add deal_type
-- - add order_id
-- - add updated_at
-- - ensure unique(user_id, template_slug, deal_type)

BEGIN;

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS deal_type TEXT NOT NULL DEFAULT 'BUY';

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS order_id BIGINT NULL;

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- drop old unique constraints if they exist (name can vary)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'entitlements'::regclass
      AND contype = 'u'
      AND conname = 'entitlements_user_id_template_slug_key'
  ) THEN
    ALTER TABLE entitlements DROP CONSTRAINT entitlements_user_id_template_slug_key;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'entitlements'::regclass
      AND contype = 'u'
      AND conname = 'entitlements_user_template_deal_uniq'
  ) THEN
    ALTER TABLE entitlements DROP CONSTRAINT entitlements_user_template_deal_uniq;
  END IF;
END $$;

ALTER TABLE entitlements
  ADD CONSTRAINT entitlements_user_template_deal_uniq
  UNIQUE (user_id, template_slug, deal_type);

COMMIT;

-- src/db/migrations/002_b12_entitlements_ends_at.sql
-- B12: entitlements table + ends_at (для download gate)
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.entitlements (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  template_slug TEXT NOT NULL,
  deal_type TEXT NOT NULL DEFAULT 'BUY',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- если таблица уже была, но без ends_at — добавим
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ NULL;

-- уникальность "право на шаблон"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entitlements_user_template_deal_uniq'
  ) THEN
    ALTER TABLE public.entitlements
      ADD CONSTRAINT entitlements_user_template_deal_uniq
      UNIQUE (user_id, template_slug, deal_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS entitlements_user_id_idx ON public.entitlements(user_id);
CREATE INDEX IF NOT EXISTS entitlements_template_slug_idx ON public.entitlements(template_slug);

COMMIT;

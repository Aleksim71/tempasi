-- src/db/migrations/002_b12_entitlements_ends_at.sql
-- B12: normalize entitlements schema (idempotent, safe)
BEGIN;

-- если таблицы нет (на чистой БД) — создадим сразу правильную
CREATE TABLE IF NOT EXISTS public.entitlements (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  template_slug TEXT NOT NULL,
  deal_type TEXT NOT NULL DEFAULT 'BUY',
  order_id BIGINT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- если таблица была создана раньше в 001 с урезанными полями — дольём недостающее
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS deal_type TEXT NOT NULL DEFAULT 'BUY';

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS order_id BIGINT NULL;

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ NULL;

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- уникальность "право на шаблон" для ON CONFLICT (user_id, template_slug, deal_type)
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

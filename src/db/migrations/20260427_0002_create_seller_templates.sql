-- path: src/db/migrations/20260427_0002_create_seller_templates.sql
-- Canonical seller_templates table used by seller uploads, public catalog, cart,
-- preview endpoint, and analytics.

CREATE TABLE IF NOT EXISTS public.seller_templates (
  id SERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  short_description TEXT,
  description TEXT,
  preview_image TEXT,
  preview_url TEXT,
  demo_url TEXT,
  price_buy_cents INTEGER,
  price_rent_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  zip_path TEXT,
  zip_original_name TEXT,
  zip_uploaded_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.seller_templates
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS short_description TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS preview_image TEXT,
  ADD COLUMN IF NOT EXISTS preview_url TEXT,
  ADD COLUMN IF NOT EXISTS demo_url TEXT,
  ADD COLUMN IF NOT EXISTS price_buy_cents INTEGER,
  ADD COLUMN IF NOT EXISTS price_rent_cents INTEGER,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS zip_path TEXT,
  ADD COLUMN IF NOT EXISTS zip_original_name TEXT,
  ADD COLUMN IF NOT EXISTS zip_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.seller_templates
SET
  status = COALESCE(NULLIF(status, ''), 'draft'),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, NOW())
WHERE status IS NULL
   OR status = ''
   OR created_at IS NULL
   OR updated_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'seller_templates_slug_unique'
  ) THEN
    ALTER TABLE public.seller_templates
      ADD CONSTRAINT seller_templates_slug_unique UNIQUE (slug);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'seller_templates_status_check'
  ) THEN
    ALTER TABLE public.seller_templates
      ADD CONSTRAINT seller_templates_status_check
      CHECK (status IN ('draft', 'published'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'seller_templates_price_buy_nonnegative_check'
  ) THEN
    ALTER TABLE public.seller_templates
      ADD CONSTRAINT seller_templates_price_buy_nonnegative_check
      CHECK (price_buy_cents IS NULL OR price_buy_cents >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'seller_templates_price_rent_nonnegative_check'
  ) THEN
    ALTER TABLE public.seller_templates
      ADD CONSTRAINT seller_templates_price_rent_nonnegative_check
      CHECK (price_rent_cents IS NULL OR price_rent_cents >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS seller_templates_owner_user_id_idx
  ON public.seller_templates (owner_user_id);

CREATE INDEX IF NOT EXISTS seller_templates_public_catalog_idx
  ON public.seller_templates (status, deleted_at, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS seller_templates_slug_idx
  ON public.seller_templates (slug);

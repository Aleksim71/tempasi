-- 20260720_0001_admin_settings_catalog_commission.sql
-- Two small admin-managed settings tables.
--
-- catalog_categories: admin-managed list of template categories.
-- Replaces the previously hardcoded <option> list duplicated twice in
-- space-my-templates.hbs. NOT a foreign key against
-- seller_templates.category (that column stays free text, as before)
-- — deleting a category here does not touch existing templates that
-- already used it; it just disappears from the list for new/edited
-- templates going forward.
--
-- commission_settings: single-row table holding the platform
-- commission percentage for rent and for sale. NOTE: as of this
-- migration nothing in checkout/orders/credit-ledger reads these
-- values yet — this only stores the admin-configured numbers.
-- Wiring them into actual payout math is separate future work.
--
-- NOTE: no migration runner in this repo — apply manually via psql,
-- same as 20260716_0001 / 20260719_0001.

BEGIN;

CREATE TABLE IF NOT EXISTS catalog_categories (
  id bigserial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed with the categories that were previously hardcoded in
-- space-my-templates.hbs, so existing templates' category values
-- keep matching a known entry after the switch to a DB-backed list.
INSERT INTO catalog_categories (slug, label) VALUES
  ('landing', 'Landing pages'),
  ('ecommerce', 'E-commerce'),
  ('blog', 'Blog / Media'),
  ('portfolio', 'Portfolio'),
  ('saas', 'SaaS / IT'),
  ('restaurant', 'Restaurant / Caf\u00e9'),
  ('real-estate', 'Real estate'),
  ('education', 'Education'),
  ('events', 'Events'),
  ('health', 'Healthcare'),
  ('other', 'Other')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS commission_settings (
  id integer PRIMARY KEY DEFAULT 1,
  rent_percent numeric(5, 2) NOT NULL DEFAULT 0,
  sale_percent numeric(5, 2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint,
  CONSTRAINT commission_settings_single_row CHECK (id = 1),
  CONSTRAINT commission_settings_rent_percent_range CHECK (rent_percent >= 0 AND rent_percent <= 100),
  CONSTRAINT commission_settings_sale_percent_range CHECK (sale_percent >= 0 AND sale_percent <= 100)
);

INSERT INTO commission_settings (id, rent_percent, sale_percent)
VALUES (1, 0, 0)
ON CONFLICT (id) DO NOTHING;

COMMIT;

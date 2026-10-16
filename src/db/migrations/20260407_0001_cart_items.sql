CREATE TABLE IF NOT EXISTS cart_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_slug TEXT NOT NULL,
  deal_type TEXT NOT NULL DEFAULT 'BUY',
  license TEXT NOT NULL DEFAULT 'PU',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cart_items_deal_type_check CHECK (deal_type IN ('BUY', 'RENT')),
  CONSTRAINT cart_items_license_check CHECK (license IN ('PU', 'CU', 'EL', 'ML', 'EX'))
);

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_user_template_deal_license_uniq
ON cart_items (user_id, template_slug, deal_type, license);

CREATE INDEX IF NOT EXISTS cart_items_user_id_idx
ON cart_items (user_id);

CREATE INDEX IF NOT EXISTS cart_items_template_slug_idx
ON cart_items (template_slug);

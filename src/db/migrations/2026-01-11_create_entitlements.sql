CREATE TABLE IF NOT EXISTS entitlements (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  template_slug TEXT NOT NULL,
  order_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_user_template_uniq UNIQUE (user_id, template_slug)
);

CREATE INDEX IF NOT EXISTS entitlements_user_id_idx ON entitlements(user_id);
CREATE INDEX IF NOT EXISTS entitlements_template_slug_idx ON entitlements(template_slug);
CREATE INDEX IF NOT EXISTS entitlements_order_id_idx ON entitlements(order_id);

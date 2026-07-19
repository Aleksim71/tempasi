-- 20260719_0001_seller_templates_admin_blocked_at.sql
-- Admin-only block flag on seller_templates, independent of the
-- seller-controlled draft/published status (which stays untouched:
-- CHECK still only allows draft/published, we do not add a 'blocked'
-- status value).
--
-- Block:   admin forces status = 'draft' AND sets admin_blocked_at = now().
-- Unblock: admin_blocked_at = NULL; status stays 'draft' (seller must
--          manually republish — this is intentional, see PILGRIM.md).
--
-- NOTE: as with category/user_profiles (see 20260716_0001 and
-- earlier), there is no migration runner in this repo — apply this
-- manually via psql against the target DB.

BEGIN;

ALTER TABLE public.seller_templates
  ADD COLUMN IF NOT EXISTS admin_blocked_at timestamptz;

CREATE INDEX IF NOT EXISTS seller_templates_admin_blocked_at_idx
  ON public.seller_templates (admin_blocked_at);

COMMIT;

-- src/db/migrations/20260816_0001_users_self_delete.sql
--
-- TEMPASI_ACCOUNT_SELF_DELETE (2026-08-16)
--
-- Adds account self-deletion: users.status already exists (default
-- 'active') and the real login route (auth.pages.routes.js POST
-- /login) already rejects any status other than 'active' — this
-- feature was half-built already, just never had a way to actually
-- SET status to anything else. No physical deletion of the user row,
-- their orders, entitlements, or seller_templates rows — self-delete
-- only sets status='deleted' + records when, and every place that
-- shows templates/profiles publicly gets a matching check added
-- (owner's self_deleted_at IS NULL) so a self-deleted seller's
-- listings stop appearing without touching a single seller_templates
-- row. Existing buyers keep their entitlements/downloads untouched —
-- this only affects future discoverability, not already-granted
-- access.
--
-- Safe to run multiple times (IF NOT EXISTS / duplicate_object guard).
--
-- ⚠️ Before applying: confirm no existing row already has a
-- users.status value outside ('active', 'deleted') — the CHECK
-- constraint below will fail to attach otherwise. Check first:
--
--   SELECT DISTINCT status FROM users;
--
-- If that shows anything besides 'active', resolve those rows first
-- (this migration will otherwise abort with an error, leaving the DB
-- unchanged — the whole thing runs in one transaction).

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS self_deleted_at timestamptz NULL;

DO $$
BEGIN
  ALTER TABLE public.users
    ADD CONSTRAINT users_status_check
    CHECK (status IN ('active', 'deleted'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS users_self_deleted_at_idx
  ON public.users (self_deleted_at)
  WHERE self_deleted_at IS NOT NULL;

COMMIT;

-- 20260716_0001_admin_role_and_audit_log.sql
-- Этап 1 админ-панели: закрепляем роль admin/superadmin CHECK-констрейнтом
-- на users.role и заводим admin_audit_log для журналирования мутирующих
-- действий из /admin.
--
-- ВАЖНО ПЕРЕД ПРИМЕНЕНИЕМ НА ПРОДЕ:
--   Таблица users не создаётся ни одной миграцией в этом репозитории —
--   её схема известна только из tests/helpers/migrateDb.cjs. Перед запуском
--   вручную убедитесь, что колонка role там есть (мы также подстраховываемся
--   ADD COLUMN IF NOT EXISTS ниже, на случай расхождения).

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

DO $$
BEGIN
  ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'seller', 'admin', 'superadmin'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
  ON public.admin_audit_log (actor_user_id);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON public.admin_audit_log (created_at);

COMMIT;

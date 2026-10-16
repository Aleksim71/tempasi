-- path: src/db/migrations/20260506_0002_cart_items_case_context.sql
-- TEMPASI_STEP_TASER_NEXT_A
-- Preserve selected Case context from Add templates -> catalog -> details -> cart -> checkout.

ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS case_ids jsonb NULL;

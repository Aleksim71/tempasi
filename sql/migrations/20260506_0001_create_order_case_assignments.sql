-- sql/migrations/20260506_0001_create_order_case_assignments.sql

CREATE TABLE IF NOT EXISTS public.order_case_assignments (
  order_id integer NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, case_id)
);

CREATE INDEX IF NOT EXISTS order_case_assignments_case_id_idx
  ON public.order_case_assignments(case_id);

CREATE INDEX IF NOT EXISTS order_case_assignments_order_id_idx
  ON public.order_case_assignments(order_id);

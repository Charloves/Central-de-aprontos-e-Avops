-- Resolve Performance Advisor findings introduced by the legacy import workflow.
-- This migration does not alter data, RLS, grants, policies, functions, or constraints.

create index if not exists historical_import_batches_applied_by_idx
  on public.historical_import_batches using btree (applied_by);

create index if not exists historical_import_batches_canceled_by_idx
  on public.historical_import_batches using btree (canceled_by);

drop index if exists public.historical_import_batches_admin_status_idx;

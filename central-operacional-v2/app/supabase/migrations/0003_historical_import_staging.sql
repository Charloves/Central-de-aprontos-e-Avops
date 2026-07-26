-- Generic historical import staging.
--
-- This migration keeps ambiguous or otherwise unresolved legacy rows outside
-- definitive business tables. It preserves the original row and avoids
-- inventing values such as briefing_records.attendance_status, which remains
-- NOT NULL in the initial schema.
--
-- Future importers must compute source_file_hash with SHA-256 over the exact
-- file bytes before parsing. The hash is part of the deterministic identity of
-- an import batch.

create type historical_import_record_classification as enum (
  'valid',
  'invalid',
  'ambiguous',
  'duplicate',
  'imported'
);

create table historical_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_reference text,
  source_file_name text,
  source_file_hash text not null,
  record_type text,
  dry_run boolean not null default true,
  migrated boolean not null default true,
  status text not null default 'OPEN',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint historical_import_batches_source_file_hash_chk
    check (source_file_hash <> '')
);

comment on table historical_import_batches is
  'Control table for local legacy import batches. Reprocessing the same source/hash should reuse the batch instead of duplicating staging rows.';
comment on column historical_import_batches.dry_run is
  'True while the batch is only validated. A future controlled migration can create a non-dry-run batch.';
comment on column historical_import_batches.source_file_hash is
  'SHA-256 hash of the exact source file bytes. Required to make batch identity deterministic across reprocessing.';

create unique index historical_import_batches_source_file_unique_idx
  on historical_import_batches (source, coalesce(source_reference, ''), source_file_hash);

create table historical_import_staging_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references historical_import_batches(id) on delete cascade,
  source text not null,
  source_record_type text not null,
  source_row_number integer,
  idempotency_key text not null,
  original_content jsonb not null,
  normalized_content jsonb,
  classification historical_import_record_classification not null,
  issues jsonb not null default '[]'::jsonb,
  limitation_reason text,
  migrated boolean not null default true,
  resolved_entity_type text,
  resolved_entity_id uuid,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  resolution_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint historical_import_staging_batch_key_unique
    unique (batch_id, idempotency_key),
  constraint historical_import_staging_resolution_chk
    check (
      (resolved_entity_type is null and resolved_entity_id is null and resolved_at is null)
      or (resolved_entity_type is not null and resolved_entity_id is not null and resolved_at is not null)
    ),
  constraint historical_import_staging_limitation_chk
    check (classification not in ('ambiguous', 'invalid') or limitation_reason is not null)
);

comment on table historical_import_staging_records is
  'Preserves legacy rows that cannot safely be written directly to definitive tables. A coordinator can later resolve a row by linking it to a definitive entity without deleting the original JSON.';
comment on column historical_import_staging_records.original_content is
  'Original source row exactly as parsed from CSV or JSON, retained for audit.';
comment on column historical_import_staging_records.normalized_content is
  'Best-effort normalized values when available. Must not invent unknown historical facts.';
comment on column historical_import_staging_records.classification is
  'valid, invalid, ambiguous, duplicate or imported. Ambiguous rows require manual resolution before definitive write.';
comment on column historical_import_staging_records.resolved_entity_type is
  'Future polymorphic reference such as briefing_records, absence_justifications or another definitive table.';
comment on column historical_import_staging_records.resolved_entity_id is
  'UUID of the definitive record created or linked during manual resolution.';

create function prevent_historical_import_original_content_update()
returns trigger
language plpgsql
as $$
begin
  if old.original_content is distinct from new.original_content then
    raise exception 'original_content is immutable for historical import staging records'
      using errcode = '22000';
  end if;

  return new;
end;
$$;

create trigger historical_import_staging_original_content_immutable
before update on historical_import_staging_records
for each row
execute function prevent_historical_import_original_content_update();

create index historical_import_batches_status_idx
  on historical_import_batches (status, created_at);
create index historical_import_batches_source_idx
  on historical_import_batches (source, record_type);

create index historical_import_staging_batch_idx
  on historical_import_staging_records (batch_id);
create index historical_import_staging_classification_idx
  on historical_import_staging_records (classification, source_record_type);
create index historical_import_staging_resolution_idx
  on historical_import_staging_records (resolved_entity_type, resolved_entity_id);
create index historical_import_staging_idempotency_idx
  on historical_import_staging_records (idempotency_key);

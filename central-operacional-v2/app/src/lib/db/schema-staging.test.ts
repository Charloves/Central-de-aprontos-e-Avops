import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const initialSchema = readFileSync(resolve(__dirname, '../../../supabase/migrations/0001_initial_schema.sql'), 'utf8');
const stagingMigration = readFileSync(resolve(__dirname, '../../../supabase/migrations/0003_historical_import_staging.sql'), 'utf8');

describe('historical import staging schema', () => {
  it('keeps briefing_records attendance_status required in the initial schema', () => {
    expect(initialSchema).toContain('attendance_status text not null');
    expect(stagingMigration).not.toContain('alter table briefing_records');
  });

  it('creates import batches and staging records with idempotency', () => {
    expect(stagingMigration).toContain('create table historical_import_batches');
    expect(stagingMigration).toContain('create table historical_import_staging_records');
    expect(stagingMigration).toContain('unique (batch_id, idempotency_key)');
  });

  it('requires source_file_hash and prevents duplicate batches when source_reference is null', () => {
    expect(stagingMigration).toContain('source_file_hash text not null');
    expect(stagingMigration).toContain('historical_import_batches_source_file_hash_chk');
    expect(stagingMigration).toContain("check (source_file_hash <> '')");
    expect(stagingMigration).toContain('create unique index historical_import_batches_source_file_unique_idx');
    expect(stagingMigration).toContain("on historical_import_batches (source, coalesce(source_reference, ''), source_file_hash)");
  });

  it('captures classification, original content, issues and future resolution link', () => {
    expect(stagingMigration).toContain('historical_import_record_classification');
    expect(stagingMigration).toContain('original_content jsonb not null');
    expect(stagingMigration).toContain('normalized_content jsonb');
    expect(stagingMigration).toContain('issues jsonb not null');
    expect(stagingMigration).toContain('resolved_entity_type text');
    expect(stagingMigration).toContain('resolved_entity_id uuid');
  });

  it('requires limitation reason for ambiguous or invalid staging records', () => {
    expect(stagingMigration).toContain("classification not in ('ambiguous', 'invalid') or limitation_reason is not null");
  });

  it('documents SHA-256 as the future deterministic source file hash', () => {
    expect(stagingMigration).toContain('SHA-256 over the exact');
    expect(stagingMigration).toContain('SHA-256 hash of the exact source file bytes');
  });

  it('protects original_content from updates with trigger and clear error', () => {
    expect(stagingMigration).toContain('create function prevent_historical_import_original_content_update()');
    expect(stagingMigration).toContain('old.original_content is distinct from new.original_content');
    expect(stagingMigration).toContain("raise exception 'original_content is immutable for historical import staging records'");
    expect(stagingMigration).toContain('create trigger historical_import_staging_original_content_immutable');
    expect(stagingMigration).toContain('before update on historical_import_staging_records');
  });

  it('allows future resolution fields without requiring original_content changes', () => {
    expect(stagingMigration).toContain('resolved_entity_type text');
    expect(stagingMigration).toContain('resolved_entity_id uuid');
    expect(stagingMigration).toContain('resolved_by uuid references profiles(id)');
    expect(stagingMigration).toContain('resolution_notes text');
    expect(stagingMigration).toContain('historical_import_staging_resolution_chk');
  });
});

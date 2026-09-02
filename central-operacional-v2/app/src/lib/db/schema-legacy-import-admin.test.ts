import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase/migrations/20260902000100_legacy_import_admin_workflow.sql');
const sql = readFileSync(migrationPath, 'utf8');
const advisorMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20260902000200_fix_legacy_import_advisor_indexes.sql',
);
const advisorSql = readFileSync(advisorMigrationPath, 'utf8');

describe('legacy import admin migration contract', () => {
  it('adds confirmation state without changing previous migrations', () => {
    expect(sql).toContain('alter table public.historical_import_batches');
    expect(sql).toContain('confirmation_token_hash text');
    expect(sql).toContain("check (confirmation_token_hash is null or confirmation_token_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).not.toMatch(/drop\s+table|truncate\s+table|delete\s+from/i);
  });

  it('creates a single transactional apply RPC with fixed search_path', () => {
    expect(sql).toContain('create or replace function public.admin_apply_legacy_import_batch(');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = pg_catalog, pg_temp');
    expect(sql).toContain('for update');
  });

  it('keeps browser roles without execute grants and preserves service_role access', () => {
    expect(sql).toContain('revoke all on function public.admin_apply_legacy_import_batch(uuid, uuid, text, timestamptz) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.admin_apply_legacy_import_batch(uuid, uuid, text, timestamptz) to service_role;');
    expect(sql).not.toMatch(/grant\s+execute[\s\S]+to\s+(public|anon|authenticated)/i);
  });

  it('does not grant ADMIN during import and protects current admins', () => {
    expect(sql).toContain("and r.role = 'ADMIN'");
    expect(sql).toContain('admin profile cannot be imported');
    expect(sql).toContain("values (v_profile_id, 'USER'");
    expect(sql).not.toContain("'ADMIN', p_actor_profile_id");
  });

  it('records sanitized audit and no policies or indexes unrelated to the workflow', () => {
    expect(sql).toContain("'LEGACY_IMPORT_APPLIED'");
    expect(sql).toContain("'applied_records'");
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/create\s+index\s+concurrently/i);
  });

  it('does not alter existing migrations or create browser policies', () => {
    const previousMigrations = [
      '0001_initial_schema.sql',
      '0002_publication_history_snapshots.sql',
      '0003_historical_import_staging.sql',
      '0004_auth_security_state.sql',
      '0005_security_hardening.sql',
      '0006_protect_public_default_privileges.sql',
      '0007_add_foreign_key_indexes.sql',
      '0008_fix_login_failure_audit_event_type.sql',
      '20260901005200_fix_profile_audience_code_ambiguity.sql',
    ];

    for (const migration of previousMigrations) {
      expect(readFileSync(join(process.cwd(), 'supabase/migrations', migration), 'utf8')).not.toContain('admin_apply_legacy_import_batch');
    }
  });

  it('adds only advisor indexes needed by the new foreign keys and removes the duplicate status index', () => {
    expect(advisorSql).toContain('create index if not exists historical_import_batches_applied_by_idx');
    expect(advisorSql).toContain('on public.historical_import_batches using btree (applied_by)');
    expect(advisorSql).toContain('create index if not exists historical_import_batches_canceled_by_idx');
    expect(advisorSql).toContain('on public.historical_import_batches using btree (canceled_by)');
    expect(advisorSql).toContain('drop index if exists public.historical_import_batches_admin_status_idx;');
    expect(advisorSql).not.toMatch(/create\s+index\s+concurrently/i);
    expect(advisorSql).not.toMatch(/alter\s+table|create\s+policy|grant\s+|revoke\s+|insert\s+into|update\s+|delete\s+from|truncate\s+table/i);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hardeningMigration = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/0005_security_hardening.sql'),
  'utf8',
);
const stagingMigration = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/0003_historical_import_staging.sql'),
  'utf8',
);

const publicTables = [
  'profiles',
  'profile_roles',
  'audiences',
  'profile_audiences',
  'avops',
  'avop_audiences',
  'avop_acknowledgements',
  'briefings',
  'briefing_audiences',
  'briefing_records',
  'absence_justifications',
  'ois',
  'notification_schedule',
  'notification_log',
  'audit_log',
  'backup_index',
  'settings',
  'profile_audience_history',
  'avop_publication_snapshots',
  'avop_publication_snapshot_members',
  'briefing_publication_snapshots',
  'briefing_publication_snapshot_members',
  'historical_import_batches',
  'historical_import_staging_records',
  'auth_rate_limit_buckets',
  'auth_temporary_blocks',
  'auth_sessions',
  'auth_audit_events',
];

const securityTables = [
  'auth_rate_limit_buckets',
  'auth_temporary_blocks',
  'auth_sessions',
  'auth_audit_events',
];

const authFunctions = [
  'auth_assert_hash(text, text, boolean)',
  'auth_assert_metadata(jsonb)',
  'auth_check_temporary_block(text, text, boolean, boolean, timestamptz)',
  'auth_acquire_login_locks(text, text, boolean, boolean)',
  'auth_finalize_login_failure(text, text, text, integer, integer, integer, boolean, boolean, timestamptz)',
  'auth_finalize_login_success(uuid, text, text, text, text, text, timestamptz, boolean, boolean, timestamptz)',
  'auth_touch_session(text, integer, timestamptz)',
  'auth_revoke_session(text, text, timestamptz)',
  'auth_revoke_profile_sessions(uuid, text, timestamptz)',
  'auth_record_audit_event(uuid, uuid, auth_audit_event_type, text, text, text, text, jsonb, timestamptz)',
  'auth_cleanup_security_state(timestamptz, integer, integer, integer, integer)',
];

const serviceRoleAuthRpcs = [
  'auth_check_temporary_block(text, text, boolean, boolean, timestamptz)',
  'auth_finalize_login_failure(text, text, text, integer, integer, integer, boolean, boolean, timestamptz)',
  'auth_finalize_login_success(uuid, text, text, text, text, text, timestamptz, boolean, boolean, timestamptz)',
  'auth_touch_session(text, integer, timestamptz)',
  'auth_revoke_session(text, text, timestamptz)',
  'auth_revoke_profile_sessions(uuid, text, timestamptz)',
  'auth_record_audit_event(uuid, uuid, auth_audit_event_type, text, text, text, text, jsonb, timestamptz)',
  'auth_cleanup_security_state(timestamptz, integer, integer, integer, integer)',
];

describe('security hardening migration', () => {
  it('enables RLS on every public table without creating permissive browser policies', () => {
    for (const tableName of publicTables) {
      expect(hardeningMigration).toContain(`alter table ${tableName} enable row level security`);
    }

    expect(hardeningMigration).not.toMatch(/\bcreate\s+policy\b/i);
    expect(hardeningMigration).not.toMatch(/\bto\s+(public|anon|authenticated)\b/i);
  });

  it('revokes table access from browser roles and grants backend access to service_role', () => {
    expect(hardeningMigration).toContain('from public, anon, authenticated');
    expect(hardeningMigration).toContain('to service_role');

    for (const tableName of publicTables) {
      expect(hardeningMigration).toContain(tableName);
    }

    expect(hardeningMigration).toContain('revoke all privileges on all sequences in schema public');
    expect(hardeningMigration).toContain('grant all privileges on all sequences in schema public to service_role');
  });

  it('protects the public schema and future objects from accidental browser exposure', () => {
    expect(hardeningMigration).toContain('revoke create on schema public from public, anon, authenticated');
    expect(hardeningMigration).toContain('revoke all privileges on schema public from public, anon, authenticated');
    expect(hardeningMigration).toContain('grant usage on schema public to service_role');
    expect(hardeningMigration).toContain('alter default privileges in schema public');
    expect(hardeningMigration).toContain('revoke all privileges on tables from public, anon, authenticated');
    expect(hardeningMigration).toContain('revoke all privileges on sequences from public, anon, authenticated');
    expect(hardeningMigration).toContain('revoke all privileges on functions from public, anon, authenticated');
    expect(hardeningMigration).toContain('grant execute on functions to service_role');
  });

  it('keeps authentication security tables accessible only through service_role RPC/backend paths', () => {
    for (const tableName of securityTables) {
      expect(hardeningMigration).toContain(`alter table ${tableName} enable row level security`);
      expect(hardeningMigration).toContain(tableName);
    }

    for (const functionSignature of authFunctions) {
      expect(hardeningMigration).toContain(`revoke all on function ${functionSignature} from public, anon, authenticated`);
    }

    for (const functionSignature of serviceRoleAuthRpcs) {
      expect(hardeningMigration).toContain(`grant execute on function ${functionSignature} to service_role`);
    }

    expect(hardeningMigration).not.toContain('grant execute on function auth_assert_hash');
    expect(hardeningMigration).not.toContain('grant execute on function auth_assert_metadata');
    expect(hardeningMigration).not.toContain('grant execute on function auth_acquire_login_locks');
  });

  it('fixes search_path on the staging immutability trigger function', () => {
    expect(hardeningMigration).toContain('create or replace function prevent_historical_import_original_content_update()');
    expect(hardeningMigration).toContain('set search_path = pg_catalog, pg_temp');
    expect(hardeningMigration).not.toContain('set search_path = public, pg_temp');
    expect(hardeningMigration).toContain('old.original_content is distinct from new.original_content');
    expect(hardeningMigration).toContain("raise exception 'original_content is immutable for historical import staging records'");
    expect(hardeningMigration).toContain('revoke all on function prevent_historical_import_original_content_update()');
    expect(hardeningMigration).toContain('grant execute on function prevent_historical_import_original_content_update() to service_role');
  });

  it('preserves the existing staging immutability trigger without dropping it', () => {
    expect(stagingMigration).toContain('create trigger historical_import_staging_original_content_immutable');
    expect(stagingMigration).toContain('execute function prevent_historical_import_original_content_update()');
    expect(hardeningMigration).not.toContain('drop trigger');
    expect(hardeningMigration).not.toContain('drop function prevent_historical_import_original_content_update');
  });
});

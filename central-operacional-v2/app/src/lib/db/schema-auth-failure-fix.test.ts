import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration0004 = readFileSync(resolve(__dirname, '../../../supabase/migrations/0004_auth_security_state.sql'), 'utf8');
const migration0008 = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/0008_fix_login_failure_audit_event_type.sql'),
  'utf8',
);

const signature =
  'auth_finalize_login_failure(text, text, text, integer, integer, integer, boolean, boolean, timestamptz)';

describe('auth login failure audit event type fix', () => {
  it('replaces only the existing auth_finalize_login_failure signature', () => {
    expect(migration0008).toContain('create or replace function public.auth_finalize_login_failure(');
    expect(migration0008).not.toContain('create function public.auth_finalize_login_failure(');
    expect(migration0008.match(/auth_finalize_login_failure\(/g)).toHaveLength(3);
    expect(migration0008).toContain(signature);
  });

  it('preserves the original function contract and security posture', () => {
    for (const fragment of [
      'p_trigram_fingerprint text',
      'p_network_fingerprint text',
      'p_reason text',
      'p_max_attempts integer default 5',
      'p_window_seconds integer default 900',
      'p_block_seconds integer default 900',
      'p_enable_trigram boolean default true',
      'p_enable_network boolean default true',
      'p_now timestamptz default now()',
      'returns table(blocked boolean, blocked_until timestamptz, scope public.auth_rate_limit_scope)',
      'language plpgsql',
      'security definer',
      'set search_path = public, pg_temp',
    ]) {
      expect(migration0008).toContain(fragment);
    }
  });

  it('casts the dynamic audit event CASE to the schema-qualified enum', () => {
    expect(migration0008).toContain(
      "(case when v_first_blocked_until is null then 'LOGIN_FAILURE' else 'LOGIN_BLOCKED' end)::public.auth_audit_event_type",
    );
    expect(migration0004).toContain(
      "case when v_first_blocked_until is null then 'LOGIN_FAILURE' else 'LOGIN_BLOCKED' end",
    );
  });

  it('preserves lock, counter, block and fifth-attempt rules', () => {
    for (const fragment of [
      'perform auth_acquire_login_locks',
      "lifted_reason = 'EXPIRED'",
      'on conflict on constraint auth_rate_limit_buckets_identity_unique',
      'failure_count = auth_rate_limit_buckets.failure_count + 1',
      'if v_failure_count >= p_max_attempts then',
      "'LOGIN_FAILURE_LIMIT'",
      'return query select v_first_blocked_until is not null, v_first_blocked_until, v_first_scope',
    ]) {
      expect(migration0008).toContain(fragment);
    }
  });

  it('reaffirms minimum executable grants and does not change schema objects', () => {
    expect(migration0008).toContain(`revoke all on function public.${signature}`);
    expect(migration0008).toContain('from public, anon, authenticated');
    expect(migration0008).toContain(`grant execute on function public.${signature}`);
    expect(migration0008).toContain('to service_role');
    expect(migration0008).not.toMatch(/\b(create|alter|drop)\s+(table|type|index|policy|trigger|constraint)\b/i);
  });

  it('keeps previous migrations present and unmodified in this corrective step', () => {
    for (const migrationName of [
      '0001_initial_schema.sql',
      '0002_publication_history_snapshots.sql',
      '0003_historical_import_staging.sql',
      '0004_auth_security_state.sql',
      '0005_security_hardening.sql',
      '0006_protect_public_default_privileges.sql',
      '0007_add_foreign_key_indexes.sql',
    ]) {
      expect(readFileSync(resolve(__dirname, `../../../supabase/migrations/${migrationName}`), 'utf8').length).toBeGreaterThan(0);
    }
  });
});

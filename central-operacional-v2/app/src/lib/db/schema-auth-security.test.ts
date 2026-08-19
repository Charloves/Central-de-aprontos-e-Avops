import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(resolve(__dirname, '../../../supabase/migrations/0004_auth_security_state.sql'), 'utf8');

describe('auth security schema', () => {
  it('creates persistent rate-limit, block, session and audit tables', () => {
    expect(migration).toContain('create table auth_rate_limit_buckets');
    expect(migration).toContain('create table auth_temporary_blocks');
    expect(migration).toContain('create table auth_sessions');
    expect(migration).toContain('create table auth_audit_events');
  });

  it('uses generated non-null keys and normal unique constraints for ON CONFLICT', () => {
    expect(migration).toContain("trigram_key text generated always as (coalesce(trigram_fingerprint, '')) stored");
    expect(migration).toContain("network_key text generated always as (coalesce(network_fingerprint, '')) stored");
    expect(migration).toContain('constraint auth_rate_limit_buckets_identity_unique unique');
    expect(migration).toContain('constraint auth_temporary_blocks_active_unique unique');
    expect(migration).toContain('on conflict on constraint auth_rate_limit_buckets_identity_unique');
    expect(migration).not.toContain('on conflict on constraint auth_temporary_blocks_active_unique');
    expect(migration).not.toContain('on conflict (\n      scope,\n      coalesce');
  });

  it('closes expired temporary blocks before inserting a new cycle', () => {
    expect(migration).toContain('lifted_reason text');
    expect(migration).toContain("lifted_reason = 'EXPIRED'");
    expect(migration).toContain('b.blocked_until <= p_now');
    expect(migration).toContain('active_marker = b.id::text');
    expect(migration).toContain('Each block cycle is a separate row');
    expect(migration).not.toContain('greatest(auth_temporary_blocks.failed_attempts');
    expect(migration).not.toContain('greatest(auth_temporary_blocks.blocked_until');
  });

  it('validates SHA-256 fingerprint formats, counters and scope-specific fingerprints', () => {
    expect(migration).toContain("~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("scope = 'TRIGRAM' and trigram_fingerprint is not null and network_fingerprint is null");
    expect(migration).toContain("scope = 'NETWORK' and trigram_fingerprint is null and network_fingerprint is not null");
    expect(migration).toContain("scope = 'COMBINED' and trigram_fingerprint is not null and network_fingerprint is not null");
    expect(migration).toContain('failure_count >= 0 and success_count >= 0');
    expect(migration).toContain('failed_attempts > 0');
  });

  it('has transacional finalization RPCs with deterministic advisory lock ordering', () => {
    expect(migration).toContain('create function auth_finalize_login_failure');
    expect(migration).toContain('create function auth_finalize_login_success');
    expect(migration).toContain('create function auth_acquire_login_locks');
    expect(migration).toContain('order by key');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = public, pg_temp');
  });

  it('documents fifth failure behavior and blocks a sixth attempt through finalization checks', () => {
    expect(migration).toContain('if v_failure_count >= p_max_attempts then');
    expect(migration).toContain("perform auth_record_audit_event(null, null, 'LOGIN_BLOCKED'");
    expect(migration).toContain("perform auth_record_audit_event(p_profile_id, null, 'LOGIN_BLOCKED'");
    expect(migration).toContain('return query select null::uuid, true, v_blocked_until');
  });

  it('stores only hashes for sessions and supports revocation with limited touch writes', () => {
    expect(migration).toContain('session_identifier_hash text not null unique');
    expect(migration).toContain('nonce_hash text not null unique');
    expect(migration).toContain('revoked_at timestamptz');
    expect(migration).toContain('create function auth_revoke_session');
    expect(migration).toContain('create function auth_revoke_profile_sessions');
    expect(migration).toContain('p_touch_interval_seconds integer default 300');
    expect(migration).toContain('s.last_seen_at <= p_now - make_interval');
  });

  it('enables RLS and blocks browser roles on tables and functions', () => {
    for (const tableName of ['auth_rate_limit_buckets', 'auth_temporary_blocks', 'auth_sessions', 'auth_audit_events']) {
      expect(migration).toContain(`alter table ${tableName} enable row level security`);
      expect(migration).toContain(`revoke all on table ${tableName} from public, anon, authenticated`);
    }

    expect(migration).toContain('revoke all on function auth_finalize_login_failure');
    expect(migration).toContain('revoke all on function auth_finalize_login_success');
    expect(migration).toContain('grant execute on function auth_finalize_login_failure');
    expect(migration).toContain('grant execute on function auth_finalize_login_success');
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain('create policy');
  });

  it('restricts metadata and validates RPC inputs before writes', () => {
    expect(migration).toContain("metadata = '{}'::jsonb");
    expect(migration).toContain('create function auth_assert_hash');
    expect(migration).toContain('create function auth_assert_metadata');
    expect(migration).toContain('invalid authentication fingerprint');
    expect(migration).toContain('invalid authentication metadata');
  });

  it('cleans expired state with separate retention windows and keeps audit retention explicit', () => {
    expect(migration).toContain('p_bucket_retention_seconds integer default 86400');
    expect(migration).toContain('p_block_retention_seconds integer default 604800');
    expect(migration).toContain('p_session_retention_seconds integer default 2592000');
    expect(migration).toContain('p_audit_retention_seconds integer default 31536000');
    expect(migration).toContain('coalesce(lifted_at, blocked_until)');
    expect(migration).toContain('coalesce(revoked_at, expires_at)');
    expect(migration).toContain('delete from auth_audit_events');
  });

  it('documents privacy and backend-only operation', () => {
    expect(migration).toContain('stores no trigram, IP address, user-agent, token or');
    expect(migration).toContain('Supabase service role');
    expect(migration).toContain('AUTH_FINGERPRINT_SECRET');
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(__dirname, '../../../supabase/migrations');
const migrationName = readdirSync(migrationsDir).find((name) => name.endsWith('_avop_email_notifications.sql'));
if (!migrationName) throw new Error('AVOP email notification migration not found.');

const migration = readFileSync(resolve(migrationsDir, migrationName), 'utf8');

describe('AVOP email notification migration', () => {
  it('extends notification tables without changing applied migrations', () => {
    expect(migration).toContain('alter table public.notification_schedule');
    expect(migration).toContain('alter table public.notification_log');
    expect(migration).not.toContain('drop table');
    expect(migration).not.toContain('truncate ');
    expect(migration).not.toContain('delete from');
  });

  it('adds reservation, marker, idempotency and stop-state columns', () => {
    for (const column of [
      'notification_type',
      'marker',
      'reserved_until',
      'reservation_token_hash',
      'permanent_failure_at',
      'stopped_reason',
      'idempotency_key',
      'error_kind',
      'attempt_number',
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain('notification_log_idempotency_key_unique');
    expect(migration).toContain("reservation_token_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("idempotency_key ~ '^[0-9a-f]{64}$'");
  });

  it('creates backend-only RPCs for list, reserve and result recording', () => {
    expect(migration).toContain('create or replace function public.list_avop_notification_candidates');
    expect(migration).toContain('create or replace function public.reserve_avop_notification');
    expect(migration).toContain('create or replace function public.record_avop_notification_result');
    expect(migration).toContain("set search_path = 'pg_catalog', 'pg_temp'");
    expect(migration).toContain('for update');
    expect(migration).toContain('on conflict (idempotency_key) where idempotency_key is not null do nothing');
  });

  it('supports controlled stop events without treating them as sent messages', () => {
    expect(migration).toContain("'AVOP_SKIPPED'");
    expect(migration).toContain('p_result in (');
    expect(migration).toContain('v_logged and p_result in');
    expect(migration).toContain("p_stop_reason is not null or p_result = 'PERMANENT_ERROR'");
  });

  it('keeps candidates based on current applicability without mutating historical snapshots', () => {
    expect(migration).toContain('public.avop_audiences');
    expect(migration).toContain('public.profile_audiences');
    expect(migration).toContain("'TODOS' = any");
    expect(migration).toContain('public.avop_acknowledgements');
    expect(migration).not.toContain('avop_publication_snapshot_members');
    expect(migration).not.toContain('update public.avop_publication');
  });

  it('restricts RPC execution to service_role', () => {
    for (const functionName of [
      'public.list_avop_notification_candidates(date)',
      'public.reserve_avop_notification(uuid, uuid, text, text, timestamptz, text, timestamptz, timestamptz)',
      'public.record_avop_notification_result(uuid, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, timestamptz)',
    ]) {
      expect(migration).toContain(`revoke execute on function ${functionName} from public, anon, authenticated;`);
      expect(migration).toContain(`grant execute on function ${functionName} to service_role;`);
    }
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../../supabase/migrations');
const migrationName = readdirSync(migrationsDir).find((name) => name.endsWith('_auto_close_briefings_cron.sql'));

if (!migrationName) {
  throw new Error('auto close briefings cron migration not found');
}

const migration = readFileSync(resolve(migrationsDir, migrationName), 'utf8');
const previousMigrations = [
  '0001_initial_schema.sql',
  '0002_publication_history_snapshots.sql',
  '0003_historical_import_staging.sql',
  '0004_auth_security_state.sql',
  '0005_security_hardening.sql',
  '0006_protect_public_default_privileges.sql',
  '0007_add_foreign_key_indexes.sql',
  '0008_fix_login_failure_audit_event_type.sql',
] as const;

describe('briefing automatic closure cron migration', () => {
  it('creates pg_cron-backed internal function with stable security posture', () => {
    expect(migration).toContain('create extension if not exists pg_cron;');
    expect(migration).toContain('create schema if not exists internal;');
    expect(migration).toContain('create or replace function internal.auto_close_due_briefings(');
    expect(migration).toContain('p_now timestamptz default now()');
    expect(migration).toContain('returns integer');
    expect(migration).toContain('security invoker');
    expect(migration).toContain('set search_path = pg_catalog, pg_temp');
    expect(migration).not.toMatch(/\bsecurity\s+definer\b/i);
  });

  it('uses the America/Sao_Paulo fourth-day boundary explicitly', () => {
    expect(migration).toContain("(p_now at time zone 'America/Sao_Paulo') >= ((b.event_date + 3)::timestamp)");
    expect(migration).toContain("'time_zone', 'America/Sao_Paulo'");
  });

  it('closes only OPEN briefings and preserves already CLOSED or invalid records', () => {
    expect(migration).toContain("b.status = 'OPEN'::public.briefing_status");
    expect(migration).toContain('b.event_date is not null');
    expect(migration).toContain("status = 'CLOSED'::public.briefing_status");
    expect(migration).toContain("closure_type = 'AUTOMATIC'::public.closure_type");
    expect(migration).not.toMatch(/update\s+public\.briefing_records/i);
    expect(migration).not.toMatch(/update\s+public\.absence_justifications/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.briefing_records/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.absence_justifications/i);
  });

  it('uses a set-based concurrent-safe update and audits only actual closures', () => {
    expect(migration).toContain('for update skip locked');
    expect(migration).toContain('closed_briefings as (');
    expect(migration).toContain('returning b.id, b.legacy_id, b.event_date');
    expect(migration).toContain('insert into public.audit_log');
    expect(migration).toContain("'BRIEFING_AUTO_CLOSED'");
    expect(migration).toContain('from closed_briefings');
    expect(migration).toContain('from audit_rows');
    expect(migration).not.toMatch(/\bloop\b/i);
  });

  it('uses a single stable hourly cron job and never calls HTTP or edits cron.job directly', () => {
    expect(migration).toContain('select cron.schedule(');
    expect(migration).toContain("'central_operacional_auto_close_briefings'");
    expect(migration).toContain("'0 * * * *'");
    expect(migration).toContain('$$select internal.auto_close_due_briefings();$$');
    expect(migration).not.toMatch(/\b(insert|update|delete)\s+(into\s+)?cron\.job\b/i);
    expect(migration).not.toMatch(/\bhttp\b/i);
    expect(migration).not.toMatch(/\bnet\./i);
    expect(migration).not.toMatch(/token|secret|authorization/i);
  });

  it('blocks browser roles and grants only the backend role', () => {
    expect(migration).toContain('revoke all on schema internal from public, anon, authenticated;');
    expect(migration).toContain('grant usage on schema internal to service_role;');
    expect(migration).toContain('revoke all on function internal.auto_close_due_briefings(timestamptz) from public, anon, authenticated;');
    expect(migration).toContain('grant execute on function internal.auto_close_due_briefings(timestamptz) to service_role;');
    expect(migration).not.toMatch(/\bgrant\b[\s\S]*\bto\s+(public|anon|authenticated)\b/i);
  });

  it('keeps previous migrations present and untouched in this step', () => {
    for (const name of previousMigrations) {
      expect(readFileSync(resolve(migrationsDir, name), 'utf8').length).toBeGreaterThan(0);
    }
  });
});

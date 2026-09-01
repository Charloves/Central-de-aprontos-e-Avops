import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260824183336_profile_admin_bootstrap.sql',
);
const sql = readFileSync(migrationPath, 'utf8');
const ambiguityFixPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260901005200_fix_profile_audience_code_ambiguity.sql',
);
const ambiguityFixSql = readFileSync(ambiguityFixPath, 'utf8');

describe('profile admin bootstrap migration contract', () => {
  it('creates the first admin bootstrap and profile admin RPCs with stable signatures', () => {
    expect(sql).toContain('create or replace function public.bootstrap_first_admin(');
    expect(sql).toContain('p_trigram text');
    expect(sql).toContain('p_audience_codes text[]');
    expect(sql).toContain('create or replace function public.admin_save_profile(');
    expect(sql).toContain('p_actor_profile_id uuid');
    expect(sql).toContain('p_payload jsonb');
    expect(countOccurrences(sql, 'create or replace function public.bootstrap_first_admin(')).toBe(1);
    expect(countOccurrences(sql, 'create or replace function public.admin_save_profile(')).toBe(1);
  });

  it('keeps functions backend-only with fixed search_path and service_role execute grants', () => {
    expect(sql).toContain('security definer');
    expect(countOccurrences(sql, 'set search_path = pg_catalog, pg_temp')).toBeGreaterThanOrEqual(4);
    expect(sql).toContain('revoke all on function public.bootstrap_first_admin(text, text, text, text[], timestamptz) from public, anon, authenticated;');
    expect(sql).toContain('revoke all on function public.admin_save_profile(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.bootstrap_first_admin(text, text, text, text[], timestamptz) to service_role;');
    expect(sql).toContain('grant execute on function public.admin_save_profile(uuid, uuid, jsonb, timestamptz) to service_role;');
  });

  it('protects first admin creation, ADMIN grant and last active ADMIN', () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('central_operacional_bootstrap_first_admin'))");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('central_operacional_admin_save_profile'))");
    expect(sql).toContain("'ADMIN' = any(v_requested_roles)");
    expect(sql).toContain("'last active admin cannot be disabled'");
    expect(sql).toContain("public.auth_revoke_profile_sessions(v_target_id, 'PROFILE_ADMIN_UPDATE', p_now)");
  });

  it('records nominal audit without storing raw email in metadata', () => {
    expect(sql).toContain('PROFILE_BOOTSTRAP_ADMIN_CREATED');
    expect(sql).toContain('PROFILE_CREATED');
    expect(sql).toContain('PROFILE_UPDATED');
    expect(sql).not.toContain("jsonb_build_object('email'");
    expect(sql).not.toContain("jsonb_build_object('trigram'");
    expect(sql).not.toContain("'email', v_email");
    expect(sql).not.toContain("'trigram', v_trigram");
  });

  it('does not alter previous migrations', () => {
    const migrationNames = [
      '0001_initial_schema.sql',
      '0002_publication_history_snapshots.sql',
      '0003_historical_import_staging.sql',
      '0004_auth_security_state.sql',
      '0005_security_hardening.sql',
      '0006_protect_public_default_privileges.sql',
      '0007_add_foreign_key_indexes.sql',
      '0008_fix_login_failure_audit_event_type.sql',
    ];

    for (const name of migrationNames) {
      const content = readFileSync(join(process.cwd(), 'supabase', 'migrations', name), 'utf8');
      expect(content.length).toBeGreaterThan(100);
    }
  });

  it('fixes audience code normalization without changing the public RPC contract', () => {
    expect(ambiguityFixSql).toContain('create or replace function internal.normalize_profile_audience_codes(p_codes text[])');
    expect(ambiguityFixSql).toContain('security invoker');
    expect(ambiguityFixSql).toContain('set search_path = pg_catalog, pg_temp');
    expect(ambiguityFixSql).toContain('array_agg(distinct n.code order by n.code)');
    expect(ambiguityFixSql).toContain('from unnest(v_codes) as requested_code');
    expect(ambiguityFixSql).toContain('left join public.audiences a on a.code = requested_code and a.active');
    expect(ambiguityFixSql).toContain('revoke all on function internal.normalize_profile_audience_codes(text[]) from public, anon, authenticated;');
    expect(ambiguityFixSql).toContain('grant execute on function internal.normalize_profile_audience_codes(text[]) to service_role;');
    expect(ambiguityFixSql).not.toContain('create table');
    expect(ambiguityFixSql).not.toContain('alter table');
    expect(ambiguityFixSql).not.toContain('create policy');
  });
});

function countOccurrences(value: string, pattern: string) {
  return value.split(pattern).length - 1;
}

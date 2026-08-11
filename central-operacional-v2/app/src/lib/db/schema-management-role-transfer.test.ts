import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migration = readFileSync(join(migrationsDir, '20260811175851_transfer_management_roles.sql'), 'utf8');

describe('management role transfer migration', () => {
  it('creates the transactional implementation in internal schema with stable lock', () => {
    expect(migration).toContain('create or replace function internal.transfer_management_roles');
    expect(migration).toContain('security invoker');
    expect(migration).toContain('set search_path = pg_catalog, pg_temp');
    expect(migration).toContain('pg_advisory_xact_lock(2026081117, 5851)');
  });

  it('revalidates active origin admin and active different target after the lock', () => {
    expect(migration).toContain("regexp_replace(coalesce(p_target_trigram, ''), '[[:space:]]+', '', 'g')");
    expect(migration).toContain('where id = p_actor_profile_id');
    expect(migration).toContain('and active = true');
    expect(migration).toContain("and role = 'ADMIN'::public.app_role");
    expect(migration).toContain('where trigram = v_normalized_target');
    expect(migration).toContain('if v_target.id = v_actor.id then');
  });

  it('preserves USER, transfers ADMIN and COORDINATOR together and only removes them from origin', () => {
    expect(migration).toContain("'USER'::public.app_role");
    expect(migration).toContain("'ADMIN'::public.app_role");
    expect(migration).toContain("'COORDINATOR'::public.app_role");
    expect(migration).toMatch(
      /values\s+\(v_target\.id, 'USER'::public\.app_role,[\s\S]*?on conflict \(profile_id, role\) do nothing;\s+insert into public\.profile_roles[\s\S]*?\(v_target\.id, 'ADMIN'::public\.app_role/i,
    );
    expect(migration).toContain("where profile_id = v_actor.id");
    expect(migration).toContain("role in ('ADMIN'::public.app_role, 'COORDINATOR'::public.app_role)");
    expect(migration).not.toMatch(/delete from public\.profile_roles[\s\S]*profile_id\s*<>\s*v_actor\.id/i);
  });

  it('writes one audit event in the same function without raw trigram metadata', () => {
    expect(migration).toContain('MANAGEMENT_ROLES_TRANSFERRED');
    expect(migration).toContain('insert into public.audit_log');
    expect(migration).toContain('roles_transferred');
    expect(migration).not.toContain('from_trigram');
    expect(migration).not.toContain('to_trigram');
  });

  it('keeps browser roles blocked and grants execute only to service_role', () => {
    expect(migration).toContain('revoke usage, create on schema internal from public, anon, authenticated');
    expect(migration).toContain('grant usage on schema internal to service_role');
    expect(migration).toContain('revoke all on function internal.transfer_management_roles(uuid, text, timestamptz) from public, anon, authenticated');
    expect(migration).toContain('grant execute on function internal.transfer_management_roles(uuid, text, timestamptz) to service_role');
    expect(migration).toContain('revoke all on function public.transfer_management_roles(uuid, text, timestamptz) from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.transfer_management_roles(uuid, text, timestamptz) to service_role');
  });

  it('does not hardcode CHA or USR and does not transfer during migration application', () => {
    expect(migration).not.toContain('CHA');
    expect(migration).not.toContain('USR');
    expect(migration).not.toMatch(/select\s+internal\.transfer_management_roles\('?[0-9a-f-]+'?/i);
  });
});

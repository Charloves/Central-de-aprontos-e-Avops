import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260926133202_support_material_ack_without_attendance.sql';
const migrationPath = join(process.cwd(), 'supabase/migrations', migrationName);
const sql = readFileSync(migrationPath, 'utf8');

describe('material acknowledgement without attendance migration', () => {
  it('makes only attendance_status nullable on briefing_records', () => {
    expect(sql).toContain('alter table public.briefing_records');
    expect(sql).toContain('alter column attendance_status drop not null;');
    expect(sql).not.toMatch(/drop\s+(table|column|index)|truncate\s+table|delete\s+from/i);
  });

  it('preserves the apply RPC signature and fixed security boundary', () => {
    expect(sql).toContain('create or replace function public.admin_apply_legacy_import_batch(');
    expect(sql).toContain('p_actor_profile_id uuid');
    expect(sql).toContain('p_batch_id uuid');
    expect(sql).toContain('p_confirmation_token_hash text');
    expect(sql).toContain('p_now timestamptz default now()');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = pg_catalog, pg_temp');
    expect(sql).toContain('for update;');
  });

  it('creates a material-only briefing record without inventing attendance', () => {
    expect(sql).toContain("or coalesce((v_payload->>'materialAcknowledged')::boolean, false)");
    expect(sql).toContain("nullif(v_payload->>'attendanceStatus', '')");
    expect(sql).toContain('insert into public.briefing_records');
  });

  it('merges concurrent or repeated imports without overwriting attendance or first timestamp', () => {
    expect(sql).toContain('on conflict (briefing_id, profile_id) do update');
    expect(sql).toContain('public.briefing_records.attendance_status');
    expect(sql).toContain('excluded.attendance_status');
    expect(sql).toContain('public.briefing_records.material_acknowledged');
    expect(sql).toContain('or excluded.material_acknowledged');
    const conflictClause = sql.slice(sql.indexOf('on conflict (briefing_id, profile_id) do update'));
    expect(conflictClause.slice(0, conflictClause.indexOf('returning id into v_record_id'))).not.toContain('recorded_at =');
  });

  it('keeps browser roles revoked and service_role access explicit', () => {
    expect(sql).toContain(
      'revoke all on function public.admin_apply_legacy_import_batch(uuid, uuid, text, timestamptz) from public, anon, authenticated;',
    );
    expect(sql).toContain(
      'grant execute on function public.admin_apply_legacy_import_batch(uuid, uuid, text, timestamptz) to service_role;',
    );
    expect(sql).not.toMatch(/create\s+policy|grant\s+execute[\s\S]+to\s+(public|anon|authenticated)/i);
  });
});

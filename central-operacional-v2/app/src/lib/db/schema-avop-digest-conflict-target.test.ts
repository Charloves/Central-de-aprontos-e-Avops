import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations/20261001113000_fix_avop_digest_reservation_conflict_target.sql',
);
const sql = readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('AVOP digest reservation conflict target correction', () => {
  it('qualifica o alvo de conflito pela constraint existente', () => {
    expect(normalized).toContain(
      'on conflict on constraint notification_schedule_activity_type_activity_id_profile_id_key',
    );
    expect(normalized).not.toContain('on conflict (activity_type, activity_id, profile_id)');
  });

  it('preserva atomicidade, concorrencia e validacoes da reserva', () => {
    expect(normalized).toContain('from public.profiles p where p.id = p_profile_id for update');
    expect(normalized).toContain('if v_reserved_count <> v_item_count');
    expect(normalized).toContain('duplicate digest item');
    expect(normalized).toContain("nl.result = 'sent'");
  });

  it('preserva security invoker, search_path e acesso exclusivo do backend', () => {
    expect(normalized).toContain('security invoker');
    expect(normalized).toContain("set search_path = 'pg_catalog', 'pg_temp'");
    expect(normalized).toContain(
      'revoke execute on function public.reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz) from public, anon, authenticated',
    );
    expect(normalized).toContain(
      'grant execute on function public.reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz) to service_role',
    );
    expect(normalized).not.toMatch(/create\s+policy|grant\s+.+\s+to\s+(anon|authenticated)/);
  });

  it('nao altera tabelas, dados ou a RPC de finalizacao', () => {
    expect(normalized).not.toMatch(/alter\s+table|create\s+table|drop\s+|truncate|delete\s+from/);
    expect(normalized).not.toContain('create or replace function public.record_avop_notification_digest_result');
  });
});

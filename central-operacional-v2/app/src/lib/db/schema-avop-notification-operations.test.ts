import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations/20260929143804_harden_avop_notification_operations.sql',
);
const sql = readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('AVOP notification operational hardening migration', () => {
  it('separa simulacao de envio real em reserva, contadores e candidatos', () => {
    expect(normalized).not.toContain("nl.result in ('sent', 'dry_run')");
    expect(normalized).not.toContain("p_result in ('sent', 'dry_run')");
    expect(normalized.match(/nl\.result = 'sent'/g)?.length).toBeGreaterThanOrEqual(5);
    expect(normalized).toContain("last_sent_at = case when v_logged and p_result = 'sent'");
    expect(normalized).toContain("send_count = case when v_logged and p_result = 'sent'");
  });

  it('normaliza somente contadores de agendamento e preserva logs historicos', () => {
    expect(normalized).toContain('update public.notification_schedule ns set send_count');
    expect(normalized).not.toMatch(/delete\s+from|truncate|drop\s+table|drop\s+index/);
    expect(normalized).not.toContain('update public.notification_log');
  });

  it('cria saude agregada backend-only sem dados nominais', () => {
    const healthStart = normalized.indexOf('create or replace function public.get_avop_notification_health');
    const healthEnd = normalized.indexOf('comment on function public.get_avop_notification_health', healthStart);
    const health = normalized.slice(healthStart, healthEnd);

    expect(health).toContain('security invoker');
    expect(health).toContain("set search_path = 'pg_catalog', 'pg_temp'");
    expect(health).toContain("'expired_reservations'");
    expect(health).toContain("'temporary_errors_last_24h'");
    expect(health).not.toMatch(/recipient|profile_id|trigram|token|message/);
  });

  it('mantem todas as funcoes exclusivas do service_role', () => {
    for (const signature of [
      'reserve_avop_notification(uuid, uuid, text, text, timestamptz, text, timestamptz, timestamptz)',
      'record_avop_notification_result(uuid, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, timestamptz)',
      'list_avop_notification_candidates(date)',
      'get_avop_notification_health(timestamptz)',
    ]) {
      expect(normalized).toContain(`revoke execute on function public.${signature} from public, anon, authenticated`);
      expect(normalized).toContain(`grant execute on function public.${signature} to service_role`);
    }
    expect(normalized).not.toMatch(/create\s+policy|grant\s+.+\s+to\s+(anon|authenticated)/);
  });
});

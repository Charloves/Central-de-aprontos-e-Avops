import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations/20261001112327_avop_recipient_digest_notifications.sql',
);
const sql = readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('AVOP recipient digest migration', () => {
  it('reserva o lote completo por perfil e rejeita reserva parcial', () => {
    expect(normalized).toContain('create or replace function public.reserve_avop_notification_digest');
    expect(normalized).toContain('from public.profiles p where p.id = p_profile_id for update');
    expect(normalized).toContain('if v_reserved_count <> v_item_count');
    expect(normalized).toContain("nl.result = 'sent'");
    expect(normalized).toContain('duplicate digest item');
  });

  it('finaliza todos os itens na mesma transacao e valida o token da reserva', () => {
    expect(normalized).toContain('create or replace function public.record_avop_notification_digest_result');
    expect(normalized).toContain('ns.reservation_token_hash = p_reservation_token_hash');
    expect(normalized).toContain('digest reservation ownership mismatch');
    expect(normalized).toContain("'delivery', 'recipient_digest'");
    expect(normalized).toContain("'digest_key', p_digest_idempotency_key");
  });

  it('preserva um log e uma chave idempotente para cada AVOP e marco', () => {
    expect(normalized).toContain('from public.record_avop_notification_result(');
    expect(normalized).toContain('v_item.idempotency_key');
    expect(normalized).toContain("when p_result = 'temporary_error' then p_now");
    expect(normalized).toContain("when p_result = 'permanent_error' then null");
  });

  it('mantem as RPCs como security invoker e exclusivas do service_role', () => {
    expect(normalized.match(/security invoker/g)).toHaveLength(2);
    expect(normalized.match(/set search_path = 'pg_catalog', 'pg_temp'/g)).toHaveLength(2);
    for (const signature of [
      'reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz)',
      'record_avop_notification_digest_result(uuid, text, text, text, jsonb, text, text, text, text, text, timestamptz)',
    ]) {
      expect(normalized).toContain(`revoke execute on function public.${signature} from public, anon, authenticated`);
      expect(normalized).toContain(`grant execute on function public.${signature} to service_role`);
    }
    expect(normalized).not.toMatch(/create\s+policy|grant\s+.+\s+to\s+(anon|authenticated)/);
  });

  it('nao altera tabelas, dados operacionais ou migrations anteriores', () => {
    expect(normalized).not.toMatch(/alter\s+table|create\s+table|drop\s+|truncate|delete\s+from/);
    expect(normalized).not.toMatch(/insert\s+into\s+public\.(avops|profiles|avop_acknowledgements)/);
  });
});

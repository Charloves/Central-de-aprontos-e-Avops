import { describe, expect, it, vi } from 'vitest';
import { SupabaseDashboardRepository } from './supabase-dashboard-repository';

vi.mock('server-only', () => ({}));

describe('SupabaseDashboardRepository', () => {
  it('usa somente tabelas server-side necessarias para dashboard', async () => {
    const calls: Array<{ table: string; columns?: string }> = [];
    const client = {
      from(table: string) {
        const builder: Record<string, unknown> = {
          select(columns: string) {
            calls.push({ table, columns });
            return builder;
          },
          neq() {
            return builder;
          },
          order() {
            return builder;
          },
          in() {
            return builder;
          },
          or() {
            return builder;
          },
          returns() {
            if (table === 'avops') {
              return Promise.resolve({
                data: [{
                  id: 'avop-1',
                  number: 'AVOP 01',
                  title: 'Aviso',
                  publication_date: '2026-08-01',
                  status: 'PUBLISHED',
                  requires_acknowledgement: true,
                  avop_audiences: [],
                }],
                error: null,
              });
            }
            if (table === 'briefings') {
              return Promise.resolve({
                data: [{
                  id: 'briefing-1',
                  legacy_id: 'APR 01',
                  title: 'Apronto',
                  event_date: '2026-08-10',
                  status: 'OPEN',
                  requires_material_acknowledgement: true,
                  briefing_audiences: [],
                }],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
        };
        return builder;
      },
    };

    const repository = new SupabaseDashboardRepository(client as never);
    await repository.loadDashboard(new Date('2026-08-11T12:00:00Z'));

    expect(calls.map((call) => call.table)).toEqual([
      'avops',
      'briefings',
      'profile_audiences',
      'avop_publication_snapshots',
      'avop_publication_snapshot_members',
      'avop_acknowledgements',
      'briefing_publication_snapshots',
      'briefing_publication_snapshot_members',
      'briefing_records',
      'absence_justifications',
    ]);
    expect(JSON.stringify(calls)).not.toContain('auth_sessions');
    expect(JSON.stringify(calls)).not.toContain('email');
  });

  it('nega com erro do Supabase em vez de retornar numeros falsos', async () => {
    const failingBuilder: Record<string, unknown> = {
      select: vi.fn(() => failingBuilder),
      neq: vi.fn(() => failingBuilder),
      order: vi.fn(() => failingBuilder),
      in: vi.fn(() => failingBuilder),
      or: vi.fn(() => failingBuilder),
      returns: vi.fn(() => Promise.resolve({ data: null, error: new Error('falha') })),
    };
    const client = {
      from: vi.fn(() => failingBuilder),
    };

    const repository = new SupabaseDashboardRepository(client as never);
    await expect(repository.loadDashboard()).rejects.toThrow('falha');
  });
});

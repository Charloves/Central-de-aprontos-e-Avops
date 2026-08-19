import { describe, expect, it, vi } from 'vitest';
import { SupabaseAvopRepository } from './supabase-avop-repository';

vi.mock('server-only', () => ({}));

describe('SupabaseAvopRepository', () => {
  it('recupera a primeira ciencia quando insert concorrente encontra unique violation', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'ack-existing',
        avop_id: 'avop-1',
        profile_id: 'profile-1',
        acknowledged_at: '2026-05-01T10:00:00.000Z',
        session_id: 'session-existing',
      },
      error: null,
    });
    const selectExisting = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) }));
    const insertSingle = vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } });
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));
    const from = vi.fn((table: string) => {
      if (table === 'avop_acknowledgements') return { insert, select: selectExisting };
      throw new Error(`Unexpected table ${table}`);
    });

    const repository = new SupabaseAvopRepository({ from } as never);

    await expect(repository.acknowledgeAvop(
      'profile-1',
      'avop-1',
      new Date('2026-05-01T11:00:00.000Z'),
      'session-new',
    )).resolves.toEqual({
      id: 'ack-existing',
      avopId: 'avop-1',
      profileId: 'profile-1',
      acknowledgedAt: '2026-05-01T10:00:00.000Z',
      sessionId: 'session-existing',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      avop_id: 'avop-1',
      profile_id: 'profile-1',
      acknowledged_at: '2026-05-01T11:00:00.000Z',
      session_id: 'session-new',
    }));
  });
});

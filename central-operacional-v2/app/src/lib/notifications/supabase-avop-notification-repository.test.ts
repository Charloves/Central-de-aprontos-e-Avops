import { describe, expect, it, vi } from 'vitest';
import { SupabaseAvopNotificationRepository } from './supabase-avop-notification-repository';

vi.mock('server-only', () => ({}));

describe('SupabaseAvopNotificationRepository recipient digest', () => {
  it('reserva todos os itens em uma unica RPC com o mesmo token', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          schedule_id: 'schedule-1',
          activity_id: 'avop-1',
          notification_type: 'AVOP_INITIAL',
          marker: 'INITIAL',
          next_send_at: '2026-10-08T00:00:00.000Z',
        },
        {
          schedule_id: 'schedule-2',
          activity_id: 'avop-2',
          notification_type: 'AVOP_REMINDER',
          marker: 'WEEK_7',
          next_send_at: '2026-10-15T00:00:00.000Z',
        },
      ],
      error: null,
    });
    const repository = new SupabaseAvopNotificationRepository({ rpc } as never);

    const reserved = await repository.reserveDigest({
      profileId: 'profile-1',
      items: [
        {
          activityId: 'avop-1',
          notificationType: 'AVOP_INITIAL',
          marker: 'INITIAL',
          nextSendAt: new Date('2026-10-08T00:00:00.000Z'),
        },
        {
          activityId: 'avop-2',
          notificationType: 'AVOP_REMINDER',
          marker: 'WEEK_7',
          nextSendAt: new Date('2026-10-15T00:00:00.000Z'),
        },
      ],
      reservationTokenHash: 'a'.repeat(64),
      reservedUntil: new Date('2026-10-01T12:10:00.000Z'),
      now: new Date('2026-10-01T12:00:00.000Z'),
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('reserve_avop_notification_digest', expect.objectContaining({
      p_profile_id: 'profile-1',
      p_reservation_token_hash: 'a'.repeat(64),
      p_items: [
        expect.objectContaining({ activity_id: 'avop-1', marker: 'INITIAL' }),
        expect.objectContaining({ activity_id: 'avop-2', marker: 'WEEK_7' }),
      ],
    }));
    expect(reserved).toHaveLength(2);
  });

  it('finaliza o digest em uma unica RPC sem incluir corpo ou segredo', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { logged_count: 2, stopped_count: 0 },
      error: null,
    });
    const repository = new SupabaseAvopNotificationRepository({ rpc } as never);

    await expect(repository.recordDigestResult({
      profileId: 'profile-1',
      recipient: 'militar@example.test',
      reservationTokenHash: 'a'.repeat(64),
      digestIdempotencyKey: 'b'.repeat(64),
      items: [
        {
          scheduleId: 'schedule-1',
          activityId: 'avop-1',
          notificationType: 'AVOP_INITIAL',
          marker: 'INITIAL',
          nextSendAt: new Date('2026-10-08T00:00:00.000Z'),
          idempotencyKey: 'c'.repeat(64),
        },
        {
          scheduleId: 'schedule-2',
          activityId: 'avop-2',
          notificationType: 'AVOP_REMINDER',
          marker: 'WEEK_7',
          nextSendAt: null,
          idempotencyKey: 'd'.repeat(64),
        },
      ],
      result: 'SENT',
      providerMessageId: 'provider-message',
      now: new Date('2026-10-01T12:00:00.000Z'),
    })).resolves.toEqual({ logged: 2, stopped: 0 });

    expect(rpc).toHaveBeenCalledTimes(1);
    const payload = rpc.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      p_profile_id: 'profile-1',
      p_digest_idempotency_key: 'b'.repeat(64),
      p_result: 'SENT',
    });
    expect(JSON.stringify(payload)).not.toMatch(/body|subject|client_secret|refresh_token/i);
  });
});

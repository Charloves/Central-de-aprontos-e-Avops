import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getHealth = vi.fn();

vi.mock('@/lib/notifications/supabase-avop-notification-repository', () => ({
  SupabaseAvopNotificationRepository: class {
    getHealth = getHealth;
  },
}));

import { GET } from './route';

const secret = '0123456789abcdef0123456789abcdef';

describe('notification health endpoint', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = secret;
    getHealth.mockReset();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('nega chamada sem CRON_SECRET antes de consultar o banco', async () => {
    const response = await GET(new Request('https://central.example.test/api/health/notifications'));

    expect(response.status).toBe(403);
    expect(getHealth).not.toHaveBeenCalled();
  });

  it('retorna apenas saude agregada com no-store', async () => {
    getHealth.mockResolvedValue({
      status: 'healthy',
      generatedAt: '2026-09-29T11:00:00.000Z',
      activeSchedules: 2,
      stoppedSchedules: 1,
      activeReservations: 0,
      expiredReservations: 0,
      sentLast24h: 3,
      dryRunLast24h: 0,
      temporaryErrorsLast24h: 0,
      permanentErrorsLast24h: 0,
      lastAttemptAt: '2026-09-29T11:00:00.000Z',
      lastSentAt: '2026-09-29T11:00:00.000Z',
    });
    const response = await GET(new Request('https://central.example.test/api/health/notifications', {
      headers: { authorization: `Bearer ${secret}` },
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).not.toMatch(/recipient|profile|email|token|secret/i);
  });

  it('retorna 503 para saude degradada ou falha do repositorio sem expor detalhes', async () => {
    getHealth.mockResolvedValueOnce({ status: 'degraded' });
    const degraded = await GET(new Request('https://central.example.test/api/health/notifications', {
      headers: { authorization: `Bearer ${secret}` },
    }));
    getHealth.mockRejectedValueOnce(new Error('sensitive database detail'));
    const failed = await GET(new Request('https://central.example.test/api/health/notifications', {
      headers: { authorization: `Bearer ${secret}` },
    }));

    expect(degraded.status).toBe(503);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('sensitive database detail');
  });
});

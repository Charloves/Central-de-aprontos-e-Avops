import { describe, expect, it } from 'vitest';
import { mapAvopNotificationHealth } from './health';

describe('AVOP notification health', () => {
  it('retorna somente metricas agregadas e estado saudavel', () => {
    const health = mapAvopNotificationHealth({
      generated_at: '2026-09-29T11:00:00Z',
      active_schedules: 2,
      stopped_schedules: 3,
      active_reservations: 0,
      expired_reservations: 0,
      sent_last_24h: 4,
      dry_run_last_24h: 0,
      temporary_errors_last_24h: 0,
      permanent_errors_last_24h: 0,
      last_attempt_at: '2026-09-29T11:00:00Z',
      last_sent_at: '2026-09-29T11:00:00Z',
    });

    expect(health).toMatchObject({ status: 'healthy', activeSchedules: 2, sentLast24h: 4 });
    expect(JSON.stringify(health)).not.toMatch(/recipient|profile|email|token|secret/i);
  });

  it('classifica erro temporario como aviso e reserva expirada ou erro permanente como degradado', () => {
    expect(mapAvopNotificationHealth({ temporary_errors_last_24h: 1 }).status).toBe('warning');
    expect(mapAvopNotificationHealth({ expired_reservations: 1 }).status).toBe('degraded');
    expect(mapAvopNotificationHealth({ permanent_errors_last_24h: 1 }).status).toBe('degraded');
  });

  it('falha fechado para contagens e datas malformadas sem ecoar valores', () => {
    const health = mapAvopNotificationHealth({
      generated_at: 'invalid',
      active_schedules: -4,
      last_attempt_at: 'invalid',
    });

    expect(health.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(health.activeSchedules).toBe(0);
    expect(health.lastAttemptAt).toBeNull();
  });
});

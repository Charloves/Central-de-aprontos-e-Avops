export type AvopNotificationHealth = {
  status: 'healthy' | 'warning' | 'degraded';
  generatedAt: string;
  activeSchedules: number;
  stoppedSchedules: number;
  activeReservations: number;
  expiredReservations: number;
  sentLast24h: number;
  dryRunLast24h: number;
  temporaryErrorsLast24h: number;
  permanentErrorsLast24h: number;
  lastAttemptAt: string | null;
  lastSentAt: string | null;
};

export type AvopNotificationHealthRow = {
  generated_at?: unknown;
  active_schedules?: unknown;
  stopped_schedules?: unknown;
  active_reservations?: unknown;
  expired_reservations?: unknown;
  sent_last_24h?: unknown;
  dry_run_last_24h?: unknown;
  temporary_errors_last_24h?: unknown;
  permanent_errors_last_24h?: unknown;
  last_attempt_at?: unknown;
  last_sent_at?: unknown;
};

export function mapAvopNotificationHealth(row: AvopNotificationHealthRow): AvopNotificationHealth {
  const expiredReservations = safeCount(row.expired_reservations);
  const temporaryErrorsLast24h = safeCount(row.temporary_errors_last_24h);
  const permanentErrorsLast24h = safeCount(row.permanent_errors_last_24h);
  const status = expiredReservations > 0 || permanentErrorsLast24h > 0
    ? 'degraded'
    : temporaryErrorsLast24h > 0
      ? 'warning'
      : 'healthy';

  return {
    status,
    generatedAt: safeTimestamp(row.generated_at) ?? new Date(0).toISOString(),
    activeSchedules: safeCount(row.active_schedules),
    stoppedSchedules: safeCount(row.stopped_schedules),
    activeReservations: safeCount(row.active_reservations),
    expiredReservations,
    sentLast24h: safeCount(row.sent_last_24h),
    dryRunLast24h: safeCount(row.dry_run_last_24h),
    temporaryErrorsLast24h,
    permanentErrorsLast24h,
    lastAttemptAt: safeTimestamp(row.last_attempt_at),
    lastSentAt: safeTimestamp(row.last_sent_at),
  };
}

function safeCount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

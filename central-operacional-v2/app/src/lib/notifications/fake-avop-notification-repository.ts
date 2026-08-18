import type {
  AvopNotificationCandidate,
  AvopNotificationMarker,
  AvopNotificationRepository,
  AvopNotificationResult,
  AvopNotificationStopReason,
  AvopNotificationType,
  ReservedAvopNotification,
} from './avop-email';

type LogEntry = {
  activityId: string;
  profileId: string;
  marker: AvopNotificationMarker;
  result: AvopNotificationResult;
  idempotencyKey: string;
};

type ScheduleEntry = {
  id: string;
  activityId: string;
  profileId: string;
  marker: AvopNotificationMarker;
  reservedUntil: Date | null;
  reservationTokenHash: string | null;
  stoppedReason: AvopNotificationStopReason | null;
};

export class FakeAvopNotificationRepository implements AvopNotificationRepository {
  readonly logs: LogEntry[] = [];
  readonly schedules = new Map<string, ScheduleEntry>();

  constructor(private readonly candidates: AvopNotificationCandidate[]) {}

  async listCandidates(): Promise<AvopNotificationCandidate[]> {
    return this.candidates;
  }

  async reserve(input: {
    activityId: string;
    profileId: string;
    notificationType: AvopNotificationType;
    marker: AvopNotificationMarker;
    reservationTokenHash: string;
    reservedUntil: Date;
    now: Date;
  }): Promise<ReservedAvopNotification | null> {
    const key = `${input.activityId}:${input.profileId}`;
    if (this.logs.some((log) => log.activityId === input.activityId && log.profileId === input.profileId && log.marker === input.marker && (log.result === 'SENT' || log.result === 'DRY_RUN'))) {
      return null;
    }
    const existing = this.schedules.get(key);
    if (existing?.reservedUntil && existing.reservedUntil > input.now && existing.reservationTokenHash !== input.reservationTokenHash) {
      return null;
    }
    const schedule = existing ?? {
      id: `schedule-${this.schedules.size + 1}`,
      activityId: input.activityId,
      profileId: input.profileId,
      marker: input.marker,
      reservedUntil: null,
      reservationTokenHash: null,
      stoppedReason: null,
    };
    schedule.marker = input.marker;
    schedule.reservedUntil = input.reservedUntil;
    schedule.reservationTokenHash = input.reservationTokenHash;
    this.schedules.set(key, schedule);
    return { scheduleId: schedule.id, reservationTokenHash: input.reservationTokenHash };
  }

  async recordResult(input: {
    activityId: string;
    profileId: string;
    marker: AvopNotificationMarker;
    result: AvopNotificationResult;
    idempotencyKey: string;
    stopReason?: AvopNotificationStopReason | null;
  }): Promise<void> {
    if (this.logs.some((log) => log.idempotencyKey === input.idempotencyKey)) return;
    this.logs.push({
      activityId: input.activityId,
      profileId: input.profileId,
      marker: input.marker,
      result: input.result,
      idempotencyKey: input.idempotencyKey,
    });
    const schedule = this.schedules.get(`${input.activityId}:${input.profileId}`);
    if (schedule) {
      schedule.reservedUntil = null;
      schedule.reservationTokenHash = null;
      if (input.stopReason) schedule.stoppedReason = input.stopReason;
      if (input.result === 'PERMANENT_ERROR') schedule.stoppedReason = 'PERMANENT_EMAIL_ERROR';
    }
  }

  async stopSchedule(input: {
    activityId: string;
    profileId: string;
    marker: AvopNotificationMarker;
    stopReason: AvopNotificationStopReason;
    idempotencyKey: string;
  }): Promise<void> {
    const key = `${input.activityId}:${input.profileId}`;
    const schedule = this.schedules.get(key) ?? {
      id: `schedule-${this.schedules.size + 1}`,
      activityId: input.activityId,
      profileId: input.profileId,
      marker: input.marker,
      reservedUntil: null,
      reservationTokenHash: null,
      stoppedReason: null,
    };
    schedule.stoppedReason = input.stopReason;
    this.schedules.set(key, schedule);
    if (!this.logs.some((log) => log.idempotencyKey === input.idempotencyKey)) {
      this.logs.push({
        activityId: input.activityId,
        profileId: input.profileId,
        marker: input.marker,
        result: 'SKIPPED',
        idempotencyKey: input.idempotencyKey,
      });
    }
  }
}

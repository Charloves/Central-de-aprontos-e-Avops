import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type AvopNotificationMarker =
  | 'INITIAL'
  | 'WEEK_7'
  | 'WEEK_14'
  | 'WEEK_21'
  | 'WEEK_28'
  | `MONTH_${number}`;

export type AvopNotificationType = 'AVOP_INITIAL' | 'AVOP_REMINDER' | 'AVOP_SKIPPED';
export type AvopNotificationResult = 'SENT' | 'DRY_RUN' | 'TEMPORARY_ERROR' | 'PERMANENT_ERROR' | 'SKIPPED';
export type AvopNotificationStopReason =
  | 'ACKNOWLEDGED'
  | 'AVOP_CLOSED'
  | 'PROFILE_INACTIVE'
  | 'NOT_APPLICABLE'
  | 'EXPIRED_365_DAYS'
  | 'PERMANENT_EMAIL_ERROR';

export type AvopNotificationCandidate = {
  avopId: string;
  avopNumber: string;
  title: string;
  publicationDate: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  profileId: string;
  recipientEmail: string | null;
  profileActive: boolean;
  applicableNow: boolean;
  acknowledged: boolean;
  sentMarkers: AvopNotificationMarker[];
};

export type ReservedAvopNotification = {
  scheduleId: string;
  reservationTokenHash: string;
};

export type AvopNotificationRepository = {
  listCandidates(now: Date): Promise<AvopNotificationCandidate[]>;
  reserve(input: {
    activityId: string;
    profileId: string;
    notificationType: AvopNotificationType;
    marker: AvopNotificationMarker;
    nextSendAt: Date | null;
    reservationTokenHash: string;
    reservedUntil: Date;
    now: Date;
  }): Promise<ReservedAvopNotification | null>;
  recordResult(input: {
    scheduleId: string;
    activityId: string;
    profileId: string;
    recipient: string;
    notificationType: AvopNotificationType;
    marker: AvopNotificationMarker;
    result: AvopNotificationResult;
    idempotencyKey: string;
    providerMessageId?: string | null;
    error?: string | null;
    errorKind?: 'TEMPORARY' | 'PERMANENT' | 'CONFIGURATION' | 'VALIDATION' | null;
    nextSendAt: Date | null;
    stopReason?: AvopNotificationStopReason | null;
    now: Date;
  }): Promise<void>;
  stopSchedule(input: {
    activityId: string;
    profileId: string;
    marker: AvopNotificationMarker;
    recipient: string;
    stopReason: AvopNotificationStopReason;
    idempotencyKey: string;
    now: Date;
  }): Promise<void>;
};

export type AvopEmailSender = {
  send(input: { to: string; subject: string; body: string }): Promise<{ providerMessageId: string | null }>;
};

export type AvopNotificationDecision =
  | { action: 'SEND'; marker: AvopNotificationMarker; notificationType: AvopNotificationType; nextSendAt: Date | null }
  | { action: 'STOP'; marker: AvopNotificationMarker; reason: AvopNotificationStopReason }
  | { action: 'SKIP'; nextSendAt: Date | null; reason: string };

export type AvopNotificationJobReport = {
  dryRun: boolean;
  scanned: number;
  reserved: number;
  sent: number;
  skipped: number;
  stopped: number;
  temporaryErrors: number;
  permanentErrors: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function decideAvopNotification(candidate: AvopNotificationCandidate, now: Date): AvopNotificationDecision {
  const publicationDate = parseDateOnly(candidate.publicationDate);
  if (!publicationDate) return { action: 'SKIP', nextSendAt: null, reason: 'INVALID_PUBLICATION_DATE' };
  if (candidate.status === 'DRAFT') return { action: 'SKIP', nextSendAt: null, reason: 'DRAFT' };
  if (candidate.acknowledged) return { action: 'STOP', marker: lastMarker(candidate.sentMarkers), reason: 'ACKNOWLEDGED' };
  if (candidate.status === 'CLOSED') return { action: 'STOP', marker: lastMarker(candidate.sentMarkers), reason: 'AVOP_CLOSED' };
  if (!candidate.profileActive) return { action: 'STOP', marker: lastMarker(candidate.sentMarkers), reason: 'PROFILE_INACTIVE' };
  if (!candidate.applicableNow) return { action: 'STOP', marker: lastMarker(candidate.sentMarkers), reason: 'NOT_APPLICABLE' };

  if (daysBetweenDateOnly(publicationDate, now) >= 365) {
    return { action: 'STOP', marker: lastMarker(candidate.sentMarkers), reason: 'EXPIRED_365_DAYS' };
  }
  const dueMarkers = dueAvopMarkers(publicationDate, now);
  if (dueMarkers.length === 0) return { action: 'SKIP', nextSendAt: nextMarkerDate(publicationDate, now), reason: 'NOT_DUE' };

  const marker = dueMarkers.find((item) => !candidate.sentMarkers.includes(item));
  if (!marker) return { action: 'SKIP', nextSendAt: nextMarkerDate(publicationDate, now), reason: 'ALREADY_SENT' };
  return {
    action: 'SEND',
    marker,
    notificationType: marker === 'INITIAL' ? 'AVOP_INITIAL' : 'AVOP_REMINDER',
    nextSendAt: nextMarkerDate(publicationDate, now),
  };
}

export function dueAvopMarkers(publicationDate: Date, now: Date): AvopNotificationMarker[] {
  const age = daysBetweenDateOnly(publicationDate, now);
  if (age < 0 || age >= 365) return [];
  const markers: AvopNotificationMarker[] = ['INITIAL'];
  for (const day of [7, 14, 21, 28]) {
    if (age >= day) markers.push(`WEEK_${day}` as AvopNotificationMarker);
  }
  for (let month = 2; month <= 12; month += 1) {
    const due = addMonthsClamped(publicationDate, month);
    if (due.getTime() <= stripUtcDate(now).getTime() && due.getTime() < addDaysUtc(publicationDate, 365).getTime()) {
      markers.push(`MONTH_${month}` as AvopNotificationMarker);
    }
  }
  return markers;
}

export function nextMarkerDate(publicationDate: Date, now: Date): Date | null {
  const today = stripUtcDate(now);
  const candidates = [
    publicationDate,
    addDaysUtc(publicationDate, 7),
    addDaysUtc(publicationDate, 14),
    addDaysUtc(publicationDate, 21),
    addDaysUtc(publicationDate, 28),
    ...Array.from({ length: 11 }, (_, index) => addMonthsClamped(publicationDate, index + 2)),
  ].filter((date) => date.getTime() < addDaysUtc(publicationDate, 365).getTime());
  return candidates.find((date) => date.getTime() > today.getTime()) ?? null;
}

export async function runAvopNotificationJob(input: {
  repository: AvopNotificationRepository;
  sender: AvopEmailSender;
  now?: Date;
  baseUrl: string;
  dryRun: boolean;
  reserveSeconds?: number;
}): Promise<AvopNotificationJobReport> {
  const now = input.now ?? new Date();
  const reserveSeconds = input.reserveSeconds ?? 10 * 60;
  const report: AvopNotificationJobReport = {
    dryRun: input.dryRun,
    scanned: 0,
    reserved: 0,
    sent: 0,
    skipped: 0,
    stopped: 0,
    temporaryErrors: 0,
    permanentErrors: 0,
  };

  const candidates = await input.repository.listCandidates(now);
  for (const candidate of candidates) {
    report.scanned += 1;
    const decision = decideAvopNotification(candidate, now);
    if (decision.action === 'SKIP') {
      report.skipped += 1;
      continue;
    }

    const recipient = candidate.recipientEmail ?? '';
    if (decision.action === 'STOP') {
      await input.repository.stopSchedule({
        activityId: candidate.avopId,
        profileId: candidate.profileId,
        marker: decision.marker,
        recipient: recipient || 'not-configured@example.test',
        stopReason: decision.reason,
        idempotencyKey: buildNotificationIdempotencyKey(candidate.avopId, candidate.profileId, decision.marker, 'STOPPED'),
        now,
      });
      report.stopped += 1;
      continue;
    }

    if (!isSimpleEmailAddress(recipient)) {
      await input.repository.stopSchedule({
        activityId: candidate.avopId,
        profileId: candidate.profileId,
        marker: decision.marker,
        recipient: recipient || 'not-configured@example.test',
        stopReason: 'PERMANENT_EMAIL_ERROR',
        idempotencyKey: buildNotificationIdempotencyKey(candidate.avopId, candidate.profileId, decision.marker, 'INVALID_EMAIL'),
        now,
      });
      report.permanentErrors += 1;
      continue;
    }

    const reservationTokenHash = sha256Hex(randomBytes(32).toString('base64url'));
    const reservation = await input.repository.reserve({
      activityId: candidate.avopId,
      profileId: candidate.profileId,
      notificationType: decision.notificationType,
      marker: decision.marker,
      nextSendAt: decision.nextSendAt,
      reservationTokenHash,
      reservedUntil: new Date(now.getTime() + reserveSeconds * 1000),
      now,
    });
    if (!reservation) {
      report.skipped += 1;
      continue;
    }
    report.reserved += 1;

    const message = buildAvopNotificationEmail({
      avopNumber: candidate.avopNumber,
      title: candidate.title,
      marker: decision.marker,
      acknowledgementUrl: buildAvopAcknowledgementUrl(input.baseUrl, candidate.avopId),
    });
    try {
      const sendResult = input.dryRun
        ? { providerMessageId: null }
        : await input.sender.send({ to: recipient, subject: message.subject, body: message.body });
      await input.repository.recordResult({
        scheduleId: reservation.scheduleId,
        activityId: candidate.avopId,
        profileId: candidate.profileId,
        recipient,
        notificationType: decision.notificationType,
        marker: decision.marker,
        result: input.dryRun ? 'DRY_RUN' : 'SENT',
        idempotencyKey: buildNotificationIdempotencyKey(candidate.avopId, candidate.profileId, decision.marker, input.dryRun ? 'DRY_RUN' : 'SENT'),
        providerMessageId: sendResult.providerMessageId,
        nextSendAt: decision.nextSendAt,
        now,
      });
      report.sent += 1;
    } catch (error) {
      const permanent = error instanceof PermanentEmailError;
      await input.repository.recordResult({
        scheduleId: reservation.scheduleId,
        activityId: candidate.avopId,
        profileId: candidate.profileId,
        recipient,
        notificationType: decision.notificationType,
        marker: decision.marker,
        result: permanent ? 'PERMANENT_ERROR' : 'TEMPORARY_ERROR',
        idempotencyKey: buildNotificationIdempotencyKey(candidate.avopId, candidate.profileId, decision.marker, permanent ? 'PERMANENT_ERROR' : 'TEMPORARY_ERROR'),
        error: 'Falha ao processar notificacao de AVOP.',
        errorKind: permanent ? 'PERMANENT' : 'TEMPORARY',
        nextSendAt: permanent ? null : now,
        stopReason: permanent ? 'PERMANENT_EMAIL_ERROR' : null,
        now,
      });
      if (permanent) report.permanentErrors += 1;
      else report.temporaryErrors += 1;
    }
  }

  return report;
}

export function buildAvopNotificationEmail(input: {
  avopNumber: string;
  title: string;
  marker: AvopNotificationMarker;
  acknowledgementUrl: string;
}): { subject: string; body: string } {
  if (input.marker === 'INITIAL') {
    return {
      subject: `Divulgação de AVOP: ${input.avopNumber}`,
      body: [
        'Caro tripulante,',
        '',
        'Foi divulgado o seguinte AVOP, com necessidade de ciência:',
        '',
        `${input.avopNumber} - ${input.title}`,
        '',
        'Para registrar ciência, acesse o link abaixo:',
        '',
        input.acknowledgementUrl,
        '',
        'CDOUT - 1º/11º GAV. Este é um lembrete automático do sistema de controle de AVOPs.',
      ].join('\n'),
    };
  }

  return {
    subject: `Pendência de ciência de AVOP: ${input.avopNumber}`,
    body: [
      'Caro tripulante,',
      '',
      'Consta pendência de ciência do seguinte AVOP:',
      '',
      `${input.avopNumber} - ${input.title}`,
      '',
      'Para registrar ciência, acesse o link abaixo:',
      '',
      input.acknowledgementUrl,
      '',
      'CDOUT - 1º/11º GAV. Este é um lembrete automático do sistema de controle de AVOPs.',
    ].join('\n'),
  };
}

export function buildAvopAcknowledgementUrl(baseUrl: string, avopId: string): string {
  const url = new URL('/portal/avops', baseUrl);
  url.searchParams.set('avop', avopId);
  return url.toString();
}

export function buildNotificationIdempotencyKey(activityId: string, profileId: string, marker: AvopNotificationMarker, result: string): string {
  return sha256Hex(['AVOP', activityId, profileId, marker, result].join('|'));
}

export function isSimpleEmailAddress(value: string): boolean {
  return value.trim() === value
    && !/[\x00-\x20\x7F,;]/.test(value)
    && EMAIL_PATTERN.test(value);
}

export function validateCronSecret(input: {
  provided: string | null;
  expected: string | undefined;
}): boolean {
  if (!input.expected || input.expected.length < 32 || !input.provided) return false;
  const expected = Buffer.from(input.expected);
  const provided = Buffer.from(input.provided);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export class PermanentEmailError extends Error {}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function stripUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetweenDateOnly(start: Date, end: Date): number {
  return Math.floor((stripUtcDate(end).getTime() - stripUtcDate(start).getTime()) / DAY_MS);
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function lastMarker(markers: AvopNotificationMarker[]): AvopNotificationMarker {
  return markers.at(-1) ?? 'INITIAL';
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

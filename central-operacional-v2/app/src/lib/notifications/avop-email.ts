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

export type RecordedAvopNotification = {
  logged: boolean;
  stopped: boolean;
};

export type AvopNotificationReservationItem = {
  activityId: string;
  notificationType: AvopNotificationType;
  marker: AvopNotificationMarker;
  nextSendAt: Date | null;
};

export type ReservedAvopNotificationDigestItem = AvopNotificationReservationItem & {
  scheduleId: string;
};

export type AvopNotificationResultItem = ReservedAvopNotificationDigestItem & {
  idempotencyKey: string;
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
  }): Promise<RecordedAvopNotification>;
  reserveDigest(input: {
    profileId: string;
    items: AvopNotificationReservationItem[];
    reservationTokenHash: string;
    reservedUntil: Date;
    now: Date;
  }): Promise<ReservedAvopNotificationDigestItem[]>;
  recordDigestResult(input: {
    profileId: string;
    recipient: string;
    reservationTokenHash: string;
    digestIdempotencyKey: string;
    items: AvopNotificationResultItem[];
    result: AvopNotificationResult;
    providerMessageId?: string | null;
    error?: string | null;
    errorKind?: 'TEMPORARY' | 'PERMANENT' | 'CONFIGURATION' | 'VALIDATION' | null;
    stopReason?: AvopNotificationStopReason | null;
    now: Date;
  }): Promise<{ logged: number; stopped: number }>;
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
  simulated: number;
  deduplicated: number;
  skipped: number;
  stopped: number;
  temporaryErrors: number;
  permanentErrors: number;
  itemsSent: number;
  itemsSimulated: number;
};

export const GMAIL_DELIVERY_CONFIRMATION = 'ENABLE_REAL_GMAIL_DELIVERY';

export function resolveAvopEmailMode(input: {
  mode: string | undefined;
  deliveryConfirmation: string | undefined;
}): { dryRun: boolean; mode: 'dry-run' | 'gmail' } {
  if (input.mode === 'dry-run') return { dryRun: true, mode: 'dry-run' };
  if (input.mode === 'gmail' && input.deliveryConfirmation === GMAIL_DELIVERY_CONFIRMATION) {
    return { dryRun: false, mode: 'gmail' };
  }
  throw new Error('AVOP email delivery configuration is not authorized.');
}

export function resolveAvopNotificationBaseUrl(input: {
  baseUrl: string | undefined;
  appOrigin: string | undefined;
  environment: string | undefined;
}): string {
  const raw = input.baseUrl || input.appOrigin;
  if (!raw) throw new Error('AVOP notification base URL is not configured.');
  const url = new URL(raw);
  const localDevelopment = input.environment !== 'production'
    && url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new Error('AVOP notification base URL is not secure.');
  }
  if (url.username || url.password) throw new Error('AVOP notification base URL contains credentials.');
  return url.origin;
}

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
    simulated: 0,
    deduplicated: 0,
    skipped: 0,
    stopped: 0,
    temporaryErrors: 0,
    permanentErrors: 0,
    itemsSent: 0,
    itemsSimulated: 0,
  };

  const candidates = await input.repository.listCandidates(now);
  const recipientDigests = new Map<string, {
    profileId: string;
    recipient: string;
    pendingCandidates: AvopNotificationCandidate[];
    items: Array<{
      candidate: AvopNotificationCandidate;
      decision: Extract<AvopNotificationDecision, { action: 'SEND' }>;
    }>;
  }>();

  for (const candidate of candidates) {
    report.scanned += 1;
    const decision = decideAvopNotification(candidate, now);
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

    if (decision.action === 'SKIP') {
      report.skipped += 1;
      if ((decision.reason === 'NOT_DUE' || decision.reason === 'ALREADY_SENT')
        && isSimpleEmailAddress(recipient)) {
        const existingDigest = recipientDigests.get(candidate.profileId);
        if (existingDigest && existingDigest.recipient !== recipient) {
          throw new Error('Inconsistent recipient for AVOP notification profile.');
        }
        const digest = existingDigest ?? {
          profileId: candidate.profileId,
          recipient,
          pendingCandidates: [],
          items: [],
        };
        if (!digest.pendingCandidates.some((item) => item.avopId === candidate.avopId)) {
          digest.pendingCandidates.push(candidate);
        }
        recipientDigests.set(candidate.profileId, digest);
      }
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

    const existingDigest = recipientDigests.get(candidate.profileId);
    if (existingDigest && existingDigest.recipient !== recipient) {
      throw new Error('Inconsistent recipient for AVOP notification profile.');
    }
    const digest = existingDigest ?? {
      profileId: candidate.profileId,
      recipient,
      pendingCandidates: [],
      items: [],
    };
    if (digest.items.some((item) => item.candidate.avopId === candidate.avopId
      && item.decision.marker === decision.marker)) {
      report.deduplicated += 1;
      continue;
    }
    if (!digest.pendingCandidates.some((item) => item.avopId === candidate.avopId)) {
      digest.pendingCandidates.push(candidate);
    }
    digest.items.push({ candidate, decision });
    recipientDigests.set(candidate.profileId, digest);
  }

  for (const digest of recipientDigests.values()) {
    if (digest.items.length === 0) continue;
    digest.items.sort(compareDigestItems);
    digest.pendingCandidates.sort(compareCandidates);
    const reservationTokenHash = sha256Hex(randomBytes(32).toString('base64url'));
    const reserved = await input.repository.reserveDigest({
      profileId: digest.profileId,
      items: digest.items.map(({ candidate, decision }) => ({
        activityId: candidate.avopId,
        notificationType: decision.notificationType,
        marker: decision.marker,
        nextSendAt: decision.nextSendAt,
      })),
      reservationTokenHash,
      reservedUntil: new Date(now.getTime() + reserveSeconds * 1000),
      now,
    });
    if (reserved.length === 0) {
      report.skipped += digest.items.length;
      continue;
    }
    if (reserved.length !== digest.items.length) {
      throw new Error('Incomplete AVOP notification digest reservation.');
    }
    report.reserved += reserved.length;

    const reservedByItem = new Map(reserved.map((item) => [digestItemKey(item.activityId, item.marker), item]));
    const resultItems = digest.items.map(({ candidate, decision }) => {
      const reservedItem = reservedByItem.get(digestItemKey(candidate.avopId, decision.marker));
      if (!reservedItem) throw new Error('Reserved AVOP notification item not found.');
      return {
        ...reservedItem,
        idempotencyKey: buildNotificationIdempotencyKey(
          candidate.avopId,
          candidate.profileId,
          decision.marker,
          input.dryRun ? 'DRY_RUN' : 'SENT',
        ),
      };
    });
    const digestIdempotencyKey = buildDigestIdempotencyKey(
      digest.profileId,
      resultItems,
      input.dryRun ? 'DRY_RUN' : 'SENT',
    );

    let providerMessageId: string | null;
    try {
      const message = buildAvopNotificationDigestEmail({
        items: digest.pendingCandidates.map((candidate) => ({
          avopNumber: candidate.avopNumber,
          title: candidate.title,
          marker: digest.items.find((item) => item.candidate.avopId === candidate.avopId)?.decision.marker ?? 'INITIAL',
          acknowledgementUrl: buildAvopAcknowledgementUrl(input.baseUrl, candidate.avopId),
        })),
      });
      const sendResult = input.dryRun
        ? { providerMessageId: null }
        : await input.sender.send({ to: digest.recipient, subject: message.subject, body: message.body });
      providerMessageId = sendResult.providerMessageId;
    } catch (error) {
      const permanent = error instanceof PermanentEmailError;
      const errorResult = permanent ? 'PERMANENT_ERROR' : 'TEMPORARY_ERROR';
      const errorItems = resultItems.map((item) => ({
        ...item,
        idempotencyKey: buildNotificationIdempotencyKey(item.activityId, digest.profileId, item.marker, errorResult),
      }));
      const recorded = await input.repository.recordDigestResult({
        profileId: digest.profileId,
        recipient: digest.recipient,
        reservationTokenHash,
        digestIdempotencyKey: buildDigestIdempotencyKey(digest.profileId, errorItems, errorResult),
        items: errorItems,
        result: permanent ? 'PERMANENT_ERROR' : 'TEMPORARY_ERROR',
        error: 'Falha ao processar notificação de AVOP.',
        errorKind: permanent ? 'PERMANENT' : 'TEMPORARY',
        stopReason: permanent ? 'PERMANENT_EMAIL_ERROR' : null,
        now,
      });
      report.deduplicated += errorItems.length - recorded.logged;
      if (recorded.logged > 0 && permanent) report.permanentErrors += 1;
      else if (recorded.logged > 0) report.temporaryErrors += 1;
      continue;
    }

    const recorded = await input.repository.recordDigestResult({
      profileId: digest.profileId,
      recipient: digest.recipient,
      reservationTokenHash,
      digestIdempotencyKey,
      items: resultItems,
      result: input.dryRun ? 'DRY_RUN' : 'SENT',
      providerMessageId,
      now,
    });
    report.deduplicated += resultItems.length - recorded.logged;
    if (input.dryRun) {
      if (recorded.logged > 0) report.simulated += 1;
      report.itemsSimulated += recorded.logged;
    } else {
      report.sent += 1;
      report.itemsSent += recorded.logged;
    }
  }

  return report;
}

export function buildAvopNotificationDigestEmail(input: {
  items: Array<{
    avopNumber: string;
    title: string;
    marker: AvopNotificationMarker;
    acknowledgementUrl: string;
  }>;
}): { subject: string; body: string } {
  if (input.items.length === 0) throw new PermanentEmailError('Digest sem pendências de AVOP.');
  if (input.items.length === 1) return buildAvopNotificationEmail(input.items[0]);

  const itemLines = input.items.flatMap((item, index) => [
    `${index + 1}. ${safeBodyLine(item.avopNumber)} — ${safeBodyLine(item.title)}`,
    `   Acesso: ${safeBodyLine(item.acknowledgementUrl)}`,
    '',
  ]);

  return {
    subject: 'Central Operacional — AVOPs pendentes de ciência',
    body: [
      'Prezado(a),',
      '',
      'Os seguintes AVOPs estão pendentes de leitura e ciência:',
      '',
      ...itemLines,
      'A abertura dos documentos não registra ciência automaticamente. Após cada leitura, utilize o campo próprio da Central para confirmar a ciência.',
      '',
      'Caso alguma ciência já tenha sido registrada, desconsidere o item correspondente.',
      '',
      'Esta é uma mensagem automática da Central Operacional.',
    ].join('\n'),
  };
}

export function buildAvopNotificationEmail(input: {
  avopNumber: string;
  title: string;
  marker: AvopNotificationMarker;
  acknowledgementUrl: string;
}): { subject: string; body: string } {
  if (input.marker === 'INITIAL') {
    return {
      subject: 'Central Operacional — novo AVOP para ciência',
      body: [
        'Prezado(a),',
        '',
        `Foi publicado o AVOP ${input.avopNumber} — ${input.title}, aplicável ao seu perfil.`,
        '',
        'Acesse a Central Operacional para realizar a leitura e registrar sua ciência:',
        input.acknowledgementUrl,
        '',
        'A abertura do documento não registra ciência automaticamente. Após a leitura, utilize o campo próprio da Central para confirmar a ciência.',
        '',
        'Esta é uma mensagem automática da Central Operacional.',
      ].join('\n'),
    };
  }

  return {
    subject: 'Central Operacional — pendência de ciência de AVOP',
    body: [
      'Prezado(a),',
      '',
      `Consta pendente o registro de ciência do AVOP ${input.avopNumber} — ${input.title}.`,
      '',
      'Acesse a Central Operacional para realizar a leitura e registrar sua ciência:',
      input.acknowledgementUrl,
      '',
      'A abertura do documento não registra ciência automaticamente. Após a leitura, utilize o campo próprio da Central para confirmar a ciência.',
      '',
      'Caso a ciência já tenha sido registrada, desconsidere esta mensagem.',
      '',
      'Esta é uma mensagem automática da Central Operacional.',
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

export function buildDigestIdempotencyKey(
  profileId: string,
  items: Array<{ activityId: string; marker: AvopNotificationMarker }>,
  result: string,
): string {
  const itemKeys = items
    .map((item) => digestItemKey(item.activityId, item.marker))
    .sort();
  return sha256Hex(['AVOP_DIGEST', profileId, result, ...itemKeys].join('|'));
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

function digestItemKey(activityId: string, marker: AvopNotificationMarker): string {
  return `${activityId}:${marker}`;
}

function compareDigestItems(
  left: { candidate: AvopNotificationCandidate },
  right: { candidate: AvopNotificationCandidate },
): number {
  return left.candidate.publicationDate.localeCompare(right.candidate.publicationDate)
    || left.candidate.avopNumber.localeCompare(right.candidate.avopNumber, 'pt-BR')
    || left.candidate.avopId.localeCompare(right.candidate.avopId);
}

function compareCandidates(left: AvopNotificationCandidate, right: AvopNotificationCandidate): number {
  return left.publicationDate.localeCompare(right.publicationDate)
    || left.avopNumber.localeCompare(right.avopNumber, 'pt-BR')
    || left.avopId.localeCompare(right.avopId);
}

function safeBodyLine(value: string): string {
  if (!value || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\r\n]/.test(value)) {
    throw new PermanentEmailError('Conteúdo inválido para mensagem de AVOP.');
  }
  return value;
}

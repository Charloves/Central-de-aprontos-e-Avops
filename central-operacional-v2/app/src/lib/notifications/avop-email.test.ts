import { describe, expect, it, vi } from 'vitest';
import {
  PermanentEmailError,
  buildAvopNotificationEmail,
  decideAvopNotification,
  dueAvopMarkers,
  isSimpleEmailAddress,
  nextMarkerDate,
  runAvopNotificationJob,
  validateCronSecret,
  type AvopEmailSender,
  type AvopNotificationCandidate,
} from './avop-email';
import { FakeAvopNotificationRepository } from './fake-avop-notification-repository';

const baseCandidate: AvopNotificationCandidate = {
  avopId: 'avop-1',
  avopNumber: 'AVOP-HML-001',
  title: 'AVOP ficticio de homologacao',
  publicationDate: '2026-01-31',
  status: 'PUBLISHED',
  profileId: 'profile-1',
  recipientEmail: 'militar@example.test',
  profileActive: true,
  applicableNow: true,
  acknowledged: false,
  sentMarkers: [],
};

function sender(): AvopEmailSender & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(async () => ({ providerMessageId: 'message-test' })),
  };
}

describe('avop email notification rules', () => {
  it('gera divulgacao inicial sem aguardar sete dias', () => {
    const decision = decideAvopNotification(baseCandidate, new Date('2026-01-31T12:00:00Z'));
    expect(decision).toMatchObject({ action: 'SEND', marker: 'INITIAL', notificationType: 'AVOP_INITIAL' });
  });

  it('cobra nos marcos 7, 14, 21 e 28 dias', () => {
    expect(dueAvopMarkers(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-08T00:00:00Z'))).toContain('WEEK_7');
    expect(dueAvopMarkers(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-15T00:00:00Z'))).toContain('WEEK_14');
    expect(dueAvopMarkers(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-22T00:00:00Z'))).toContain('WEEK_21');
    expect(dueAvopMarkers(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-29T00:00:00Z'))).toContain('WEEK_28');
  });

  it('transiciona para cobranca mensal a partir do segundo mes no dia-base', () => {
    const markers = dueAvopMarkers(new Date('2026-01-31T00:00:00Z'), new Date('2026-03-31T00:00:00Z'));
    expect(markers).toContain('MONTH_2');
  });

  it('trata meses com quantidades diferentes de dias', () => {
    expect(nextMarkerDate(new Date('2026-01-31T00:00:00Z'), new Date('2026-03-31T00:00:00Z'))?.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('encerra no limite de 365 dias', () => {
    const decision = decideAvopNotification(baseCandidate, new Date('2027-01-31T00:00:00Z'));
    expect(decision).toMatchObject({ action: 'STOP', reason: 'EXPIRED_365_DAYS' });
  });

  it('cessa por ciencia, AVOP fechado, perfil inativo ou saida do publico', () => {
    expect(decideAvopNotification({ ...baseCandidate, acknowledged: true }, new Date('2026-02-07T00:00:00Z'))).toMatchObject({ action: 'STOP', reason: 'ACKNOWLEDGED' });
    expect(decideAvopNotification({ ...baseCandidate, status: 'CLOSED' }, new Date('2026-02-07T00:00:00Z'))).toMatchObject({ action: 'STOP', reason: 'AVOP_CLOSED' });
    expect(decideAvopNotification({ ...baseCandidate, profileActive: false }, new Date('2026-02-07T00:00:00Z'))).toMatchObject({ action: 'STOP', reason: 'PROFILE_INACTIVE' });
    expect(decideAvopNotification({ ...baseCandidate, applicableNow: false }, new Date('2026-02-07T00:00:00Z'))).toMatchObject({ action: 'STOP', reason: 'NOT_APPLICABLE' });
  });

  it('ignora AVOP em DRAFT', () => {
    expect(decideAvopNotification({ ...baseCandidate, status: 'DRAFT' }, new Date('2026-02-07T00:00:00Z'))).toMatchObject({ action: 'SKIP', reason: 'DRAFT' });
  });

  it('identifica entrada posterior no publico sem alterar snapshot historico', () => {
    const decision = decideAvopNotification({ ...baseCandidate, sentMarkers: [] }, new Date('2026-03-31T00:00:00Z'));
    expect(decision).toMatchObject({ action: 'SEND', marker: 'INITIAL' });
  });

  it('valida email simples e rejeita multiplos destinatarios/cabecalhos maliciosos', () => {
    expect(isSimpleEmailAddress('militar@example.test')).toBe(true);
    expect(isSimpleEmailAddress('militar@example.test,outro@example.test')).toBe(false);
    expect(isSimpleEmailAddress('militar@example.test;outro@example.test')).toBe(false);
    expect(isSimpleEmailAddress('Militar <militar@example.test>')).toBe(false);
    expect(isSimpleEmailAddress('militar@example.test\r\nBcc: outro@example.test')).toBe(false);
  });

  it('valida CRON_SECRET por comparacao segura', () => {
    const secret = '0123456789abcdef0123456789abcdef';
    expect(validateCronSecret({ provided: secret, expected: secret })).toBe(true);
    expect(validateCronSecret({ provided: 'errado', expected: secret })).toBe(false);
    expect(validateCronSecret({ provided: secret, expected: undefined })).toBe(false);
  });

  it('monta templates em portugues para divulgacao e cobranca', () => {
    const initial = buildAvopNotificationEmail({
      avopNumber: 'AVOP-HML-001',
      title: 'Titulo ficticio',
      marker: 'INITIAL',
      acknowledgementUrl: 'https://central.example.test/portal/avops?avop=1',
    });
    expect(initial.subject).toContain('Divulgação de AVOP');
    expect(initial.body).toContain('Para registrar ciência');
    const reminder = buildAvopNotificationEmail({
      avopNumber: 'AVOP-HML-001',
      title: 'Titulo ficticio',
      marker: 'WEEK_7',
      acknowledgementUrl: 'https://central.example.test/portal/avops?avop=1',
    });
    expect(reminder.subject).toContain('Pendência');
  });
});

describe('avop email notification job', () => {
  it('executa divulgacao inicial em dry-run sem chamada externa', async () => {
    const fakeSender = sender();
    const repository = new FakeAvopNotificationRepository([baseCandidate]);
    const report = await runAvopNotificationJob({
      repository,
      sender: fakeSender,
      now: new Date('2026-01-31T12:00:00Z'),
      baseUrl: 'https://central.example.test',
      dryRun: true,
    });
    expect(report).toMatchObject({ scanned: 1, reserved: 1, sent: 1 });
    expect(repository.logs).toHaveLength(1);
    expect(repository.logs[0]).toMatchObject({ marker: 'INITIAL', result: 'DRY_RUN' });
    expect(fakeSender.send).not.toHaveBeenCalled();
  });

  it('envia cobranca real via sender injetado quando dry-run esta falso', async () => {
    const fakeSender = sender();
    const repository = new FakeAvopNotificationRepository([{ ...baseCandidate, sentMarkers: ['INITIAL'] }]);
    const report = await runAvopNotificationJob({
      repository,
      sender: fakeSender,
      now: new Date('2026-02-07T12:00:00Z'),
      baseUrl: 'https://central.example.test',
      dryRun: false,
    });
    expect(report.sent).toBe(1);
    expect(fakeSender.send).toHaveBeenCalledTimes(1);
    expect(repository.logs[0]).toMatchObject({ marker: 'WEEK_7', result: 'SENT' });
  });

  it('nao duplica envio em job repetido', async () => {
    const repository = new FakeAvopNotificationRepository([baseCandidate]);
    await runAvopNotificationJob({ repository, sender: sender(), now: new Date('2026-01-31T00:00:00Z'), baseUrl: 'https://central.example.test', dryRun: true });
    await runAvopNotificationJob({ repository, sender: sender(), now: new Date('2026-01-31T00:00:00Z'), baseUrl: 'https://central.example.test', dryRun: true });
    expect(repository.logs.filter((log) => log.marker === 'INITIAL')).toHaveLength(1);
  });

  it('nao duplica destinatario quando a listagem retornar o mesmo militar duas vezes', async () => {
    const repository = new FakeAvopNotificationRepository([baseCandidate, { ...baseCandidate }]);
    const report = await runAvopNotificationJob({ repository, sender: sender(), now: new Date('2026-01-31T00:00:00Z'), baseUrl: 'https://central.example.test', dryRun: true });
    expect(report).toMatchObject({ scanned: 2, sent: 1, skipped: 1 });
    expect(repository.logs.filter((log) => log.marker === 'INITIAL')).toHaveLength(1);
  });

  it('evita duplicidade em duas execucoes concorrentes', async () => {
    const repository = new FakeAvopNotificationRepository([baseCandidate]);
    await Promise.all([
      runAvopNotificationJob({ repository, sender: sender(), now: new Date('2026-01-31T00:00:00Z'), baseUrl: 'https://central.example.test', dryRun: true }),
      runAvopNotificationJob({ repository, sender: sender(), now: new Date('2026-01-31T00:00:00Z'), baseUrl: 'https://central.example.test', dryRun: true }),
    ]);
    expect(repository.logs.filter((log) => log.marker === 'INITIAL')).toHaveLength(1);
  });

  it('libera reserva expirada para nova tentativa controlada', async () => {
    const repository = new FakeAvopNotificationRepository([baseCandidate]);
    const first = await repository.reserve({
      activityId: baseCandidate.avopId,
      profileId: baseCandidate.profileId,
      notificationType: 'AVOP_INITIAL',
      marker: 'INITIAL',
      reservationTokenHash: 'a'.repeat(64),
      reservedUntil: new Date('2026-01-31T00:05:00Z'),
      now: new Date('2026-01-31T00:00:00Z'),
    });
    const blocked = await repository.reserve({
      activityId: baseCandidate.avopId,
      profileId: baseCandidate.profileId,
      notificationType: 'AVOP_INITIAL',
      marker: 'INITIAL',
      reservationTokenHash: 'b'.repeat(64),
      reservedUntil: new Date('2026-01-31T00:06:00Z'),
      now: new Date('2026-01-31T00:01:00Z'),
    });
    const afterExpiration = await repository.reserve({
      activityId: baseCandidate.avopId,
      profileId: baseCandidate.profileId,
      notificationType: 'AVOP_INITIAL',
      marker: 'INITIAL',
      reservationTokenHash: 'c'.repeat(64),
      reservedUntil: new Date('2026-01-31T00:11:00Z'),
      now: new Date('2026-01-31T00:10:00Z'),
    });
    expect(first).not.toBeNull();
    expect(blocked).toBeNull();
    expect(afterExpiration).not.toBeNull();
  });

  it('permite nova tentativa controlada apos erro temporario', async () => {
    const fakeSender = sender();
    fakeSender.send.mockRejectedValueOnce(new Error('falha temporaria'));
    const repository = new FakeAvopNotificationRepository([{ ...baseCandidate, sentMarkers: ['INITIAL'] }]);
    const first = await runAvopNotificationJob({ repository, sender: fakeSender, now: new Date('2026-02-07T00:00:00Z'), baseUrl: 'https://central.example.test', dryRun: false });
    const second = await runAvopNotificationJob({ repository, sender: sender(), now: new Date('2026-02-07T00:10:00Z'), baseUrl: 'https://central.example.test', dryRun: false });
    expect(first.temporaryErrors).toBe(1);
    expect(second.sent).toBe(1);
  });

  it('registra erro permanente sem loop infinito', async () => {
    const fakeSender = sender();
    fakeSender.send.mockRejectedValueOnce(new PermanentEmailError('invalido'));
    const repository = new FakeAvopNotificationRepository([{ ...baseCandidate, sentMarkers: ['INITIAL'] }]);
    const report = await runAvopNotificationJob({ repository, sender: fakeSender, now: new Date('2026-02-07T00:00:00Z'), baseUrl: 'https://central.example.test', dryRun: false });
    expect(report.permanentErrors).toBe(1);
    expect(Array.from(repository.schedules.values())[0]?.stoppedReason).toBe('PERMANENT_EMAIL_ERROR');
  });

  it('registra destinatario ausente ou invalido como erro permanente sem enviar', async () => {
    const fakeSender = sender();
    const repository = new FakeAvopNotificationRepository([
      { ...baseCandidate, recipientEmail: null },
      { ...baseCandidate, avopId: 'avop-2', profileId: 'profile-2', recipientEmail: 'bad,mail@example.test' },
    ]);
    const report = await runAvopNotificationJob({ repository, sender: fakeSender, now: new Date('2026-01-31T00:00:00Z'), baseUrl: 'https://central.example.test', dryRun: false });
    expect(report.permanentErrors).toBe(2);
    expect(fakeSender.send).not.toHaveBeenCalled();
  });
});

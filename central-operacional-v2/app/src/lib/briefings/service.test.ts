import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import { FakeBriefingRepository } from './fake-briefing-repository';
import {
  getBriefingCloseInstant,
  getEffectiveBriefingStatus,
  isValidBriefingMaterialUrl,
  normalizeJustificationText,
} from './rules';
import {
  acknowledgeBriefingMaterialForSession,
  extractBriefingJustification,
  extractBriefingMaterialId,
  justifyBriefingAbsenceForSession,
  listApplicableBriefingsForSession,
} from './service';
import type { BriefingListItem, BriefingRecord } from './types';

vi.mock('server-only', () => ({}));

const baseSession: AuthenticatedSession = {
  sessionIdentifier: 'opaque-session-token-briefing-test-000000001',
  profileId: 'profile-piloto',
  persistentSessionId: 'persistent-session-id-briefing',
  trigram: 'PLT',
  roles: ['USER'],
};

const openDate = '2026-08-10';
const beforeClose = new Date('2026-08-13T02:59:59.000Z');
const afterClose = new Date('2026-08-13T03:00:00.000Z');

function briefing(input: Partial<BriefingListItem> & Pick<BriefingListItem, 'id' | 'legacyId' | 'title' | 'audiences'>): BriefingListItem {
  return {
    eventDate: openDate,
    status: 'OPEN',
    effectiveStatus: 'OPEN',
    driveUrl: 'https://drive.google.com/file/d/ficticio/view',
    requiresMaterialAcknowledgement: true,
    record: null,
    latestJustification: null,
    ...input,
  };
}

function record(input: Partial<BriefingRecord> & Pick<BriefingRecord, 'briefingId' | 'profileId'>): BriefingRecord {
  return {
    id: `record-${input.profileId}-${input.briefingId}`,
    attendanceStatus: 'PENDENTE',
    materialAcknowledged: false,
    recordedAt: '2026-08-11T10:00:00.000Z',
    ...input,
  };
}

function repository() {
  return new FakeBriefingRepository({
    profiles: [
      { id: 'profile-piloto', active: true, audiences: ['PILOTO'] },
      { id: 'profile-tripulante', active: true, audiences: ['TRIPULANTE'] },
      { id: 'profile-hsar', active: true, audiences: ['HSAR'] },
      { id: 'profile-misto', active: true, audiences: ['PILOTO', 'HSAR'] },
      { id: 'profile-user', active: true, audiences: ['TODOS'] },
      { id: 'profile-inactive', active: false, audiences: ['PILOTO'] },
    ],
    briefings: [
      briefing({ id: 'briefing-piloto', legacyId: 'APR-001', title: 'Piloto', audiences: ['PILOTO'] }),
      briefing({ id: 'briefing-tripulante', legacyId: 'APR-002', title: 'Tripulante', audiences: ['TRIPULANTE'] }),
      briefing({ id: 'briefing-hsar', legacyId: 'APR-003', title: 'HSAR', audiences: ['HSAR'] }),
      briefing({ id: 'briefing-todos', legacyId: 'APR-004', title: 'Todos', audiences: ['TODOS'] }),
      briefing({ id: 'briefing-misto', legacyId: 'APR-005', title: 'Misto', audiences: ['PILOTO', 'TRIPULANTE'] }),
      briefing({ id: 'briefing-closed', legacyId: 'APR-006', title: 'Fechado', audiences: ['PILOTO'], status: 'CLOSED' }),
      briefing({ id: 'briefing-no-material', legacyId: 'APR-007', title: 'Sem material', audiences: ['PILOTO'], requiresMaterialAcknowledgement: false }),
      briefing({ id: 'briefing-invalid-link', legacyId: 'APR-008', title: 'Link invalido', audiences: ['PILOTO'], driveUrl: 'http://example.test/documento.pdf' }),
      briefing({ id: 'briefing-invalid-date', legacyId: 'APR-009', title: 'Data invalida', audiences: ['PILOTO'], eventDate: '2026-02-31' }),
      briefing({ id: 'briefing-draft', legacyId: 'APR-010', title: 'Rascunho', audiences: ['PILOTO'], status: 'DRAFT' }),
    ],
    records: [
      record({ briefingId: 'briefing-piloto', profileId: 'profile-misto', attendanceStatus: 'PRESENTE', materialAcknowledged: false }),
      record({ briefingId: 'briefing-todos', profileId: 'profile-user', attendanceStatus: '', materialAcknowledged: false }),
    ],
  });
}

describe('Briefing module service', () => {
  it('lista aprontos aplicaveis para PILOTO, TRIPULANTE, HSAR, TODOS e perfis mistos', async () => {
    const repo = repository();

    const piloto = await listApplicableBriefingsForSession(baseSession, repo, beforeClose);
    const tripulante = await listApplicableBriefingsForSession({ ...baseSession, profileId: 'profile-tripulante' }, repo, beforeClose);
    const hsar = await listApplicableBriefingsForSession({ ...baseSession, profileId: 'profile-hsar' }, repo, beforeClose);
    const misto = await listApplicableBriefingsForSession({ ...baseSession, profileId: 'profile-misto' }, repo, beforeClose);
    const todos = await listApplicableBriefingsForSession({ ...baseSession, profileId: 'profile-user' }, repo, beforeClose);

    expect(piloto.map((item) => item.id)).toEqual(expect.arrayContaining(['briefing-piloto', 'briefing-todos', 'briefing-misto']));
    expect(tripulante.map((item) => item.id)).toEqual(expect.arrayContaining(['briefing-tripulante', 'briefing-todos', 'briefing-misto']));
    expect(hsar.map((item) => item.id)).toEqual(expect.arrayContaining(['briefing-hsar', 'briefing-todos']));
    expect(misto.map((item) => item.id)).toEqual(expect.arrayContaining(['briefing-piloto', 'briefing-hsar', 'briefing-todos', 'briefing-misto']));
    expect(todos.map((item) => item.id)).toEqual(['briefing-todos']);
  });

  it('nao lista aprontos para perfil inativo nem rascunho', async () => {
    const repo = repository();
    const list = await listApplicableBriefingsForSession({ ...baseSession, profileId: 'profile-inactive' }, repo, beforeClose);
    const piloto = await listApplicableBriefingsForSession(baseSession, repo, beforeClose);

    expect(list).toEqual([]);
    expect(piloto.map((item) => item.id)).not.toContain('briefing-draft');
  });

  it('calcula fechamento no inicio do quarto dia em America/Sao_Paulo', () => {
    expect(getBriefingCloseInstant('2026-08-10').toISOString()).toBe('2026-08-13T03:00:00.000Z');
    expect(getEffectiveBriefingStatus({ status: 'OPEN', eventDate: '2026-08-10' }, beforeClose)).toBe('OPEN');
    expect(getEffectiveBriefingStatus({ status: 'OPEN', eventDate: '2026-08-10' }, afterClose)).toBe('CLOSED');
  });

  it('trata transicao de ano e data invalida de forma segura', () => {
    expect(getBriefingCloseInstant('2026-12-31').toISOString()).toBe('2027-01-03T03:00:00.000Z');
    expect(getEffectiveBriefingStatus({ status: 'OPEN', eventDate: '2026-02-31' }, beforeClose)).toBe('CLOSED');
  });

  it('registra ciencia de material explicitamente e preserva o primeiro timestamp em repeticao', async () => {
    const repo = repository();
    const first = await acknowledgeBriefingMaterialForSession({
      session: baseSession,
      briefingId: 'briefing-piloto',
      repository: repo,
      now: new Date('2026-08-11T10:00:00.000Z'),
    });
    const second = await acknowledgeBriefingMaterialForSession({
      session: baseSession,
      briefingId: 'briefing-piloto',
      repository: repo,
      now: new Date('2026-08-11T11:00:00.000Z'),
    });

    expect(first).toMatchObject({ ok: true, alreadyAcknowledged: false });
    expect(second).toMatchObject({ ok: true, alreadyAcknowledged: true });
    expect(first.ok && second.ok ? second.record.recordedAt : null).toBe('2026-08-11T10:00:00.000Z');
    expect(first.ok ? first.record.attendanceStatus : null).toBe('PENDENTE');
    expect(repo.materialWrites).toBe(1);
  });

  it('mantem idempotencia em duplo envio concorrente da ciencia de material', async () => {
    const repo = repository();
    const [first, second] = await Promise.all([
      acknowledgeBriefingMaterialForSession({ session: baseSession, briefingId: 'briefing-piloto', repository: repo, now: beforeClose }),
      acknowledgeBriefingMaterialForSession({ session: baseSession, briefingId: 'briefing-piloto', repository: repo, now: beforeClose }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(repo.materialWrites).toBe(1);
  });

  it('nao registra ciencia ao apenas listar ou abrir link', async () => {
    const repo = repository();
    const list = await listApplicableBriefingsForSession(baseSession, repo, beforeClose);

    expect(list.find((item) => item.id === 'briefing-piloto')?.driveUrl).toContain('drive.google.com');
    expect(repo.materialWrites).toBe(0);
  });

  it('rejeita ciencia em apronto nao aplicavel, fechado, sem exigencia, com data fechada ou link invalido', async () => {
    const repo = repository();

    await expect(acknowledgeBriefingMaterialForSession({ session: baseSession, briefingId: 'briefing-tripulante', repository: repo, now: beforeClose })).resolves.toMatchObject({ ok: false, reason: 'NOT_APPLICABLE' });
    await expect(acknowledgeBriefingMaterialForSession({ session: baseSession, briefingId: 'briefing-closed', repository: repo, now: beforeClose })).resolves.toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
    await expect(acknowledgeBriefingMaterialForSession({ session: baseSession, briefingId: 'briefing-no-material', repository: repo, now: beforeClose })).resolves.toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
    await expect(acknowledgeBriefingMaterialForSession({ session: baseSession, briefingId: 'briefing-piloto', repository: repo, now: afterClose })).resolves.toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
    await expect(acknowledgeBriefingMaterialForSession({ session: baseSession, briefingId: 'briefing-invalid-link', repository: repo, now: beforeClose })).resolves.toMatchObject({ ok: false, reason: 'INVALID_DOCUMENT' });
  });

  it('registra justificativa sem transformar em presenca nem ciencia de material', async () => {
    const repo = repository();
    const result = await justifyBriefingAbsenceForSession({
      session: baseSession,
      briefingId: 'briefing-piloto',
      text: 'escala operacional',
      repository: repo,
      now: new Date('2026-08-11T12:00:00.000Z'),
    });
    const list = await listApplicableBriefingsForSession(baseSession, repo, beforeClose);
    const briefing = list.find((item) => item.id === 'briefing-piloto');

    expect(result).toMatchObject({ ok: true });
    expect(briefing?.latestJustification?.text).toBe('escala operacional');
    expect(briefing?.record?.attendanceStatus).toBeUndefined();
    expect(briefing?.record?.materialAcknowledged).toBeUndefined();
    expect(repo.justificationWrites).toBe(1);
  });

  it('preserva campos legados vazios sem inventar presenca ou falta', async () => {
    const repo = repository();
    const list = await listApplicableBriefingsForSession({ ...baseSession, profileId: 'profile-user' }, repo, beforeClose);
    const todos = list.find((item) => item.id === 'briefing-todos');

    expect(todos?.record?.attendanceStatus).toBe('');
    expect(todos?.record?.materialAcknowledged).toBe(false);
  });

  it('valida justificativa vazia, curta, excessiva e com tentativa de HTML ou script', async () => {
    const repo = repository();

    expect(normalizeJustificationText('   missao   operacional   ')).toBe('missao operacional');
    expect(normalizeJustificationText('')).toBeNull();
    expect(normalizeJustificationText('ab')).toBeNull();
    expect(normalizeJustificationText('a'.repeat(501))).toBeNull();
    expect(normalizeJustificationText('<script>alert(1)</script>')).toBeNull();
    expect(normalizeJustificationText('javascript:alert(1)')).toBeNull();
    await expect(justifyBriefingAbsenceForSession({ session: baseSession, briefingId: 'briefing-piloto', text: '<b>teste</b>', repository: repo, now: beforeClose })).resolves.toMatchObject({ ok: false, reason: 'INVALID_TEXT' });
  });

  it('rejeita justificativa em apronto nao aplicavel, fechado ou com fechamento efetivo', async () => {
    const repo = repository();

    await expect(justifyBriefingAbsenceForSession({ session: baseSession, briefingId: 'briefing-tripulante', text: 'escala', repository: repo, now: beforeClose })).resolves.toMatchObject({ ok: false, reason: 'NOT_APPLICABLE' });
    await expect(justifyBriefingAbsenceForSession({ session: baseSession, briefingId: 'briefing-closed', text: 'escala', repository: repo, now: beforeClose })).resolves.toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
    await expect(justifyBriefingAbsenceForSession({ session: baseSession, briefingId: 'briefing-piloto', text: 'escala', repository: repo, now: afterClose })).resolves.toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
  });

  it('rejeita identidade de terceiro enviada pelo navegador', async () => {
    for (const field of ['profileId', 'profile_id', 'trigram', 'trigrama', 'sessionId', 'session_id']) {
      const material = new FormData();
      material.set('briefingId', 'briefing-piloto');
      material.set(field, 'TRP');

      const justification = new FormData();
      justification.set('briefingId', 'briefing-piloto');
      justification.set('text', 'escala operacional');
      justification.set(field, 'TRP');

      await expect(extractBriefingMaterialId(material)).resolves.toBe('');
      await expect(extractBriefingJustification(justification)).resolves.toEqual({ briefingId: '', text: '' });
    }
  });

  it('aceita somente links de material permitidos por ambiente', () => {
    expect(isValidBriefingMaterialUrl('https://drive.google.com/file/d/ficticio/view', 'production')).toBe(true);
    expect(isValidBriefingMaterialUrl('https://example.test/docs/apr.pdf', 'development')).toBe(true);
    expect(isValidBriefingMaterialUrl('https://example.test/docs/apr.pdf', 'test')).toBe(true);
    expect(isValidBriefingMaterialUrl('https://example.test/docs/apr.pdf', 'production')).toBe(false);
    expect(isValidBriefingMaterialUrl('http://drive.google.com/file/d/ficticio/view', 'production')).toBe(false);
    expect(isValidBriefingMaterialUrl('https://drive.google.com.evil.test/file', 'production')).toBe(false);
    expect(isValidBriefingMaterialUrl('https://user:pass@drive.google.com/file/d/ficticio/view', 'production')).toBe(false);
    expect(isValidBriefingMaterialUrl('javascript:alert(1)', 'development')).toBe(false);
    expect(isValidBriefingMaterialUrl('data:text/html,teste', 'development')).toBe(false);
    expect(isValidBriefingMaterialUrl('not-a-url', 'development')).toBe(false);
  });
});

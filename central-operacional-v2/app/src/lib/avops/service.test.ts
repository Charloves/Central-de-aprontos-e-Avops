import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedSession } from '@/lib/auth/authorization';
import { FakeAvopRepository } from './fake-avop-repository';
import { isValidDriveUrl } from './rules';
import { acknowledgeAvopForSession, extractAcknowledgeAvopId, listApplicableAvopsForSession } from './service';
import type { AvopListItem } from './types';

vi.mock('server-only', () => ({}));

const baseSession: AuthenticatedSession = {
  sessionIdentifier: 'opaque-session-token-avop-test-00000000001',
  profileId: 'profile-piloto',
  persistentSessionId: 'persistent-session-id-1',
  trigram: 'PLT',
  roles: ['USER'],
};

const publishedBase = {
  publicationDate: '2026-04-22',
  dueDate: null,
  status: 'PUBLISHED' as const,
  driveUrl: 'https://drive.google.com/file/d/ficticio/view',
  requiresAcknowledgement: true,
  acknowledgement: null,
};

function avop(input: Partial<AvopListItem> & Pick<AvopListItem, 'id' | 'number' | 'title' | 'audiences'>): AvopListItem {
  return { ...publishedBase, ...input };
}

function repository() {
  return new FakeAvopRepository({
    profiles: [
      { id: 'profile-piloto', active: true, audiences: ['PILOTO'] },
      { id: 'profile-tripulante', active: true, audiences: ['TRIPULANTE'] },
      { id: 'profile-hsar', active: true, audiences: ['HSAR'] },
      { id: 'profile-misto', active: true, audiences: ['PILOTO', 'HSAR'] },
      { id: 'profile-inactive', active: false, audiences: ['PILOTO'] },
      { id: 'profile-user', active: true, audiences: ['TODOS'] },
    ],
    avops: [
      avop({ id: 'avop-piloto', number: 'AVOP 01-2026', title: 'Piloto', audiences: ['PILOTO'] }),
      avop({ id: 'avop-tripulante', number: 'AVOP 02-2026', title: 'Tripulante', audiences: ['TRIPULANTE'] }),
      avop({ id: 'avop-hsar', number: 'AVOP 03-2026', title: 'HSAR', audiences: ['HSAR'] }),
      avop({ id: 'avop-todos', number: 'AVOP 04-2026', title: 'Todos', audiences: ['TODOS'] }),
      avop({ id: 'avop-misto', number: 'AVOP 05-2026', title: 'Misto', audiences: ['PILOTO', 'TRIPULANTE'] }),
      avop({ id: 'avop-closed', number: 'AVOP 06-2026', title: 'Fechado', audiences: ['PILOTO'], status: 'CLOSED' }),
      avop({ id: 'avop-invalid-link', number: 'AVOP 07-2026', title: 'Link invalido', audiences: ['PILOTO'], driveUrl: 'http://example.test/documento.pdf' }),
    ],
  });
}

describe('AVOP module service', () => {
  it('lista AVOPs aplicaveis para PILOTO, TODOS e perfis mistos', async () => {
    const repo = repository();

    await expect(listApplicableAvopsForSession(baseSession, repo)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'avop-piloto' }),
        expect.objectContaining({ id: 'avop-todos' }),
        expect.objectContaining({ id: 'avop-misto' }),
      ]),
    );
    await expect(listApplicableAvopsForSession({ ...baseSession, profileId: 'profile-misto' }, repo)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'avop-piloto' }),
        expect.objectContaining({ id: 'avop-hsar' }),
        expect.objectContaining({ id: 'avop-misto' }),
      ]),
    );
  });

  it('respeita TRIPULANTE, HSAR e nao mostra AVOP nao aplicavel', async () => {
    const repo = repository();

    const tripulante = await listApplicableAvopsForSession({ ...baseSession, profileId: 'profile-tripulante' }, repo);
    const hsar = await listApplicableAvopsForSession({ ...baseSession, profileId: 'profile-hsar' }, repo);

    expect(tripulante.map((item) => item.id)).toContain('avop-tripulante');
    expect(tripulante.map((item) => item.id)).not.toContain('avop-piloto');
    expect(hsar.map((item) => item.id)).toContain('avop-hsar');
    expect(hsar.map((item) => item.id)).not.toContain('avop-tripulante');
  });

  it('nao lista AVOP para perfil inativo', async () => {
    await expect(listApplicableAvopsForSession({ ...baseSession, profileId: 'profile-inactive' }, repository())).resolves.toEqual([]);
  });

  it('registra primeira ciencia e preserva o primeiro registro em repeticao', async () => {
    const repo = repository();
    const first = await acknowledgeAvopForSession({
      session: baseSession,
      avopId: 'avop-piloto',
      repository: repo,
      now: new Date('2026-05-01T10:00:00.000Z'),
    });
    const second = await acknowledgeAvopForSession({
      session: baseSession,
      avopId: 'avop-piloto',
      repository: repo,
      now: new Date('2026-05-01T11:00:00.000Z'),
    });

    expect(first).toMatchObject({ ok: true, alreadyAcknowledged: false });
    expect(second).toMatchObject({ ok: true, alreadyAcknowledged: true });
    expect(first.ok && second.ok ? second.acknowledgement.acknowledgedAt : null).toBe('2026-05-01T10:00:00.000Z');
    expect(first.ok ? first.acknowledgement.sessionId : null).toBe('persistent-session-id-1');
    expect(repo.acknowledgementWrites).toBe(1);
  });

  it('mantem idempotencia em duplo envio concorrente no repositorio fake', async () => {
    const repo = repository();
    const [first, second] = await Promise.all([
      acknowledgeAvopForSession({ session: baseSession, avopId: 'avop-piloto', repository: repo }),
      acknowledgeAvopForSession({ session: baseSession, avopId: 'avop-piloto', repository: repo }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(repo.acknowledgementWrites).toBe(1);
  });

  it('nao registra ciencia ao apenas listar ou abrir link', async () => {
    const repo = repository();
    const list = await listApplicableAvopsForSession(baseSession, repo);

    expect(list.find((item) => item.id === 'avop-piloto')?.driveUrl).toContain('drive.google.com');
    expect(repo.acknowledgementWrites).toBe(0);
  });

  it('rejeita AVOP nao aplicavel, fechado ou com link ausente/invalido', async () => {
    const repo = repository();

    await expect(acknowledgeAvopForSession({ session: baseSession, avopId: 'avop-tripulante', repository: repo })).resolves.toMatchObject({ ok: false, reason: 'NOT_APPLICABLE' });
    await expect(acknowledgeAvopForSession({ session: baseSession, avopId: 'avop-closed', repository: repo })).resolves.toMatchObject({ ok: false, reason: 'NOT_APPLICABLE' });
    await expect(acknowledgeAvopForSession({ session: baseSession, avopId: 'avop-invalid-link', repository: repo })).resolves.toMatchObject({ ok: false, reason: 'INVALID_DOCUMENT' });
  });

  it('aceita URL HTTPS armazenada como documento valido', () => {
    expect(isValidDriveUrl('https://drive.google.com/file/d/ficticio/view')).toBe(true);
    expect(isValidDriveUrl('https://example.test/documento.pdf', 'development')).toBe(true);
    expect(isValidDriveUrl('https://example.test/documento.pdf', 'test')).toBe(true);
    expect(isValidDriveUrl('https://example.test/documento.pdf', 'production')).toBe(false);
    expect(isValidDriveUrl('https://drive.google.com.evil.example.test/file')).toBe(false);
    expect(isValidDriveUrl('https://evil.example.test/drive.google.com/file')).toBe(false);
    expect(isValidDriveUrl('https://user:pass@drive.google.com/file/d/ficticio/view')).toBe(false);
    expect(isValidDriveUrl('http://example.test/documento.pdf')).toBe(false);
    expect(isValidDriveUrl('javascript:alert(1)')).toBe(false);
    expect(isValidDriveUrl('data:text/html,teste')).toBe(false);
    expect(isValidDriveUrl('not-a-url')).toBe(false);
  });

  it('ignora identidade de terceiro enviada pelo navegador e usa somente a sessao', async () => {
    const formData = new FormData();
    formData.set('avopId', 'avop-piloto');
    formData.set('profileId', 'profile-tripulante');
    formData.set('trigram', 'TRP');

    await expect(extractAcknowledgeAvopId(formData)).resolves.toBe('avop-piloto');
    await expect(acknowledgeAvopForSession({
      session: baseSession,
      avopId: await extractAcknowledgeAvopId(formData),
      repository: repository(),
    })).resolves.toMatchObject({ ok: true });
  });
});

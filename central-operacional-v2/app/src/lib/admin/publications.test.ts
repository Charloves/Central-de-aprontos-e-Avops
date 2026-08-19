import { describe, expect, it } from 'vitest';
import {
  parseAvopDraftForm,
  parseBriefingDraftForm,
  publishAvopForSession,
  publishBriefingForSession,
  saveAvopDraftForSession,
  saveBriefingDraftForSession,
} from './publications';
import { FakePublicationRepository } from './fake-publication-repository';
import type { AuthenticatedSession } from '@/lib/auth/authorization';

const adminSession = sessionWithRoles(['ADMIN']);
const coordinatorSession = sessionWithRoles(['COORDINATOR']);
const userSession = sessionWithRoles(['USER']);
const now = new Date('2026-08-17T12:00:00.000Z');

describe('administrative publication workflow', () => {
  it('blocks USER and allows ADMIN or COORDINATOR', async () => {
    const repository = new FakePublicationRepository();

    expect(await saveAvopDraftForSession({ session: userSession, repository, formData: avopForm(), now })).toEqual({
      ok: false,
      reason: 'FORBIDDEN',
    });
    expect((await saveAvopDraftForSession({ session: adminSession, repository, formData: avopForm(), now })).ok).toBe(true);
    expect((await saveBriefingDraftForSession({ session: coordinatorSession, repository, formData: briefingForm(), now })).ok).toBe(true);
  });

  it('creates and edits AVOP and briefing drafts before publication', async () => {
    const repository = new FakePublicationRepository();
    const createdAvop = await saveAvopDraftForSession({ session: adminSession, repository, formData: avopForm(), now });
    expect(createdAvop.ok).toBe(true);
    if (!createdAvop.ok) throw new Error('expected AVOP draft');

    const editedAvop = await saveAvopDraftForSession({
      session: adminSession,
      repository,
      formData: avopForm({ draftId: createdAvop.id, title: 'AVOP revisado' }),
      now,
    });
    expect(editedAvop).toMatchObject({ ok: true, id: createdAvop.id });
    expect(repository.avops.get(createdAvop.id)?.title).toBe('AVOP revisado');

    const createdBriefing = await saveBriefingDraftForSession({ session: adminSession, repository, formData: briefingForm(), now });
    expect(createdBriefing.ok).toBe(true);
    if (!createdBriefing.ok) throw new Error('expected briefing draft');
    const editedBriefing = await saveBriefingDraftForSession({
      session: adminSession,
      repository,
      formData: briefingForm({ draftId: createdBriefing.id, title: 'Apronto revisado' }),
      now,
    });
    expect(editedBriefing).toMatchObject({ ok: true, id: createdBriefing.id });
    expect(repository.briefings.get(createdBriefing.id)?.title).toBe('Apronto revisado');
  });

  it('publishes explicitly and preserves the first snapshot on repeated or concurrent requests', async () => {
    const repository = new FakePublicationRepository();
    const created = await saveAvopDraftForSession({ session: adminSession, repository, formData: avopForm({ audiences: ['PILOTO'] }), now });
    if (!created.ok) throw new Error('expected AVOP draft');
    const form = publishForm(created.id);

    const first = await publishAvopForSession({ session: adminSession, repository, formData: form, now });
    const repeated = await publishAvopForSession({ session: adminSession, repository, formData: form, now: new Date('2026-08-18T12:00:00.000Z') });
    const concurrent = await Promise.all([
      publishAvopForSession({ session: adminSession, repository, formData: form, now }),
      publishAvopForSession({ session: adminSession, repository, formData: form, now }),
    ]);

    expect(first).toMatchObject({ ok: true, applicableProfileCount: 2, alreadyPublished: false });
    expect(repeated).toMatchObject({ ok: true, applicableProfileCount: 2, alreadyPublished: true });
    expect(concurrent.every((result) => result.ok)).toBe(true);
    expect(repository.auditEvents.filter((event) => event.action === 'AVOP_PUBLISHED')).toHaveLength(1);
    expect(repository.avops.get(created.id)?.snapshot?.publishedAt).toBe(now.toISOString());
  });

  it('handles TODOS, mixed audiences, duplicate membership causes and inactive profiles', async () => {
    const repository = new FakePublicationRepository();
    const todos = await saveAvopDraftForSession({ session: adminSession, repository, formData: avopForm({ audiences: ['TODOS'] }), now });
    const mixed = await saveBriefingDraftForSession({
      session: adminSession,
      repository,
      formData: briefingForm({ audiences: ['PILOTO', 'HSAR'] }),
      now,
    });
    if (!todos.ok || !mixed.ok) throw new Error('expected drafts');

    const todosPublication = await publishAvopForSession({ session: adminSession, repository, formData: publishForm(todos.id), now });
    const mixedPublication = await publishBriefingForSession({ session: adminSession, repository, formData: publishForm(mixed.id), now });

    expect(todosPublication).toMatchObject({ ok: true, applicableProfileCount: 4 });
    expect(mixedPublication).toMatchObject({ ok: true, applicableProfileCount: 3 });
    expect(repository.briefingMembers.get(mixed.id)).toContainEqual({ profileId: 'profile-misto', audience: 'PILOTO' });
    expect(repository.briefingMembers.get(mixed.id)).toContainEqual({ profileId: 'profile-misto', audience: 'HSAR' });
    expect(repository.briefingMembers.get(mixed.id)?.some((member) => member.profileId === 'profile-inativo')).toBe(false);
  });

  it('rejects publication without audience or without applicable profiles', async () => {
    const repository = new FakePublicationRepository();
    repository.profiles.forEach((profile) => {
      profile.active = false;
    });
    const created = await saveAvopDraftForSession({ session: adminSession, repository, formData: avopForm({ audiences: ['PILOTO'] }), now });
    if (!created.ok) throw new Error('expected AVOP draft');
    expect(await publishAvopForSession({ session: adminSession, repository, formData: publishForm(created.id), now })).toEqual({
      ok: false,
      reason: 'NO_APPLICABLE_PROFILES',
    });
    expect(parseAvopDraftForm(avopForm({ audiences: [] })).ok).toBe(false);
  });

  it('rejects editing published records', async () => {
    const repository = new FakePublicationRepository();
    const avop = await saveAvopDraftForSession({ session: adminSession, repository, formData: avopForm(), now });
    const briefing = await saveBriefingDraftForSession({ session: adminSession, repository, formData: briefingForm(), now });
    if (!avop.ok || !briefing.ok) throw new Error('expected drafts');
    await publishAvopForSession({ session: adminSession, repository, formData: publishForm(avop.id), now });
    await publishBriefingForSession({ session: adminSession, repository, formData: publishForm(briefing.id), now });

    expect(await saveAvopDraftForSession({ session: adminSession, repository, formData: avopForm({ draftId: avop.id }), now })).toEqual({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
    expect(await saveBriefingDraftForSession({ session: adminSession, repository, formData: briefingForm({ draftId: briefing.id }), now })).toEqual({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
  });

  it('rejects unsafe URLs and client-supplied identity', () => {
    expect(parseAvopDraftForm(avopForm({ driveUrl: 'https://drive.google.com.evil.test/file' })).ok).toBe(false);
    expect(parseAvopDraftForm(avopForm({ driveUrl: 'javascript:alert(1)' })).ok).toBe(false);
    expect(parseBriefingDraftForm(briefingForm({ driveUrl: 'https://user@example.test/material' })).ok).toBe(false);

    const form = avopForm();
    form.set('profile_id', 'third-party');
    expect(parseAvopDraftForm(form).ok).toBe(false);
  });

  it('does not mutate unrelated historical records while publishing a draft', async () => {
    const repository = new FakePublicationRepository();
    const historical: Awaited<ReturnType<typeof repository.findAvop>> = {
      id: 'historical-avop',
      number: 'AVOP-HIST',
      title: 'Historico preservado',
      publicationDate: '2026-01-01',
      driveUrl: 'https://example.test/hist.pdf',
      driveFileId: null,
      status: 'PUBLISHED',
      requiresAcknowledgement: true,
      audiences: ['TODOS'],
      snapshot: {
        id: 'historical-snapshot',
        publishedAt: '2026-01-01T00:00:00.000Z',
        applicableProfileCount: 99,
      },
    };
    repository.avops.set(historical.id, { ...historical });
    const created = await saveAvopDraftForSession({ session: adminSession, repository, formData: avopForm(), now });
    if (!created.ok) throw new Error('expected AVOP draft');
    await publishAvopForSession({ session: adminSession, repository, formData: publishForm(created.id), now });

    expect(repository.avops.get('historical-avop')).toEqual(historical);
  });
});

function sessionWithRoles(roles: AuthenticatedSession['roles']): AuthenticatedSession {
  return {
    profileId: 'actor-profile',
    trigram: 'ADM',
    roles,
    sessionIdentifier: 'opaque-session-identifier-with-enough-size',
    persistentSessionId: 'persistent-session',
  };
}

function avopForm(overrides: {
  draftId?: string;
  number?: string;
  title?: string;
  publicationDate?: string;
  driveUrl?: string;
  audiences?: string[];
} = {}): FormData {
  const form = new FormData();
  if (overrides.draftId) form.set('draftId', overrides.draftId);
  form.set('number', overrides.number ?? 'AVOP-HML-001');
  form.set('title', overrides.title ?? 'AVOP ficticio');
  form.set('publicationDate', overrides.publicationDate ?? '2026-08-17');
  form.set('driveUrl', overrides.driveUrl ?? 'https://example.test/avop.pdf');
  form.set('driveFileId', 'fake-drive-file-id');
  form.set('requiresAcknowledgement', 'on');
  for (const audience of overrides.audiences ?? ['PILOTO']) form.append('audiences', audience);
  return form;
}

function briefingForm(overrides: {
  draftId?: string;
  legacyId?: string;
  title?: string;
  eventDate?: string;
  driveUrl?: string;
  audiences?: string[];
} = {}): FormData {
  const form = new FormData();
  if (overrides.draftId) form.set('draftId', overrides.draftId);
  form.set('legacyId', overrides.legacyId ?? 'APR-HML-001');
  form.set('title', overrides.title ?? 'Apronto ficticio');
  form.set('eventDate', overrides.eventDate ?? '2026-08-17');
  form.set('driveUrl', overrides.driveUrl ?? 'https://example.test/apronto.pdf');
  form.set('driveFileId', 'fake-drive-file-id');
  form.set('requiresMaterialAcknowledgement', 'on');
  for (const audience of overrides.audiences ?? ['TODOS']) form.append('audiences', audience);
  return form;
}

function publishForm(id: string): FormData {
  const form = new FormData();
  form.set('id', id);
  return form;
}

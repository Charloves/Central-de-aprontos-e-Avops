import { describe, expect, it } from 'vitest';
import { FakeProfileAdminRepository } from './fake-profile-admin-repository';
import {
  parseAdminProfileForm,
  saveAdminProfileForSession,
  type AdminProfileSummary,
} from './profiles';
import type { AuthenticatedSession } from '@/lib/auth/authorization';

const adminProfile: AdminProfileSummary = {
  profileId: '11111111-1111-4111-8111-111111111111',
  trigram: 'ADM',
  name: 'Administrador',
  email: 'admin@example.test',
  active: true,
  roles: ['USER', 'COORDINATOR', 'ADMIN'],
  audiences: ['TODOS'],
};

const userProfile: AdminProfileSummary = {
  profileId: '22222222-2222-4222-8222-222222222222',
  trigram: 'USR',
  name: 'Usuário',
  email: 'usr@example.test',
  active: true,
  roles: ['USER'],
  audiences: ['PILOTO'],
};

const adminSession: AuthenticatedSession = {
  sessionIdentifier: 'a'.repeat(43),
  trigram: 'ADM',
  profileId: '11111111-1111-4111-8111-111111111111',
  roles: ['USER', 'COORDINATOR', 'ADMIN'],
  persistentSessionId: 'session-1',
};

describe('admin profile management rules', () => {
  it('allows ADMIN to create a USER/COORDINATOR profile with audiences', async () => {
    const repository = new FakeProfileAdminRepository({ profiles: [adminProfile] });
    const result = await saveAdminProfileForSession({
      session: adminSession,
      repository,
      formData: profileForm({
        trigram: 'NEW',
        name: 'Perfil Novo',
        email: 'novo@example.test',
        roles: ['USER', 'COORDINATOR'],
        audiences: ['PILOTO', 'TODOS'],
      }),
    });

    expect(result).toMatchObject({ ok: true });
    await expect(repository.listProfiles()).resolves.toContainEqual(expect.objectContaining({
      trigram: 'NEW',
      roles: ['USER', 'COORDINATOR'],
      audiences: ['PILOTO', 'TODOS'],
    }));
    expect(repository.auditActions).toContainEqual(expect.objectContaining({ action: 'PROFILE_CREATED' }));
  });

  it('blocks USER and COORDINATOR without ADMIN from mutating profiles', async () => {
    const repository = new FakeProfileAdminRepository({ profiles: [adminProfile, userProfile] });
    const result = await saveAdminProfileForSession({
      session: { ...adminSession, profileId: userProfile.profileId, roles: ['USER', 'COORDINATOR'] },
      repository,
      formData: profileForm({ trigram: 'NEW', name: 'Perfil Novo' }),
    });

    expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' });
  });

  it('rejects client-supplied administrative identity', () => {
    const form = profileForm({ trigram: 'NEW', name: 'Perfil Novo' });
    form.set('actorProfileId', 'other-admin');

    expect(parseAdminProfileForm(form)).toEqual({ ok: false });
  });

  it('rejects ADMIN grants outside the transfer flow', () => {
    const form = profileForm({ trigram: 'NEW', name: 'Perfil Novo', roles: ['USER', 'ADMIN'] });

    expect(parseAdminProfileForm(form)).toEqual({ ok: false });
  });

  it('preserves the last active ADMIN', async () => {
    const repository = new FakeProfileAdminRepository({ profiles: [adminProfile] });
    const result = await saveAdminProfileForSession({
      session: adminSession,
      repository,
      formData: profileForm({
        targetProfileId: adminProfile.profileId,
        trigram: 'ADM',
        name: 'Administrador',
        active: false,
        roles: ['USER', 'COORDINATOR'],
      }),
    });

    expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' });
  });

  it('revokes sessions when a profile is inactivated or loses relevant roles', async () => {
    const repository = new FakeProfileAdminRepository({
      profiles: [
        adminProfile,
        { ...userProfile, roles: ['USER', 'COORDINATOR'] },
      ],
    });
    const result = await saveAdminProfileForSession({
      session: adminSession,
      repository,
      formData: profileForm({
        targetProfileId: userProfile.profileId,
        trigram: 'USR',
        name: 'Usuário',
        active: true,
        roles: ['USER'],
      }),
    });

    expect(result).toMatchObject({ ok: true });
    expect(repository.revokedProfileIds).toEqual([userProfile.profileId]);
  });

  it('is idempotent for repeated profile creation conflicts by trigram', async () => {
    const repository = new FakeProfileAdminRepository({ profiles: [adminProfile, userProfile] });
    const result = await saveAdminProfileForSession({
      session: adminSession,
      repository,
      formData: profileForm({ trigram: 'USR', name: 'Duplicado' }),
    });

    expect(result).toEqual({ ok: false, reason: 'CONFLICT' });
  });
});

function profileForm(input: {
  targetProfileId?: string;
  trigram: string;
  name: string;
  email?: string;
  active?: boolean;
  roles?: string[];
  audiences?: string[];
}) {
  const form = new FormData();
  if (input.targetProfileId) form.set('targetProfileId', input.targetProfileId);
  form.set('trigram', input.trigram);
  form.set('name', input.name);
  form.set('email', input.email ?? 'perfil@example.test');
  if (input.active ?? true) form.set('active', 'on');
  for (const role of input.roles ?? ['USER']) form.append('roles', role);
  for (const audience of input.audiences ?? ['TODOS']) form.append('audienceCodes', audience);
  return form;
}

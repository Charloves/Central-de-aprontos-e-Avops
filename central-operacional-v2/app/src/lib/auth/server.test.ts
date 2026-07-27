import { describe, expect, it } from 'vitest';
import { authorizeCurrentAdminSession } from './authorization';
import { FakeProfileRepository } from './fake-profile-repository';
import type { SessionPayload } from './session';

const baseSession: SessionPayload = {
  trigram: 'ADM',
  exp: Date.now() + 60_000,
  nonce: 'nonce',
};

describe('server-side authorization', () => {
  it('autoriza administrador com papel atual no repositorio', async () => {
    const repository = new FakeProfileRepository([
      { id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: true, roles: ['USER', 'ADMIN'] },
    ]);

    await expect(authorizeCurrentAdminSession(baseSession, repository)).resolves.toMatchObject({
      trigram: 'ADM',
      roles: ['USER', 'ADMIN'],
    });
  });

  it('nega imediatamente quando o papel e removido apos emissao do cookie', async () => {
    const repository = new FakeProfileRepository([
      { id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: true, roles: ['USER', 'ADMIN'] },
    ]);

    repository.setProfile({ id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: true, roles: ['USER'] });

    await expect(authorizeCurrentAdminSession(baseSession, repository)).resolves.toBeNull();
  });

  it('nega imediatamente quando o perfil e desativado apos emissao do cookie', async () => {
    const repository = new FakeProfileRepository([
      { id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: false, roles: ['USER', 'ADMIN'] },
    ]);

    await expect(authorizeCurrentAdminSession(baseSession, repository)).resolves.toBeNull();
  });

  it('autoriza usuario promovido apos emissao do cookie', async () => {
    const repository = new FakeProfileRepository([
      { id: 'profile-user', trigram: 'ADM', name: 'Usuario Ficticio', active: true, roles: ['USER'] },
    ]);

    repository.setProfile({ id: 'profile-user', trigram: 'ADM', name: 'Usuario Ficticio', active: true, roles: ['USER', 'COORDINATOR'] });

    await expect(authorizeCurrentAdminSession(baseSession, repository)).resolves.toMatchObject({
      roles: ['USER', 'COORDINATOR'],
    });
  });

  it('ignora papeis antigos eventualmente presentes na sessao recebida', async () => {
    const repository = new FakeProfileRepository([
      { id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: true, roles: ['USER'] },
    ]);
    const legacySession = { ...baseSession, roles: ['ADMIN' as const] };

    await expect(authorizeCurrentAdminSession(legacySession, repository)).resolves.toBeNull();
  });
});

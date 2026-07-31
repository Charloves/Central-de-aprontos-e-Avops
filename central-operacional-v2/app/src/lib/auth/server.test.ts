import { describe, expect, it } from 'vitest';
import { authorizeCurrentAdminSession } from './authorization';
import { FakeAuthSecurityRepository } from './fake-security-repository';
import { FakeProfileRepository } from './fake-profile-repository';
import { buildAuthSecurityContext, getSessionHashes, type AuthSecurityConfig } from './security';
import type { SessionPayload } from './session';

const baseSession: SessionPayload = {
  trigram: 'ADM',
  exp: Date.now() + 60_000,
  nonce: 'nonce',
};

const securityConfig: AuthSecurityConfig = {
  fingerprintSecret: 'auth-secret-0123456789abcdef012345',
  maxAttempts: 5,
  windowSeconds: 900,
  blockSeconds: 900,
  sessionTouchIntervalSeconds: 300,
  enableTrigramScope: true,
  enableNetworkScope: true,
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

  it('mantem sessao persistente valida enquanto nao expirada nem revogada', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ADM',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config: securityConfig,
    });
    const hashes = getSessionHashes(baseSession, securityConfig.fingerprintSecret);

    await repository.recordLoginSuccess({
      context,
      config: securityConfig,
      profile: { id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: true, roles: ['USER', 'ADMIN'] },
      session: baseSession,
      sessionIdentifierHash: hashes.sessionIdentifierHash,
      nonceHash: hashes.nonceHash,
    });

    await expect(repository.touchSession({
      nonceHash: hashes.nonceHash,
      touchIntervalSeconds: securityConfig.sessionTouchIntervalSeconds,
    })).resolves.toMatchObject({
      profileId: 'profile-admin',
      revokedAt: null,
    });
  });

  it('rejeita sessao revogada, expirada e inexistente', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ADM',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config: securityConfig,
    });
    const expiredSession: SessionPayload = {
      trigram: 'ADM',
      exp: Date.now() - 1,
      nonce: 'expired',
    };
    const revokedSession: SessionPayload = {
      trigram: 'ADM',
      exp: Date.now() + 60_000,
      nonce: 'revoked',
    };
    const expiredHashes = getSessionHashes(expiredSession, securityConfig.fingerprintSecret);
    const revokedHashes = getSessionHashes(revokedSession, securityConfig.fingerprintSecret);

    await repository.recordLoginSuccess({
      context,
      config: securityConfig,
      profile: { id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: true, roles: ['USER', 'ADMIN'] },
      session: expiredSession,
      sessionIdentifierHash: expiredHashes.sessionIdentifierHash,
      nonceHash: expiredHashes.nonceHash,
    });
    await repository.recordLoginSuccess({
      context,
      config: securityConfig,
      profile: { id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: true, roles: ['USER', 'ADMIN'] },
      session: revokedSession,
      sessionIdentifierHash: revokedHashes.sessionIdentifierHash,
      nonceHash: revokedHashes.nonceHash,
    });
    await repository.revokeSession({ nonceHash: revokedHashes.nonceHash, reason: 'LOGOUT' });

    await expect(repository.touchSession({
      nonceHash: expiredHashes.nonceHash,
      touchIntervalSeconds: securityConfig.sessionTouchIntervalSeconds,
    })).resolves.toBeNull();
    await expect(repository.touchSession({
      nonceHash: revokedHashes.nonceHash,
      touchIntervalSeconds: securityConfig.sessionTouchIntervalSeconds,
    })).resolves.toBeNull();
    await expect(repository.touchSession({
      nonceHash: '0'.repeat(64),
      touchIntervalSeconds: securityConfig.sessionTouchIntervalSeconds,
    })).resolves.toBeNull();
  });

  it('logout revoga sessao e permite revogar todas as sessoes de um perfil', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ADM',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config: securityConfig,
    });
    const firstSession: SessionPayload = { trigram: 'ADM', exp: Date.now() + 60_000, nonce: 'first' };
    const secondSession: SessionPayload = { trigram: 'ADM', exp: Date.now() + 60_000, nonce: 'second' };
    const firstHashes = getSessionHashes(firstSession, securityConfig.fingerprintSecret);
    const secondHashes = getSessionHashes(secondSession, securityConfig.fingerprintSecret);

    for (const [session, hashes] of [[firstSession, firstHashes], [secondSession, secondHashes]] as const) {
      await repository.recordLoginSuccess({
        context,
        config: securityConfig,
        profile: { id: 'profile-admin', trigram: 'ADM', name: 'Admin Ficticio', active: true, roles: ['USER', 'ADMIN'] },
        session,
        sessionIdentifierHash: hashes.sessionIdentifierHash,
        nonceHash: hashes.nonceHash,
      });
    }

    await expect(repository.revokeSession({ nonceHash: firstHashes.nonceHash, reason: 'LOGOUT' })).resolves.toMatchObject({
      sessionId: expect.any(String),
    });
    await expect(repository.touchSession({
      nonceHash: firstHashes.nonceHash,
      touchIntervalSeconds: securityConfig.sessionTouchIntervalSeconds,
    })).resolves.toBeNull();
    await expect(repository.revokeProfileSessions({ profileId: 'profile-admin', reason: 'ADMIN_REVOKE_ALL' })).resolves.toEqual({
      revokedCount: 1,
    });
    await expect(repository.touchSession({
      nonceHash: secondHashes.nonceHash,
      touchIntervalSeconds: securityConfig.sessionTouchIntervalSeconds,
    })).resolves.toBeNull();
  });
});

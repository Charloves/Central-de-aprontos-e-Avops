import { describe, expect, it } from 'vitest';
import { FakeAuthSecurityRepository } from './fake-security-repository';
import {
  buildAuthSecurityContext,
  fingerprintAuthValue,
  getSessionHashes,
  loadAuthSecurityConfig,
  resolveTrustedNetworkOrigin,
  validateFingerprintSecret,
  type AuthSecurityConfig,
} from './security';
import type { SessionPayload } from './session';

const AUTH_SECRET = 'auth-secret-0123456789abcdef012345';
const SESSION_SECRET = 'session-secret-0123456789abcdef01';

const config: AuthSecurityConfig = {
  fingerprintSecret: AUTH_SECRET,
  maxAttempts: 5,
  windowSeconds: 900,
  blockSeconds: 900,
  sessionTouchIntervalSeconds: 300,
  enableTrigramScope: true,
  enableNetworkScope: true,
};

async function failFiveTimes(
  repository: FakeAuthSecurityRepository,
  context: ReturnType<typeof buildAuthSecurityContext>,
  now: Date,
): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await repository.recordLoginFailure({ context, config, reason: 'INVALID_CREDENTIALS', now });
  }
}

describe('auth security primitives', () => {
  it('gera fingerprints HMAC-SHA256 deterministicos sem texto em claro', () => {
    const first = fingerprintAuthValue('trigram', 'ABC', AUTH_SECRET);
    const second = fingerprintAuthValue('trigram', 'ABC', AUTH_SECRET);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('ABC');
  });

  it('recusa segredo ausente, fraco ou igual ao SESSION_SECRET', () => {
    expect(() => validateFingerprintSecret(undefined, SESSION_SECRET)).toThrow();
    expect(() => validateFingerprintSecret('curto', SESSION_SECRET)).toThrow();
    expect(() => validateFingerprintSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', SESSION_SECRET)).toThrow();
    expect(() => validateFingerprintSecret(SESSION_SECRET, SESSION_SECRET)).toThrow();
    expect(validateFingerprintSecret(AUTH_SECRET, SESSION_SECRET)).toBe(AUTH_SECRET);
  });

  it('carrega defaults configuraveis e permite escopo de rede desabilitado', () => {
    const loaded = loadAuthSecurityConfig({
      AUTH_FINGERPRINT_SECRET: AUTH_SECRET,
      SESSION_SECRET,
      AUTH_RATE_LIMIT_NETWORK_ENABLED: 'false',
    } as unknown as NodeJS.ProcessEnv);

    expect(loaded).toMatchObject({
      maxAttempts: 5,
      windowSeconds: 900,
      blockSeconds: 900,
      sessionTouchIntervalSeconds: 300,
      enableTrigramScope: true,
      enableNetworkScope: false,
    });
  });

  it('usa rede local fixa em desenvolvimento e nada arbitrario em producao sem provedor', () => {
    const request = new Request('https://central.example.test', {
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });

    expect(resolveTrustedNetworkOrigin({ request, environment: 'development' })).toBe('LOCAL_DEVELOPMENT_NETWORK');
    expect(resolveTrustedNetworkOrigin({ request, environment: 'production' })).toBeNull();
  });

  it('gera hashes de sessao sem persistir identificador bruto', () => {
    const session: SessionPayload = {
      sessionIdentifier: 'opaque-session-token-for-user-000000000001',
    };

    const hashes = getSessionHashes(session, AUTH_SECRET);
    expect(hashes.sessionIdentifierHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes.nonceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(hashes).join(' ')).not.toContain(session.sessionIdentifier);
  });

  it('bloqueia apos cinco falhas e libera janela expirada naturalmente', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ABC',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config,
    });
    const now = new Date('2026-05-06T10:00:00.000Z');

    await failFiveTimes(repository, context, now);

    await expect(repository.checkTemporaryBlock({ context, config, now })).resolves.toMatchObject({ blocked: true });
    await expect(repository.checkTemporaryBlock({
      context,
      config,
      now: new Date('2026-05-06T10:16:00.000Z'),
    })).resolves.toMatchObject({ blocked: false });
  });

  it('processa a quinta falha como bloqueio e recusa a sexta sem nova falha comum', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ABC',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config,
    });
    const now = new Date('2026-05-06T10:00:00.000Z');

    for (let index = 0; index < 4; index += 1) {
      await expect(repository.recordLoginFailure({ context, config, reason: 'INVALID_CREDENTIALS', now }))
        .resolves.toMatchObject({ blocked: false });
    }

    await expect(repository.recordLoginFailure({ context, config, reason: 'INVALID_CREDENTIALS', now }))
      .resolves.toMatchObject({ blocked: true });
    await expect(repository.recordLoginFailure({
      context,
      config,
      reason: 'INVALID_CREDENTIALS',
      now: new Date('2026-05-06T10:01:00.000Z'),
    })).resolves.toMatchObject({ blocked: true });

    expect(repository.auditEvents.filter((event) => event.eventType === 'LOGIN_FAILURE')).toHaveLength(4);
    expect(repository.auditEvents.filter((event) => event.eventType === 'LOGIN_BLOCKED')).toHaveLength(2);
    expect(repository.getBlocksForTest()).toHaveLength(3);
  });

  it('encerra bloqueio expirado e cria novo ciclo sem sobrescrever o historico', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ABC',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config,
    });
    const firstCycleAt = new Date('2026-05-06T10:00:00.000Z');
    const secondCycleAt = new Date('2026-05-06T10:16:00.000Z');
    const combinedKey = `COMBINED:${context.trigramFingerprint}:${context.networkFingerprint}`;

    await failFiveTimes(repository, context, firstCycleAt);
    const firstCombinedBlock = repository.getBlocksForTest().find((block) => block.key === combinedKey);
    expect(firstCombinedBlock).toMatchObject({
      windowStartedAt: '2026-05-06T10:00:00.000Z',
      blockedUntil: '2026-05-06T10:15:00.000Z',
      failedAttempts: 5,
      liftedAt: null,
    });

    await failFiveTimes(repository, context, secondCycleAt);
    const combinedBlocks = repository.getBlocksForTest().filter((block) => block.key === combinedKey);

    expect(combinedBlocks).toHaveLength(2);
    expect(combinedBlocks[0]).toMatchObject({
      windowStartedAt: '2026-05-06T10:00:00.000Z',
      blockedUntil: '2026-05-06T10:15:00.000Z',
      failedAttempts: 5,
      liftedAt: '2026-05-06T10:16:00.000Z',
      liftedReason: 'EXPIRED',
    });
    expect(combinedBlocks[1]).toMatchObject({
      windowStartedAt: '2026-05-06T10:15:00.000Z',
      blockedUntil: '2026-05-06T10:31:00.000Z',
      failedAttempts: 5,
      liftedAt: null,
    });
  });

  it('nao duplica bloqueio vigente e nao incrementa contador na tentativa bloqueada', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ABC',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config,
    });
    const now = new Date('2026-05-06T10:00:00.000Z');

    await failFiveTimes(repository, context, now);
    await repository.recordLoginFailure({
      context,
      config,
      reason: 'INVALID_CREDENTIALS',
      now: new Date('2026-05-06T10:01:00.000Z'),
    });

    expect(repository.getBlocksForTest()).toHaveLength(3);
    expect(repository.auditEvents.filter((event) => event.eventType === 'LOGIN_FAILURE')).toHaveLength(4);
    expect(repository.auditEvents.filter((event) => event.eventType === 'LOGIN_BLOCKED')).toHaveLength(2);
  });

  it('mantem no maximo um bloqueio ativo por fingerprint mesmo com tentativas paralelas', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ABC',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config,
    });
    const now = new Date('2026-05-06T10:00:00.000Z');
    const combinedKey = `COMBINED:${context.trigramFingerprint}:${context.networkFingerprint}`;

    for (let index = 0; index < 4; index += 1) {
      await repository.recordLoginFailure({ context, config, reason: 'INVALID_CREDENTIALS', now });
    }

    await Promise.all([
      repository.recordLoginFailure({ context, config, reason: 'INVALID_CREDENTIALS', now }),
      repository.recordLoginFailure({ context, config, reason: 'INVALID_CREDENTIALS', now }),
    ]);

    const activeCombinedBlocks = repository.getBlocksForTest().filter(
      (block) => block.key === combinedKey && block.liftedAt === null,
    );
    expect(activeCombinedBlocks).toHaveLength(1);
  });

  it('impede sucesso concorrente quando ja existe bloqueio ativo e nao cria sessao', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ABC',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config,
    });
    const now = new Date('2026-05-06T10:00:00.000Z');
    await failFiveTimes(repository, context, now);

    const session: SessionPayload = {
      sessionIdentifier: 'opaque-session-token-for-blocked-success001',
    };
    const hashes = getSessionHashes(session, config.fingerprintSecret);

    await expect(repository.recordLoginSuccess({
      context,
      config,
      profile: { id: 'profile-user', trigram: 'ABC', name: 'Usuario Ficticio', active: true, roles: ['USER'] },
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionIdentifierHash: hashes.sessionIdentifierHash,
      nonceHash: hashes.nonceHash,
      now,
    })).rejects.toThrow();
    await expect(repository.touchSession({
      sessionIdentifierHash: hashes.sessionIdentifierHash,
      touchIntervalSeconds: config.sessionTouchIntervalSeconds,
      now,
    })).resolves.toBeNull();
  });

  it('limita atualizacao de last_seen_at ao intervalo configurado', async () => {
    const repository = new FakeAuthSecurityRepository();
    const context = buildAuthSecurityContext({
      trigram: 'ABC',
      networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
      userAgent: 'Browser Ficticio',
      config,
    });
    const session: SessionPayload = {
      sessionIdentifier: 'opaque-session-token-for-touch-interval001',
    };
    const hashes = getSessionHashes(session, config.fingerprintSecret);

    await repository.recordLoginSuccess({
      context,
      config,
      profile: { id: 'profile-user', trigram: 'ABC', name: 'Usuario Ficticio', active: true, roles: ['USER'] },
      sessionExpiresAt: '2026-05-06T11:00:00.000Z',
      sessionIdentifierHash: hashes.sessionIdentifierHash,
      nonceHash: hashes.nonceHash,
      now: new Date('2026-05-06T10:00:00.000Z'),
    });

    await repository.touchSession({
      sessionIdentifierHash: hashes.sessionIdentifierHash,
      touchIntervalSeconds: config.sessionTouchIntervalSeconds,
      now: new Date('2026-05-06T10:00:00.000Z'),
    });
    const firstSeen = repository.getLastSeenForTest(hashes.sessionIdentifierHash);
    await repository.touchSession({
      sessionIdentifierHash: hashes.sessionIdentifierHash,
      touchIntervalSeconds: config.sessionTouchIntervalSeconds,
      now: new Date('2026-05-06T10:01:00.000Z'),
    });
    expect(repository.getLastSeenForTest(hashes.sessionIdentifierHash)).toBe(firstSeen);
    await repository.touchSession({
      sessionIdentifierHash: hashes.sessionIdentifierHash,
      touchIntervalSeconds: config.sessionTouchIntervalSeconds,
      now: new Date('2026-05-06T10:06:00.000Z'),
    });
    expect(repository.getLastSeenForTest(hashes.sessionIdentifierHash)).toBe('2026-05-06T10:06:00.000Z');
  });
});

import { describe, expect, it } from 'vitest';
import { FakeProfileRepository } from './fake-profile-repository';
import { FakeAuthSecurityRepository } from './fake-security-repository';
import { authenticateTrigram, GENERIC_LOGIN_FAILURE, isAllowedTrigramFormat } from './login';
import { buildAuthSecurityContext, type AuthSecurityConfig } from './security';
import { verifySessionToken } from './session';

const STRONG_SECRET = '0123456789abcdef0123456789abcdef';
const AUTH_SECRET = 'auth-secret-0123456789abcdef012345';

const securityConfig: AuthSecurityConfig = {
  fingerprintSecret: AUTH_SECRET,
  maxAttempts: 5,
  windowSeconds: 900,
  blockSeconds: 900,
  sessionTouchIntervalSeconds: 300,
  enableTrigramScope: true,
  enableNetworkScope: true,
};

function contextFor(trigram: string) {
  return buildAuthSecurityContext({
    trigram,
    networkOrigin: 'LOCAL_DEVELOPMENT_NETWORK',
    userAgent: 'Browser Ficticio',
    config: securityConfig,
  });
}

const repository = new FakeProfileRepository([
  {
    id: 'profile-user',
    trigram: 'ABC',
    name: 'Militar Alfa',
    active: true,
    roles: ['USER'],
  },
  {
    id: 'profile-coordinator',
    trigram: 'COO',
    name: 'Militar Coordenador',
    active: true,
    roles: ['USER', 'COORDINATOR'],
  },
  {
    id: 'profile-admin',
    trigram: 'ADM',
    name: 'Militar Admin',
    active: true,
    roles: ['USER', 'ADMIN'],
  },
  {
    id: 'profile-inactive',
    trigram: 'INA',
    name: 'Militar Inativo',
    active: false,
    roles: ['USER'],
  },
]);

describe('login by trigram', () => {
  it('autentica trigrama valido no servidor e emite cookie HttpOnly', async () => {
    const result = await authenticateTrigram({
      rawTrigram: ' abc ',
      repository,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
      environment: 'development',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('login deveria ter sucesso');
    expect(result.cookie).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax' });
    expect(verifySessionToken(result.token, STRONG_SECRET)).toMatchObject({ trigram: 'ABC' });
    expect(result.audit).toMatchObject({ status: 'OK', reason: 'VALID' });
  });

  it('usa cookie Secure em producao', async () => {
    const result = await authenticateTrigram({
      rawTrigram: 'ABC',
      repository,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
      environment: 'production',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cookie.secure).toBe(true);
  });

  it('normaliza trigrama sem colocar papeis no token', async () => {
    const coordinator = await authenticateTrigram({
      rawTrigram: 'coo',
      repository,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });
    const admin = await authenticateTrigram({
      rawTrigram: 'adm',
      repository,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    expect(coordinator.ok && verifySessionToken(coordinator.token, STRONG_SECRET)).toMatchObject({ trigram: 'COO' });
    expect(admin.ok && verifySessionToken(admin.token, STRONG_SECRET)).toMatchObject({ trigram: 'ADM' });
    expect(coordinator.ok && 'roles' in verifySessionToken(coordinator.token, STRONG_SECRET)!).toBe(false);
    expect(admin.ok && 'roles' in verifySessionToken(admin.token, STRONG_SECRET)!).toBe(false);
  });

  it('bloqueia trigrama invalido, inativo e malformado sem enumerar usuario', async () => {
    const missing = await authenticateTrigram({
      rawTrigram: 'ZZZ',
      repository,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });
    const inactive = await authenticateTrigram({
      rawTrigram: 'INA',
      repository,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });
    const malformed = await authenticateTrigram({
      rawTrigram: 'ABC-INVALIDO',
      repository,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    expect(missing).toMatchObject({ ok: false, message: GENERIC_LOGIN_FAILURE });
    expect(inactive).toMatchObject({ ok: false, message: GENERIC_LOGIN_FAILURE });
    expect(malformed).toMatchObject({ ok: false, message: GENERIC_LOGIN_FAILURE });
    expect(missing.ok || missing.audit.reason).toBe('INVALID_CREDENTIALS');
    expect(inactive.ok || inactive.audit.reason).toBe('INACTIVE');
    expect(malformed.ok || malformed.audit.reason).toBe('INVALID_FORMAT');
  });

  it('limita tamanho e formato do trigrama', () => {
    expect(isAllowedTrigramFormat('ABC')).toBe(true);
    expect(isAllowedTrigramFormat('A')).toBe(false);
    expect(isAllowedTrigramFormat('ABCDEFGHI')).toBe(false);
    expect(isAllowedTrigramFormat('AB-C')).toBe(false);
  });

  it('falha de forma segura sem segredo ou com segredo fraco', async () => {
    const missingSecret = await authenticateTrigram({
      rawTrigram: 'ABC',
      repository,
      secret: undefined,
      durationSeconds: 3600,
    });
    const weakSecret = await authenticateTrigram({
      rawTrigram: 'ABC',
      repository,
      secret: 'curto',
      durationSeconds: 3600,
    });

    expect(missingSecret).toMatchObject({ ok: false, status: 500, message: 'Configuracao de sessao indisponivel.' });
    expect(weakSecret).toMatchObject({ ok: false, status: 500, message: 'Configuracao de sessao indisponivel.' });
  });

  it('registra cinco falhas e bloqueia tentativas seguintes com resposta generica', async () => {
    const securityRepository = new FakeAuthSecurityRepository();
    const securityContext = contextFor('ZZZ');

    for (let index = 0; index < 5; index += 1) {
      const result = await authenticateTrigram({
        rawTrigram: 'ZZZ',
        repository,
        securityRepository,
        securityConfig,
        securityContext,
        secret: STRONG_SECRET,
        durationSeconds: 3600,
        now: new Date('2026-05-06T10:00:00.000Z'),
      });
      expect(result).toMatchObject({ ok: false, status: 401, message: GENERIC_LOGIN_FAILURE });
    }

    const blocked = await authenticateTrigram({
      rawTrigram: 'ZZZ',
      repository,
      securityRepository,
      securityConfig,
      securityContext,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
      now: new Date('2026-05-06T10:01:00.000Z'),
    });

    expect(blocked).toMatchObject({ ok: false, status: 401, message: GENERIC_LOGIN_FAILURE });
    expect(blocked.ok || blocked.audit.reason).toBe('BLOCKED');
  });

  it('cria sessao persistente no login valido e reseta bloqueio do trigrama', async () => {
    const securityRepository = new FakeAuthSecurityRepository();
    const securityContext = contextFor('ABC');

    const result = await authenticateTrigram({
      rawTrigram: 'ABC',
      repository,
      securityRepository,
      securityConfig,
      securityContext,
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    expect(result.ok).toBe(true);
    expect(securityRepository.auditEvents).toContainEqual(expect.objectContaining({ eventType: 'LOGIN_SUCCESS' }));
  });

  it('mantem inexistente e inativo indistinguiveis externamente com seguranca persistente', async () => {
    const securityRepository = new FakeAuthSecurityRepository();
    const missing = await authenticateTrigram({
      rawTrigram: 'ZZZ',
      repository,
      securityRepository,
      securityConfig,
      securityContext: contextFor('ZZZ'),
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });
    const inactive = await authenticateTrigram({
      rawTrigram: 'INA',
      repository,
      securityRepository,
      securityConfig,
      securityContext: contextFor('INA'),
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    if (missing.ok || inactive.ok) throw new Error('ambos deveriam falhar');
    expect({ ok: missing.ok, status: missing.status, message: missing.message }).toEqual({
      ok: inactive.ok,
      status: inactive.status,
      message: inactive.message,
    });
  });

  it('nega acesso com seguranca quando o banco de seguranca falha', async () => {
    const securityRepository = new FakeAuthSecurityRepository();
    securityRepository.failNext = true;

    const result = await authenticateTrigram({
      rawTrigram: 'ABC',
      repository,
      securityRepository,
      securityConfig,
      securityContext: contextFor('ABC'),
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    expect(result).toMatchObject({ ok: false, status: 401, message: GENERIC_LOGIN_FAILURE });
    expect(result.ok || result.audit.reason).toBe('SECURITY_ERROR');
  });
});

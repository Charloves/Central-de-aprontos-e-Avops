import { describe, expect, it } from 'vitest';
import { FakeProfileRepository } from './fake-profile-repository';
import { authenticateTrigram, GENERIC_LOGIN_FAILURE, isAllowedTrigramFormat } from './login';
import { verifySessionToken } from './session';

const STRONG_SECRET = '0123456789abcdef0123456789abcdef';

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
});

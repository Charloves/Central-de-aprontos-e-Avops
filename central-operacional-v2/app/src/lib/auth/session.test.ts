import { describe, expect, it, vi } from 'vitest';
import {
  buildSessionCookieOptions,
  buildLogoutCookieOptions,
  createSessionToken,
  hasAdminRole,
  validateSessionSecret,
  verifySessionToken,
} from './session';

const STRONG_SECRET = '0123456789abcdef0123456789abcdef';

describe('session', () => {
  it('cria e valida sessao assinada', () => {
    const token = createSessionToken({
      trigram: 'cha',
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    expect(verifySessionToken(token, STRONG_SECRET)).toMatchObject({
      trigram: 'CHA',
    });
  });

  it('rejeita sessao adulterada', () => {
    const token = createSessionToken({
      trigram: 'CHA',
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    expect(verifySessionToken(`${token}x`, STRONG_SECRET)).toBeNull();
  });

  it('rejeita sessao expirada', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T10:00:00.000Z'));
    const token = createSessionToken({
      trigram: 'CHA',
      secret: STRONG_SECRET,
      durationSeconds: 1,
    });

    vi.setSystemTime(new Date('2026-05-06T10:00:02.000Z'));
    expect(verifySessionToken(token, STRONG_SECRET)).toBeNull();
    vi.useRealTimers();
  });

  it('exige segredo presente e forte', () => {
    expect(validateSessionSecret(undefined)).toMatchObject({ ok: false });
    expect(validateSessionSecret('curto')).toMatchObject({ ok: false });
    expect(validateSessionSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toMatchObject({ ok: false });
    expect(validateSessionSecret(STRONG_SECRET)).toMatchObject({ ok: true });
  });

  it('define cookie HttpOnly e Secure em producao', () => {
    expect(buildSessionCookieOptions({ durationSeconds: 3600, environment: 'production' })).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 3600,
    });
    expect(buildSessionCookieOptions({ durationSeconds: 3600, environment: 'development' }).secure).toBe(false);
  });

  it('logout remove a sessao mantendo atributos seguros do cookie', () => {
    expect(buildLogoutCookieOptions('production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  });

  it('autoriza area administrativa por COORDINATOR ou ADMIN', () => {
    expect(hasAdminRole(['USER'])).toBe(false);
    expect(hasAdminRole(['USER', 'COORDINATOR'])).toBe(true);
    expect(hasAdminRole(['USER', 'ADMIN'])).toBe(true);
  });
});

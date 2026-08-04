import { describe, expect, it } from 'vitest';
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
  it('cria e valida token de sessao opaco', () => {
    const token = createSessionToken({
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(token).not.toContain('CHA');
    expect(token).not.toContain('cha');
    expect(token).not.toContain('.');
    expect(verifySessionToken(token, STRONG_SECRET)).toEqual({ sessionIdentifier: token });
  });

  it('gera tokens aleatorios e nao reutilizados', () => {
    const first = createSessionToken({ secret: STRONG_SECRET, durationSeconds: 3600 });
    const second = createSessionToken({ secret: STRONG_SECRET, durationSeconds: 3600 });

    expect(first).not.toBe(second);
  });

  it('rejeita sessao adulterada ou malformada', () => {
    const token = createSessionToken({
      secret: STRONG_SECRET,
      durationSeconds: 3600,
    });

    expect(verifySessionToken(`${token}=`, STRONG_SECRET)).toBeNull();
    expect(verifySessionToken('CHA', STRONG_SECRET)).toBeNull();
    expect(verifySessionToken('header.payload.signature', STRONG_SECRET)).toBeNull();
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

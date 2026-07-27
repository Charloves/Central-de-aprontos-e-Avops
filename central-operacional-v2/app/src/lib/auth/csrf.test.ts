import { describe, expect, it } from 'vitest';
import { validateMutableRequest } from './csrf';

const APP_ORIGIN = 'https://central.example.test';

describe('csrf validation', () => {
  it('aceita login/logout com origem confiavel', () => {
    expect(validateMutableRequest({
      origin: APP_ORIGIN,
      secFetchSite: 'same-origin',
      appOrigin: APP_ORIGIN,
      environment: 'production',
    })).toEqual({ ok: true });
  });

  it('rejeita origem diferente', () => {
    expect(validateMutableRequest({
      origin: 'https://evil.example.test',
      secFetchSite: 'same-origin',
      appOrigin: APP_ORIGIN,
      environment: 'production',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('rejeita origem ausente em producao', () => {
    expect(validateMutableRequest({
      origin: null,
      secFetchSite: null,
      appOrigin: APP_ORIGIN,
      environment: 'production',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('rejeita Sec-Fetch-Site cross-site', () => {
    expect(validateMutableRequest({
      origin: APP_ORIGIN,
      secFetchSite: 'cross-site',
      appOrigin: APP_ORIGIN,
      environment: 'production',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('permite desenvolvimento local sem origem configurada', () => {
    expect(validateMutableRequest({
      origin: null,
      secFetchSite: null,
      appOrigin: undefined,
      environment: 'development',
    })).toEqual({ ok: true });
  });

  it('rejeita producao sem APP_ORIGIN configurado', () => {
    expect(validateMutableRequest({
      origin: APP_ORIGIN,
      secFetchSite: 'same-origin',
      appOrigin: undefined,
      environment: 'production',
    })).toMatchObject({ ok: false, status: 403 });
  });
});

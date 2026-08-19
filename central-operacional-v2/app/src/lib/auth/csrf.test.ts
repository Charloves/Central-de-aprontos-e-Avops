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

  it('rejeita origem malformada quando APP_ORIGIN esta configurado', () => {
    expect(validateMutableRequest({
      origin: 'not-a-valid-origin',
      secFetchSite: 'same-origin',
      appOrigin: APP_ORIGIN,
      environment: 'development',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('rejeita origem diferente em desenvolvimento quando APP_ORIGIN esta configurado', () => {
    expect(validateMutableRequest({
      origin: 'https://evil.example.test',
      secFetchSite: 'same-origin',
      appOrigin: APP_ORIGIN,
      environment: 'development',
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

  it('permite desenvolvimento local sem APP_ORIGIN apenas com origem localhost padrao', () => {
    expect(validateMutableRequest({
      origin: 'http://localhost:3000',
      secFetchSite: 'same-origin',
      appOrigin: undefined,
      environment: 'development',
    })).toEqual({ ok: true });
  });

  it('rejeita desenvolvimento local sem APP_ORIGIN quando a origem esta ausente', () => {
    expect(validateMutableRequest({
      origin: null,
      secFetchSite: null,
      appOrigin: undefined,
      environment: 'development',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('rejeita origem ausente quando APP_ORIGIN esta configurado', () => {
    expect(validateMutableRequest({
      origin: null,
      secFetchSite: null,
      appOrigin: APP_ORIGIN,
      environment: 'development',
    })).toMatchObject({ ok: false, status: 403 });
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

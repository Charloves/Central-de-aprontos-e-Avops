import { describe, expect, it } from 'vitest';
import { validateProductionEnvironment } from './validate-production-env.ts';

const productionRef = 'abcdefghijklmnopqrst';
const developmentRef = 'tsrqponmlkjihgfedcba';

const validEnv = {
  APP_ENV: 'production',
  APP_ORIGIN: 'https://central.example.test',
  APP_BASE_URL: 'https://central.example.test/portal',
  SUPABASE_TARGET_ENV: 'production',
  SUPABASE_URL: `https://${productionRef}.supabase.co`,
  SUPABASE_PRODUCTION_PROJECT_REF: productionRef,
  SUPABASE_DEV_PROJECT_REF: developmentRef,
  SUPABASE_SECRET_KEY: 'sb_secret_prod_1234567890abcdefXYZ',
  SESSION_SECRET: 'session-prod-1234567890abcdefXYZ',
  AUTH_FINGERPRINT_SECRET: 'fingerprint-prod-1234567890abcdef',
  CRON_SECRET: 'cron-prod-1234567890abcdefXYZ987',
  AVOP_EMAIL_MODE: 'dry-run',
  NEXT_PUBLIC_APP_NAME: 'Central Operacional V2',
};

describe('production environment validator', () => {
  it('aceita configuracao de producao sanitizada em dry-run inicial', () => {
    const result = validateProductionEnvironment(validEnv);

    expect(result.ok).toBe(true);
    expect(result.summary.APP_ENV).toBe('valid');
    expect(result.summary.AVOP_EMAIL_MODE).toBe('dry-run');
    expect(JSON.stringify(result)).not.toContain(validEnv.SUPABASE_SECRET_KEY);
  });

  it('rejeita APP_ENV diferente de production', () => {
    const result = validateProductionEnvironment({ ...validEnv, APP_ENV: 'development' });

    expect(result.ok).toBe(false);
    expect(result.summary.APP_ENV).toBe('invalid');
    expect(result.issues).toContain('APP_ENV deve ser exatamente production.');
  });

  it('rejeita URLs HTTP e hosts locais', () => {
    const result = validateProductionEnvironment({
      ...validEnv,
      APP_ORIGIN: 'http://central.example.test',
      APP_BASE_URL: 'http://localhost:3000',
      SUPABASE_URL: `http://${productionRef}.supabase.co`,
    });

    expect(result.ok).toBe(false);
    expect(result.summary.APP_ORIGIN).toBe('invalid');
    expect(result.summary.APP_BASE_URL).toBe('invalid');
    expect(result.summary.SUPABASE_URL).toBe('invalid');
  });

  it('rejeita Supabase de producao igual ao development', () => {
    const result = validateProductionEnvironment({
      ...validEnv,
      SUPABASE_URL: `https://${developmentRef}.supabase.co`,
      SUPABASE_PRODUCTION_PROJECT_REF: developmentRef,
      SUPABASE_DEV_PROJECT_REF: developmentRef,
    });

    expect(result.ok).toBe(false);
    expect(result.summary.SUPABASE_URL).toBe('invalid');
    expect(result.summary.SUPABASE_PRODUCTION_PROJECT_REF).toBe('invalid');
  });

  it('rejeita segredos ausentes, fracos ou reutilizados', () => {
    const result = validateProductionEnvironment({
      ...validEnv,
      SUPABASE_SECRET_KEY: 'sb_secret_short',
      SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      AUTH_FINGERPRINT_SECRET: 'same-secret-1234567890abcdefghij',
      CRON_SECRET: 'same-secret-1234567890abcdefghij',
    });

    expect(result.ok).toBe(false);
    expect(result.summary.SUPABASE_SECRET_KEY).toBe('invalid');
    expect(result.summary.SESSION_SECRET).toBe('invalid');
    expect(result.summary.AUTH_FINGERPRINT_SECRET).toBe('invalid');
    expect(result.summary.CRON_SECRET).toBe('invalid');
  });

  it('permite dry-run sem Gmail completo, mas rejeita Gmail real incompleto', () => {
    const dryRun = validateProductionEnvironment({ ...validEnv, GMAIL_CLIENT_SECRET: undefined });
    const gmail = validateProductionEnvironment({
      ...validEnv,
      AVOP_EMAIL_MODE: 'gmail',
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: undefined,
      GMAIL_REFRESH_TOKEN: 'refresh-token',
      GMAIL_SENDER_EMAIL: 'central@example.test',
      GMAIL_SENDER_NAME: 'Central Operacional',
    });

    expect(dryRun.ok).toBe(true);
    expect(gmail.ok).toBe(false);
    expect(gmail.summary.GMAIL_CLIENT_SECRET).toBe('missing');
  });

  it('rejeita Gmail real com remetente inseguro', () => {
    const result = validateProductionEnvironment({
      ...validEnv,
      AVOP_EMAIL_MODE: 'gmail',
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'gmail-client-1234567890abcdef',
      GMAIL_REFRESH_TOKEN: 'gmail-refresh-token-1234567890',
      GMAIL_SENDER_EMAIL: 'central@example.test,other@example.test',
      GMAIL_SENDER_NAME: 'Central Operacional',
    });

    expect(result.ok).toBe(false);
    expect(result.summary.GMAIL_SENDER_EMAIL).toBe('invalid');
  });

  it('rejeita NEXT_PUBLIC contendo segredos ou credenciais', () => {
    const result = validateProductionEnvironment({
      ...validEnv,
      NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'sb_secret_leak',
    });

    expect(result.ok).toBe(false);
    expect(result.summary.NEXT_PUBLIC_SECRETS).toBe('invalid');
    expect(JSON.stringify(result)).not.toContain('sb_secret_leak');
  });
});

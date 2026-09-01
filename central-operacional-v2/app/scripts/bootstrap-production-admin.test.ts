import { describe, expect, it } from 'vitest';
import {
  readBootstrapInput,
  runBootstrapProductionAdmin,
  validateBootstrapEnvironment,
} from './bootstrap-production-admin';

const validEnv = {
  APP_ENV: 'production',
  SUPABASE_TARGET_ENV: 'production',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PRODUCTION_PROJECT_REF: 'abcdefghijklmnopqrst',
  SUPABASE_DEV_PROJECT_REF: 'tsrqponmlkjihgfedcba',
  SUPABASE_SECRET_KEY: 'sb_secret_' + 'a'.repeat(48),
  BOOTSTRAP_ADMIN_TRIGRAM: 'ADM',
  BOOTSTRAP_ADMIN_NAME: 'Administrador Inicial',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
  BOOTSTRAP_ADMIN_AUDIENCES: 'TODOS,PILOTO',
};

describe('production admin bootstrap script', () => {
  it('fails closed outside production', () => {
    expect(validateBootstrapEnvironment({ ...validEnv, APP_ENV: 'development' })).toContain(
      'APP_ENV deve ser exatamente production.',
    );
    expect(validateBootstrapEnvironment({ ...validEnv, SUPABASE_TARGET_ENV: 'development' })).toContain(
      'SUPABASE_TARGET_ENV deve ser exatamente production.',
    );
  });

  it('rejects production project equal to development', () => {
    const issues = validateBootstrapEnvironment({
      ...validEnv,
      SUPABASE_DEV_PROJECT_REF: validEnv.SUPABASE_PRODUCTION_PROJECT_REF,
    });

    expect(issues).toContain('Projeto production não pode ser igual ao development.');
  });

  it('parses sanitized bootstrap input without logging personal data', () => {
    const parsed = readBootstrapInput(validEnv);

    expect(parsed).toEqual({
      ok: true,
      input: {
        trigram: 'ADM',
        name: 'Administrador Inicial',
        email: 'admin@example.test',
        audienceCodes: ['PILOTO', 'TODOS'],
      },
    });
  });

  it('refuses malformed input before calling the repository', async () => {
    let called = false;
    const logs: string[] = [];
    const ok = await runBootstrapProductionAdmin({
      env: { ...validEnv, BOOTSTRAP_ADMIN_EMAIL: 'bad@example.test,evil@example.test' },
      repository: {
        async bootstrapFirstAdmin() {
          called = true;
          return { ok: true };
        },
      },
      logger: {
        log: (message) => logs.push(message),
        error: (message) => logs.push(message),
      },
    });

    expect(ok).toBe(false);
    expect(called).toBe(false);
    expect(logs.join('\n')).not.toContain('bad@example.test');
    expect(logs.join('\n')).not.toContain(validEnv.SUPABASE_SECRET_KEY);
  });

  it('calls the repository exactly once when environment and input are valid', async () => {
    const calls: unknown[] = [];
    const ok = await runBootstrapProductionAdmin({
      env: validEnv,
      repository: {
        async bootstrapFirstAdmin(input) {
          calls.push(input);
          return { ok: true };
        },
      },
      logger: {
        log: () => undefined,
        error: () => undefined,
      },
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ trigram: 'ADM', audienceCodes: ['PILOTO', 'TODOS'] });
  });

  it('does not expose values when repository refuses execution', async () => {
    const logs: string[] = [];
    const ok = await runBootstrapProductionAdmin({
      env: validEnv,
      repository: {
        async bootstrapFirstAdmin() {
          return { ok: false, reason: 'ADMIN_EXISTS' };
        },
      },
      logger: {
        log: (message) => logs.push(message),
        error: (message) => logs.push(message),
      },
    });

    expect(ok).toBe(false);
    expect(logs.join('\n')).not.toContain(validEnv.BOOTSTRAP_ADMIN_TRIGRAM);
    expect(logs.join('\n')).not.toContain(validEnv.BOOTSTRAP_ADMIN_EMAIL);
    expect(logs.join('\n')).not.toContain(validEnv.SUPABASE_SECRET_KEY);
  });
});

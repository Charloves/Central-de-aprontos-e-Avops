import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizationUrl,
  GMAIL_SEND_SCOPE,
  isSafeLocalCallbackUrl,
  parseEnvContent,
  safeStateEquals,
  upsertEnvValue,
  validateGmailOAuthEnvironment,
} from './gmail-oauth-local';

describe('gmail oauth local helper', () => {
  it('valida somente variaveis necessarias sem imprimir valores', () => {
    const check = validateGmailOAuthEnvironment({
      APP_ENV: 'development',
      AVOP_EMAIL_MODE: 'dry-run',
      CRON_SECRET: 'cron-secret-test',
      GMAIL_CLIENT_ID: 'client-id-test',
      GMAIL_CLIENT_SECRET: 'client-secret-test',
      GMAIL_SENDER_EMAIL: 'cdout.1gav11@gmail.com',
      GMAIL_SENDER_NAME: 'Conta Funcional',
    });

    expect(check.ok).toBe(true);
    expect(check.summary.GMAIL_CLIENT_SECRET).toBe('present');
    expect(JSON.stringify(check)).not.toContain('client-secret-test');
  });

  it('falha fechado em production e quando o modo gmail ja esta ativo', () => {
    const check = validateGmailOAuthEnvironment({
      APP_ENV: 'production',
      AVOP_EMAIL_MODE: 'gmail',
      GMAIL_CLIENT_ID: 'client-id-test',
      GMAIL_CLIENT_SECRET: 'client-secret-test',
      GMAIL_SENDER_EMAIL: 'cdout.1gav11@gmail.com',
    });

    expect(check.ok).toBe(false);
    expect(check.issues.join(' ')).toMatch(/production/);
    expect(check.issues.join(' ')).toMatch(/nao envia e-mail/);
  });

  it('exige a conta funcional prevista para o remetente', () => {
    const check = validateGmailOAuthEnvironment({
      APP_ENV: 'development',
      AVOP_EMAIL_MODE: 'dry-run',
      GMAIL_CLIENT_ID: 'client-id-test',
      GMAIL_CLIENT_SECRET: 'client-secret-test',
      GMAIL_SENDER_EMAIL: 'outra-conta@example.test',
    });

    expect(check.ok).toBe(false);
    expect(check.summary.GMAIL_SENDER_EMAIL).toBe('invalid');
  });

  it('gera URL com offline access, gmail.send, prompt consent, state e login_hint', () => {
    const generateAuthUrl = vi.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?mock=1');

    const url = buildAuthorizationUrl({
      client: {
        generateAuthUrl,
        getToken: vi.fn(),
      },
      state: 'state-test',
    });

    expect(url).toContain('https://accounts.google.com');
    expect(generateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      scope: [GMAIL_SEND_SCOPE],
      prompt: 'consent',
      state: 'state-test',
      login_hint: 'cdout.1gav11@gmail.com',
    });
  });

  it('aceita callback somente em localhost e no caminho esperado', () => {
    expect(isSafeLocalCallbackUrl(new URL('http://localhost:3456/oauth2callback?code=x'))).toBe(true);
    expect(isSafeLocalCallbackUrl(new URL('http://127.0.0.1:3456/oauth2callback?code=x'))).toBe(true);
    expect(isSafeLocalCallbackUrl(new URL('https://localhost:3456/oauth2callback?code=x'))).toBe(false);
    expect(isSafeLocalCallbackUrl(new URL('http://example.test:3456/oauth2callback?code=x'))).toBe(false);
    expect(isSafeLocalCallbackUrl(new URL('http://localhost:3456/outro?code=x'))).toBe(false);
  });

  it('compara state de forma segura sem aceitar valor diferente', () => {
    expect(safeStateEquals('state-a', 'state-a')).toBe(true);
    expect(safeStateEquals('state-a', 'state-b')).toBe(false);
  });

  it('parseia .env.local sem expor valores extras', () => {
    const parsed = parseEnvContent([
      '# comentario',
      'GMAIL_CLIENT_ID=client-id-test',
      'GMAIL_CLIENT_SECRET="client-secret-test"',
      'IGNORADO',
    ].join('\n'));

    expect(parsed).toEqual({
      GMAIL_CLIENT_ID: 'client-id-test',
      GMAIL_CLIENT_SECRET: 'client-secret-test',
    });
  });

  it('salva refresh token somente em .env.local preservando newline final', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gmail-oauth-test-'));
    const envPath = join(dir, '.env.local');
    try {
      await writeFile(envPath, 'GMAIL_CLIENT_ID=client-id-test\nGMAIL_REFRESH_TOKEN=old\n', 'utf8');

      await upsertEnvValue({
        path: envPath,
        key: 'GMAIL_REFRESH_TOKEN',
        value: 'refresh-token-test',
      });

      const content = await readFile(envPath, 'utf8');
      expect(content).toContain('GMAIL_CLIENT_ID=client-id-test');
      expect(content).toContain('GMAIL_REFRESH_TOKEN="refresh-token-test"\n');
      expect(content.endsWith('\n')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

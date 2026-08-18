import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runControlledGmailTestSend,
  sanitizeError,
  validateControlledGmailTestEnvironment,
} from './gmail-test-send';

const execFileAsync = promisify(execFile);
const appDir = dirname(dirname(fileURLToPath(import.meta.url)));

const validEnv = {
  APP_ENV: 'development',
  NODE_ENV: 'development',
  AVOP_EMAIL_MODE: 'dry-run',
  CONFIRM_GMAIL_TEST_SEND: 'SEND_ONE_EMAIL',
  GMAIL_CLIENT_ID: 'client-id-test',
  GMAIL_CLIENT_SECRET: 'client-secret-test',
  GMAIL_REFRESH_TOKEN: 'refresh-token-test',
  GMAIL_SENDER_EMAIL: 'sender@example.test',
  GMAIL_SENDER_NAME: 'Conta Funcional Teste',
  GMAIL_TEST_RECIPIENT: 'sender@example.test',
};

function loggerMock() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe('controlled gmail test send', () => {
  it('rejeita ambiente diferente de development antes de chamar Gmail', async () => {
    const sender = vi.fn();
    const logger = loggerMock();

    const result = await runControlledGmailTestSend({
      env: { ...validEnv, APP_ENV: 'homologation' },
      sender,
      logger,
    });

    expect(result.ok).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  it('rejeita confirmacao ausente ou incorreta', () => {
    expect(validateControlledGmailTestEnvironment({
      ...validEnv,
      CONFIRM_GMAIL_TEST_SEND: undefined,
    })).toContain('Confirmacao explicita ausente ou invalida.');

    expect(validateControlledGmailTestEnvironment({
      ...validEnv,
      CONFIRM_GMAIL_TEST_SEND: 'SIM',
    })).toContain('Confirmacao explicita ausente ou invalida.');
  });

  it('rejeita destinatario diferente do remetente nesta primeira versao', async () => {
    const sender = vi.fn();
    const result = await runControlledGmailTestSend({
      env: { ...validEnv, GMAIL_TEST_RECIPIENT: 'destino@example.test' },
      sender,
      logger: loggerMock(),
    });

    expect(result.ok).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  it.each([
    ['virgula', 'sender@example.test,other@example.test'],
    ['ponto e virgula', 'sender@example.test;other@example.test'],
    ['CRLF', 'sender@example.test\r\nBcc:evil@example.test'],
    ['NUL', 'sender@example.test\0'],
    ['controle', 'sender@example.test\u0007'],
    ['display name', 'Pessoa <sender@example.test>'],
  ])('rejeita destinatario malicioso: %s', async (_case, recipient) => {
    const sender = vi.fn();
    const result = await runControlledGmailTestSend({
      env: {
        ...validEnv,
        GMAIL_SENDER_EMAIL: recipient,
        GMAIL_TEST_RECIPIENT: recipient,
      },
      sender,
      logger: loggerMock(),
    });

    expect(result.ok).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  it('rejeita credencial ausente antes de instanciar Gmail', async () => {
    const sender = vi.fn();
    const result = await runControlledGmailTestSend({
      env: { ...validEnv, GMAIL_REFRESH_TOKEN: undefined },
      sender,
      logger: loggerMock(),
    });

    expect(result.ok).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  it('envia exatamente uma mensagem ficticia quando todas as travas passam', async () => {
    const sender = vi.fn().mockResolvedValue({ data: { id: 'provider-message-id-test' } });
    const logger = loggerMock();

    const result = await runControlledGmailTestSend({
      env: validEnv,
      sender,
      logger,
      createLocalTestId: () => 'gmail-test-local',
    });

    expect(result).toEqual({ ok: true, localTestId: 'gmail-test-local' });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith({
      to: 'sender@example.test',
      subject: '[TESTE FICTICIO] Central Operacional V2 - envio controlado',
      body: expect.stringContaining('Mensagem ficticia de teste da Central Operacional V2.'),
    });
    expect(JSON.stringify(logger.log.mock.calls)).toContain('gmail-test-local');
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('provider-message-id-test');
  });

  it('nao acessa Supabase ou Drive', async () => {
    const sender = vi.fn().mockResolvedValue({ data: { id: 'provider-message-id-test' } });

    await runControlledGmailTestSend({
      env: validEnv,
      sender,
      logger: loggerMock(),
    });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sender.mock.calls)).not.toMatch(/supabase|drive|notification_schedule/i);
  });

  it('sanitiza erro da API e nao expoe segredos em logs', async () => {
    const sender = vi.fn().mockRejectedValue(
      new Error('falha com client-secret-test refresh-token-test ya29.access-token-provider'),
    );
    const logger = loggerMock();

    const result = await runControlledGmailTestSend({
      env: validEnv,
      sender,
      logger,
      createLocalTestId: () => 'gmail-test-local',
    });

    const logs = JSON.stringify([...logger.log.mock.calls, ...logger.error.mock.calls]);
    expect(result).toEqual({ ok: false, error: 'Falha no envio Gmail de teste.' });
    expect(logs).not.toContain('client-secret-test');
    expect(logs).not.toContain('refresh-token-test');
    expect(logs).not.toContain('ya29.access-token-provider');
  });

  it('sanitiza valores sensiveis tambem pela funcao utilitaria', () => {
    const sanitized = sanitizeError(
      new Error('erro client-secret-test refresh-token-test abcdefghijklmnopqrstuvwxyz'),
      validEnv,
    );

    expect(sanitized).not.toContain('client-secret-test');
    expect(sanitized).not.toContain('refresh-token-test');
    expect(sanitized).toContain('[redacted]');
  });

  it('entrypoint real carrega modulos e falha antes do Gmail sem confirmacao', async () => {
    let result: { code?: number; stdout?: string; stderr?: string };
    try {
      result = await execFileAsync(
        process.execPath,
        ['--experimental-strip-types', 'scripts/gmail-test-send.ts'],
        {
          cwd: appDir,
          env: {
            ...process.env,
            APP_ENV: 'development',
            NODE_ENV: 'development',
            AVOP_EMAIL_MODE: 'dry-run',
            GMAIL_CLIENT_ID: 'client-id-test',
            GMAIL_CLIENT_SECRET: 'client-secret-test',
            GMAIL_REFRESH_TOKEN: 'refresh-token-test',
            GMAIL_SENDER_EMAIL: 'sender@example.test',
            GMAIL_SENDER_NAME: 'Conta Funcional Teste',
            GMAIL_TEST_RECIPIENT: 'sender@example.test',
            CONFIRM_GMAIL_TEST_SEND: '',
          },
        },
      );
    } catch (error) {
      result = error as { code: number; stdout: string; stderr: string };
    }

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Envio Gmail de teste recusado');
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).not.toContain('client-secret-test');
    expect(result.stderr).not.toContain('refresh-token-test');
  });
});

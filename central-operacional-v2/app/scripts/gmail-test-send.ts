import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const CONFIRMATION_VALUE = 'SEND_ONE_EMAIL';
const TEST_SUBJECT = '[TESTE FICTICIO] Central Operacional V2 - envio controlado';
const TEST_BODY = [
  'Mensagem ficticia de teste da Central Operacional V2.',
  '',
  'Este envio valida apenas a autorizacao OAuth da conta funcional Gmail.',
  'Nao representa AVOP real, cobranca operacional ou ciencia automatica.',
].join('\n');
const HEADER_CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
const SIMPLE_EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const SENSITIVE_ENV_NAMES = [
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'SUPABASE_SECRET_KEY',
  'CRON_SECRET',
  'SESSION_SECRET',
  'AUTH_FINGERPRINT_SECRET',
];

type EnvMap = Record<string, string | undefined>;
type GmailSender = (input: {
  to: string;
  subject: string;
  body: string;
}) => Promise<unknown>;
type Logger = Pick<typeof console, 'log' | 'error'>;
type PreflightStatus = 'present' | 'missing' | 'valid' | 'invalid' | 'dry-run' | 'other';

export type ControlledGmailTestResult =
  | { ok: true; localTestId: string }
  | { ok: false; error: string };

export type ControlledGmailTestPreflight = {
  ok: boolean;
  summary: {
    APP_ENV: PreflightStatus;
    AVOP_EMAIL_MODE: PreflightStatus;
    GMAIL_SENDER_EMAIL: PreflightStatus;
    GMAIL_TEST_RECIPIENT: PreflightStatus;
    GMAIL_CREDENTIALS: PreflightStatus;
    CONFIRM_GMAIL_TEST_SEND: 'present' | 'missing';
  };
};

function appDir() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function loadTestSendEnvironment(projectDir = appDir()): EnvMap {
  const existingEnv = { ...process.env };
  nextEnv.loadEnvConfig(
    projectDir,
    true,
    {
      info: () => undefined,
      error: () => undefined,
    },
    true,
  );
  for (const [key, value] of Object.entries(existingEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
  return { ...process.env };
}

export function validateControlledGmailTestEnvironment(env: EnvMap): string[] {
  const issues: string[] = [];
  const required = [
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
    'GMAIL_SENDER_EMAIL',
    'GMAIL_SENDER_NAME',
    'GMAIL_TEST_RECIPIENT',
  ];

  if (env.APP_ENV !== 'development' || env.NODE_ENV === 'production') {
    issues.push('Execucao permitida somente com APP_ENV=development.');
  }

  if (env.AVOP_EMAIL_MODE !== 'dry-run') {
    issues.push('AVOP_EMAIL_MODE deve permanecer dry-run.');
  }

  if (env.CONFIRM_GMAIL_TEST_SEND !== CONFIRMATION_VALUE) {
    issues.push('Confirmacao explicita ausente ou invalida.');
  }

  for (const name of required) {
    if (!env[name]) issues.push(`${name} ausente.`);
  }

  const senderEmail = env.GMAIL_SENDER_EMAIL;
  const recipient = env.GMAIL_TEST_RECIPIENT;
  if (senderEmail && !isSafeSimpleEmail(senderEmail)) {
    issues.push('GMAIL_SENDER_EMAIL invalido.');
  }
  if (recipient && !isSafeSimpleEmail(recipient)) {
    issues.push('GMAIL_TEST_RECIPIENT invalido.');
  }
  if (senderEmail && recipient && senderEmail !== recipient) {
    issues.push('GMAIL_TEST_RECIPIENT deve ser exatamente igual a GMAIL_SENDER_EMAIL nesta etapa.');
  }

  if (env.GMAIL_SENDER_NAME && HEADER_CONTROL_CHAR_PATTERN.test(env.GMAIL_SENDER_NAME)) {
    issues.push('GMAIL_SENDER_NAME invalido.');
  }

  return issues;
}

export function preflightControlledGmailTestEnvironment(env: EnvMap): ControlledGmailTestPreflight {
  const credentialsAvailable = Boolean(
    env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN,
  );
  const summary: ControlledGmailTestPreflight['summary'] = {
    APP_ENV: env.APP_ENV ? 'present' : 'missing',
    AVOP_EMAIL_MODE: env.AVOP_EMAIL_MODE === 'dry-run' ? 'dry-run' : env.AVOP_EMAIL_MODE ? 'other' : 'missing',
    GMAIL_SENDER_EMAIL: env.GMAIL_SENDER_EMAIL && isSafeSimpleEmail(env.GMAIL_SENDER_EMAIL)
      ? 'valid'
      : env.GMAIL_SENDER_EMAIL ? 'invalid' : 'missing',
    GMAIL_TEST_RECIPIENT: env.GMAIL_TEST_RECIPIENT && isSafeSimpleEmail(env.GMAIL_TEST_RECIPIENT)
      ? 'valid'
      : env.GMAIL_TEST_RECIPIENT ? 'invalid' : 'missing',
    GMAIL_CREDENTIALS: credentialsAvailable ? 'present' : 'missing',
    CONFIRM_GMAIL_TEST_SEND: env.CONFIRM_GMAIL_TEST_SEND ? 'present' : 'missing',
  };

  return {
    ok: validateControlledGmailTestEnvironment(env).length === 0,
    summary,
  };
}

function isSafeSimpleEmail(value: string) {
  return value.trim() === value
    && !value.includes(' ')
    && !value.includes(',')
    && !value.includes(';')
    && !HEADER_CONTROL_CHAR_PATTERN.test(value)
    && SIMPLE_EMAIL_PATTERN.test(value);
}

export async function runControlledGmailTestSend(input: {
  env: EnvMap;
  sender?: GmailSender;
  logger?: Logger;
  createLocalTestId?: () => string;
}): Promise<ControlledGmailTestResult> {
  const logger = input.logger ?? console;
  const issues = validateControlledGmailTestEnvironment(input.env);
  if (issues.length > 0) {
    const message = 'Envio Gmail de teste recusado por configuracao insegura ou incompleta.';
    logger.error(message);
    return { ok: false, error: message };
  }

  const localTestId = input.createLocalTestId?.() ?? createLocalTestId();
  try {
    const sender = input.sender ?? await loadGmailSender();
    await sender({
      to: input.env.GMAIL_TEST_RECIPIENT as string,
      subject: TEST_SUBJECT,
      body: TEST_BODY,
    });
    logger.log(`Envio Gmail de teste concluido. localTestId=${localTestId}`);
    return { ok: true, localTestId };
  } catch (error) {
    const sanitized = sanitizeError(error, input.env);
    logger.error(`Falha no envio Gmail de teste: ${sanitized}`);
    return { ok: false, error: 'Falha no envio Gmail de teste.' };
  }
}

async function loadGmailSender(): Promise<GmailSender> {
  const gmailModule = await import('../src/lib/gmail/avop-email.ts');
  return gmailModule.sendGmailMessage;
}

function createLocalTestId() {
  return `gmail-test-${randomBytes(8).toString('hex')}`;
}

export function sanitizeError(error: unknown, env: EnvMap) {
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  let sanitized = message;
  for (const name of SENSITIVE_ENV_NAMES) {
    const value = env[name];
    if (value) sanitized = sanitized.replaceAll(value, '[redacted]');
  }
  return sanitized
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]');
}

async function main() {
  const env = loadTestSendEnvironment();
  if (process.argv.includes('--preflight')) {
    printPreflight(preflightControlledGmailTestEnvironment(env));
    return;
  }
  const result = await runControlledGmailTestSend({ env });
  process.exitCode = result.ok ? 0 : 1;
}

function printPreflight(preflight: ControlledGmailTestPreflight) {
  console.log('Preflight sanitizado do envio Gmail controlado:');
  for (const [name, status] of Object.entries(preflight.summary)) {
    console.log(`- ${name}: ${status}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}

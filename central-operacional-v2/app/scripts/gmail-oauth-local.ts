import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const FUNCTIONAL_ACCOUNT = 'cdout.1gav11@gmail.com';
const DEFAULT_PORT = 3456;
const CALLBACK_PATH = '/oauth2callback';
const SENSITIVE_ENV_NAMES = [
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'CRON_SECRET',
  'SESSION_SECRET',
  'AUTH_FINGERPRINT_SECRET',
  'SUPABASE_SECRET_KEY',
];

type EnvMap = Record<string, string>;
type OAuthClient = {
  generateAuthUrl(input: {
    access_type: 'offline';
    scope: string[];
    prompt: 'consent';
    state: string;
    login_hint: string;
  }): string;
  getToken(code: string): Promise<{ tokens: { refresh_token?: string | null } }>;
};

export type GmailOAuthCheck = {
  ok: boolean;
  issues: string[];
  summary: Record<string, 'present' | 'missing' | 'invalid' | 'disabled'>;
};

function appDir() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function envLocalPath() {
  return join(appDir(), '.env.local');
}

export async function readEnvLocal(path = envLocalPath()): Promise<EnvMap> {
  if (!existsSync(path)) return {};
  const content = await readFile(path, 'utf8');
  return parseEnvContent(content);
}

export function parseEnvContent(content: string): EnvMap {
  const env: EnvMap = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    env[key] = unquoteEnvValue(value);
  }
  return env;
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function mergedEnv(fileEnv: EnvMap): EnvMap {
  return { ...fileEnv, ...process.env } as EnvMap;
}

export function validateGmailOAuthEnvironment(env: EnvMap): GmailOAuthCheck {
  const issues: string[] = [];
  const summary: GmailOAuthCheck['summary'] = {
    APP_ENV: valueStatus(env.APP_ENV),
    AVOP_EMAIL_MODE: valueStatus(env.AVOP_EMAIL_MODE),
    CRON_SECRET: valueStatus(env.CRON_SECRET),
    GMAIL_CLIENT_ID: valueStatus(env.GMAIL_CLIENT_ID),
    GMAIL_CLIENT_SECRET: valueStatus(env.GMAIL_CLIENT_SECRET),
    GMAIL_REFRESH_TOKEN: valueStatus(env.GMAIL_REFRESH_TOKEN),
    GMAIL_SENDER_EMAIL: valueStatus(env.GMAIL_SENDER_EMAIL),
    GMAIL_SENDER_NAME: valueStatus(env.GMAIL_SENDER_NAME),
  };

  if (env.APP_ENV === 'production' || env.NODE_ENV === 'production') {
    issues.push('Este fluxo local nao pode ser executado em production.');
  }

  if (env.AVOP_EMAIL_MODE === 'gmail') {
    issues.push('Use este fluxo com AVOP_EMAIL_MODE diferente de gmail; ele nao envia e-mail.');
  }

  if (!env.GMAIL_CLIENT_ID) issues.push('GMAIL_CLIENT_ID ausente.');
  if (!env.GMAIL_CLIENT_SECRET) issues.push('GMAIL_CLIENT_SECRET ausente.');

  if (env.GMAIL_SENDER_EMAIL && env.GMAIL_SENDER_EMAIL !== FUNCTIONAL_ACCOUNT) {
    summary.GMAIL_SENDER_EMAIL = 'invalid';
    issues.push('GMAIL_SENDER_EMAIL deve apontar para a conta funcional prevista.');
  }

  return { ok: issues.length === 0, issues, summary };
}

function valueStatus(value: string | undefined): 'present' | 'missing' {
  return value ? 'present' : 'missing';
}

export function createState() {
  return randomBytes(32).toString('base64url');
}

export function isSafeLocalCallbackUrl(url: URL) {
  return url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    && url.pathname === CALLBACK_PATH;
}

export function safeStateEquals(actual: string, expected: string) {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function buildOAuthClient(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): OAuthClient {
  return new google.auth.OAuth2(input.clientId, input.clientSecret, input.redirectUri);
}

export function buildAuthorizationUrl(input: {
  client: OAuthClient;
  state: string;
}) {
  return input.client.generateAuthUrl({
    access_type: 'offline',
    scope: [GMAIL_SEND_SCOPE],
    prompt: 'consent',
    state: input.state,
    login_hint: FUNCTIONAL_ACCOUNT,
  });
}

export async function upsertEnvValue(input: {
  path: string;
  key: string;
  value: string;
}) {
  const existing = existsSync(input.path)
    ? await readFile(input.path, 'utf8')
    : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const escaped = input.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const nextLine = `${input.key}="${escaped}"`;
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.match(new RegExp(`^\\s*${input.key}\\s*=`))) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    nextLines.push(nextLine);
  }

  await writeFile(input.path, `${nextLines.join('\n').replace(/\n*$/, '')}\n`, 'utf8');
}

export function sanitizeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  let sanitized = message;
  for (const name of SENSITIVE_ENV_NAMES) {
    const value = process.env[name];
    if (value) sanitized = sanitized.replaceAll(value, '[redacted]');
  }
  return sanitized.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]');
}

async function runCheck() {
  const env = mergedEnv(await readEnvLocal());
  const check = validateGmailOAuthEnvironment(env);
  printCheck(check);
  process.exitCode = check.ok ? 0 : 1;
}

async function runAuthorize() {
  const fileEnv = await readEnvLocal();
  const env = mergedEnv(fileEnv);
  const check = validateGmailOAuthEnvironment(env);
  printCheck(check);
  if (!check.ok) {
    process.exitCode = 1;
    return;
  }

  const port = parsePort(env.GMAIL_OAUTH_LOCAL_PORT);
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;
  const state = createState();
  const client = buildOAuthClient({
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    redirectUri,
  });
  const authorizationUrl = buildAuthorizationUrl({ client, state });

  console.log('Redirect URI local confirmado:', redirectUri);
  console.log('Escopo solicitado:', GMAIL_SEND_SCOPE);
  console.log('Abra a URL abaixo no navegador e autorize somente a conta funcional.');
  console.log(authorizationUrl);

  const server = createServer(async (request, response) => {
    await handleCallback({ request, response, client, state, envPath: envLocalPath() });
    server.close();
  });

  await new Promise<void>((resolve) => server.listen(port, 'localhost', resolve));
  console.log('Callback local aguardando em localhost. Nenhum e-mail sera enviado.');
}

async function handleCallback(input: {
  request: IncomingMessage;
  response: ServerResponse;
  client: OAuthClient;
  state: string;
  envPath: string;
}) {
  try {
    const requestUrl = new URL(input.request.url ?? '/', 'http://localhost');
    if (!isSafeLocalCallbackUrl(requestUrl)) {
      return writeCallbackResponse(input.response, 400, 'Callback invalido.');
    }
    const code = requestUrl.searchParams.get('code');
    const returnedState = requestUrl.searchParams.get('state');
    if (!code || !returnedState || !safeStateEquals(returnedState, input.state)) {
      return writeCallbackResponse(input.response, 400, 'Autorizacao invalida.');
    }

    const { tokens } = await input.client.getToken(code);
    if (!tokens.refresh_token) {
      return writeCallbackResponse(
        input.response,
        400,
        'Refresh token nao retornado. Revogue o consentimento anterior ou repita com prompt=consent.',
      );
    }

    await upsertEnvValue({
      path: input.envPath,
      key: 'GMAIL_REFRESH_TOKEN',
      value: tokens.refresh_token,
    });

    writeCallbackResponse(
      input.response,
      200,
      'Autorizacao concluida. O refresh token foi salvo em .env.local e nao foi exibido.',
    );
  } catch (error) {
    console.error('Falha no fluxo OAuth local:', sanitizeErrorMessage(error));
    writeCallbackResponse(input.response, 500, 'Falha ao concluir autorizacao.');
  }
}

function writeCallbackResponse(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(message);
}

function parsePort(value: string | undefined) {
  if (!value) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('GMAIL_OAUTH_LOCAL_PORT invalido.');
  }
  return port;
}

function printCheck(check: GmailOAuthCheck) {
  console.log('Validacao sanitizada de variaveis Gmail OAuth:');
  for (const [name, status] of Object.entries(check.summary)) {
    console.log(`- ${name}: ${status}`);
  }
  if (!check.ok) {
    console.log('Pendencias:');
    for (const issue of check.issues) console.log(`- ${issue}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--check')) {
    await runCheck();
  } else if (args.has('--authorize')) {
    await runAuthorize();
  } else {
    console.log('Uso: npm run gmail:oauth:check ou npm run gmail:oauth:local');
    process.exitCode = 1;
  }
}

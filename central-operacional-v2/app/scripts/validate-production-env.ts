type EnvMap = Record<string, string | undefined>;
type Status = 'present' | 'missing' | 'valid' | 'invalid' | 'dry-run' | 'gmail' | 'other';

export type ProductionEnvValidation = {
  ok: boolean;
  summary: Record<string, Status>;
  issues: string[];
};

const SECRET_NAMES = [
  'SUPABASE_SECRET_KEY',
  'SESSION_SECRET',
  'AUTH_FINGERPRINT_SECRET',
  'CRON_SECRET',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
] as const;

const REQUIRED_STRONG_SECRETS = [
  'SUPABASE_SECRET_KEY',
  'SESSION_SECRET',
  'AUTH_FINGERPRINT_SECRET',
  'CRON_SECRET',
] as const;

const GMAIL_REQUIRED_WHEN_REAL = [
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'GMAIL_SENDER_EMAIL',
  'GMAIL_SENDER_NAME',
] as const;

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const SIMPLE_EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

export function validateProductionEnvironment(env: EnvMap): ProductionEnvValidation {
  const issues: string[] = [];
  const summary: Record<string, Status> = {};

  const appEnv = normalize(env.APP_ENV);
  summary.APP_ENV = appEnv === 'production' ? 'valid' : appEnv ? 'invalid' : 'missing';
  if (appEnv !== 'production') issues.push('APP_ENV deve ser exatamente production.');

  const supabaseTarget = normalize(env.SUPABASE_TARGET_ENV);
  summary.SUPABASE_TARGET_ENV = supabaseTarget === 'production' ? 'valid' : supabaseTarget ? 'invalid' : 'missing';
  if (supabaseTarget !== 'production') issues.push('SUPABASE_TARGET_ENV deve ser exatamente production.');

  validateHttpsOrigin('APP_ORIGIN', env.APP_ORIGIN, issues, summary, { required: true });
  validateHttpsOrigin('APP_BASE_URL', env.APP_BASE_URL, issues, summary, { required: false });
  if (env.APP_BASE_URL && env.APP_ORIGIN && normalizeOrigin(env.APP_BASE_URL) !== normalizeOrigin(env.APP_ORIGIN)) {
    summary.APP_BASE_URL = 'invalid';
    issues.push('APP_BASE_URL deve ter a mesma origem de APP_ORIGIN quando configurado.');
  }

  const productionProjectRef = normalize(env.SUPABASE_PRODUCTION_PROJECT_REF);
  const developmentProjectRef = normalize(env.SUPABASE_DEV_PROJECT_REF);
  const urlProjectRef = extractSupabaseProjectRef(env.SUPABASE_URL);

  summary.SUPABASE_URL = urlProjectRef ? 'valid' : env.SUPABASE_URL ? 'invalid' : 'missing';
  if (!urlProjectRef) issues.push('SUPABASE_URL deve apontar para um projeto Supabase HTTPS valido.');

  summary.SUPABASE_PRODUCTION_PROJECT_REF = PROJECT_REF_PATTERN.test(productionProjectRef) ? 'valid' : productionProjectRef ? 'invalid' : 'missing';
  if (!PROJECT_REF_PATTERN.test(productionProjectRef)) {
    issues.push('SUPABASE_PRODUCTION_PROJECT_REF deve conter o project ref de producao.');
  }

  summary.SUPABASE_DEV_PROJECT_REF = developmentProjectRef
    ? PROJECT_REF_PATTERN.test(developmentProjectRef) ? 'valid' : 'invalid'
    : 'missing';
  if (developmentProjectRef && !PROJECT_REF_PATTERN.test(developmentProjectRef)) {
    issues.push('SUPABASE_DEV_PROJECT_REF deve ser valido quando configurado para comparacao.');
  }

  if (urlProjectRef && productionProjectRef && urlProjectRef !== productionProjectRef) {
    issues.push('SUPABASE_URL deve corresponder a SUPABASE_PRODUCTION_PROJECT_REF.');
    summary.SUPABASE_URL = 'invalid';
  }

  if (developmentProjectRef && productionProjectRef && developmentProjectRef === productionProjectRef) {
    issues.push('Projeto Supabase de producao nao pode ser igual ao development.');
    summary.SUPABASE_PRODUCTION_PROJECT_REF = 'invalid';
    summary.SUPABASE_DEV_PROJECT_REF = 'invalid';
  }

  if (developmentProjectRef && urlProjectRef && developmentProjectRef === urlProjectRef) {
    issues.push('SUPABASE_URL de producao nao pode apontar para o projeto development.');
    summary.SUPABASE_URL = 'invalid';
  }

  for (const secretName of REQUIRED_STRONG_SECRETS) {
    const value = env[secretName];
    const valid = isStrongSecret(value, { allowSecretWord: secretName === 'SUPABASE_SECRET_KEY' })
      && (secretName !== 'SUPABASE_SECRET_KEY' || value?.startsWith('sb_secret_'));
    summary[secretName] = valid ? 'valid' : value ? 'invalid' : 'missing';
    if (!valid) issues.push(`${secretName} ausente, fraco ou em formato invalido.`);
  }

  rejectReusedSecrets(env, issues, summary);
  rejectPublicSecretVariables(env, issues, summary);

  const emailMode = normalize(env.AVOP_EMAIL_MODE);
  summary.AVOP_EMAIL_MODE = emailMode === 'dry-run' ? 'dry-run' : emailMode === 'gmail' ? 'gmail' : emailMode ? 'other' : 'missing';
  if (emailMode !== 'dry-run' && emailMode !== 'gmail') {
    issues.push('AVOP_EMAIL_MODE deve ser dry-run no primeiro deploy ou gmail apenas apos liberacao explicita.');
  }

  if (emailMode === 'gmail') {
    validateGmailConfiguration(env, issues, summary);
  } else {
    for (const name of GMAIL_REQUIRED_WHEN_REAL) {
      summary[name] = env[name] ? 'present' : 'missing';
    }
  }

  return {
    ok: issues.length === 0,
    summary,
    issues,
  };
}

function validateHttpsOrigin(
  name: 'APP_ORIGIN' | 'APP_BASE_URL',
  value: string | undefined,
  issues: string[],
  summary: Record<string, Status>,
  options: { required: boolean },
) {
  if (!value) {
    summary[name] = options.required ? 'missing' : 'missing';
    if (options.required) issues.push(`${name} deve ser configurado com HTTPS.`);
    return;
  }

  const origin = normalizeOrigin(value);
  if (!origin || !origin.startsWith('https://')) {
    summary[name] = 'invalid';
    issues.push(`${name} deve usar HTTPS e origem valida.`);
    return;
  }

  if (/localhost|127\.0\.0\.1|\.local$/i.test(new URL(origin).hostname)) {
    summary[name] = 'invalid';
    issues.push(`${name} nao pode apontar para host local em producao.`);
    return;
  }

  summary[name] = 'valid';
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function extractSupabaseProjectRef(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const suffix = '.supabase.co';
    if (!url.hostname.endsWith(suffix)) return null;
    const ref = url.hostname.slice(0, -suffix.length);
    return PROJECT_REF_PATTERN.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

function isStrongSecret(value: string | undefined, options: { allowSecretWord?: boolean } = {}): value is string {
  if (!value || value.length < 32) return false;
  if (/^(.)\1+$/.test(value)) return false;
  const forbiddenPattern = options.allowSecretWord
    ? /troque|change|placeholder|example|segredo/i
    : /troque|change|placeholder|example|secret|segredo/i;
  if (forbiddenPattern.test(value)) return false;
  return true;
}

function rejectReusedSecrets(env: EnvMap, issues: string[], summary: Record<string, Status>) {
  const values = new Map<string, string[]>();
  for (const name of SECRET_NAMES) {
    const value = env[name];
    if (!value) continue;
    const names = values.get(value) ?? [];
    names.push(name);
    values.set(value, names);
  }

  for (const names of values.values()) {
    if (names.length <= 1) continue;
    issues.push(`Segredos reutilizados entre variaveis: ${names.join(', ')}.`);
    for (const name of names) summary[name] = 'invalid';
  }
}

function rejectPublicSecretVariables(env: EnvMap, issues: string[], summary: Record<string, Status>) {
  const forbiddenFragments = ['SECRET', 'TOKEN', 'KEY', 'PASSWORD', 'COOKIE', 'SUPABASE', 'GMAIL', 'CRON'];
  const leaked = Object.keys(env).filter((name) => {
    if (!name.startsWith('NEXT_PUBLIC_')) return false;
    return forbiddenFragments.some((fragment) => name.includes(fragment));
  });

  summary.NEXT_PUBLIC_SECRETS = leaked.length === 0 ? 'valid' : 'invalid';
  if (leaked.length > 0) {
    issues.push('Variaveis NEXT_PUBLIC_* nao podem conter segredos ou credenciais.');
  }
}

function validateGmailConfiguration(env: EnvMap, issues: string[], summary: Record<string, Status>) {
  for (const name of GMAIL_REQUIRED_WHEN_REAL) {
    summary[name] = env[name] ? 'present' : 'missing';
    if (!env[name]) issues.push(`${name} obrigatorio quando AVOP_EMAIL_MODE=gmail.`);
  }

  if (env.GMAIL_SENDER_EMAIL && !isSafeSimpleEmail(env.GMAIL_SENDER_EMAIL)) {
    summary.GMAIL_SENDER_EMAIL = 'invalid';
    issues.push('GMAIL_SENDER_EMAIL invalido.');
  }

  if (env.GMAIL_SENDER_NAME && CONTROL_CHAR_PATTERN.test(env.GMAIL_SENDER_NAME)) {
    summary.GMAIL_SENDER_NAME = 'invalid';
    issues.push('GMAIL_SENDER_NAME invalido.');
  }
}

function isSafeSimpleEmail(value: string) {
  return value.trim() === value
    && !value.includes(' ')
    && !value.includes(',')
    && !value.includes(';')
    && !CONTROL_CHAR_PATTERN.test(value)
    && SIMPLE_EMAIL_PATTERN.test(value);
}

function normalize(value: string | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function printSanitizedReport(result: ProductionEnvValidation) {
  console.log('Validação sanitizada de variáveis de produção');
  console.log(`Resultado: ${result.ok ? 'ok' : 'falhou'}`);
  for (const [name, status] of Object.entries(result.summary).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`- ${name}: ${status}`);
  }
  if (result.issues.length > 0) {
    console.log('Achados:');
    for (const issue of result.issues) console.log(`- ${issue}`);
  }
}

if (process.argv[1]?.endsWith('validate-production-env.ts')) {
  const result = validateProductionEnvironment(process.env);
  printSanitizedReport(result);
  process.exitCode = result.ok ? 0 : 1;
}

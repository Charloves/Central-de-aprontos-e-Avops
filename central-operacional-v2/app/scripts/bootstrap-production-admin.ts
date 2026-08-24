import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

type EnvMap = Record<string, string | undefined>;
type BootstrapRepository = {
  bootstrapFirstAdmin(input: {
    trigram: string;
    name: string;
    email: string;
    audienceCodes: string[];
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
};

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const SIMPLE_EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function appDir() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function loadBootstrapEnvironment(projectDir = appDir()): EnvMap {
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

export function validateBootstrapEnvironment(env: EnvMap): string[] {
  const issues: string[] = [];
  const appEnv = env.APP_ENV?.trim();
  const targetEnv = env.SUPABASE_TARGET_ENV?.trim();
  const productionRef = env.SUPABASE_PRODUCTION_PROJECT_REF?.trim();
  const developmentRef = env.SUPABASE_DEV_PROJECT_REF?.trim();
  const urlRef = extractSupabaseProjectRef(env.SUPABASE_URL);

  if (appEnv !== 'production') issues.push('APP_ENV deve ser exatamente production.');
  if (targetEnv !== 'production') issues.push('SUPABASE_TARGET_ENV deve ser exatamente production.');
  if (!productionRef || !PROJECT_REF_PATTERN.test(productionRef)) {
    issues.push('SUPABASE_PRODUCTION_PROJECT_REF ausente ou inválido.');
  }
  if (developmentRef && !PROJECT_REF_PATTERN.test(developmentRef)) {
    issues.push('SUPABASE_DEV_PROJECT_REF inválido.');
  }
  if (productionRef && developmentRef && productionRef === developmentRef) {
    issues.push('Projeto production não pode ser igual ao development.');
  }
  if (!urlRef || urlRef !== productionRef) {
    issues.push('SUPABASE_URL deve apontar para o project ref production confirmado.');
  }
  if (!env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')) {
    issues.push('SUPABASE_SECRET_KEY moderna ausente.');
  }

  return issues;
}

export function readBootstrapInput(env: EnvMap): { ok: true; input: {
  trigram: string;
  name: string;
  email: string;
  audienceCodes: string[];
} } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const trigram = (env.BOOTSTRAP_ADMIN_TRIGRAM ?? '').trim().toUpperCase();
  const name = (env.BOOTSTRAP_ADMIN_NAME ?? '').trim();
  const email = (env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const audienceCodes = (env.BOOTSTRAP_ADMIN_AUDIENCES ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)
    .sort();

  if (!/^[A-Z0-9]{2,10}$/.test(trigram)) issues.push('Trigrama do primeiro administrador inválido.');
  if (name.length < 2 || name.length > 120) issues.push('Nome do primeiro administrador inválido.');
  if (!SIMPLE_EMAIL_PATTERN.test(email)) issues.push('E-mail do primeiro administrador inválido.');
  if (audienceCodes.length === 0) issues.push('Informe ao menos um público para o primeiro administrador.');

  return issues.length > 0 ? { ok: false, issues } : { ok: true, input: { trigram, name, email, audienceCodes } };
}

export async function runBootstrapProductionAdmin(input: {
  env: EnvMap;
  repository: BootstrapRepository;
  logger?: Pick<typeof console, 'log' | 'error'>;
}): Promise<boolean> {
  const logger = input.logger ?? console;
  const envIssues = validateBootstrapEnvironment(input.env);
  const parsed = readBootstrapInput(input.env);
  if (envIssues.length > 0 || !parsed.ok) {
    logger.error('Bootstrap do primeiro administrador recusado por configuração incompleta ou insegura.');
    for (const issue of [...envIssues, ...(parsed.ok ? [] : parsed.issues)]) logger.error(`- ${issue}`);
    return false;
  }

  const result = await input.repository.bootstrapFirstAdmin(parsed.input);
  if (!result.ok) {
    logger.error('Bootstrap do primeiro administrador não foi concluído.');
    return false;
  }

  logger.log('Bootstrap do primeiro administrador concluído com auditoria registrada.');
  return true;
}

class SupabaseBootstrapRepository implements BootstrapRepository {
  async bootstrapFirstAdmin(input: {
    trigram: string;
    name: string;
    email: string;
    audienceCodes: string[];
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { createServerSupabaseClient } = await import('../src/lib/db/client.ts');
    const client = createServerSupabaseClient();
    const { error } = await client.rpc('bootstrap_first_admin', {
      p_trigram: input.trigram,
      p_name: input.name,
      p_email: input.email,
      p_audience_codes: input.audienceCodes,
      p_now: new Date().toISOString(),
    });
    return error ? { ok: false, reason: 'BOOTSTRAP_FAILED' } : { ok: true };
  }
}

function extractSupabaseProjectRef(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const suffix = '.supabase.co';
    if (url.protocol !== 'https:' || !url.hostname.endsWith(suffix)) return null;
    const ref = url.hostname.slice(0, -suffix.length);
    return PROJECT_REF_PATTERN.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

async function main() {
  const env = loadBootstrapEnvironment();
  const ok = await runBootstrapProductionAdmin({
    env,
    repository: new SupabaseBootstrapRepository(),
  });
  process.exitCode = ok ? 0 : 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}

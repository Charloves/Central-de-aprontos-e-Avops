import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type SpawnResult = Pick<SpawnSyncReturns<Buffer>, 'status' | 'signal' | 'error'>;

type SafeDryRunDependencies = {
  cwd: string;
  env: Record<string, string | undefined>;
  argv: string[];
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  supabaseCommand: string;
  supabaseArgsPrefix: string[];
  spawn: (command: string, args: string[], options: { cwd: string; stdio: 'inherit'; shell: boolean }) => SpawnResult;
  log: (message: string) => void;
  error: (message: string) => void;
};

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const REJECTED_ENVIRONMENTS = new Set([
  'prod',
  'production',
  'homolog',
  'homologation',
  'homologacao',
  'staging',
  'stage',
  'hml',
  'qa',
]);

export function runSafeSupabaseDryRun(dependencies: SafeDryRunDependencies): number {
  if (dependencies.argv.length > 2) {
    dependencies.error('O wrapper nao aceita argumentos adicionais. O comando permitido e fixo: supabase db push --dry-run.');
    return 1;
  }

  const fileEnv = readDotEnvLocal(dependencies);
  const targetEnv = normalizeEnvironment(dependencies.env.SUPABASE_TARGET_ENV ?? fileEnv.SUPABASE_TARGET_ENV);
  const expectedProjectRef = readProjectRef(dependencies.env.SUPABASE_DEV_PROJECT_REF ?? fileEnv.SUPABASE_DEV_PROJECT_REF);

  if (!targetEnv || targetEnv !== 'development' || REJECTED_ENVIRONMENTS.has(targetEnv)) {
    dependencies.error('SUPABASE_TARGET_ENV deve ser exatamente development para executar o dry-run.');
    return 1;
  }

  if (!expectedProjectRef || !PROJECT_REF_PATTERN.test(expectedProjectRef)) {
    dependencies.error('SUPABASE_DEV_PROJECT_REF ausente ou invalido. Use o project ref de desenvolvimento com 20 caracteres minusculos alfanumericos.');
    return 1;
  }

  const linkedProjectRefPath = resolve(dependencies.cwd, 'supabase', '.temp', 'project-ref');
  if (!dependencies.exists(linkedProjectRefPath)) {
    dependencies.error('Nenhum projeto Supabase linkado foi encontrado em supabase/.temp/project-ref.');
    return 1;
  }

  const linkedProjectRef = readProjectRef(dependencies.readFile(linkedProjectRefPath));
  if (!PROJECT_REF_PATTERN.test(linkedProjectRef)) {
    dependencies.error('O project ref linkado localmente e invalido.');
    return 1;
  }

  if (linkedProjectRef !== expectedProjectRef) {
    dependencies.error('Project ref linkado difere de SUPABASE_DEV_PROJECT_REF. Dry-run interrompido.');
    return 1;
  }

  dependencies.log(`Supabase target confirmado: env=${targetEnv}; project_ref=${linkedProjectRef}`);
  dependencies.log('Executando comando fixo: supabase db push --dry-run');
  const result = dependencies.spawn(dependencies.supabaseCommand, [...dependencies.supabaseArgsPrefix, 'db', 'push', '--dry-run'], {
    cwd: dependencies.cwd,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    dependencies.error(`Falha ao executar Supabase CLI: ${result.error.message}`);
    return 1;
  }

  if (result.signal) {
    dependencies.error(`Supabase CLI interrompida por sinal: ${result.signal}`);
    return 1;
  }

  return result.status ?? 1;
}

function readDotEnvLocal(dependencies: SafeDryRunDependencies): Record<string, string> {
  const envPath = resolve(dependencies.cwd, '.env.local');
  if (!dependencies.exists(envPath)) return {};

  const env: Record<string, string> = {};
  const content = dependencies.readFile(envPath);
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1);
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

function normalizeEnvironment(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function readProjectRef(value: string | undefined): string {
  return value ?? '';
}

function resolveAppRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function resolveLocalSupabaseEntrypoint(appRoot: string): string {
  return resolve(appRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appRoot = resolveAppRoot();
  const supabaseEntrypoint = resolveLocalSupabaseEntrypoint(appRoot);
  process.exit(runSafeSupabaseDryRun({
    cwd: appRoot,
    env: process.env,
    argv: process.argv,
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    supabaseCommand: process.execPath,
    supabaseArgsPrefix: [supabaseEntrypoint],
    spawn: (command, args, options) => spawnSync(command, args, options),
    log: console.log,
    error: console.error,
  }));
}

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredMigrations = [
  '0001_initial_schema.sql',
  '0002_publication_history_snapshots.sql',
  '0003_historical_import_staging.sql',
  '0004_auth_security_state.sql',
];

const forbiddenSeedPatterns = [
  /@fab\.mil\.br/i,
  /charlescdma/i,
  /cdout\.1gav11/i,
  /gmail\.com/i,
  /documento\s+real/i,
  /drive\.google\.com/i,
];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`ERRO: ${message}`);
    process.exitCode = 1;
  }
}

const supabaseDir = resolve(process.cwd(), 'supabase');
const configPath = resolve(supabaseDir, 'config.toml');
const seedPath = resolve(supabaseDir, 'seed.sql');
const migrationsDir = resolve(supabaseDir, 'migrations');

assert(existsSync(configPath), 'supabase/config.toml nao encontrado.');
assert(existsSync(seedPath), 'supabase/seed.sql nao encontrado.');
assert(existsSync(migrationsDir), 'supabase/migrations nao encontrado.');

const config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
assert(config.includes('project_id = "central-operacional-v2-dev"'), 'config.toml deve usar project_id ficticio de desenvolvimento.');
assert(!/access_token|service_role|anon_key|project_ref/i.test(config), 'config.toml nao deve conter credenciais ou project ref remoto.');

const migrationFiles = existsSync(migrationsDir) ? readdirSync(migrationsDir).sort() : [];
for (const migration of requiredMigrations) {
  assert(migrationFiles.includes(migration), `migration obrigatoria ausente: ${migration}`);
}

const seed = existsSync(seedPath) ? readFileSync(seedPath, 'utf8') : '';
for (const pattern of forbiddenSeedPatterns) {
  assert(!pattern.test(seed), `seed.sql contem valor proibido pelo padrao ${pattern}`);
}
assert(seed.includes("('CHA', 'Coordenador Ficticio'"), 'seed.sql deve conter perfil CHA ficticio.');
assert(seed.includes("('USER'), ('COORDINATOR'), ('ADMIN')"), 'seed.sql deve atribuir papeis USER, COORDINATOR e ADMIN ficticios ao CHA.');
assert(seed.includes('AVOP DEV-001'), 'seed.sql deve conter AVOP ficticio.');
assert(seed.includes('APR-DEV-001'), 'seed.sql deve conter apronto ficticio.');
assert(seed.includes('OI-DEV-H50-001'), 'seed.sql deve conter OI H-50 ficticia.');
assert(seed.includes('OI-DEV-H125-001'), 'seed.sql deve conter OI H-125 ficticia.');

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('Preparacao Supabase dev validada localmente.');

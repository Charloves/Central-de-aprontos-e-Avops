import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations');
const migrations = readdirSync(migrationsDir)
  .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
  .sort();

if (migrations.length === 0) {
  console.error('Nenhuma migration encontrada em supabase/migrations.');
  process.exit(1);
}

for (const fileName of migrations) {
  const filePath = resolve(migrationsDir, fileName);
  const size = statSync(filePath).size;
  console.log(`${fileName}\t${size} bytes`);
}

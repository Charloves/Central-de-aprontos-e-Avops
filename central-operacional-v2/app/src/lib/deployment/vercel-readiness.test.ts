import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
  engines?: { node?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const vercelConfig = JSON.parse(readFileSync(join(appRoot, 'vercel.json'), 'utf8')) as {
  crons?: Array<{ path: string; schedule: string }>;
};
const envExample = readFileSync(join(appRoot, '.env.example'), 'utf8');
const cronRoute = readFileSync(join(appRoot, 'src/app/api/cron/avop-notifications/route.ts'), 'utf8');
const docs = readFileSync(join(appRoot, 'docs/VERCEL_HOMOLOGATION.md'), 'utf8');

describe('Vercel homologation readiness', () => {
  it('fixa runtime Node LTS compativel com a Vercel', () => {
    expect(packageJson.engines?.node).toBe('22.x');
    expect(packageJson.scripts?.build).toBe('next build');
  });

  it('configura cron diario em UTC para 08:00 America/Sao_Paulo', () => {
    expect(vercelConfig.crons).toEqual([
      {
        path: '/api/cron/avop-notifications',
        schedule: '0 11 * * *',
      },
    ]);
    expect(docs).toContain('08:00 em `America/Sao_Paulo`');
    expect(docs).toContain('Preview Deployments não disparam Cron Jobs automaticamente');
  });

  it('mantem o endpoint cron protegido e sem cache', () => {
    expect(cronRoute).toContain('export async function GET(request: Request)');
    expect(cronRoute).toContain('validateCronSecret');
    expect(cronRoute).toContain("response.headers.set('Cache-Control', 'no-store')");
    expect(cronRoute).toContain("process.env.AVOP_EMAIL_MODE !== 'gmail'");
  });

  it('documenta ambiente Preview usando Supabase development e dry-run', () => {
    expect(docs).toContain('Root Directory: `central-operacional-v2/app`');
    expect(docs).toContain('Framework Preset: `Next.js`');
    expect(docs).toContain('SUPABASE_TARGET_ENV');
    expect(docs).toContain('development');
    expect(docs).toContain('`AVOP_EMAIL_MODE`');
    expect(docs).toContain('`dry-run`');
  });

  it('falha fechada quando segredos e origem nao forem configurados', () => {
    expect(envExample).toContain('APP_ORIGIN=http://localhost:3000');
    expect(envExample).toContain('CRON_SECRET=');
    expect(envExample).toContain('SUPABASE_SECRET_KEY=');
    expect(envExample).toContain('SESSION_SECRET=');
    expect(envExample).toContain('AUTH_FINGERPRINT_SECRET=');
    expect(docs).toContain('falhem fechadas');
  });

  it('nao define variaveis secretas como NEXT_PUBLIC', () => {
    const forbiddenPublicSecrets = [
      'NEXT_PUBLIC_SUPABASE_SECRET_KEY',
      'NEXT_PUBLIC_SESSION_SECRET',
      'NEXT_PUBLIC_AUTH_FINGERPRINT_SECRET',
      'NEXT_PUBLIC_CRON_SECRET',
      'NEXT_PUBLIC_GMAIL_CLIENT_SECRET',
      'NEXT_PUBLIC_GMAIL_REFRESH_TOKEN',
    ];

    for (const name of forbiddenPublicSecrets) {
      expect(envExample).not.toContain(name);
      expect(docs).not.toContain(name);
    }
  });

  it('nao depende de caminho absoluto Windows em codigo de runtime', () => {
    const runtimeFiles = collectRuntimeFiles(join(appRoot, 'src'));
    for (const file of runtimeFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/[A-Z]:[\\/]/);
      expect(source).not.toContain('C:\\Users\\');
    }
  });

  it('mantem Gmail e Supabase em modulos server-only', () => {
    const sensitiveModules = [
      'src/lib/db/client.ts',
      'src/lib/gmail/avop-email.ts',
      'src/lib/notifications/gmail-avop-email-sender.ts',
      'src/lib/notifications/supabase-avop-notification-repository.ts',
    ];

    for (const relativePath of sensitiveModules) {
      expect(readFileSync(join(appRoot, relativePath), 'utf8').startsWith("import 'server-only';")).toBe(true);
    }
  });
});

function collectRuntimeFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRuntimeFiles(fullPath));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

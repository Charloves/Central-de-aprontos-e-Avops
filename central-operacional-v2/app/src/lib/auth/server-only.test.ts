import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(testDir, '..', '..');

describe('server-only boundaries', () => {
  it.each([
    join(srcDir, 'lib', 'db', 'client.ts'),
    join(testDir, 'server.ts'),
    join(testDir, 'supabase-security-repository.ts'),
    join(testDir, 'supabase-profile-repository.ts'),
    join(srcDir, 'lib', 'briefings', 'supabase-briefing-repository.ts'),
    join(srcDir, 'lib', 'ois', 'supabase-oi-repository.ts'),
    join(srcDir, 'lib', 'dashboard', 'supabase-dashboard-repository.ts'),
    join(srcDir, 'lib', 'admin', 'supabase-publication-repository.ts'),
    join(srcDir, 'lib', 'admin', 'supabase-profile-admin-repository.ts'),
    join(srcDir, 'lib', 'notifications', 'supabase-avop-notification-repository.ts'),
    join(srcDir, 'lib', 'notifications', 'gmail-avop-email-sender.ts'),
  ])('marca modulo sensivel como server-only: %s', (filePath) => {
    expect(readFileSync(filePath, 'utf8').startsWith("import 'server-only';")).toBe(true);
  });
});

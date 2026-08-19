import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/0006_protect_public_default_privileges.sql'),
  'utf8',
);

const previousMigrations = [
  '0001_initial_schema.sql',
  '0002_publication_history_snapshots.sql',
  '0003_historical_import_staging.sql',
  '0004_auth_security_state.sql',
  '0005_security_hardening.sql',
];

describe('public default privileges hardening migration', () => {
  it('uses explicit owner-scoped default privileges only for the application migration owner', () => {
    expect(migration).toContain('alter default privileges for role postgres in schema public');
    expect(migration).not.toContain('alter default privileges for role supabase_admin');
    expect(migration).not.toContain('alter default privileges in schema public');
  });

  it('revokes future access for browser roles and service_role on tables, sequences and functions', () => {
    expect(migration).toContain(
      'revoke all privileges on tables from public, anon, authenticated, service_role',
    );
    expect(migration).toContain(
      'revoke all privileges on sequences from public, anon, authenticated, service_role',
    );
    expect(migration).toContain(
      'revoke execute on functions from public, anon, authenticated, service_role',
    );
  });

  it('requires explicit future service_role grants instead of default access', () => {
    expect(migration).not.toMatch(/\bgrant\b[\s\S]*\bto\s+(public|anon|authenticated|service_role)\b/i);
    expect(migration).toContain(
      'Each future migration must\n-- grant service_role explicitly only for the objects the backend needs',
    );
  });

  it('is limited to the public schema and does not touch policies, indexes or Supabase internal schemas', () => {
    expect(migration).toContain('in schema public');
    expect(migration).not.toMatch(/\bcreate\s+policy\b/i);
    expect(migration).not.toMatch(/\bcreate\s+index\b/i);
    expect(migration).not.toMatch(/\bdrop\s+index\b/i);
    expect(migration).not.toMatch(/\bschema\s+(auth|storage|realtime|extensions)\b/i);
    expect(migration).not.toContain('db reset');
    expect(migration).not.toContain('seed');
  });

  it('keeps previous migrations present for the unchanged 0001 through 0005 chain', () => {
    for (const migrationName of previousMigrations) {
      const content = readFileSync(
        resolve(__dirname, `../../../supabase/migrations/${migrationName}`),
        'utf8',
      );

      expect(content.length).toBeGreaterThan(0);
    }
  });
});

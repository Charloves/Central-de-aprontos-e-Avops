import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/0007_add_foreign_key_indexes.sql'),
  'utf8',
);

const previousMigrations = [
  '0001_initial_schema.sql',
  '0002_publication_history_snapshots.sql',
  '0003_historical_import_staging.sql',
  '0004_auth_security_state.sql',
  '0005_security_hardening.sql',
  '0006_protect_public_default_privileges.sql',
];

const expectedIndexes = [
  ['absence_justifications', 'briefing_id'],
  ['absence_justifications', 'profile_id'],
  ['audit_log', 'actor_profile_id'],
  ['auth_audit_events', 'session_id'],
  ['avop_acknowledgements', 'profile_id'],
  ['avop_audiences', 'audience_id'],
  ['avop_publication_snapshot_members', 'audience_id'],
  ['avop_publication_snapshots', 'created_by'],
  ['avops', 'closed_by'],
  ['briefing_audiences', 'audience_id'],
  ['briefing_publication_snapshot_members', 'audience_id'],
  ['briefing_publication_snapshots', 'created_by'],
  ['briefing_records', 'profile_id'],
  ['historical_import_batches', 'created_by'],
  ['historical_import_staging_records', 'created_by'],
  ['historical_import_staging_records', 'resolved_by'],
  ['notification_log', 'schedule_id'],
  ['notification_schedule', 'profile_id'],
  ['profile_audience_history', 'audience_id'],
  ['profile_audience_history', 'created_by'],
  ['profile_audiences', 'audience_id'],
  ['profile_roles', 'assigned_by'],
] as const;

const indexName = (tableName: string, columnName: string) => `${tableName}_${columnName}_idx`;

describe('foreign key support indexes migration', () => {
  it('creates exactly the confirmed support indexes for unindexed foreign keys', () => {
    const createStatements = migration.match(/\bcreate\s+index\s+if\s+not\s+exists\b/gi) ?? [];

    expect(createStatements).toHaveLength(expectedIndexes.length);

    for (const [tableName, columnName] of expectedIndexes) {
      expect(migration).toContain(
        `create index if not exists ${indexName(tableName, columnName)} on public.${tableName} using btree (${columnName});`,
      );
    }
  });

  it('uses deterministic unique names within PostgreSQL identifier limits', () => {
    const names = expectedIndexes.map(([tableName, columnName]) => indexName(tableName, columnName));

    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).toMatch(/^[a-z0-9_]+_idx$/);
    }
  });

  it('keeps the migration limited to normal transactional public schema indexes', () => {
    expect(migration).not.toMatch(/\bconcurrently\b/i);
    expect(migration).not.toMatch(/\bdrop\s+index\b/i);
    expect(migration).not.toMatch(/\balter\s+table\b/i);
    expect(migration).not.toMatch(/\bcreate\s+policy\b/i);
    expect(migration).not.toMatch(/\bgrant\b/i);
    expect(migration).not.toMatch(/\brevoke\b/i);
    expect(migration).not.toMatch(/\bcreate\s+function\b/i);
    expect(migration).not.toMatch(/\banalyze\b/i);
    expect(migration).not.toMatch(/\bvacuum\b/i);
    expect(migration).not.toMatch(/\b(auth|storage|realtime|extensions)\./i);
  });

  it('does not include data changes or destructive statements', () => {
    expect(migration).not.toMatch(/\binsert\b/i);
    expect(migration).not.toMatch(/\bupdate\b/i);
    expect(migration).not.toMatch(/\bdelete\b/i);
    expect(migration).not.toMatch(/\btruncate\b/i);
    expect(migration).not.toMatch(/\bdrop\b/i);
  });

  it('keeps previous migrations present for the unchanged 0001 through 0006 chain', () => {
    for (const migrationName of previousMigrations) {
      const content = readFileSync(
        resolve(__dirname, `../../../supabase/migrations/${migrationName}`),
        'utf8',
      );

      expect(content.length).toBeGreaterThan(0);
    }
  });
});

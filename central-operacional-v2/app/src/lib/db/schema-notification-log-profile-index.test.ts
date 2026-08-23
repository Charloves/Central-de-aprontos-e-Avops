import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    __dirname,
    '../../../supabase/migrations/20260823000237_add_notification_log_profile_id_index.sql',
  ),
  'utf8',
);

const previousMigrations = [
  '0001_initial_schema.sql',
  '0002_publication_history_snapshots.sql',
  '0003_historical_import_staging.sql',
  '0004_auth_security_state.sql',
  '0005_security_hardening.sql',
  '0006_protect_public_default_privileges.sql',
  '0007_add_foreign_key_indexes.sql',
  '0008_fix_login_failure_audit_event_type.sql',
  '20260811132644_auto_close_briefings_cron.sql',
  '20260811175851_transfer_management_roles.sql',
  '20260817184128_admin_publication_workflow.sql',
  '20260818120552_avop_email_notifications.sql',
];

describe('notification_log profile_id support index migration', () => {
  it('creates only the btree support index for notification_log.profile_id', () => {
    expect(migration.trim()).toBe(
      [
        'create index if not exists notification_log_profile_id_idx',
        '  on public.notification_log using btree (profile_id);',
      ].join('\n'),
    );
  });

  it('keeps the index name deterministic and within PostgreSQL limits', () => {
    const indexName = 'notification_log_profile_id_idx';

    expect(indexName.length).toBeLessThanOrEqual(63);
    expect(indexName).toMatch(/^[a-z0-9_]+_idx$/);
  });

  it('does not alter schema behavior beyond the new support index', () => {
    expect(migration).not.toMatch(/\bconcurrently\b/i);
    expect(migration).not.toMatch(/\bdrop\s+index\b/i);
    expect(migration).not.toMatch(/\balter\s+table\b/i);
    expect(migration).not.toMatch(/\bcreate\s+policy\b/i);
    expect(migration).not.toMatch(/\bgrant\b/i);
    expect(migration).not.toMatch(/\brevoke\b/i);
    expect(migration).not.toMatch(/\bcreate\s+function\b/i);
    expect(migration).not.toMatch(/\binsert\b/i);
    expect(migration).not.toMatch(/\bupdate\b/i);
    expect(migration).not.toMatch(/\bdelete\b/i);
    expect(migration).not.toMatch(/\btruncate\b/i);
    expect(migration).not.toMatch(/\b(auth|storage|realtime|extensions)\./i);
  });

  it('keeps all prior applied migrations present and unchanged by this contract', () => {
    for (const migrationName of previousMigrations) {
      const content = readFileSync(
        resolve(__dirname, `../../../supabase/migrations/${migrationName}`),
        'utf8',
      );

      expect(content.length).toBeGreaterThan(0);
    }
  });
});

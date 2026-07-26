import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/0002_publication_history_snapshots.sql'),
  'utf8',
);

describe('historical publication schema', () => {
  it('creates evidence history for profile audiences without rewriting legacy data', () => {
    expect(migration).toContain('create table profile_audience_history');
    expect(migration).toContain('historical_profile_available boolean not null default true');
    expect(migration).toContain('limitation_reason text');
    expect(migration).toContain('profile_audience_history_limitation_chk');
  });

  it('creates nominal AVOP publication snapshots and members', () => {
    expect(migration).toContain('create table avop_publication_snapshots');
    expect(migration).toContain('create table avop_publication_snapshot_members');
    expect(migration).toContain('unique (snapshot_id, profile_id, audience_code_snapshot)');
    expect(migration).toContain('applicable_profile_source text not null');
  });

  it('creates nominal briefing publication snapshots and members', () => {
    expect(migration).toContain('create table briefing_publication_snapshots');
    expect(migration).toContain('create table briefing_publication_snapshot_members');
    expect(migration).toContain('opened_at timestamptz not null');
    expect(migration).toContain('briefing_snapshot_members_limitation_chk');
  });
});

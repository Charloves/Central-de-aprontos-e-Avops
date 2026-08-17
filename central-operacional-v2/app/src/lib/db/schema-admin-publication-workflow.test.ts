import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260817184128_admin_publication_workflow.sql'),
  'utf8',
);

describe('admin publication workflow migration', () => {
  it('creates backend-only RPCs with fixed search path and service_role grants', () => {
    for (const functionName of [
      'public.admin_save_avop_draft',
      'public.admin_publish_avop',
      'public.admin_save_briefing_draft',
      'public.admin_publish_briefing',
    ]) {
      expect(migration).toContain(`create or replace function ${functionName}`);
      expect(migration).toContain('security invoker');
      expect(migration).toContain('set search_path = pg_catalog, pg_temp');
      expect(migration).toContain(`revoke all on function ${functionName}`);
      expect(migration).toContain(`grant execute on function ${functionName}`);
    }

    expect(migration).not.toMatch(/grant execute .* anon/i);
    expect(migration).not.toMatch(/grant execute .* authenticated/i);
  });

  it('publishes AVOPs transactionally with a single snapshot, nominal members and audit', () => {
    expect(migration).toContain('for update');
    expect(migration).toContain("status = 'DRAFT'::public.avop_status");
    expect(migration).toContain("status = 'PUBLISHED'::public.avop_status");
    expect(migration).toContain('public.avop_publication_snapshots');
    expect(migration).toContain('public.avop_publication_snapshot_members');
    expect(migration).toContain('count(distinct profile_id)');
    expect(migration).toContain("'AVOP_PUBLISHED'");
    expect(migration).toContain("on conflict (snapshot_id, profile_id, audience_code_snapshot) do nothing");
  });

  it('publishes briefings transactionally with a single snapshot, nominal members and audit', () => {
    expect(migration).toContain("status = 'DRAFT'::public.briefing_status");
    expect(migration).toContain("status = 'OPEN'::public.briefing_status");
    expect(migration).toContain('public.briefing_publication_snapshots');
    expect(migration).toContain('public.briefing_publication_snapshot_members');
    expect(migration).toContain("'BRIEFING_PUBLISHED'");
  });

  it('captures TODOS, mixed audiences and current profile-audience validity without creating email work', () => {
    expect(migration).toContain("where s.code = 'TODOS'");
    expect(migration).toContain("where s.code <> 'TODOS'");
    expect(migration).toContain("p.active = true");
    expect(migration).toContain("pa.valid_from");
    expect(migration).toContain("pa.valid_to");
    expect(migration).not.toMatch(/gmail|notification_schedule|smtp|http/i);
  });

  it('keeps draft creation and publication audit events explicit', () => {
    expect(migration).toContain("'AVOP_DRAFT_CREATED'");
    expect(migration).toContain("'AVOP_PUBLISHED'");
    expect(migration).toContain("'BRIEFING_DRAFT_CREATED'");
    expect(migration).toContain("'BRIEFING_PUBLISHED'");
    expect(migration).toContain('public.audit_log');
  });
});

-- Security hardening after applying 0001 through 0004 in the isolated
-- development project.
--
-- V2 access model:
-- - Browsers do not access Supabase directly.
-- - Next.js server-side code is the only database caller.
-- - The server uses service_role and enforces authorization before queries.
-- - Public, anon and authenticated must not receive table or RPC access here.
-- - RLS is enabled on every public table as defense in depth for the exposed
--   public schema.

revoke create on schema public from public, anon, authenticated;
revoke all privileges on schema public from public, anon, authenticated;
grant usage on schema public to service_role;

-- Future objects created by the migration owner must not become browser APIs by
-- default. Future browser access must be added deliberately with a dedicated
-- migration, explicit grants, RLS policies and authorization tests.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public
  grant select, insert, update, delete, truncate, references, trigger on tables to service_role;
alter default privileges in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  revoke all privileges on functions from public, anon, authenticated;
alter default privileges in schema public
  grant execute on functions to service_role;

alter table profiles enable row level security;
alter table profile_roles enable row level security;
alter table audiences enable row level security;
alter table profile_audiences enable row level security;
alter table avops enable row level security;
alter table avop_audiences enable row level security;
alter table avop_acknowledgements enable row level security;
alter table briefings enable row level security;
alter table briefing_audiences enable row level security;
alter table briefing_records enable row level security;
alter table absence_justifications enable row level security;
alter table ois enable row level security;
alter table notification_schedule enable row level security;
alter table notification_log enable row level security;
alter table audit_log enable row level security;
alter table backup_index enable row level security;
alter table settings enable row level security;
alter table profile_audience_history enable row level security;
alter table avop_publication_snapshots enable row level security;
alter table avop_publication_snapshot_members enable row level security;
alter table briefing_publication_snapshots enable row level security;
alter table briefing_publication_snapshot_members enable row level security;
alter table historical_import_batches enable row level security;
alter table historical_import_staging_records enable row level security;
alter table auth_rate_limit_buckets enable row level security;
alter table auth_temporary_blocks enable row level security;
alter table auth_sessions enable row level security;
alter table auth_audit_events enable row level security;

revoke all privileges on table
  profiles,
  profile_roles,
  audiences,
  profile_audiences,
  avops,
  avop_audiences,
  avop_acknowledgements,
  briefings,
  briefing_audiences,
  briefing_records,
  absence_justifications,
  ois,
  notification_schedule,
  notification_log,
  audit_log,
  backup_index,
  settings,
  profile_audience_history,
  avop_publication_snapshots,
  avop_publication_snapshot_members,
  briefing_publication_snapshots,
  briefing_publication_snapshot_members,
  historical_import_batches,
  historical_import_staging_records,
  auth_rate_limit_buckets,
  auth_temporary_blocks,
  auth_sessions,
  auth_audit_events
from public, anon, authenticated;

grant select, insert, update, delete, truncate, references, trigger on table
  profiles,
  profile_roles,
  audiences,
  profile_audiences,
  avops,
  avop_audiences,
  avop_acknowledgements,
  briefings,
  briefing_audiences,
  briefing_records,
  absence_justifications,
  ois,
  notification_schedule,
  notification_log,
  audit_log,
  backup_index,
  settings,
  profile_audience_history,
  avop_publication_snapshots,
  avop_publication_snapshot_members,
  briefing_publication_snapshots,
  briefing_publication_snapshot_members,
  historical_import_batches,
  historical_import_staging_records,
  auth_rate_limit_buckets,
  auth_temporary_blocks,
  auth_sessions,
  auth_audit_events
to service_role;

revoke all privileges on all sequences in schema public from public, anon, authenticated;
grant all privileges on all sequences in schema public to service_role;

create or replace function prevent_historical_import_original_content_update()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.original_content is distinct from new.original_content then
    raise exception 'original_content is immutable for historical import staging records'
      using errcode = '22000';
  end if;

  return new;
end;
$$;

revoke all on function prevent_historical_import_original_content_update() from public, anon, authenticated;
grant execute on function prevent_historical_import_original_content_update() to service_role;

-- Reassert browser role lockdown for authentication RPCs created by 0004.
revoke all on function auth_assert_hash(text, text, boolean) from public, anon, authenticated;
revoke all on function auth_assert_metadata(jsonb) from public, anon, authenticated;
revoke all on function auth_check_temporary_block(text, text, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function auth_acquire_login_locks(text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function auth_finalize_login_failure(text, text, text, integer, integer, integer, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function auth_finalize_login_success(uuid, text, text, text, text, text, timestamptz, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function auth_touch_session(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function auth_revoke_session(text, text, timestamptz) from public, anon, authenticated;
revoke all on function auth_revoke_profile_sessions(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function auth_record_audit_event(uuid, uuid, auth_audit_event_type, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function auth_cleanup_security_state(timestamptz, integer, integer, integer, integer) from public, anon, authenticated;

grant execute on function auth_check_temporary_block(text, text, boolean, boolean, timestamptz) to service_role;
grant execute on function auth_finalize_login_failure(text, text, text, integer, integer, integer, boolean, boolean, timestamptz) to service_role;
grant execute on function auth_finalize_login_success(uuid, text, text, text, text, text, timestamptz, boolean, boolean, timestamptz) to service_role;
grant execute on function auth_touch_session(text, integer, timestamptz) to service_role;
grant execute on function auth_revoke_session(text, text, timestamptz) to service_role;
grant execute on function auth_revoke_profile_sessions(uuid, text, timestamptz) to service_role;
grant execute on function auth_record_audit_event(uuid, uuid, auth_audit_event_type, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function auth_cleanup_security_state(timestamptz, integer, integer, integer, integer) to service_role;

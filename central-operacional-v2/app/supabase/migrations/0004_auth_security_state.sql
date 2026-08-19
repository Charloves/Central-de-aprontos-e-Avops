-- Persistent authentication security state.
--
-- This migration is additive and must be operated only by the backend using the
-- Supabase service role. It stores no trigram, IP address, user-agent, token or
-- nonce in plain text. Application code must compute fingerprints with
-- HMAC-SHA256 using AUTH_FINGERPRINT_SECRET before calling these functions.

create type auth_rate_limit_scope as enum ('TRIGRAM', 'NETWORK', 'COMBINED');
create type auth_audit_event_type as enum (
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGIN_BLOCKED',
  'LOGOUT',
  'SESSION_REVOKED',
  'SESSION_EXPIRED'
);

create table auth_rate_limit_buckets (
  id uuid primary key default gen_random_uuid(),
  scope auth_rate_limit_scope not null,
  trigram_fingerprint text,
  network_fingerprint text,
  trigram_key text generated always as (coalesce(trigram_fingerprint, '')) stored,
  network_key text generated always as (coalesce(network_fingerprint, '')) stored,
  window_started_at timestamptz not null,
  window_ends_at timestamptz not null,
  failure_count integer not null default 0,
  success_count integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_rate_limit_buckets_fingerprints_chk check (
    (scope = 'TRIGRAM' and trigram_fingerprint is not null and network_fingerprint is null)
    or (scope = 'NETWORK' and trigram_fingerprint is null and network_fingerprint is not null)
    or (scope = 'COMBINED' and trigram_fingerprint is not null and network_fingerprint is not null)
  ),
  constraint auth_rate_limit_buckets_hash_format_chk check (
    (trigram_fingerprint is null or trigram_fingerprint ~ '^[a-f0-9]{64}$')
    and (network_fingerprint is null or network_fingerprint ~ '^[a-f0-9]{64}$')
  ),
  constraint auth_rate_limit_buckets_counts_chk check (
    failure_count >= 0 and success_count >= 0
  ),
  constraint auth_rate_limit_buckets_window_chk check (
    window_ends_at > window_started_at
  ),
  constraint auth_rate_limit_buckets_identity_unique unique (
    scope,
    trigram_key,
    network_key,
    window_started_at
  )
);

comment on table auth_rate_limit_buckets is
  'Server-only rate-limit buckets for authentication. Fingerprints are HMAC-SHA256 values, never raw trigram or network origin.';
comment on column auth_rate_limit_buckets.trigram_key is
  'Generated non-null key used only to make ON CONFLICT target a normal unique constraint.';
comment on column auth_rate_limit_buckets.network_key is
  'Generated non-null key used only to make ON CONFLICT target a normal unique constraint.';

create index auth_rate_limit_buckets_lookup_idx
  on auth_rate_limit_buckets (scope, trigram_key, network_key, window_ends_at);

create table auth_temporary_blocks (
  id uuid primary key default gen_random_uuid(),
  scope auth_rate_limit_scope not null,
  trigram_fingerprint text,
  network_fingerprint text,
  trigram_key text generated always as (coalesce(trigram_fingerprint, '')) stored,
  network_key text generated always as (coalesce(network_fingerprint, '')) stored,
  active_marker text not null default 'ACTIVE',
  reason text not null,
  failed_attempts integer not null,
  window_started_at timestamptz not null,
  blocked_until timestamptz not null,
  lifted_at timestamptz,
  lifted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_temporary_blocks_fingerprints_chk check (
    (scope = 'TRIGRAM' and trigram_fingerprint is not null and network_fingerprint is null)
    or (scope = 'NETWORK' and trigram_fingerprint is null and network_fingerprint is not null)
    or (scope = 'COMBINED' and trigram_fingerprint is not null and network_fingerprint is not null)
  ),
  constraint auth_temporary_blocks_hash_format_chk check (
    (trigram_fingerprint is null or trigram_fingerprint ~ '^[a-f0-9]{64}$')
    and (network_fingerprint is null or network_fingerprint ~ '^[a-f0-9]{64}$')
  ),
  constraint auth_temporary_blocks_counts_chk check (failed_attempts > 0),
  constraint auth_temporary_blocks_period_chk check (blocked_until > window_started_at),
  constraint auth_temporary_blocks_lift_marker_chk check (
    (lifted_at is null and active_marker = 'ACTIVE')
    or (lifted_at is not null and active_marker <> 'ACTIVE')
  ),
  constraint auth_temporary_blocks_lift_reason_chk check (
    (lifted_at is null and lifted_reason is null)
    or (lifted_at is not null and lifted_reason in ('EXPIRED', 'LOGIN_SUCCESS', 'ADMIN_REVOCATION'))
  ),
  constraint auth_temporary_blocks_active_unique unique (
    scope,
    trigram_key,
    network_key,
    active_marker
  )
);

comment on table auth_temporary_blocks is
  'Temporary authentication blocks. Each block cycle is a separate row. Expired rows are lifted before a new cycle is inserted; active rows use active_marker=ACTIVE to prevent simultaneous active blocks.';
comment on column auth_temporary_blocks.lifted_reason is
  'Reason the active block row was closed. Expired cycles use EXPIRED; a new cycle must be inserted as a new row.';

create index auth_temporary_blocks_active_lookup_idx
  on auth_temporary_blocks (scope, trigram_key, network_key, blocked_until)
  where lifted_at is null;

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  session_identifier_hash text not null unique,
  nonce_hash text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  network_fingerprint text,
  user_agent_fingerprint text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_sessions_hash_format_chk check (
    session_identifier_hash ~ '^[a-f0-9]{64}$'
    and nonce_hash ~ '^[a-f0-9]{64}$'
    and (network_fingerprint is null or network_fingerprint ~ '^[a-f0-9]{64}$')
    and (user_agent_fingerprint is null or user_agent_fingerprint ~ '^[a-f0-9]{64}$')
  ),
  constraint auth_sessions_period_chk check (expires_at > issued_at),
  constraint auth_sessions_metadata_chk check (jsonb_typeof(metadata) = 'object' and metadata = '{}'::jsonb)
);

comment on table auth_sessions is
  'Persistent server-side sessions. Raw token and raw nonce are never stored; only HMAC-SHA256 derived identifiers are stored.';
comment on column auth_sessions.metadata is
  'Reserved for future non-identifying keys. Restricted to empty object until an explicit allowlist is approved.';

create index auth_sessions_profile_active_idx
  on auth_sessions (profile_id, expires_at)
  where revoked_at is null;
create index auth_sessions_nonce_lookup_idx
  on auth_sessions (nonce_hash, expires_at, revoked_at);

create table auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  session_id uuid references auth_sessions(id) on delete set null,
  event_type auth_audit_event_type not null,
  result text not null,
  trigram_fingerprint text,
  network_fingerprint text,
  reason text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint auth_audit_events_hash_format_chk check (
    (trigram_fingerprint is null or trigram_fingerprint ~ '^[a-f0-9]{64}$')
    and (network_fingerprint is null or network_fingerprint ~ '^[a-f0-9]{64}$')
  ),
  constraint auth_audit_events_metadata_chk check (jsonb_typeof(metadata) = 'object' and metadata = '{}'::jsonb)
);

comment on table auth_audit_events is
  'Authentication audit events without raw personal identifiers. Metadata is restricted to empty object until an explicit allowlist is approved.';

create index auth_audit_events_type_time_idx
  on auth_audit_events (event_type, occurred_at);
create index auth_audit_events_profile_time_idx
  on auth_audit_events (profile_id, occurred_at);
create index auth_audit_events_fingerprint_time_idx
  on auth_audit_events (trigram_fingerprint, network_fingerprint, occurred_at);

alter table auth_rate_limit_buckets enable row level security;
alter table auth_temporary_blocks enable row level security;
alter table auth_sessions enable row level security;
alter table auth_audit_events enable row level security;

revoke all on table auth_rate_limit_buckets from public, anon, authenticated;
revoke all on table auth_temporary_blocks from public, anon, authenticated;
revoke all on table auth_sessions from public, anon, authenticated;
revoke all on table auth_audit_events from public, anon, authenticated;
-- This migration creates no sequences. Keep this explicit note so future ID
-- strategy changes must revisit sequence privileges before deployment.

create function auth_assert_hash(p_value text, p_name text, p_required boolean default true)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_value is null then
    if p_required then
      raise exception 'invalid authentication fingerprint' using errcode = '22023';
    end if;
    return;
  end if;

  if p_value !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid authentication fingerprint' using errcode = '22023';
  end if;
end;
$$;

create function auth_assert_metadata(p_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(p_metadata, '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'invalid authentication metadata' using errcode = '22023';
  end if;
end;
$$;

create function auth_check_temporary_block(
  p_trigram_fingerprint text,
  p_network_fingerprint text,
  p_enable_trigram boolean default true,
  p_enable_network boolean default true,
  p_now timestamptz default now()
)
returns table(blocked boolean, blocked_until timestamptz, scope auth_rate_limit_scope)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform auth_assert_hash(p_trigram_fingerprint, 'trigram', p_enable_trigram);
  perform auth_assert_hash(p_network_fingerprint, 'network', false);

  return query
  select true, b.blocked_until, b.scope
  from auth_temporary_blocks b
  where b.lifted_at is null
    and b.blocked_until > p_now
    and (
      (p_enable_trigram and b.scope = 'TRIGRAM' and b.trigram_fingerprint = p_trigram_fingerprint)
      or (p_enable_network and p_network_fingerprint is not null and b.scope = 'NETWORK' and b.network_fingerprint = p_network_fingerprint)
      or (
        p_enable_trigram
        and p_enable_network
        and p_network_fingerprint is not null
        and b.scope = 'COMBINED'
        and b.trigram_fingerprint = p_trigram_fingerprint
        and b.network_fingerprint = p_network_fingerprint
      )
    )
  order by b.blocked_until desc, b.scope
  limit 1;
end;
$$;

create function auth_acquire_login_locks(
  p_trigram_fingerprint text,
  p_network_fingerprint text,
  p_enable_trigram boolean default true,
  p_enable_network boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock_key text;
begin
  for v_lock_key in
    select key
    from (
      select case when p_enable_trigram then 'TRIGRAM:' || p_trigram_fingerprint end as key
      union all
      select case when p_enable_network and p_network_fingerprint is not null then 'NETWORK:' || p_network_fingerprint end
      union all
      select case
        when p_enable_trigram and p_enable_network and p_network_fingerprint is not null
        then 'COMBINED:' || p_trigram_fingerprint || ':' || p_network_fingerprint
      end
    ) keys
    where key is not null
    order by key
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  end loop;
end;
$$;

create function auth_finalize_login_failure(
  p_trigram_fingerprint text,
  p_network_fingerprint text,
  p_reason text,
  p_max_attempts integer default 5,
  p_window_seconds integer default 900,
  p_block_seconds integer default 900,
  p_enable_trigram boolean default true,
  p_enable_network boolean default true,
  p_now timestamptz default now()
)
returns table(blocked boolean, blocked_until timestamptz, scope auth_rate_limit_scope)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_started_at timestamptz;
  v_window_ends_at timestamptz;
  v_blocked_until timestamptz;
  v_scope auth_rate_limit_scope;
  v_failure_count integer;
  v_first_blocked_until timestamptz;
  v_first_scope auth_rate_limit_scope;
begin
  perform auth_assert_hash(p_trigram_fingerprint, 'trigram', p_enable_trigram);
  perform auth_assert_hash(p_network_fingerprint, 'network', false);

  if p_max_attempts <= 0 or p_window_seconds <= 0 or p_block_seconds <= 0 then
    raise exception 'invalid authentication limit configuration' using errcode = '22023';
  end if;

  perform auth_acquire_login_locks(p_trigram_fingerprint, p_network_fingerprint, p_enable_trigram, p_enable_network);

  -- Expired block rows are closed before a new cycle can be created. This
  -- preserves the previous window_started_at, blocked_until and failed_attempts
  -- instead of mutating a historical row through ON CONFLICT.
  update auth_temporary_blocks b
  set lifted_at = p_now,
      lifted_reason = 'EXPIRED',
      active_marker = b.id::text,
      updated_at = now()
  where b.lifted_at is null
    and b.blocked_until <= p_now
    and (
      (p_enable_trigram and b.scope = 'TRIGRAM' and b.trigram_fingerprint = p_trigram_fingerprint)
      or (p_enable_network and p_network_fingerprint is not null and b.scope = 'NETWORK' and b.network_fingerprint = p_network_fingerprint)
      or (
        p_enable_trigram
        and p_enable_network
        and p_network_fingerprint is not null
        and b.scope = 'COMBINED'
        and b.trigram_fingerprint = p_trigram_fingerprint
        and b.network_fingerprint = p_network_fingerprint
      )
    );

  select b.blocked_until, b.scope
    into v_first_blocked_until, v_first_scope
  from auth_temporary_blocks b
  where b.lifted_at is null
    and b.blocked_until > p_now
    and (
      (p_enable_trigram and b.scope = 'TRIGRAM' and b.trigram_fingerprint = p_trigram_fingerprint)
      or (p_enable_network and p_network_fingerprint is not null and b.scope = 'NETWORK' and b.network_fingerprint = p_network_fingerprint)
      or (
        p_enable_trigram
        and p_enable_network
        and p_network_fingerprint is not null
        and b.scope = 'COMBINED'
        and b.trigram_fingerprint = p_trigram_fingerprint
        and b.network_fingerprint = p_network_fingerprint
      )
    )
  order by b.blocked_until desc, b.scope
  limit 1;

  if v_first_blocked_until is not null then
    perform auth_record_audit_event(null, null, 'LOGIN_BLOCKED', 'NEGADO', p_trigram_fingerprint, p_network_fingerprint, 'TEMPORARY_BLOCK', '{}'::jsonb, p_now);
    return query select true, v_first_blocked_until, v_first_scope;
    return;
  end if;

  v_window_started_at := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  v_window_ends_at := v_window_started_at + make_interval(secs => p_window_seconds);
  v_blocked_until := p_now + make_interval(secs => p_block_seconds);

  for v_scope in
    select unnest(array['TRIGRAM'::auth_rate_limit_scope, 'NETWORK'::auth_rate_limit_scope, 'COMBINED'::auth_rate_limit_scope])
  loop
    continue when v_scope = 'TRIGRAM' and not p_enable_trigram;
    continue when v_scope = 'NETWORK' and not (p_enable_network and p_network_fingerprint is not null);
    continue when v_scope = 'COMBINED' and not (p_enable_trigram and p_enable_network and p_network_fingerprint is not null);

    insert into auth_rate_limit_buckets (
      scope,
      trigram_fingerprint,
      network_fingerprint,
      window_started_at,
      window_ends_at,
      failure_count,
      last_attempt_at
    ) values (
      v_scope,
      case when v_scope in ('TRIGRAM', 'COMBINED') then p_trigram_fingerprint else null end,
      case when v_scope in ('NETWORK', 'COMBINED') then p_network_fingerprint else null end,
      v_window_started_at,
      v_window_ends_at,
      1,
      p_now
    )
    on conflict on constraint auth_rate_limit_buckets_identity_unique
    do update set
      failure_count = auth_rate_limit_buckets.failure_count + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = now()
    returning failure_count into v_failure_count;

    if v_failure_count >= p_max_attempts then
      insert into auth_temporary_blocks (
        scope,
        trigram_fingerprint,
        network_fingerprint,
        reason,
        failed_attempts,
        window_started_at,
        blocked_until
      ) values (
        v_scope,
        case when v_scope in ('TRIGRAM', 'COMBINED') then p_trigram_fingerprint else null end,
        case when v_scope in ('NETWORK', 'COMBINED') then p_network_fingerprint else null end,
        'LOGIN_FAILURE_LIMIT',
        v_failure_count,
        v_window_started_at,
        v_blocked_until
      );
    end if;
  end loop;

  select b.blocked_until, b.scope
    into v_first_blocked_until, v_first_scope
  from auth_temporary_blocks b
  where b.lifted_at is null
    and b.blocked_until > p_now
    and (
      (p_enable_trigram and b.scope = 'TRIGRAM' and b.trigram_fingerprint = p_trigram_fingerprint)
      or (p_enable_network and p_network_fingerprint is not null and b.scope = 'NETWORK' and b.network_fingerprint = p_network_fingerprint)
      or (
        p_enable_trigram
        and p_enable_network
        and p_network_fingerprint is not null
        and b.scope = 'COMBINED'
        and b.trigram_fingerprint = p_trigram_fingerprint
        and b.network_fingerprint = p_network_fingerprint
      )
    )
  order by b.blocked_until desc, b.scope
  limit 1;

  perform auth_record_audit_event(
    null,
    null,
    case when v_first_blocked_until is null then 'LOGIN_FAILURE' else 'LOGIN_BLOCKED' end,
    'NEGADO',
    p_trigram_fingerprint,
    p_network_fingerprint,
    p_reason,
    '{}'::jsonb,
    p_now
  );

  return query select v_first_blocked_until is not null, v_first_blocked_until, v_first_scope;
end;
$$;

create function auth_finalize_login_success(
  p_profile_id uuid,
  p_trigram_fingerprint text,
  p_network_fingerprint text,
  p_user_agent_fingerprint text,
  p_session_identifier_hash text,
  p_nonce_hash text,
  p_expires_at timestamptz,
  p_enable_trigram boolean default true,
  p_enable_network boolean default true,
  p_now timestamptz default now()
)
returns table(session_id uuid, blocked boolean, blocked_until timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blocked_until timestamptz;
  v_session_id uuid;
begin
  if p_profile_id is null or p_expires_at <= p_now then
    raise exception 'invalid authentication session input' using errcode = '22023';
  end if;

  perform auth_assert_hash(p_trigram_fingerprint, 'trigram', p_enable_trigram);
  perform auth_assert_hash(p_network_fingerprint, 'network', false);
  perform auth_assert_hash(p_user_agent_fingerprint, 'user_agent', false);
  perform auth_assert_hash(p_session_identifier_hash, 'session', true);
  perform auth_assert_hash(p_nonce_hash, 'nonce', true);
  perform auth_acquire_login_locks(p_trigram_fingerprint, p_network_fingerprint, p_enable_trigram, p_enable_network);

  select b.blocked_until
    into v_blocked_until
  from auth_temporary_blocks b
  where b.lifted_at is null
    and b.blocked_until > p_now
    and (
      (p_enable_trigram and b.scope = 'TRIGRAM' and b.trigram_fingerprint = p_trigram_fingerprint)
      or (p_enable_network and p_network_fingerprint is not null and b.scope = 'NETWORK' and b.network_fingerprint = p_network_fingerprint)
      or (
        p_enable_trigram
        and p_enable_network
        and p_network_fingerprint is not null
        and b.scope = 'COMBINED'
        and b.trigram_fingerprint = p_trigram_fingerprint
        and b.network_fingerprint = p_network_fingerprint
      )
    )
  order by b.blocked_until desc, b.scope
  limit 1;

  if v_blocked_until is not null then
    perform auth_record_audit_event(p_profile_id, null, 'LOGIN_BLOCKED', 'NEGADO', p_trigram_fingerprint, p_network_fingerprint, 'TEMPORARY_BLOCK', '{}'::jsonb, p_now);
    return query select null::uuid, true, v_blocked_until;
    return;
  end if;

  if p_enable_trigram then
    delete from auth_rate_limit_buckets
    where scope = 'TRIGRAM'
      and trigram_fingerprint = p_trigram_fingerprint;

    update auth_temporary_blocks
    set lifted_at = p_now,
        active_marker = id::text,
        lifted_reason = 'LOGIN_SUCCESS',
        updated_at = now()
    where scope = 'TRIGRAM'
      and trigram_fingerprint = p_trigram_fingerprint
      and lifted_at is null;
  end if;

  if p_enable_trigram and p_enable_network and p_network_fingerprint is not null then
    delete from auth_rate_limit_buckets
    where scope = 'COMBINED'
      and trigram_fingerprint = p_trigram_fingerprint
      and network_fingerprint = p_network_fingerprint;

    update auth_temporary_blocks
    set lifted_at = p_now,
        active_marker = id::text,
        lifted_reason = 'LOGIN_SUCCESS',
        updated_at = now()
    where scope = 'COMBINED'
      and trigram_fingerprint = p_trigram_fingerprint
      and network_fingerprint = p_network_fingerprint
      and lifted_at is null;
  end if;

  insert into auth_sessions (
    profile_id,
    session_identifier_hash,
    nonce_hash,
    issued_at,
    expires_at,
    network_fingerprint,
    user_agent_fingerprint,
    metadata
  ) values (
    p_profile_id,
    p_session_identifier_hash,
    p_nonce_hash,
    p_now,
    p_expires_at,
    p_network_fingerprint,
    p_user_agent_fingerprint,
    '{}'::jsonb
  )
  returning id into v_session_id;

  perform auth_record_audit_event(p_profile_id, v_session_id, 'LOGIN_SUCCESS', 'OK', p_trigram_fingerprint, p_network_fingerprint, null, '{}'::jsonb, p_now);
  return query select v_session_id, false, null::timestamptz;
end;
$$;

create function auth_touch_session(
  p_nonce_hash text,
  p_touch_interval_seconds integer default 300,
  p_now timestamptz default now()
)
returns table(session_id uuid, profile_id uuid, expires_at timestamptz, revoked_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform auth_assert_hash(p_nonce_hash, 'nonce', true);

  if p_touch_interval_seconds <= 0 then
    raise exception 'invalid authentication touch interval' using errcode = '22023';
  end if;

  update auth_sessions s
  set last_seen_at = p_now,
      updated_at = now()
  where s.nonce_hash = p_nonce_hash
    and s.expires_at > p_now
    and s.revoked_at is null
    and (
      s.last_seen_at is null
      or s.last_seen_at <= p_now - make_interval(secs => p_touch_interval_seconds)
    );

  return query
  select s.id, s.profile_id, s.expires_at, s.revoked_at
  from auth_sessions s
  where s.nonce_hash = p_nonce_hash
    and s.expires_at > p_now
    and s.revoked_at is null
  limit 1;
end;
$$;

create function auth_revoke_session(
  p_nonce_hash text,
  p_reason text default 'LOGOUT',
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid;
begin
  perform auth_assert_hash(p_nonce_hash, 'nonce', true);

  update auth_sessions
  set revoked_at = coalesce(revoked_at, p_now),
      revoked_reason = coalesce(revoked_reason, p_reason),
      updated_at = now()
  where nonce_hash = p_nonce_hash
  returning id into v_session_id;

  if v_session_id is not null then
    perform auth_record_audit_event(null, v_session_id, 'LOGOUT', 'OK', null, null, p_reason, '{}'::jsonb, p_now);
  end if;

  return v_session_id;
end;
$$;

create function auth_revoke_profile_sessions(
  p_profile_id uuid,
  p_reason text default 'ADMIN_REVOKE_ALL',
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_profile_id is null then
    raise exception 'invalid authentication profile' using errcode = '22023';
  end if;

  update auth_sessions
  set revoked_at = p_now,
      revoked_reason = p_reason,
      updated_at = now()
  where profile_id = p_profile_id
    and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function auth_record_audit_event(
  p_profile_id uuid,
  p_session_id uuid,
  p_event_type auth_audit_event_type,
  p_result text,
  p_trigram_fingerprint text default null,
  p_network_fingerprint text default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  perform auth_assert_hash(p_trigram_fingerprint, 'trigram', false);
  perform auth_assert_hash(p_network_fingerprint, 'network', false);
  perform auth_assert_metadata(p_metadata);

  insert into auth_audit_events (
    profile_id,
    session_id,
    event_type,
    result,
    trigram_fingerprint,
    network_fingerprint,
    reason,
    occurred_at,
    metadata
  ) values (
    p_profile_id,
    p_session_id,
    p_event_type,
    p_result,
    p_trigram_fingerprint,
    p_network_fingerprint,
    p_reason,
    p_now,
    '{}'::jsonb
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create function auth_cleanup_security_state(
  p_before timestamptz default now(),
  p_bucket_retention_seconds integer default 86400,
  p_block_retention_seconds integer default 604800,
  p_session_retention_seconds integer default 2592000,
  p_audit_retention_seconds integer default 31536000
)
returns table(deleted_buckets integer, deleted_blocks integer, deleted_sessions integer, deleted_audit_events integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buckets integer;
  v_blocks integer;
  v_sessions integer;
  v_audit integer;
begin
  if p_bucket_retention_seconds <= 0 or p_block_retention_seconds <= 0 or p_session_retention_seconds <= 0 or p_audit_retention_seconds <= 0 then
    raise exception 'invalid authentication cleanup retention' using errcode = '22023';
  end if;

  delete from auth_rate_limit_buckets
  where window_ends_at < p_before - make_interval(secs => p_bucket_retention_seconds);
  get diagnostics v_buckets = row_count;

  delete from auth_temporary_blocks
  where coalesce(lifted_at, blocked_until) < p_before - make_interval(secs => p_block_retention_seconds);
  get diagnostics v_blocks = row_count;

  delete from auth_sessions
  where coalesce(revoked_at, expires_at) < p_before - make_interval(secs => p_session_retention_seconds);
  get diagnostics v_sessions = row_count;

  delete from auth_audit_events
  where occurred_at < p_before - make_interval(secs => p_audit_retention_seconds);
  get diagnostics v_audit = row_count;

  return query select v_buckets, v_blocks, v_sessions, v_audit;
end;
$$;

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

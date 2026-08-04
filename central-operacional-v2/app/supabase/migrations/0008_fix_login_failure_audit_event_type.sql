-- Corrects the already-applied authentication failure finalization RPC without
-- changing tables, enums, indexes, RLS, grants on data objects or stored data.
-- The original 0004 body is preserved; only the CASE expression passed to
-- auth_record_audit_event is explicitly cast to public.auth_audit_event_type.

create or replace function public.auth_finalize_login_failure(
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
returns table(blocked boolean, blocked_until timestamptz, scope public.auth_rate_limit_scope)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_started_at timestamptz;
  v_window_ends_at timestamptz;
  v_blocked_until timestamptz;
  v_scope public.auth_rate_limit_scope;
  v_failure_count integer;
  v_first_blocked_until timestamptz;
  v_first_scope public.auth_rate_limit_scope;
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
    select unnest(array['TRIGRAM'::public.auth_rate_limit_scope, 'NETWORK'::public.auth_rate_limit_scope, 'COMBINED'::public.auth_rate_limit_scope])
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
    (case when v_first_blocked_until is null then 'LOGIN_FAILURE' else 'LOGIN_BLOCKED' end)::public.auth_audit_event_type,
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

revoke all on function public.auth_finalize_login_failure(text, text, text, integer, integer, integer, boolean, boolean, timestamptz)
  from public, anon, authenticated;

grant execute on function public.auth_finalize_login_failure(text, text, text, integer, integer, integer, boolean, boolean, timestamptz)
  to service_role;

create schema if not exists internal;

create or replace function internal.assert_profile_admin_actor(p_actor_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_actor_profile_id is null then
    raise exception 'invalid actor' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.profile_roles pr on pr.profile_id = p.id
    where p.id = p_actor_profile_id
      and p.active
      and pr.role = 'ADMIN'::public.app_role
  ) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
end;
$$;

create or replace function internal.normalize_profile_audience_codes(p_codes text[])
returns text[]
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_codes text[];
begin
  select coalesce(array_agg(distinct code order by code), array[]::text[])
  into v_codes
  from (
    select upper(btrim(value)) as code
    from unnest(coalesce(p_codes, array[]::text[])) as value
    where btrim(value) <> ''
  ) normalized;

  if coalesce(array_length(v_codes, 1), 0) = 0 then
    raise exception 'at least one audience is required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_codes) as code
    left join public.audiences a on a.code = code and a.active
    where a.id is null
  ) then
    raise exception 'invalid audience' using errcode = '22023';
  end if;

  return v_codes;
end;
$$;

create or replace function public.bootstrap_first_admin(
  p_trigram text,
  p_name text,
  p_email text,
  p_audience_codes text[],
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_trigram text := upper(btrim(coalesce(p_trigram, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_audience_codes text[];
  v_profile_id uuid;
  v_audit_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('central_operacional_bootstrap_first_admin'));

  if v_trigram !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'invalid trigram' using errcode = '22023';
  end if;

  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'invalid name' using errcode = '22023';
  end if;

  if v_email is not null and v_email !~ '^[A-Za-z0-9.!#$%&''''*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  v_audience_codes := internal.normalize_profile_audience_codes(p_audience_codes);

  if exists (
    select 1
    from public.profiles p
    join public.profile_roles pr on pr.profile_id = p.id
    where p.active
      and pr.role = 'ADMIN'::public.app_role
  ) then
    raise exception 'admin already exists' using errcode = '23505';
  end if;

  insert into public.profiles (trigram, name, email, active, created_at, updated_at)
  values (v_trigram, v_name, v_email, true, p_now, p_now)
  on conflict (trigram) do update
    set name = excluded.name,
        email = excluded.email,
        active = true,
        updated_at = excluded.updated_at
  returning id into v_profile_id;

  insert into public.profile_roles (profile_id, role, assigned_by, assigned_at, reason)
  values
    (v_profile_id, 'USER'::public.app_role, null, p_now, 'BOOTSTRAP_FIRST_ADMIN'),
    (v_profile_id, 'COORDINATOR'::public.app_role, null, p_now, 'BOOTSTRAP_FIRST_ADMIN'),
    (v_profile_id, 'ADMIN'::public.app_role, null, p_now, 'BOOTSTRAP_FIRST_ADMIN')
  on conflict (profile_id, role) do update
    set assigned_at = excluded.assigned_at,
        reason = excluded.reason;

  delete from public.profile_audiences where profile_id = v_profile_id;
  insert into public.profile_audiences (profile_id, audience_id, valid_from, valid_to)
  select v_profile_id, a.id, p_now::date, null
  from public.audiences a
  where a.code = any(v_audience_codes)
    and a.active;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, occurred_at, metadata)
  values (
    v_profile_id,
    'PROFILE_BOOTSTRAP_ADMIN_CREATED',
    'profile',
    v_profile_id::text,
    p_now,
    jsonb_build_object('roles', jsonb_build_array('USER', 'COORDINATOR', 'ADMIN'), 'audiences', to_jsonb(v_audience_codes))
  )
  returning id into v_audit_id;

  return jsonb_build_object('ok', true, 'profile_id', v_profile_id, 'audit_id', v_audit_id);
end;
$$;

create or replace function public.admin_save_profile(
  p_actor_profile_id uuid,
  p_profile_id uuid,
  p_payload jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_target_id uuid := p_profile_id;
  v_old_active boolean;
  v_old_roles text[];
  v_new_roles text[];
  v_existing_is_admin boolean := false;
  v_trigram text := upper(btrim(coalesce(v_payload->>'trigram', '')));
  v_name text := btrim(coalesce(v_payload->>'name', ''));
  v_email text := nullif(lower(btrim(coalesce(v_payload->>'email', ''))), '');
  v_active boolean;
  v_audience_codes text[];
  v_requested_roles text[];
  v_action text;
  v_audit_id uuid;
  v_revoked_sessions integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('central_operacional_admin_save_profile'));
  perform internal.assert_profile_admin_actor(p_actor_profile_id);

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;

  if v_payload ?| array['actorProfileId', 'actor_profile_id', 'assignedBy', 'assigned_by', 'sessionId', 'session_id'] then
    raise exception 'client supplied actor identity' using errcode = '22023';
  end if;

  if v_trigram !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'invalid trigram' using errcode = '22023';
  end if;

  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'invalid name' using errcode = '22023';
  end if;

  if v_email is not null and v_email !~ '^[A-Za-z0-9.!#$%&''''*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  if jsonb_typeof(v_payload->'active') <> 'boolean' then
    raise exception 'invalid active flag' using errcode = '22023';
  end if;
  v_active := (v_payload->>'active')::boolean;

  if jsonb_typeof(v_payload->'audienceCodes') <> 'array' then
    raise exception 'invalid audiences' using errcode = '22023';
  end if;
  select array_agg(value order by value)
  into v_audience_codes
  from jsonb_array_elements_text(v_payload->'audienceCodes') as value;
  v_audience_codes := internal.normalize_profile_audience_codes(v_audience_codes);

  if jsonb_typeof(v_payload->'roles') <> 'array' then
    raise exception 'invalid roles' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct upper(btrim(value)) order by upper(btrim(value))), array[]::text[])
  into v_requested_roles
  from jsonb_array_elements_text(v_payload->'roles') as value
  where btrim(value) <> '';

  if 'ADMIN' = any(v_requested_roles) then
    raise exception 'admin grant must use transfer flow' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(v_requested_roles) as role
    where role not in ('USER', 'COORDINATOR')
  ) then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  v_requested_roles := array(select distinct role from unnest(array_append(v_requested_roles, 'USER')) as role order by role);

  if v_target_id is null then
    insert into public.profiles (trigram, name, email, active, created_at, updated_at)
    values (v_trigram, v_name, v_email, v_active, p_now, p_now)
    returning id into v_target_id;
    v_old_active := null;
    v_old_roles := array[]::text[];
    v_action := 'PROFILE_CREATED';
  else
    select p.active,
           coalesce(array_agg(pr.role::text order by pr.role::text) filter (where pr.role is not null), array[]::text[])
    into v_old_active, v_old_roles
    from public.profiles p
    left join public.profile_roles pr on pr.profile_id = p.id
    where p.id = v_target_id
    group by p.id, p.active;

    if not found then
      raise exception 'profile not found' using errcode = '02000';
    end if;

    v_existing_is_admin := 'ADMIN' = any(v_old_roles);

    if v_existing_is_admin and not v_active and not exists (
      select 1
      from public.profiles p
      join public.profile_roles pr on pr.profile_id = p.id
      where pr.role = 'ADMIN'::public.app_role
        and p.active
        and p.id <> v_target_id
    ) then
      raise exception 'last active admin cannot be disabled' using errcode = '42501';
    end if;

    update public.profiles
    set trigram = v_trigram,
        name = v_name,
        email = v_email,
        active = v_active,
        updated_at = p_now
    where id = v_target_id;

    v_action := 'PROFILE_UPDATED';
  end if;

  v_new_roles := v_requested_roles;
  if v_existing_is_admin then
    v_new_roles := array(select distinct role from unnest(array_append(v_new_roles, 'ADMIN')) as role order by role);
  end if;

  delete from public.profile_roles
  where profile_id = v_target_id
    and role <> 'ADMIN'::public.app_role
    and not (role::text = any(v_requested_roles));

  insert into public.profile_roles (profile_id, role, assigned_by, assigned_at, reason)
  select v_target_id, role::public.app_role, p_actor_profile_id, p_now, 'PROFILE_ADMIN_UPDATE'
  from unnest(v_requested_roles) as role
  on conflict (profile_id, role) do nothing;

  delete from public.profile_audiences
  where profile_id = v_target_id
    and audience_id not in (
      select id from public.audiences where code = any(v_audience_codes) and active
    );

  insert into public.profile_audiences (profile_id, audience_id, valid_from, valid_to)
  select v_target_id, a.id, p_now::date, null
  from public.audiences a
  where a.code = any(v_audience_codes)
    and a.active
  on conflict (profile_id, audience_id) do update
    set valid_to = null;

  if v_old_active is not null and (v_old_active is distinct from v_active or v_old_roles is distinct from v_new_roles) then
    select public.auth_revoke_profile_sessions(v_target_id, 'PROFILE_ADMIN_UPDATE', p_now)
    into v_revoked_sessions;
  end if;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, occurred_at, metadata)
  values (
    p_actor_profile_id,
    v_action,
    'profile',
    v_target_id::text,
    p_now,
    jsonb_build_object(
      'active_changed', v_old_active is not null and v_old_active is distinct from v_active,
      'roles_changed', v_old_roles is distinct from v_new_roles,
      'audience_count', coalesce(array_length(v_audience_codes, 1), 0),
      'sessions_revoked', v_revoked_sessions
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'profile_id', v_target_id,
    'audit_id', v_audit_id,
    'sessions_revoked', v_revoked_sessions
  );
end;
$$;

comment on function public.bootstrap_first_admin(text, text, text, text[], timestamptz) is
  'One-time backend-only bootstrap for the first production administrator. Refuses execution after an active ADMIN exists.';
comment on function public.admin_save_profile(uuid, uuid, jsonb, timestamptz) is
  'Backend-only administrative profile mutation with ADMIN authorization, last-admin protection, audit and session revocation.';

revoke all on function internal.assert_profile_admin_actor(uuid) from public, anon, authenticated;
revoke all on function internal.normalize_profile_audience_codes(text[]) from public, anon, authenticated;
revoke all on function public.bootstrap_first_admin(text, text, text, text[], timestamptz) from public, anon, authenticated;
revoke all on function public.admin_save_profile(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function internal.assert_profile_admin_actor(uuid) to service_role;
grant execute on function internal.normalize_profile_audience_codes(text[]) to service_role;
grant execute on function public.bootstrap_first_admin(text, text, text, text[], timestamptz) to service_role;
grant execute on function public.admin_save_profile(uuid, uuid, jsonb, timestamptz) to service_role;

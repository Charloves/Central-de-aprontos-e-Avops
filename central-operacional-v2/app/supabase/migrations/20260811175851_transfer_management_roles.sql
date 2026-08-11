create schema if not exists internal;

revoke usage, create on schema internal from public, anon, authenticated;
grant usage on schema internal to service_role;

create or replace function internal.transfer_management_roles(
  p_actor_profile_id uuid,
  p_target_trigram text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_normalized_target text;
  v_audit_id uuid;
begin
  if p_actor_profile_id is null then
    raise exception 'invalid role transfer request' using errcode = '22023';
  end if;

  v_normalized_target := upper(regexp_replace(coalesce(p_target_trigram, ''), '[[:space:]]+', '', 'g'));
  if v_normalized_target !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'invalid role transfer request' using errcode = '22023';
  end if;

  -- Single stable lock serializes management transfer attempts and avoids
  -- partial states where the application could momentarily have no admin.
  perform pg_catalog.pg_advisory_xact_lock(2026081117, 5851);

  select *
    into v_actor
    from public.profiles
   where id = p_actor_profile_id
     and active = true
   for update;

  if not found then
    raise exception 'invalid role transfer request' using errcode = '28000';
  end if;

  if not exists (
    select 1
      from public.profile_roles
     where profile_id = v_actor.id
       and role = 'ADMIN'::public.app_role
  ) then
    raise exception 'invalid role transfer request' using errcode = '42501';
  end if;

  select *
    into v_target
    from public.profiles
   where trigram = v_normalized_target
     and active = true
   for update;

  if not found then
    raise exception 'invalid role transfer request' using errcode = '22023';
  end if;

  if v_target.id = v_actor.id then
    raise exception 'invalid role transfer request' using errcode = '22023';
  end if;

  insert into public.profile_roles (profile_id, role, assigned_by, assigned_at, reason)
  values
    (v_actor.id, 'USER'::public.app_role, v_actor.id, p_now, 'USER preservado na transferencia administrativa.')
  on conflict (profile_id, role) do nothing;

  insert into public.profile_roles (profile_id, role, assigned_by, assigned_at, reason)
  values
    (v_target.id, 'USER'::public.app_role, v_actor.id, p_now, 'USER preservado na transferencia administrativa.')
  on conflict (profile_id, role) do nothing;

  insert into public.profile_roles (profile_id, role, assigned_by, assigned_at, reason)
  values
    (v_target.id, 'ADMIN'::public.app_role, v_actor.id, p_now, 'Transferencia atomica de administracao.'),
    (v_target.id, 'COORDINATOR'::public.app_role, v_actor.id, p_now, 'Transferencia atomica de coordenacao.')
  on conflict (profile_id, role) do update
    set assigned_by = excluded.assigned_by,
        assigned_at = excluded.assigned_at,
        reason = excluded.reason;

  delete from public.profile_roles
   where profile_id = v_actor.id
     and role in ('ADMIN'::public.app_role, 'COORDINATOR'::public.app_role);

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    occurred_at,
    metadata
  )
  values (
    v_actor.id,
    'MANAGEMENT_ROLES_TRANSFERRED',
    'profile',
    v_target.id::text,
    p_now,
    jsonb_build_object(
      'from_profile_id', v_actor.id,
      'to_profile_id', v_target.id,
      'roles_transferred', jsonb_build_array('ADMIN', 'COORDINATOR'),
      'user_preserved', true
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'from_profile_id', v_actor.id,
    'to_profile_id', v_target.id,
    'audit_id', v_audit_id
  );
end;
$$;

comment on function internal.transfer_management_roles(uuid, text, timestamptz) is
  'Atomically transfers ADMIN and COORDINATOR from the active admin actor to an active target profile, preserving USER and writing one audit_log event.';

revoke all on function internal.transfer_management_roles(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function internal.transfer_management_roles(uuid, text, timestamptz) to service_role;

-- The transactional implementation stays in the non-exposed internal schema.
-- This public wrapper exists only so the server-side Supabase client can call
-- the RPC through PostgREST's exposed public schema using the backend secret.
create or replace function public.transfer_management_roles(
  p_actor_profile_id uuid,
  p_target_trigram text,
  p_now timestamptz default now()
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select internal.transfer_management_roles(p_actor_profile_id, p_target_trigram, p_now);
$$;

comment on function public.transfer_management_roles(uuid, text, timestamptz) is
  'Backend-only wrapper for internal.transfer_management_roles. Browser roles have no EXECUTE grant.';

revoke all on function public.transfer_management_roles(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.transfer_management_roles(uuid, text, timestamptz) to service_role;

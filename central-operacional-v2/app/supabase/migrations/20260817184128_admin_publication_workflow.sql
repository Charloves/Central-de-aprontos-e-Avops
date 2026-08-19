create schema if not exists internal;

revoke usage, create on schema internal from public, anon, authenticated;
grant usage on schema internal to service_role;

create or replace function internal.assert_management_actor(p_actor_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_actor_profile_id is null then
    raise exception 'invalid administrative request' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.profiles p
      join public.profile_roles r on r.profile_id = p.id
     where p.id = p_actor_profile_id
       and p.active = true
       and r.role in ('ADMIN'::public.app_role, 'COORDINATOR'::public.app_role)
  ) then
    raise exception 'invalid administrative request' using errcode = '42501';
  end if;
end;
$$;

create or replace function internal.normalized_publication_audiences(p_payload jsonb)
returns text[]
language sql
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    array_agg(distinct upper(pg_catalog.btrim(value))) filter (where pg_catalog.btrim(value) <> ''),
    '{}'::text[]
  )
  from jsonb_array_elements_text(coalesce(p_payload->'audiences', '[]'::jsonb)) as items(value);
$$;

create or replace function internal.assert_publication_audiences(p_codes text[])
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  if coalesce(cardinality(p_codes), 0) = 0 then
    raise exception 'publication requires audience' using errcode = '22023';
  end if;

  select count(*)
    into v_count
    from public.audiences a
   where a.active = true
     and a.code = any(p_codes);

  if v_count <> cardinality(p_codes) then
    raise exception 'publication contains invalid audience' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.admin_save_avop_draft(
  p_actor_profile_id uuid,
  p_draft_id uuid,
  p_payload jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
  v_number text := pg_catalog.btrim(coalesce(p_payload->>'number', ''));
  v_title text := pg_catalog.btrim(coalesce(p_payload->>'title', ''));
  v_publication_date date;
  v_drive_url text := pg_catalog.btrim(coalesce(p_payload->>'drive_url', ''));
  v_drive_file_id text := nullif(pg_catalog.btrim(coalesce(p_payload->>'drive_file_id', '')), '');
  v_requires_ack boolean := coalesce((p_payload->>'requires_acknowledgement')::boolean, true);
  v_audiences text[] := internal.normalized_publication_audiences(p_payload);
begin
  perform internal.assert_management_actor(p_actor_profile_id);
  perform internal.assert_publication_audiences(v_audiences);

  if v_number = '' or length(v_number) > 80 or v_title = '' or length(v_title) > 240 or v_drive_url = '' then
    raise exception 'invalid AVOP draft' using errcode = '22023';
  end if;
  v_publication_date := (p_payload->>'publication_date')::date;

  if p_draft_id is null then
    insert into public.avops (number, title, publication_date, drive_url, drive_file_id, status, requires_acknowledgement, created_at, updated_at)
    values (v_number, v_title, v_publication_date, v_drive_url, v_drive_file_id, 'DRAFT'::public.avop_status, v_requires_ack, p_now, p_now)
    returning id into v_id;

    insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, occurred_at, metadata)
    values (p_actor_profile_id, 'AVOP_DRAFT_CREATED', 'avop', v_id::text, p_now, '{}'::jsonb);
  else
    update public.avops
       set number = v_number,
           title = v_title,
           publication_date = v_publication_date,
           drive_url = v_drive_url,
           drive_file_id = v_drive_file_id,
           requires_acknowledgement = v_requires_ack,
           updated_at = p_now
     where id = p_draft_id
       and status = 'DRAFT'::public.avop_status
     returning id into v_id;

    if v_id is null then
      raise exception 'AVOP draft not editable' using errcode = '42501';
    end if;
  end if;

  delete from public.avop_audiences where avop_id = v_id;
  insert into public.avop_audiences (avop_id, audience_id)
  select v_id, a.id
    from public.audiences a
   where a.active = true
     and a.code = any(v_audiences)
  on conflict (avop_id, audience_id) do nothing;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_save_briefing_draft(
  p_actor_profile_id uuid,
  p_draft_id uuid,
  p_payload jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
  v_legacy_id text := pg_catalog.btrim(coalesce(p_payload->>'legacy_id', ''));
  v_title text := pg_catalog.btrim(coalesce(p_payload->>'title', ''));
  v_event_date date;
  v_drive_url text := nullif(pg_catalog.btrim(coalesce(p_payload->>'drive_url', '')), '');
  v_drive_file_id text := nullif(pg_catalog.btrim(coalesce(p_payload->>'drive_file_id', '')), '');
  v_requires_material boolean := coalesce((p_payload->>'requires_material_acknowledgement')::boolean, false);
  v_audiences text[] := internal.normalized_publication_audiences(p_payload);
begin
  perform internal.assert_management_actor(p_actor_profile_id);
  perform internal.assert_publication_audiences(v_audiences);

  if v_legacy_id = '' or length(v_legacy_id) > 80 or v_title = '' or length(v_title) > 240 then
    raise exception 'invalid briefing draft' using errcode = '22023';
  end if;
  v_event_date := (p_payload->>'event_date')::date;

  if p_draft_id is null then
    insert into public.briefings (legacy_id, title, event_date, drive_url, drive_file_id, requires_material_acknowledgement, status, created_at, updated_at)
    values (v_legacy_id, v_title, v_event_date, v_drive_url, v_drive_file_id, v_requires_material, 'DRAFT'::public.briefing_status, p_now, p_now)
    returning id into v_id;

    insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, occurred_at, metadata)
    values (p_actor_profile_id, 'BRIEFING_DRAFT_CREATED', 'briefing', v_id::text, p_now, '{}'::jsonb);
  else
    update public.briefings
       set legacy_id = v_legacy_id,
           title = v_title,
           event_date = v_event_date,
           drive_url = v_drive_url,
           drive_file_id = v_drive_file_id,
           requires_material_acknowledgement = v_requires_material,
           updated_at = p_now
     where id = p_draft_id
       and status = 'DRAFT'::public.briefing_status
     returning id into v_id;

    if v_id is null then
      raise exception 'briefing draft not editable' using errcode = '42501';
    end if;
  end if;

  delete from public.briefing_audiences where briefing_id = v_id;
  insert into public.briefing_audiences (briefing_id, audience_id)
  select v_id, a.id
    from public.audiences a
   where a.active = true
     and a.code = any(v_audiences)
  on conflict (briefing_id, audience_id) do nothing;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_publish_avop(
  p_actor_profile_id uuid,
  p_avop_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_avop public.avops%rowtype;
  v_snapshot_id uuid;
  v_applicable_count integer;
  v_audience_snapshot jsonb;
begin
  perform internal.assert_management_actor(p_actor_profile_id);
  if p_avop_id is null then
    raise exception 'invalid AVOP publication' using errcode = '22023';
  end if;

  select * into v_avop from public.avops where id = p_avop_id for update;
  if not found then
    raise exception 'invalid AVOP publication' using errcode = '22023';
  end if;

  if v_avop.status = 'PUBLISHED'::public.avop_status then
    select id, applicable_profile_count into v_snapshot_id, v_applicable_count
      from public.avop_publication_snapshots where avop_id = p_avop_id;
    if v_snapshot_id is null then
      raise exception 'published AVOP missing snapshot' using errcode = '23514';
    end if;
    return jsonb_build_object('ok', true, 'id', p_avop_id, 'snapshot_id', v_snapshot_id, 'applicable_profile_count', v_applicable_count, 'already_published', true);
  end if;

  if v_avop.status <> 'DRAFT'::public.avop_status then
    raise exception 'AVOP is not publishable' using errcode = '42501';
  end if;

  with selected as (
    select a.id, a.code, a.name
      from public.avop_audiences aa
      join public.audiences a on a.id = aa.audience_id
     where aa.avop_id = p_avop_id
       and a.active = true
  )
  select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name) order by code)
    into v_audience_snapshot
    from selected;

  if v_audience_snapshot is null then
    raise exception 'AVOP publication requires audience' using errcode = '22023';
  end if;

  with selected as (
    select a.id, a.code, a.name
      from public.avop_audiences aa
      join public.audiences a on a.id = aa.audience_id
     where aa.avop_id = p_avop_id
       and a.active = true
  ), applicable as (
    select p.id as profile_id
      from selected s
      join public.profiles p on p.active = true
     where s.code = 'TODOS'
    union
    select p.id as profile_id
      from selected s
      join public.profile_audiences pa on pa.audience_id = s.id
      join public.profiles p on p.id = pa.profile_id and p.active = true
     where s.code <> 'TODOS'
       and (pa.valid_from is null or pa.valid_from <= (p_now at time zone 'America/Sao_Paulo')::date)
       and (pa.valid_to is null or pa.valid_to >= (p_now at time zone 'America/Sao_Paulo')::date)
  )
  select count(distinct profile_id) into v_applicable_count from applicable;

  if v_applicable_count <= 0 then
    raise exception 'AVOP publication has no applicable profiles' using errcode = '22023';
  end if;

  update public.avops set status = 'PUBLISHED'::public.avop_status, updated_at = p_now where id = p_avop_id;

  insert into public.avop_publication_snapshots (avop_id, published_at, audience_snapshot, applicable_profile_count, created_by, created_at, updated_at)
  values (p_avop_id, p_now, v_audience_snapshot, v_applicable_count, p_actor_profile_id, p_now, p_now)
  returning id into v_snapshot_id;

  insert into public.avop_publication_snapshot_members (
    snapshot_id, avop_id, profile_id, audience_id, trigram_snapshot, name_snapshot, email_snapshot,
    audience_code_snapshot, audience_name_snapshot, profile_active_snapshot, applicable_profile_source,
    valid_from, valid_to, created_at
  )
  with selected as (
    select a.id, a.code, a.name
      from public.avop_audiences aa
      join public.audiences a on a.id = aa.audience_id
     where aa.avop_id = p_avop_id
       and a.active = true
  ), applicable as (
    select p.id as profile_id, p.trigram, p.name as profile_name, p.email, p.active,
           s.id as audience_id, s.code as audience_code, s.name as audience_name,
           null::date as valid_from, null::date as valid_to
      from selected s
      join public.profiles p on p.active = true
     where s.code = 'TODOS'
    union all
    select p.id as profile_id, p.trigram, p.name as profile_name, p.email, p.active,
           s.id as audience_id, s.code as audience_code, s.name as audience_name,
           pa.valid_from, pa.valid_to
      from selected s
      join public.profile_audiences pa on pa.audience_id = s.id
      join public.profiles p on p.id = pa.profile_id and p.active = true
     where s.code <> 'TODOS'
       and (pa.valid_from is null or pa.valid_from <= (p_now at time zone 'America/Sao_Paulo')::date)
       and (pa.valid_to is null or pa.valid_to >= (p_now at time zone 'America/Sao_Paulo')::date)
  )
  select v_snapshot_id, p_avop_id, profile_id, audience_id, trigram, profile_name, email,
         audience_code, audience_name, active, 'CURRENT_PROFILE_AUDIENCE', valid_from, valid_to, p_now
    from applicable
  on conflict (snapshot_id, profile_id, audience_code_snapshot) do nothing;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, occurred_at, metadata)
  values (p_actor_profile_id, 'AVOP_PUBLISHED', 'avop', p_avop_id::text, p_now, jsonb_build_object('snapshot_id', v_snapshot_id, 'applicable_profile_count', v_applicable_count));

  return jsonb_build_object('ok', true, 'id', p_avop_id, 'snapshot_id', v_snapshot_id, 'applicable_profile_count', v_applicable_count, 'already_published', false);
end;
$$;

create or replace function public.admin_publish_briefing(
  p_actor_profile_id uuid,
  p_briefing_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_briefing public.briefings%rowtype;
  v_snapshot_id uuid;
  v_applicable_count integer;
  v_audience_snapshot jsonb;
begin
  perform internal.assert_management_actor(p_actor_profile_id);
  if p_briefing_id is null then
    raise exception 'invalid briefing publication' using errcode = '22023';
  end if;

  select * into v_briefing from public.briefings where id = p_briefing_id for update;
  if not found then
    raise exception 'invalid briefing publication' using errcode = '22023';
  end if;

  if v_briefing.status = 'OPEN'::public.briefing_status then
    select id, applicable_profile_count into v_snapshot_id, v_applicable_count
      from public.briefing_publication_snapshots where briefing_id = p_briefing_id;
    if v_snapshot_id is null then
      raise exception 'open briefing missing snapshot' using errcode = '23514';
    end if;
    return jsonb_build_object('ok', true, 'id', p_briefing_id, 'snapshot_id', v_snapshot_id, 'applicable_profile_count', v_applicable_count, 'already_published', true);
  end if;

  if v_briefing.status <> 'DRAFT'::public.briefing_status then
    raise exception 'briefing is not publishable' using errcode = '42501';
  end if;

  with selected as (
    select a.id, a.code, a.name
      from public.briefing_audiences ba
      join public.audiences a on a.id = ba.audience_id
     where ba.briefing_id = p_briefing_id
       and a.active = true
  )
  select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name) order by code)
    into v_audience_snapshot
    from selected;

  if v_audience_snapshot is null then
    raise exception 'briefing publication requires audience' using errcode = '22023';
  end if;

  with selected as (
    select a.id, a.code, a.name
      from public.briefing_audiences ba
      join public.audiences a on a.id = ba.audience_id
     where ba.briefing_id = p_briefing_id
       and a.active = true
  ), applicable as (
    select p.id as profile_id
      from selected s
      join public.profiles p on p.active = true
     where s.code = 'TODOS'
    union
    select p.id as profile_id
      from selected s
      join public.profile_audiences pa on pa.audience_id = s.id
      join public.profiles p on p.id = pa.profile_id and p.active = true
     where s.code <> 'TODOS'
       and (pa.valid_from is null or pa.valid_from <= (p_now at time zone 'America/Sao_Paulo')::date)
       and (pa.valid_to is null or pa.valid_to >= (p_now at time zone 'America/Sao_Paulo')::date)
  )
  select count(distinct profile_id) into v_applicable_count from applicable;

  if v_applicable_count <= 0 then
    raise exception 'briefing publication has no applicable profiles' using errcode = '22023';
  end if;

  update public.briefings set status = 'OPEN'::public.briefing_status, updated_at = p_now where id = p_briefing_id;

  insert into public.briefing_publication_snapshots (briefing_id, opened_at, audience_snapshot, applicable_profile_count, created_by, created_at, updated_at)
  values (p_briefing_id, p_now, v_audience_snapshot, v_applicable_count, p_actor_profile_id, p_now, p_now)
  returning id into v_snapshot_id;

  insert into public.briefing_publication_snapshot_members (
    snapshot_id, briefing_id, profile_id, audience_id, trigram_snapshot, name_snapshot, email_snapshot,
    audience_code_snapshot, audience_name_snapshot, profile_active_snapshot, applicable_profile_source,
    valid_from, valid_to, created_at
  )
  with selected as (
    select a.id, a.code, a.name
      from public.briefing_audiences ba
      join public.audiences a on a.id = ba.audience_id
     where ba.briefing_id = p_briefing_id
       and a.active = true
  ), applicable as (
    select p.id as profile_id, p.trigram, p.name as profile_name, p.email, p.active,
           s.id as audience_id, s.code as audience_code, s.name as audience_name,
           null::date as valid_from, null::date as valid_to
      from selected s
      join public.profiles p on p.active = true
     where s.code = 'TODOS'
    union all
    select p.id as profile_id, p.trigram, p.name as profile_name, p.email, p.active,
           s.id as audience_id, s.code as audience_code, s.name as audience_name,
           pa.valid_from, pa.valid_to
      from selected s
      join public.profile_audiences pa on pa.audience_id = s.id
      join public.profiles p on p.id = pa.profile_id and p.active = true
     where s.code <> 'TODOS'
       and (pa.valid_from is null or pa.valid_from <= (p_now at time zone 'America/Sao_Paulo')::date)
       and (pa.valid_to is null or pa.valid_to >= (p_now at time zone 'America/Sao_Paulo')::date)
  )
  select v_snapshot_id, p_briefing_id, profile_id, audience_id, trigram, profile_name, email,
         audience_code, audience_name, active, 'CURRENT_PROFILE_AUDIENCE', valid_from, valid_to, p_now
    from applicable
  on conflict (snapshot_id, profile_id, audience_code_snapshot) do nothing;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, occurred_at, metadata)
  values (p_actor_profile_id, 'BRIEFING_PUBLISHED', 'briefing', p_briefing_id::text, p_now, jsonb_build_object('snapshot_id', v_snapshot_id, 'applicable_profile_count', v_applicable_count));

  return jsonb_build_object('ok', true, 'id', p_briefing_id, 'snapshot_id', v_snapshot_id, 'applicable_profile_count', v_applicable_count, 'already_published', false);
end;
$$;

comment on function public.admin_save_avop_draft(uuid, uuid, jsonb, timestamptz) is 'Backend-only administrative draft upsert for AVOPs. Browser roles have no EXECUTE grant.';
comment on function public.admin_publish_avop(uuid, uuid, timestamptz) is 'Backend-only transactional AVOP publication with nominal audience snapshot and audit event.';
comment on function public.admin_save_briefing_draft(uuid, uuid, jsonb, timestamptz) is 'Backend-only administrative draft upsert for briefings/aprontos. Browser roles have no EXECUTE grant.';
comment on function public.admin_publish_briefing(uuid, uuid, timestamptz) is 'Backend-only transactional briefing publication with nominal audience snapshot and audit event.';

revoke all on function internal.assert_management_actor(uuid) from public, anon, authenticated;
revoke all on function internal.normalized_publication_audiences(jsonb) from public, anon, authenticated;
revoke all on function internal.assert_publication_audiences(text[]) from public, anon, authenticated;
revoke all on function public.admin_save_avop_draft(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_publish_avop(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_save_briefing_draft(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_publish_briefing(uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function internal.assert_management_actor(uuid) to service_role;
grant execute on function internal.normalized_publication_audiences(jsonb) to service_role;
grant execute on function internal.assert_publication_audiences(text[]) to service_role;
grant execute on function public.admin_save_avop_draft(uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.admin_publish_avop(uuid, uuid, timestamptz) to service_role;
grant execute on function public.admin_save_briefing_draft(uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.admin_publish_briefing(uuid, uuid, timestamptz) to service_role;

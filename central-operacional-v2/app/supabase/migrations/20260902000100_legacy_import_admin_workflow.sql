-- Administrative legacy import workflow.
--
-- Preview writes only to historical_import_* staging tables. Definitive
-- operational writes happen exclusively through admin_apply_legacy_import_batch,
-- which locks the batch row, validates the server-side confirmation token hash,
-- applies staged rows in one transaction and records a sanitized audit event.

alter table public.historical_import_batches
  add column if not exists validation_fingerprint text,
  add column if not exists confirmation_token_hash text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by uuid references public.profiles(id),
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references public.profiles(id),
  add column if not exists result_summary jsonb not null default '{}'::jsonb;

alter table public.historical_import_batches
  add constraint historical_import_batches_validation_fingerprint_chk
    check (validation_fingerprint is null or validation_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint historical_import_batches_confirmation_token_hash_chk
    check (confirmation_token_hash is null or confirmation_token_hash ~ '^[0-9a-f]{64}$'),
  add constraint historical_import_batches_result_summary_object_chk
    check (jsonb_typeof(result_summary) = 'object'),
  add constraint historical_import_batches_admin_status_chk
    check (status in ('OPEN', 'VALIDATED', 'APPLIED', 'CANCELED', 'FAILED'));

comment on column public.historical_import_batches.validation_fingerprint is
  'SHA-256 fingerprint of the parsed file and validation parameters. Changing the file or import kind creates a different confirmation context.';
comment on column public.historical_import_batches.confirmation_token_hash is
  'SHA-256 hash of an opaque server-generated confirmation token. The raw token is never stored.';
comment on column public.historical_import_batches.result_summary is
  'Sanitized operational result totals; no complete personal content, secrets, tokens or raw files.';

create index if not exists historical_import_batches_admin_status_idx
  on public.historical_import_batches using btree (status, created_at);

create or replace function internal.assert_legacy_import_admin(p_actor_profile_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if not exists (
    select 1
      from public.profiles p
      join public.profile_roles r on r.profile_id = p.id
     where p.id = p_actor_profile_id
       and p.active
       and r.role = 'ADMIN'
  ) then
    raise exception 'admin actor required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_apply_legacy_import_batch(
  p_actor_profile_id uuid,
  p_batch_id uuid,
  p_confirmation_token_hash text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_batch public.historical_import_batches%rowtype;
  v_record public.historical_import_staging_records%rowtype;
  v_payload jsonb;
  v_profile_id uuid;
  v_activity_id uuid;
  v_audience_id uuid;
  v_audience_code text;
  v_audit_id uuid;
  v_totals jsonb := '{}'::jsonb;
  v_applied integer := 0;
begin
  perform internal.assert_legacy_import_admin(p_actor_profile_id);

  if p_confirmation_token_hash is null or p_confirmation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid confirmation token' using errcode = '22023';
  end if;

  select *
    into v_batch
    from public.historical_import_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'batch not found' using errcode = '02000';
  end if;

  if v_batch.status = 'APPLIED' then
    return coalesce(v_batch.result_summary, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'already_applied', true, 'batch_id', v_batch.id);
  end if;

  if v_batch.status <> 'VALIDATED' or v_batch.applied_at is not null then
    raise exception 'batch is not ready' using errcode = '22023';
  end if;

  if v_batch.confirmation_token_hash is distinct from p_confirmation_token_hash then
    raise exception 'invalid confirmation token' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.historical_import_staging_records r
     where r.batch_id = p_batch_id
       and r.classification <> 'valid'
  ) then
    raise exception 'batch has unresolved records' using errcode = '22023';
  end if;

  for v_record in
    select *
      from public.historical_import_staging_records
     where batch_id = p_batch_id
     order by source_record_type, source_row_number nulls last, id
  loop
    v_payload := coalesce(v_record.normalized_content, '{}'::jsonb);

    if v_record.source_record_type = 'EFETIVO' then
      if exists (
        select 1
          from public.profiles p
          join public.profile_roles r on r.profile_id = p.id
         where p.trigram = v_payload->>'trigram'
           and r.role = 'ADMIN'
      ) then
        raise exception 'admin profile cannot be imported' using errcode = '42501';
      end if;

      insert into public.profiles (trigram, name, email, active, created_at, updated_at)
      values (
        v_payload->>'trigram',
        v_payload->>'name',
        nullif(v_payload->>'email', ''),
        coalesce((v_payload->>'active')::boolean, true),
        p_now,
        p_now
      )
      on conflict (trigram) do update
        set name = excluded.name,
            email = excluded.email,
            active = excluded.active,
            updated_at = p_now
      returning id into v_profile_id;

      insert into public.profile_roles (profile_id, role, assigned_by, assigned_at, reason)
      values (v_profile_id, 'USER', p_actor_profile_id, p_now, 'LEGACY_IMPORT')
      on conflict (profile_id, role) do nothing;

      for v_audience_code in
        select jsonb_array_elements_text(coalesce(v_payload->'audiences', '[]'::jsonb))
      loop
        select id into v_audience_id from public.audiences where code = v_audience_code and active;
        if v_audience_id is null then
          raise exception 'unknown audience' using errcode = '22023';
        end if;
        insert into public.profile_audiences (profile_id, audience_id, valid_from)
        values (v_profile_id, v_audience_id, p_now::date)
        on conflict (profile_id, audience_id) do nothing;
      end loop;

    elsif v_record.source_record_type = 'AVOPS' then
      insert into public.avops (
        number, title, publication_date, drive_url, drive_file_id,
        status, requires_acknowledgement, created_at, updated_at
      )
      values (
        v_payload->>'number',
        v_payload->>'title',
        (v_payload->>'publicationDate')::date,
        coalesce(v_payload->>'webappUrl', ''),
        nullif(v_payload->>'driveFileId', ''),
        case when v_payload->>'status' = 'FECHADO' then 'CLOSED'::public.avop_status else 'PUBLISHED'::public.avop_status end,
        coalesce((v_payload->>'requiresAcknowledgement')::boolean, true),
        p_now,
        p_now
      )
      on conflict (number) do nothing
      returning id into v_activity_id;

      if v_activity_id is null then
        select id into v_activity_id from public.avops where number = v_payload->>'number';
      end if;

      for v_audience_code in
        select jsonb_array_elements_text(coalesce(v_payload->'targetAudiences', '[]'::jsonb))
      loop
        select id into v_audience_id from public.audiences where code = v_audience_code and active;
        if v_audience_id is null then
          raise exception 'unknown audience' using errcode = '22023';
        end if;
        insert into public.avop_audiences (avop_id, audience_id)
        values (v_activity_id, v_audience_id)
        on conflict (avop_id, audience_id) do nothing;
      end loop;

    elsif v_record.source_record_type = 'APRONTOS' then
      insert into public.briefings (
        legacy_id, title, event_date, drive_url, drive_file_id,
        requires_material_acknowledgement, status, created_at, updated_at
      )
      values (
        v_payload->>'briefingId',
        v_payload->>'title',
        (v_payload->>'eventDate')::date,
        nullif(v_payload->>'materialUrl', ''),
        nullif(v_payload->>'driveFileId', ''),
        coalesce((v_payload->>'requiresMaterialAcknowledgement')::boolean, false),
        case when v_payload->>'status' = 'FECHADO' then 'CLOSED'::public.briefing_status else 'OPEN'::public.briefing_status end,
        p_now,
        p_now
      )
      on conflict (legacy_id) do nothing
      returning id into v_activity_id;

      if v_activity_id is null then
        select id into v_activity_id from public.briefings where legacy_id = v_payload->>'briefingId';
      end if;

      for v_audience_code in
        select jsonb_array_elements_text(coalesce(v_payload->'targetAudiences', '[]'::jsonb))
      loop
        select id into v_audience_id from public.audiences where code = v_audience_code and active;
        if v_audience_id is null then
          raise exception 'unknown audience' using errcode = '22023';
        end if;
        insert into public.briefing_audiences (briefing_id, audience_id)
        values (v_activity_id, v_audience_id)
        on conflict (briefing_id, audience_id) do nothing;
      end loop;

    elsif v_record.source_record_type in ('OI_H50', 'OI_H125') then
      insert into public.ois (
        aircraft, oi_key, program, subprogram, phase_id, title, drive_url,
        drive_file_id, start_page, end_page, display_key, active, mission_codes
      )
      values (
        v_payload->>'aircraft',
        v_payload->>'oiKey',
        v_payload->>'program',
        v_payload->>'subprogram',
        v_payload->>'phaseId',
        v_payload->>'title',
        v_payload->>'driveUrl',
        nullif(v_payload->>'driveFileId', ''),
        (v_payload->>'startPage')::integer,
        nullif(v_payload->>'endPage', '')::integer,
        v_payload->>'displayKey',
        coalesce((v_payload->>'active')::boolean, true),
        array(select jsonb_array_elements_text(coalesce(v_payload->'missionCodes', '[]'::jsonb)))
      )
      on conflict (aircraft, oi_key) do nothing;

    elsif v_record.source_record_type = 'LEITURAS' then
      select p.id into v_profile_id
        from public.profiles p
       where p.trigram = v_payload->>'trigram';
      select a.id into v_activity_id
        from public.avops a
       where a.number = v_payload->>'avopNumber';
      if v_profile_id is null or v_activity_id is null then
        raise exception 'missing acknowledgement reference' using errcode = '22023';
      end if;
      insert into public.avop_acknowledgements (avop_id, profile_id, acknowledged_at, legacy_source)
      values (
        v_activity_id,
        v_profile_id,
        coalesce(nullif(v_payload->>'acknowledgedAt', '')::timestamptz, p_now),
        jsonb_build_object('batch_id', p_batch_id, 'source', 'LEGACY_IMPORT')
      )
      on conflict (avop_id, profile_id) do nothing;

    elsif v_record.source_record_type = 'PRESENCAS' then
      select p.id into v_profile_id
        from public.profiles p
       where p.trigram = v_payload->>'trigram';
      select b.id into v_activity_id
        from public.briefings b
       where b.legacy_id = v_payload->>'briefingId';
      if v_profile_id is null or v_activity_id is null then
        raise exception 'missing briefing reference' using errcode = '22023';
      end if;
      if coalesce((v_payload->>'hasAttendance')::boolean, false)
        or coalesce((v_payload->>'hasAbsence')::boolean, false)
      then
        insert into public.briefing_records (
          briefing_id, profile_id, attendance_status, material_acknowledged, recorded_at, legacy_source
        )
        values (
          v_activity_id,
          v_profile_id,
          v_payload->>'attendanceStatus',
          coalesce((v_payload->>'materialAcknowledged')::boolean, false),
          coalesce(nullif(v_payload->>'recordedAt', '')::timestamptz, p_now),
          jsonb_build_object('batch_id', p_batch_id, 'source', 'LEGACY_IMPORT')
        )
        on conflict (briefing_id, profile_id) do nothing;
      end if;
      if nullif(v_payload->>'justificationText', '') is not null then
        insert into public.absence_justifications (briefing_id, profile_id, text, created_at, updated_at)
        values (v_activity_id, v_profile_id, v_payload->>'justificationText', p_now, p_now)
        on conflict do nothing;
      end if;
    end if;

    update public.historical_import_staging_records
       set classification = 'imported',
           migrated = true,
           resolved_at = p_now,
           resolved_by = p_actor_profile_id,
           updated_at = p_now
     where id = v_record.id;

    v_applied := v_applied + 1;
  end loop;

  v_totals := jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'batch_id', p_batch_id,
    'applied_records', v_applied
  );

  update public.historical_import_batches
     set status = 'APPLIED',
         dry_run = false,
         migrated = true,
         applied_at = p_now,
         applied_by = p_actor_profile_id,
         result_summary = v_totals,
         updated_at = p_now
   where id = p_batch_id;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, occurred_at, metadata)
  values (
    p_actor_profile_id,
    'LEGACY_IMPORT_APPLIED',
    'historical_import_batch',
    p_batch_id::text,
    p_now,
    jsonb_build_object('batch_id', p_batch_id, 'applied_records', v_applied)
  )
  returning id into v_audit_id;

  return v_totals || jsonb_build_object('audit_id', v_audit_id);
end;
$$;

comment on function public.admin_apply_legacy_import_batch(uuid, uuid, text, timestamptz) is
  'Backend-only transactional application of a validated legacy import batch. Browser roles have no EXECUTE grant.';

alter table public.historical_import_batches enable row level security;
alter table public.historical_import_staging_records enable row level security;

revoke all on function internal.assert_legacy_import_admin(uuid) from public, anon, authenticated;
revoke all on function public.admin_apply_legacy_import_batch(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function internal.assert_legacy_import_admin(uuid) to service_role;
grant execute on function public.admin_apply_legacy_import_batch(uuid, uuid, text, timestamptz) to service_role;

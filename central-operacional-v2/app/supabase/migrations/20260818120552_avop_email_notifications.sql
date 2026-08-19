-- Adds the persistent state required by the V2 AVOP disclosure/reminder job.
-- The job remains backend-only: the browser never receives grants or policies.

alter table public.notification_schedule
  add column if not exists notification_type text not null default 'AVOP_INITIAL',
  add column if not exists marker text not null default 'INITIAL',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists failed_attempt_count integer not null default 0,
  add column if not exists reserved_at timestamptz,
  add column if not exists reserved_until timestamptz,
  add column if not exists reservation_token_hash text,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists permanent_failure_at timestamptz,
  add column if not exists stopped_at timestamptz,
  add column if not exists stopped_reason text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.notification_schedule
  add constraint notification_schedule_activity_type_chk
    check (activity_type in ('AVOP')) not valid,
  add constraint notification_schedule_notification_type_chk
    check (notification_type in ('AVOP_INITIAL', 'AVOP_REMINDER', 'AVOP_SKIPPED')) not valid,
  add constraint notification_schedule_marker_chk
    check (marker ~ '^(INITIAL|WEEK_(7|14|21|28)|MONTH_([2-9]|[1-9][0-9]+))$') not valid,
  add constraint notification_schedule_attempts_chk
    check (attempt_count >= 0 and failed_attempt_count >= 0 and failed_attempt_count <= attempt_count) not valid,
  add constraint notification_schedule_reservation_hash_chk
    check (reservation_token_hash is null or reservation_token_hash ~ '^[0-9a-f]{64}$') not valid,
  add constraint notification_schedule_reservation_period_chk
    check (reserved_until is null or reserved_at is not null) not valid,
  add constraint notification_schedule_stop_reason_chk
    check (stopped_reason is null or stopped_reason in (
      'ACKNOWLEDGED',
      'AVOP_CLOSED',
      'PROFILE_INACTIVE',
      'NOT_APPLICABLE',
      'EXPIRED_365_DAYS',
      'PERMANENT_EMAIL_ERROR'
    )) not valid,
  add constraint notification_schedule_metadata_object_chk
    check (jsonb_typeof(metadata) = 'object') not valid;

alter table public.notification_log
  add column if not exists activity_type text not null default 'AVOP',
  add column if not exists activity_id uuid,
  add column if not exists profile_id uuid references public.profiles(id),
  add column if not exists marker text,
  add column if not exists idempotency_key text,
  add column if not exists error_kind text,
  add column if not exists attempt_number integer,
  add column if not exists reserved_at timestamptz;

alter table public.notification_log
  add constraint notification_log_activity_type_chk
    check (activity_type in ('AVOP')) not valid,
  add constraint notification_log_notification_type_chk
    check (notification_type in ('AVOP_INITIAL', 'AVOP_REMINDER', 'AVOP_SKIPPED')) not valid,
  add constraint notification_log_marker_chk
    check (marker is null or marker ~ '^(INITIAL|WEEK_(7|14|21|28)|MONTH_([2-9]|[1-9][0-9]+))$') not valid,
  add constraint notification_log_result_chk
    check (result in ('SENT', 'DRY_RUN', 'TEMPORARY_ERROR', 'PERMANENT_ERROR', 'SKIPPED')) not valid,
  add constraint notification_log_error_kind_chk
    check (error_kind is null or error_kind in ('TEMPORARY', 'PERMANENT', 'CONFIGURATION', 'VALIDATION')) not valid,
  add constraint notification_log_idempotency_key_chk
    check (idempotency_key is null or idempotency_key ~ '^[0-9a-f]{64}$') not valid,
  add constraint notification_log_attempt_number_chk
    check (attempt_number is null or attempt_number >= 1) not valid,
  add constraint notification_log_metadata_object_chk
    check (jsonb_typeof(metadata) = 'object') not valid;

create unique index if not exists notification_log_idempotency_key_unique
  on public.notification_log using btree (idempotency_key)
  where idempotency_key is not null;

create index if not exists notification_schedule_due_reservation_idx
  on public.notification_schedule using btree (status, next_send_at, reserved_until)
  where status = 'ACTIVE'::public.notification_status;

create index if not exists notification_log_activity_marker_idx
  on public.notification_log using btree (activity_type, activity_id, profile_id, marker, result);

create or replace function public.reserve_avop_notification(
  p_activity_id uuid,
  p_profile_id uuid,
  p_notification_type text,
  p_marker text,
  p_next_send_at timestamptz,
  p_reservation_token_hash text,
  p_reserved_until timestamptz,
  p_now timestamptz default now()
)
returns table (
  schedule_id uuid,
  reserved boolean,
  already_completed boolean
)
language plpgsql
security invoker
set search_path = 'pg_catalog', 'pg_temp'
as $$
declare
  v_schedule_id uuid;
begin
  if p_activity_id is null or p_profile_id is null then
    raise exception 'invalid notification identity' using errcode = '22023';
  end if;
  if p_notification_type not in ('AVOP_INITIAL', 'AVOP_REMINDER', 'AVOP_SKIPPED') then
    raise exception 'invalid notification type' using errcode = '22023';
  end if;
  if p_marker !~ '^(INITIAL|WEEK_(7|14|21|28)|MONTH_([2-9]|[1-9][0-9]+))$' then
    raise exception 'invalid notification marker' using errcode = '22023';
  end if;
  if p_reservation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid reservation token' using errcode = '22023';
  end if;
  if p_reserved_until <= p_now then
    raise exception 'invalid reservation period' using errcode = '22023';
  end if;

  insert into public.notification_schedule (
    activity_type,
    activity_id,
    profile_id,
    notification_type,
    marker,
    next_send_at,
    status,
    created_at,
    updated_at
  )
  values ('AVOP', p_activity_id, p_profile_id, p_notification_type, p_marker, p_now, 'ACTIVE'::public.notification_status, p_now, p_now)
  on conflict (activity_type, activity_id, profile_id)
  do update set
    notification_type = excluded.notification_type,
    marker = excluded.marker,
    next_send_at = least(coalesce(public.notification_schedule.next_send_at, excluded.next_send_at), excluded.next_send_at),
    updated_at = p_now
  returning id into v_schedule_id;

  if exists (
    select 1
      from public.notification_log nl
     where nl.activity_type = 'AVOP'
       and nl.activity_id = p_activity_id
       and nl.profile_id = p_profile_id
       and nl.marker = p_marker
       and nl.result in ('SENT', 'DRY_RUN')
  ) then
    schedule_id := v_schedule_id;
    reserved := false;
    already_completed := true;
    return next;
    return;
  end if;

  update public.notification_schedule ns
     set reserved_at = p_now,
         reserved_until = p_reserved_until,
         reservation_token_hash = p_reservation_token_hash,
         notification_type = p_notification_type,
         marker = p_marker,
         last_attempt_at = p_now,
         attempt_count = attempt_count + 1,
         updated_at = p_now
   where ns.id = v_schedule_id
     and ns.status = 'ACTIVE'::public.notification_status
     and ns.permanent_failure_at is null
     and (ns.reserved_until is null or ns.reserved_until <= p_now or ns.reservation_token_hash = p_reservation_token_hash);

  schedule_id := v_schedule_id;
  reserved := found;
  already_completed := false;
  return next;
end;
$$;

create or replace function public.record_avop_notification_result(
  p_schedule_id uuid,
  p_activity_id uuid,
  p_profile_id uuid,
  p_recipient text,
  p_notification_type text,
  p_marker text,
  p_result text,
  p_idempotency_key text,
  p_provider_message_id text default null,
  p_error text default null,
  p_error_kind text default null,
  p_next_send_at timestamptz default null,
  p_stop_reason text default null,
  p_now timestamptz default now()
)
returns table (
  schedule_id uuid,
  logged boolean,
  stopped boolean
)
language plpgsql
security invoker
set search_path = 'pg_catalog', 'pg_temp'
as $$
declare
  v_attempt_number integer;
  v_logged boolean := false;
  v_row_count integer := 0;
begin
  if p_schedule_id is null or p_activity_id is null or p_profile_id is null then
    raise exception 'invalid notification identity' using errcode = '22023';
  end if;
  if p_recipient is null or length(trim(p_recipient)) = 0 or length(p_recipient) > 320 then
    raise exception 'invalid recipient' using errcode = '22023';
  end if;
  if p_notification_type not in ('AVOP_INITIAL', 'AVOP_REMINDER', 'AVOP_SKIPPED') then
    raise exception 'invalid notification type' using errcode = '22023';
  end if;
  if p_marker !~ '^(INITIAL|WEEK_(7|14|21|28)|MONTH_([2-9]|[1-9][0-9]+))$' then
    raise exception 'invalid marker' using errcode = '22023';
  end if;
  if p_result not in ('SENT', 'DRY_RUN', 'TEMPORARY_ERROR', 'PERMANENT_ERROR', 'SKIPPED') then
    raise exception 'invalid result' using errcode = '22023';
  end if;
  if p_idempotency_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_error_kind is not null and p_error_kind not in ('TEMPORARY', 'PERMANENT', 'CONFIGURATION', 'VALIDATION') then
    raise exception 'invalid error kind' using errcode = '22023';
  end if;

  select attempt_count
    into v_attempt_number
    from public.notification_schedule
   where id = p_schedule_id
   for update;

  if v_attempt_number is null then
    raise exception 'notification schedule not found' using errcode = '22023';
  end if;

  insert into public.notification_log (
    schedule_id,
    activity_type,
    activity_id,
    profile_id,
    recipient,
    notification_type,
    marker,
    attempted_at,
    result,
    provider_message_id,
    error,
    error_kind,
    attempt_number,
    idempotency_key,
    reserved_at,
    metadata
  )
  values (
    p_schedule_id,
    'AVOP',
    p_activity_id,
    p_profile_id,
    p_recipient,
    p_notification_type,
    p_marker,
    p_now,
    p_result,
    p_provider_message_id,
    p_error,
    p_error_kind,
    greatest(1, v_attempt_number),
    p_idempotency_key,
    p_now,
    '{}'::jsonb
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  get diagnostics v_row_count = row_count;
  v_logged := v_row_count > 0;

  update public.notification_schedule
     set last_sent_at = case when v_logged and p_result in ('SENT', 'DRY_RUN') then p_now else last_sent_at end,
         send_count = case when v_logged and p_result in ('SENT', 'DRY_RUN') then send_count + 1 else send_count end,
         failed_attempt_count = case when v_logged and p_result in ('TEMPORARY_ERROR', 'PERMANENT_ERROR') then failed_attempt_count + 1 else failed_attempt_count end,
         next_send_at = p_next_send_at,
         reserved_at = null,
         reserved_until = null,
         reservation_token_hash = null,
         permanent_failure_at = case when v_logged and p_result = 'PERMANENT_ERROR' then p_now else permanent_failure_at end,
         status = case when v_logged and (p_stop_reason is not null or p_result = 'PERMANENT_ERROR') then 'STOPPED'::public.notification_status else status end,
         stopped_at = case when v_logged and (p_stop_reason is not null or p_result = 'PERMANENT_ERROR') then p_now else stopped_at end,
         stopped_reason = case
           when v_logged then coalesce(p_stop_reason, case when p_result = 'PERMANENT_ERROR' then 'PERMANENT_EMAIL_ERROR' else null end, stopped_reason)
           else stopped_reason
         end,
         updated_at = p_now
   where id = p_schedule_id;

  schedule_id := p_schedule_id;
  logged := v_logged;
  stopped := v_logged and (p_stop_reason is not null or p_result = 'PERMANENT_ERROR');
  return next;
end;
$$;

create or replace function public.list_avop_notification_candidates(
  p_today date default current_date
)
returns table (
  avop_id uuid,
  avop_number text,
  title text,
  publication_date date,
  status public.avop_status,
  profile_id uuid,
  recipient_email text,
  profile_active boolean,
  applicable_now boolean,
  acknowledged boolean,
  sent_markers text[]
)
language sql
security invoker
set search_path = 'pg_catalog', 'pg_temp'
as $$
  with avop_audience_codes as (
    select aa.avop_id, array_agg(distinct au.code order by au.code) as audience_codes
      from public.avop_audiences aa
      join public.audiences au on au.id = aa.audience_id
     where au.active
     group by aa.avop_id
  ),
  active_profile_audiences as (
    select pa.profile_id, array_agg(distinct au.code order by au.code) as audience_codes
      from public.profile_audiences pa
      join public.audiences au on au.id = pa.audience_id
     where au.active
       and (pa.valid_from is null or pa.valid_from <= p_today)
       and (pa.valid_to is null or pa.valid_to >= p_today)
     group by pa.profile_id
  ),
  pairs as (
    select distinct a.id as avop_id, p.id as profile_id
      from public.avops a
      join public.profiles p on true
      left join avop_audience_codes aac on aac.avop_id = a.id
      left join active_profile_audiences apa on apa.profile_id = p.id
     where a.status in ('PUBLISHED'::public.avop_status, 'CLOSED'::public.avop_status)
       and (
         (
           p.active
           and (
             'TODOS' = any(coalesce(aac.audience_codes, array[]::text[]))
             or coalesce(aac.audience_codes, array[]::text[]) && coalesce(apa.audience_codes, array[]::text[])
           )
         )
         or exists (
           select 1
             from public.notification_schedule ns
            where ns.activity_type = 'AVOP'
              and ns.activity_id = a.id
              and ns.profile_id = p.id
              and ns.status = 'ACTIVE'::public.notification_status
         )
       )
  )
  select
    a.id as avop_id,
    a.number as avop_number,
    a.title,
    a.publication_date,
    a.status,
    p.id as profile_id,
    p.email as recipient_email,
    p.active as profile_active,
    (
      p.active
      and (
        'TODOS' = any(coalesce(aac.audience_codes, array[]::text[]))
        or coalesce(aac.audience_codes, array[]::text[]) && coalesce(apa.audience_codes, array[]::text[])
      )
    ) as applicable_now,
    exists (
      select 1
        from public.avop_acknowledgements ack
       where ack.avop_id = a.id
         and ack.profile_id = p.id
    ) as acknowledged,
    coalesce((
      select array_agg(distinct nl.marker order by nl.marker)
        from public.notification_log nl
       where nl.activity_type = 'AVOP'
         and nl.activity_id = a.id
         and nl.profile_id = p.id
         and nl.marker is not null
         and nl.result in ('SENT', 'DRY_RUN')
    ), array[]::text[]) as sent_markers
    from pairs
    join public.avops a on a.id = pairs.avop_id
    join public.profiles p on p.id = pairs.profile_id
    left join avop_audience_codes aac on aac.avop_id = a.id
    left join active_profile_audiences apa on apa.profile_id = p.id
   order by a.publication_date, a.number, p.id;
$$;

revoke execute on function public.reserve_avop_notification(uuid, uuid, text, text, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_avop_notification_result(uuid, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.list_avop_notification_candidates(date) from public, anon, authenticated;
grant execute on function public.reserve_avop_notification(uuid, uuid, text, text, timestamptz, text, timestamptz, timestamptz) to service_role;
grant execute on function public.record_avop_notification_result(uuid, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, text, timestamptz) to service_role;
grant execute on function public.list_avop_notification_candidates(date) to service_role;

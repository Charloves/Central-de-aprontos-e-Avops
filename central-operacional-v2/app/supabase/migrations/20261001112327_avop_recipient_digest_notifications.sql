-- Reserves and records one recipient digest atomically while preserving one
-- schedule and one log entry for each AVOP/marker included in the message.

create or replace function public.reserve_avop_notification_digest(
  p_profile_id uuid,
  p_items jsonb,
  p_reservation_token_hash text,
  p_reserved_until timestamptz,
  p_now timestamptz default now()
)
returns table (
  schedule_id uuid,
  activity_id uuid,
  notification_type text,
  marker text,
  next_send_at timestamptz
)
language plpgsql
security invoker
set search_path = 'pg_catalog', 'pg_temp'
as $$
declare
  v_item_count integer;
  v_reserved_count integer;
begin
  if p_profile_id is null
     or p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or p_now is null
     or p_reserved_until is null
     or p_reservation_token_hash is null
     or p_reservation_token_hash !~ '^[0-9a-f]{64}$'
     or p_reserved_until <= p_now then
    raise exception 'invalid digest reservation' using errcode = '22023';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 100 then
    raise exception 'invalid digest item count' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_items) as item(
        activity_id uuid,
        notification_type text,
        marker text,
        next_send_at timestamptz
      )
     where item.activity_id is null
        or item.notification_type not in ('AVOP_INITIAL', 'AVOP_REMINDER')
        or item.marker !~ '^(INITIAL|WEEK_(7|14|21|28)|MONTH_([2-9]|[1-9][0-9]+))$'
  ) then
    raise exception 'invalid digest item' using errcode = '22023';
  end if;

  if (
    select count(*)
      from (
        select distinct item.activity_id, item.marker
          from jsonb_to_recordset(p_items) as item(
            activity_id uuid,
            notification_type text,
            marker text,
            next_send_at timestamptz
          )
      ) unique_items
  ) <> v_item_count then
    raise exception 'duplicate digest item' using errcode = '22023';
  end if;

  -- Serializes all digest reservations for the same recipient profile.
  perform 1
    from public.profiles p
   where p.id = p_profile_id
   for update;
  if not found then
    raise exception 'notification profile not found' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_items) as item(
        activity_id uuid,
        notification_type text,
        marker text,
        next_send_at timestamptz
      )
      left join public.notification_schedule ns
        on ns.activity_type = 'AVOP'
       and ns.activity_id = item.activity_id
       and ns.profile_id = p_profile_id
     where coalesce(ns.status <> 'ACTIVE'::public.notification_status, false)
        or ns.permanent_failure_at is not null
        or (
          ns.reserved_until > p_now
          and ns.reservation_token_hash is distinct from p_reservation_token_hash
        )
        or exists (
          select 1
            from public.notification_log nl
           where nl.activity_type = 'AVOP'
             and nl.activity_id = item.activity_id
             and nl.profile_id = p_profile_id
             and nl.marker = item.marker
             and nl.result = 'SENT'
        )
  ) then
    return;
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
  select
    'AVOP',
    item.activity_id,
    p_profile_id,
    item.notification_type,
    item.marker,
    p_now,
    'ACTIVE'::public.notification_status,
    p_now,
    p_now
  from jsonb_to_recordset(p_items) as item(
    activity_id uuid,
    notification_type text,
    marker text,
    next_send_at timestamptz
  )
  on conflict (activity_type, activity_id, profile_id)
  do update set
    notification_type = excluded.notification_type,
    marker = excluded.marker,
    next_send_at = least(coalesce(public.notification_schedule.next_send_at, excluded.next_send_at), excluded.next_send_at),
    updated_at = p_now;

  return query
  update public.notification_schedule ns
     set reserved_at = p_now,
         reserved_until = p_reserved_until,
         reservation_token_hash = p_reservation_token_hash,
         notification_type = item.notification_type,
         marker = item.marker,
         last_attempt_at = p_now,
         attempt_count = ns.attempt_count + 1,
         updated_at = p_now
    from jsonb_to_recordset(p_items) as item(
      activity_id uuid,
      notification_type text,
      marker text,
      next_send_at timestamptz
    )
   where ns.activity_type = 'AVOP'
     and ns.activity_id = item.activity_id
     and ns.profile_id = p_profile_id
  returning ns.id, ns.activity_id, item.notification_type, item.marker, item.next_send_at;

  get diagnostics v_reserved_count = row_count;
  if v_reserved_count <> v_item_count then
    raise exception 'incomplete digest reservation' using errcode = '40001';
  end if;
end;
$$;

create or replace function public.record_avop_notification_digest_result(
  p_profile_id uuid,
  p_recipient text,
  p_reservation_token_hash text,
  p_digest_idempotency_key text,
  p_items jsonb,
  p_result text,
  p_provider_message_id text default null,
  p_error text default null,
  p_error_kind text default null,
  p_stop_reason text default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = 'pg_catalog', 'pg_temp'
as $$
declare
  v_item record;
  v_item_count integer;
  v_owned_count integer;
  v_logged boolean;
  v_stopped boolean;
  v_logged_count integer := 0;
  v_stopped_count integer := 0;
begin
  if p_profile_id is null
     or p_now is null
     or p_recipient is null
     or length(trim(p_recipient)) = 0
     or length(p_recipient) > 320
     or p_reservation_token_hash is null
     or p_reservation_token_hash !~ '^[0-9a-f]{64}$'
     or p_digest_idempotency_key is null
     or p_digest_idempotency_key !~ '^[0-9a-f]{64}$'
     or p_items is null
     or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid digest result' using errcode = '22023';
  end if;
  if p_result is null or p_result not in ('SENT', 'DRY_RUN', 'TEMPORARY_ERROR', 'PERMANENT_ERROR') then
    raise exception 'invalid digest result type' using errcode = '22023';
  end if;
  if p_error_kind is not null and p_error_kind not in ('TEMPORARY', 'PERMANENT', 'CONFIGURATION', 'VALIDATION') then
    raise exception 'invalid digest error kind' using errcode = '22023';
  end if;
  if p_stop_reason is not null and p_stop_reason <> 'PERMANENT_EMAIL_ERROR' then
    raise exception 'invalid digest stop reason' using errcode = '22023';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 100 then
    raise exception 'invalid digest item count' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_items) as item(
        schedule_id uuid,
        activity_id uuid,
        notification_type text,
        marker text,
        next_send_at timestamptz,
        idempotency_key text
      )
     where item.schedule_id is null
        or item.activity_id is null
        or item.notification_type not in ('AVOP_INITIAL', 'AVOP_REMINDER')
        or item.marker !~ '^(INITIAL|WEEK_(7|14|21|28)|MONTH_([2-9]|[1-9][0-9]+))$'
        or item.idempotency_key !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'invalid digest result item' using errcode = '22023';
  end if;

  if (
    select count(*)
      from (
        select distinct item.schedule_id, item.activity_id, item.marker
          from jsonb_to_recordset(p_items) as item(
            schedule_id uuid,
            activity_id uuid,
            notification_type text,
            marker text,
            next_send_at timestamptz,
            idempotency_key text
          )
      ) unique_items
  ) <> v_item_count then
    raise exception 'duplicate digest result item' using errcode = '22023';
  end if;

  perform ns.id
    from public.notification_schedule ns
    join jsonb_to_recordset(p_items) as item(
      schedule_id uuid,
      activity_id uuid,
      notification_type text,
      marker text,
      next_send_at timestamptz,
      idempotency_key text
    ) on item.schedule_id = ns.id
   order by ns.id
   for update of ns;

  select count(*)
    into v_owned_count
    from public.notification_schedule ns
    join jsonb_to_recordset(p_items) as item(
      schedule_id uuid,
      activity_id uuid,
      notification_type text,
      marker text,
      next_send_at timestamptz,
      idempotency_key text
    ) on item.schedule_id = ns.id
   where ns.activity_type = 'AVOP'
     and ns.activity_id = item.activity_id
     and ns.profile_id = p_profile_id
     and ns.reservation_token_hash = p_reservation_token_hash;

  if v_owned_count <> v_item_count then
    raise exception 'digest reservation ownership mismatch' using errcode = '40001';
  end if;

  for v_item in
    select item.*
      from jsonb_to_recordset(p_items) as item(
        schedule_id uuid,
        activity_id uuid,
        notification_type text,
        marker text,
        next_send_at timestamptz,
        idempotency_key text
      )
     order by item.schedule_id
  loop
    select result.logged, result.stopped
      into v_logged, v_stopped
      from public.record_avop_notification_result(
        v_item.schedule_id,
        v_item.activity_id,
        p_profile_id,
        p_recipient,
        v_item.notification_type,
        v_item.marker,
        p_result,
        v_item.idempotency_key,
        p_provider_message_id,
        p_error,
        p_error_kind,
        case
          when p_result = 'TEMPORARY_ERROR' then p_now
          when p_result = 'PERMANENT_ERROR' then null
          else v_item.next_send_at
        end,
        p_stop_reason,
        p_now
      ) result;

    if v_logged then
      v_logged_count := v_logged_count + 1;
      update public.notification_log nl
         set metadata = jsonb_build_object(
           'delivery', 'recipient_digest',
           'digest_key', p_digest_idempotency_key,
           'item_count', v_item_count
         )
       where nl.idempotency_key = v_item.idempotency_key;
    end if;
    if v_stopped then
      v_stopped_count := v_stopped_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'logged_count', v_logged_count,
    'stopped_count', v_stopped_count
  );
end;
$$;

comment on function public.reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz) is
  'Atomically reserves all due AVOP markers for one recipient digest.';
comment on function public.record_avop_notification_digest_result(uuid, text, text, text, jsonb, text, text, text, text, text, timestamptz) is
  'Atomically records one recipient digest while retaining one log per AVOP marker.';

revoke execute on function public.reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_avop_notification_digest_result(uuid, text, text, text, jsonb, text, text, text, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz) to service_role;
grant execute on function public.record_avop_notification_digest_result(uuid, text, text, text, jsonb, text, text, text, text, text, timestamptz) to service_role;

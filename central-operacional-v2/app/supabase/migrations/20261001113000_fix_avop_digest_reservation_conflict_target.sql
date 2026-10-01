-- Qualifies the notification schedule conflict target so PL/pgSQL does not
-- confuse the table column with the RETURNS TABLE activity_id parameter.

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
  on conflict on constraint notification_schedule_activity_type_activity_id_profile_id_key
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

comment on function public.reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz) is
  'Atomically reserves all due AVOP markers for one recipient digest.';

revoke execute on function public.reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_avop_notification_digest(uuid, jsonb, text, timestamptz, timestamptz) to service_role;

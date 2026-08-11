create extension if not exists pg_cron;

create schema if not exists internal;

revoke all on schema internal from public, anon, authenticated;
grant usage on schema internal to service_role;

create or replace function internal.auto_close_due_briefings(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_closed_count integer := 0;
begin
  if p_now is null then
    raise exception 'p_now must not be null';
  end if;

  /*
    The effective deadline is evaluated in America/Sao_Paulo, not in the
    database default timezone. A briefing held on 2026-08-10 closes when the
    local timestamp reaches 2026-08-13 00:00:00.

    FOR UPDATE SKIP LOCKED prevents two concurrent cron executions from
    closing and auditing the same briefing twice.
  */
  with due_briefings as (
    select b.id
    from public.briefings as b
    where b.status = 'OPEN'::public.briefing_status
      and b.event_date is not null
      and (p_now at time zone 'America/Sao_Paulo') >= ((b.event_date + 3)::timestamp)
    order by b.event_date, b.id
    for update skip locked
  ),
  closed_briefings as (
    update public.briefings as b
    set
      status = 'CLOSED'::public.briefing_status,
      closed_at = p_now,
      closure_type = 'AUTOMATIC'::public.closure_type,
      updated_at = p_now
    from due_briefings
    where b.id = due_briefings.id
      and b.status = 'OPEN'::public.briefing_status
    returning b.id, b.legacy_id, b.event_date
  ),
  audit_rows as (
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      occurred_at,
      metadata
    )
    select
      null,
      'BRIEFING_AUTO_CLOSED',
      'briefing',
      closed_briefings.id::text,
      p_now,
      pg_catalog.jsonb_build_object(
        'source', 'pg_cron',
        'legacy_id', closed_briefings.legacy_id,
        'event_date', closed_briefings.event_date,
        'closure_type', 'AUTOMATIC',
        'time_zone', 'America/Sao_Paulo'
      )
    from closed_briefings
    returning id
  )
  select pg_catalog.count(*)::integer
  into v_closed_count
  from audit_rows;

  return v_closed_count;
end;
$$;

comment on schema internal is
  'Internal server-side database routines for Central Operacional V2. This schema is not exposed to browser roles.';

comment on function internal.auto_close_due_briefings(timestamptz) is
  'Closes OPEN briefings at the start of the fourth day in America/Sao_Paulo and writes one audit_log row per actual closure.';

revoke all on function internal.auto_close_due_briefings(timestamptz) from public, anon, authenticated;
grant execute on function internal.auto_close_due_briefings(timestamptz) to service_role;

select cron.schedule(
  'central_operacional_auto_close_briefings',
  '0 * * * *',
  $$select internal.auto_close_due_briefings();$$
);

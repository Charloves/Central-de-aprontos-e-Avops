create or replace function internal.normalize_profile_audience_codes(p_codes text[])
returns text[]
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_codes text[];
begin
  select coalesce(array_agg(distinct n.code order by n.code), array[]::text[])
  into v_codes
  from (
    select upper(btrim(value)) as code
    from unnest(coalesce(p_codes, array[]::text[])) as value
    where btrim(value) <> ''
  ) n;

  if coalesce(array_length(v_codes, 1), 0) = 0 then
    raise exception 'at least one audience is required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_codes) as requested_code
    left join public.audiences a on a.code = requested_code and a.active
    where a.id is null
  ) then
    raise exception 'invalid audience' using errcode = '22023';
  end if;

  return v_codes;
end;
$$;

comment on function internal.normalize_profile_audience_codes(text[]) is
  'Normalizes profile audience codes for backend-only profile administration without ambiguous column references.';

revoke all on function internal.normalize_profile_audience_codes(text[]) from public, anon, authenticated;
grant execute on function internal.normalize_profile_audience_codes(text[]) to service_role;

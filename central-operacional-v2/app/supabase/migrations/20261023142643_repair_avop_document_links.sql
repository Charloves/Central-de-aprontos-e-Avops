-- The legacy AVOPS sheet stores the document in LINK_PDF (or PDF_URL as a
-- fallback). Earlier imports incorrectly persisted WEBAPP_URL, which points to
-- the retired Apps Script application. Repair only imported AVOPs with an
-- invalid current document URL and preserve every already-valid manual value.

with source_candidates as (
  select distinct on (r.resolved_entity_id)
    r.resolved_entity_id as avop_id,
    coalesce(
      nullif(pg_catalog.btrim(r.original_content->>'LINK_PDF'), ''),
      nullif(pg_catalog.btrim(r.original_content->>'PDF_URL'), '')
    ) as drive_url
  from public.historical_import_staging_records r
  where r.source_record_type = 'AVOPS'
    and r.migrated = true
    and r.resolved_entity_type = 'avop'
    and r.resolved_entity_id is not null
  order by r.resolved_entity_id, r.resolved_at desc nulls last, r.id
), valid_candidates as (
  select
    c.avop_id,
    c.drive_url,
    coalesce(
      substring(c.drive_url from '/file/d/([^/?#]+)'),
      substring(c.drive_url from '[?&]id=([^&#]+)')
    ) as drive_file_id
  from source_candidates c
  where c.drive_url ~ '^https://drive\.google\.com(?:/|$)'
)
update public.avops a
   set drive_url = c.drive_url,
       drive_file_id = c.drive_file_id,
       updated_at = pg_catalog.now()
  from valid_candidates c
 where a.id = c.avop_id
   and c.drive_file_id is not null
   and (
     a.drive_url !~ '^https://drive\.google\.com(?:/|$)'
     or coalesce(
       substring(a.drive_url from '/file/d/([^/?#]+)'),
       substring(a.drive_url from '[?&]id=([^&#]+)')
     ) is null
   );

-- Fail closed rather than leaving an imported AVOP with the retired webapp URL
-- or no recognized Drive file identifier. The migration is transactional, so a
-- failure rolls the update back and requires an explicit data review.
do $$
begin
  if exists (
    select 1
      from public.historical_import_staging_records r
      join public.avops a on a.id = r.resolved_entity_id
     where r.source_record_type = 'AVOPS'
       and r.migrated = true
       and r.resolved_entity_type = 'avop'
       and (
         a.drive_url !~ '^https://drive\.google\.com(?:/|$)'
         or coalesce(
           substring(a.drive_url from '/file/d/([^/?#]+)'),
           substring(a.drive_url from '[?&]id=([^&#]+)')
         ) is null
       )
  ) then
    raise exception 'imported AVOP document links require manual review'
      using errcode = '22023';
  end if;
end;
$$;

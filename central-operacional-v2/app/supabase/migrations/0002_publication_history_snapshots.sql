-- Historical profile/audience evidence and publication snapshots.
--
-- This migration is additive. It does not rewrite legacy records and does not
-- recalculate past denominators. When legacy evidence is insufficient, rows can
-- explicitly carry the limitation "perfil historico nao disponivel".

create table profile_audience_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  audience_id uuid references audiences(id),
  audience_code_snapshot text not null,
  audience_name_snapshot text,
  valid_from date not null,
  valid_to date,
  source text not null,
  source_reference text,
  migrated boolean not null default false,
  historical_profile_available boolean not null default true,
  limitation_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_audience_history_valid_period_chk
    check (valid_to is null or valid_to >= valid_from),
  constraint profile_audience_history_limitation_chk
    check (historical_profile_available or limitation_reason is not null)
);

comment on table profile_audience_history is
  'Evidence table for profile/audience validity over time. It preserves historical limitations instead of reconstructing old audiences without proof.';
comment on column profile_audience_history.audience_code_snapshot is
  'Audience code as known at the time of evidence. Kept even if the audiences table changes later.';
comment on column profile_audience_history.historical_profile_available is
  'False when migration cannot prove the profile/audience that was valid at the historical date.';
comment on column profile_audience_history.limitation_reason is
  'Use "perfil historico nao disponivel" when legacy data does not provide reliable historical profile evidence.';

create table avop_publication_snapshots (
  id uuid primary key default gen_random_uuid(),
  avop_id uuid not null unique references avops(id) on delete cascade,
  published_at timestamptz not null,
  source text not null default 'V2',
  source_reference text,
  migrated boolean not null default false,
  audience_snapshot jsonb not null default '[]'::jsonb,
  applicable_profile_count integer not null default 0,
  historical_limitations jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint avop_publication_snapshots_count_chk
    check (applicable_profile_count >= 0)
);

comment on table avop_publication_snapshots is
  'Immutable publication-time denominator for each AVOP. Future dashboards should use this snapshot for historical audit.';
comment on column avop_publication_snapshots.audience_snapshot is
  'JSON array with target audiences as published, preserving code/name even if the current audience catalog changes.';
comment on column avop_publication_snapshots.historical_limitations is
  'Known limitations for migrated or incomplete records, including missing historical profile evidence.';

create table avop_publication_snapshot_members (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references avop_publication_snapshots(id) on delete cascade,
  avop_id uuid not null references avops(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  audience_id uuid references audiences(id),
  trigram_snapshot text not null,
  name_snapshot text not null,
  email_snapshot text,
  audience_code_snapshot text not null,
  audience_name_snapshot text,
  profile_active_snapshot boolean not null,
  applicable_profile_source text not null,
  valid_from date,
  valid_to date,
  source text not null default 'V2',
  source_reference text,
  migrated boolean not null default false,
  historical_profile_available boolean not null default true,
  limitation_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint avop_snapshot_members_valid_period_chk
    check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint avop_snapshot_members_limitation_chk
    check (historical_profile_available or limitation_reason is not null),
  constraint avop_snapshot_members_snapshot_match_unique
    unique (snapshot_id, profile_id, audience_code_snapshot)
);

comment on table avop_publication_snapshot_members is
  'Nominal AVOP audience at publication time. This is the denominator for future historical AVOP acknowledgement audits.';
comment on column avop_publication_snapshot_members.applicable_profile_source is
  'Explains whether applicability came from current V2 profile data, imported evidence, manual admin evidence, or an explicit historical limitation.';

create table briefing_publication_snapshots (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null unique references briefings(id) on delete cascade,
  opened_at timestamptz not null,
  source text not null default 'V2',
  source_reference text,
  migrated boolean not null default false,
  audience_snapshot jsonb not null default '[]'::jsonb,
  applicable_profile_count integer not null default 0,
  historical_limitations jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint briefing_publication_snapshots_count_chk
    check (applicable_profile_count >= 0)
);

comment on table briefing_publication_snapshots is
  'Immutable opening/publication-time denominator for each briefing/apronto.';
comment on column briefing_publication_snapshots.audience_snapshot is
  'JSON array with target audiences as opened/published, preserving code/name even if current audiences change.';

create table briefing_publication_snapshot_members (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references briefing_publication_snapshots(id) on delete cascade,
  briefing_id uuid not null references briefings(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  audience_id uuid references audiences(id),
  trigram_snapshot text not null,
  name_snapshot text not null,
  email_snapshot text,
  audience_code_snapshot text not null,
  audience_name_snapshot text,
  profile_active_snapshot boolean not null,
  applicable_profile_source text not null,
  valid_from date,
  valid_to date,
  source text not null default 'V2',
  source_reference text,
  migrated boolean not null default false,
  historical_profile_available boolean not null default true,
  limitation_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint briefing_snapshot_members_valid_period_chk
    check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint briefing_snapshot_members_limitation_chk
    check (historical_profile_available or limitation_reason is not null),
  constraint briefing_snapshot_members_snapshot_match_unique
    unique (snapshot_id, profile_id, audience_code_snapshot)
);

comment on table briefing_publication_snapshot_members is
  'Nominal briefing/apronto audience at opening time. This preserves future historical attendance denominators.';
comment on column briefing_publication_snapshot_members.applicable_profile_source is
  'Explains whether applicability came from current V2 profile data, imported evidence, manual admin evidence, or an explicit historical limitation.';

create index profile_audience_history_profile_period_idx
  on profile_audience_history (profile_id, valid_from, valid_to);
create index profile_audience_history_audience_idx
  on profile_audience_history (audience_code_snapshot, valid_from, valid_to);
create index profile_audience_history_migrated_idx
  on profile_audience_history (migrated, historical_profile_available);

create index avop_publication_snapshot_members_avop_idx
  on avop_publication_snapshot_members (avop_id);
create index avop_publication_snapshot_members_profile_idx
  on avop_publication_snapshot_members (profile_id);
create index avop_publication_snapshot_members_audience_idx
  on avop_publication_snapshot_members (audience_code_snapshot);
create index avop_publication_snapshot_members_limitation_idx
  on avop_publication_snapshot_members (migrated, historical_profile_available);

create index briefing_publication_snapshot_members_briefing_idx
  on briefing_publication_snapshot_members (briefing_id);
create index briefing_publication_snapshot_members_profile_idx
  on briefing_publication_snapshot_members (profile_id);
create index briefing_publication_snapshot_members_audience_idx
  on briefing_publication_snapshot_members (audience_code_snapshot);
create index briefing_publication_snapshot_members_limitation_idx
  on briefing_publication_snapshot_members (migrated, historical_profile_available);

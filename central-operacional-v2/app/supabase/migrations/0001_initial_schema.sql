create extension if not exists "pgcrypto";

create type app_role as enum ('USER', 'COORDINATOR', 'ADMIN');
create type avop_status as enum ('DRAFT', 'PUBLISHED', 'CLOSED');
create type briefing_status as enum ('DRAFT', 'OPEN', 'CLOSED');
create type closure_type as enum ('AUTOMATIC', 'MANUAL');
create type notification_status as enum ('ACTIVE', 'STOPPED');

create table profiles (
  id uuid primary key default gen_random_uuid(),
  trigram text not null unique,
  name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profile_roles (
  profile_id uuid not null references profiles(id) on delete cascade,
  role app_role not null,
  assigned_by uuid references profiles(id),
  assigned_at timestamptz not null default now(),
  reason text,
  primary key (profile_id, role)
);

create table audiences (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true
);

create table profile_audiences (
  profile_id uuid not null references profiles(id) on delete cascade,
  audience_id uuid not null references audiences(id),
  valid_from date,
  valid_to date,
  primary key (profile_id, audience_id)
);

create table avops (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  title text not null,
  publication_date date not null,
  drive_url text not null,
  drive_file_id text,
  status avop_status not null default 'DRAFT',
  requires_acknowledgement boolean not null default true,
  closed_at timestamptz,
  closed_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table avop_audiences (
  avop_id uuid not null references avops(id) on delete cascade,
  audience_id uuid not null references audiences(id),
  primary key (avop_id, audience_id)
);

create table avop_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  avop_id uuid not null references avops(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  acknowledged_at timestamptz not null default now(),
  session_id text,
  request_metadata jsonb not null default '{}'::jsonb,
  legacy_source jsonb not null default '{}'::jsonb,
  unique (avop_id, profile_id)
);

create table briefings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  title text not null,
  event_date date,
  drive_url text,
  drive_file_id text,
  requires_material_acknowledgement boolean not null default false,
  status briefing_status not null default 'DRAFT',
  closed_at timestamptz,
  closure_type closure_type,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table briefing_audiences (
  briefing_id uuid not null references briefings(id) on delete cascade,
  audience_id uuid not null references audiences(id),
  primary key (briefing_id, audience_id)
);

create table briefing_records (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references briefings(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  attendance_status text not null,
  material_acknowledged boolean not null default false,
  recorded_at timestamptz not null default now(),
  legacy_source jsonb not null default '{}'::jsonb,
  unique (briefing_id, profile_id)
);

create table absence_justifications (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references briefings(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ois (
  id uuid primary key default gen_random_uuid(),
  aircraft text not null,
  oi_key text not null,
  program text not null,
  subprogram text not null,
  phase_id text not null,
  title text not null,
  drive_url text not null,
  drive_file_id text,
  start_page integer not null,
  end_page integer,
  display_key text not null,
  mission_codes text[] not null default '{}',
  active boolean not null default true,
  unique (aircraft, oi_key)
);

create table notification_schedule (
  id uuid primary key default gen_random_uuid(),
  activity_type text not null,
  activity_id uuid not null,
  profile_id uuid not null references profiles(id),
  last_sent_at timestamptz,
  next_send_at timestamptz,
  send_count integer not null default 0,
  status notification_status not null default 'ACTIVE',
  unique (activity_type, activity_id, profile_id)
);

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references notification_schedule(id),
  recipient text not null,
  notification_type text not null,
  attempted_at timestamptz not null default now(),
  result text not null,
  provider_message_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table backup_index (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null,
  drive_url text,
  checksum text,
  status text not null,
  notes text
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into audiences (code, name) values
  ('PILOTO', 'Piloto'),
  ('TRIPULANTE', 'Tripulante'),
  ('HSAR', 'HSAR'),
  ('TODOS', 'Todos')
on conflict (code) do nothing;

insert into settings (key, value) values
  ('initial_admin_trigram', '"CHA"'::jsonb),
  ('gmail_sender_email', '"cdout.1gav11@gmail.com"'::jsonb),
  ('avop_weekly_billing_days', '7'::jsonb),
  ('avop_monthly_billing_starts_after_days', '30'::jsonb),
  ('avop_billing_stops_after_days', '365'::jsonb)
on conflict (key) do nothing;

create index profiles_trigram_active_idx on profiles (trigram, active);
create index avops_status_publication_idx on avops (status, publication_date);
create index briefings_status_event_idx on briefings (status, event_date);
create index notification_next_send_idx on notification_schedule (status, next_send_at);
create index ois_aircraft_phase_idx on ois (aircraft, phase_id);
create index ois_mission_codes_idx on ois using gin (mission_codes);

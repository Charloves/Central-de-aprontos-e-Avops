-- Seed exclusivo para desenvolvimento isolado.
-- Nao inserir nomes, e-mails, documentos, links ou dados operacionais reais.

insert into profiles (trigram, name, email, active)
values
  ('CHA', 'Coordenador Ficticio', 'cha@example.test', true),
  ('USR', 'Usuario Ficticio', 'usr@example.test', true),
  ('PLT', 'Piloto Ficticio', 'plt@example.test', true),
  ('TRP', 'Tripulante Ficticio', 'trp@example.test', true),
  ('INA', 'Usuario Inativo Ficticio', 'ina@example.test', false)
on conflict (trigram) do update set
  name = excluded.name,
  email = excluded.email,
  active = excluded.active,
  updated_at = now();

insert into profile_roles (profile_id, role, reason)
select profiles.id, roles.role::app_role, 'Seed ficticio de desenvolvimento.'
from profiles
cross join (values ('USER'), ('COORDINATOR'), ('ADMIN')) as roles(role)
where profiles.trigram = 'CHA'
on conflict (profile_id, role) do nothing;

insert into profile_roles (profile_id, role, reason)
select profiles.id, 'USER'::app_role, 'Seed ficticio de desenvolvimento.'
from profiles
where profiles.trigram in ('USR', 'PLT', 'TRP', 'INA')
on conflict (profile_id, role) do nothing;

insert into profile_audiences (profile_id, audience_id, valid_from)
select profiles.id, audiences.id, date '2026-01-01'
from profiles
join audiences on (
  (profiles.trigram in ('CHA', 'PLT') and audiences.code = 'PILOTO')
  or (profiles.trigram = 'TRP' and audiences.code = 'TRIPULANTE')
  or (profiles.trigram = 'USR' and audiences.code = 'TODOS')
)
on conflict (profile_id, audience_id) do nothing;

insert into avops (number, title, publication_date, drive_url, drive_file_id, status)
values
  ('AVOP DEV-001', 'Procedimento Ficticio de Desenvolvimento', date '2026-01-10', 'https://example.test/docs/avop-dev-001.pdf', 'file-avop-dev-001', 'PUBLISHED'),
  ('AVOP DEV-002', 'Aviso Ficticio de Homologacao', date '2026-01-15', 'https://example.test/docs/avop-dev-002.pdf', 'file-avop-dev-002', 'DRAFT')
on conflict (number) do update set
  title = excluded.title,
  publication_date = excluded.publication_date,
  drive_url = excluded.drive_url,
  drive_file_id = excluded.drive_file_id,
  status = excluded.status,
  updated_at = now();

insert into avop_audiences (avop_id, audience_id)
select avops.id, audiences.id
from avops
join audiences on (
  (avops.number = 'AVOP DEV-001' and audiences.code in ('PILOTO', 'TRIPULANTE'))
  or (avops.number = 'AVOP DEV-002' and audiences.code = 'TODOS')
)
on conflict (avop_id, audience_id) do nothing;

insert into briefings (legacy_id, title, event_date, drive_url, drive_file_id, requires_material_acknowledgement, status)
values
  ('APR-DEV-001', 'Apronto Ficticio de Desenvolvimento', date '2026-02-01', 'https://example.test/docs/apr-dev-001.pdf', 'file-apr-dev-001', true, 'OPEN'),
  ('APR-DEV-002', 'Apronto Ficticio Encerrado', date '2026-02-05', 'https://example.test/docs/apr-dev-002.pdf', 'file-apr-dev-002', false, 'CLOSED')
on conflict (legacy_id) do update set
  title = excluded.title,
  event_date = excluded.event_date,
  drive_url = excluded.drive_url,
  drive_file_id = excluded.drive_file_id,
  requires_material_acknowledgement = excluded.requires_material_acknowledgement,
  status = excluded.status,
  updated_at = now();

insert into briefing_audiences (briefing_id, audience_id)
select briefings.id, audiences.id
from briefings
join audiences on (
  (briefings.legacy_id = 'APR-DEV-001' and audiences.code in ('PILOTO', 'TRIPULANTE'))
  or (briefings.legacy_id = 'APR-DEV-002' and audiences.code = 'TODOS')
)
on conflict (briefing_id, audience_id) do nothing;

insert into ois (
  aircraft,
  oi_key,
  program,
  subprogram,
  phase_id,
  title,
  drive_url,
  drive_file_id,
  start_page,
  end_page,
  display_key,
  mission_codes,
  active
)
values
  ('H-50', 'OI-DEV-H50-001', 'DEVOP', 'DEV-1', '01DEVH50', 'OI Ficticia H-50', 'https://example.test/docs/oi-h50-dev.pdf', 'file-oi-h50-dev', 1, 3, '01DEVH5001', array['01DEVH5001', '01DEVH5002'], true),
  ('H-125', 'OI-DEV-H125-001', 'DEVOP', 'DEV-2', '01DEVH125', 'OI Ficticia H-125', 'https://example.test/docs/oi-h125-dev.pdf', 'file-oi-h125-dev', 4, 6, '01DEVH12501', array['01DEVH12501', '01DEVH12502'], true)
on conflict (aircraft, oi_key) do update set
  program = excluded.program,
  subprogram = excluded.subprogram,
  phase_id = excluded.phase_id,
  title = excluded.title,
  drive_url = excluded.drive_url,
  drive_file_id = excluded.drive_file_id,
  start_page = excluded.start_page,
  end_page = excluded.end_page,
  display_key = excluded.display_key,
  mission_codes = excluded.mission_codes,
  active = excluded.active;

insert into settings (key, value)
values
  ('development_seed_notice', '"dados exclusivamente ficticios"'::jsonb),
  ('gmail_sender_email', '"not-configured@example.test"'::jsonb)
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();

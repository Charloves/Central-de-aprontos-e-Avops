insert into profiles (trigram, name, email, active)
values ('CHA', 'CHARLES', 'charlescdma@fab.mil.br', true)
on conflict (trigram) do update set
  name = excluded.name,
  email = excluded.email,
  active = excluded.active,
  updated_at = now();

insert into profile_roles (profile_id, role, reason)
select id, role::app_role, 'Coordenador e administrador inicial da V2.'
from profiles
cross join (values ('USER'), ('COORDINATOR'), ('ADMIN')) as roles(role)
where trigram = 'CHA'
on conflict (profile_id, role) do nothing;

insert into profile_audiences (profile_id, audience_id)
select profiles.id, audiences.id
from profiles
join audiences on audiences.code = 'PILOTO'
where profiles.trigram = 'CHA'
on conflict (profile_id, audience_id) do nothing;

-- Rôle administrateur (accès à la télémétrie d'usage). Additif.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Channing = administrateur (compte créé avec l'email pro).
update public.profiles set is_admin = true
where id in (select id from auth.users where email = 'channing@mc-export.com');

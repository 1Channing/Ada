-- Rôle administrateur (accès à la télémétrie d'usage). Additif.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Verrou : personne ne peut s'auto-promouvoir depuis l'application — la
-- colonne is_admin n'est modifiable que hors rôles applicatifs (éditeur SQL
-- du dashboard ou service_role), jamais via anon/authenticated.
create or replace function public.protect_is_admin() returns trigger
language plpgsql security definer as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_admin := false;
    elsif new.is_admin is distinct from old.is_admin then
      raise exception 'is_admin est géré par l''administrateur de la base';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_is_admin on public.profiles;
create trigger trg_protect_is_admin
  before insert or update on public.profiles
  for each row execute function public.protect_is_admin();

-- Channing = administrateur (compte créé avec l'email pro).
update public.profiles set is_admin = true
where id in (select id from auth.users where email = 'channing@mc-export.com');

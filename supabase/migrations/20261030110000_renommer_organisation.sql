-- ═══════════════════════════════════════════════════════════════════════════
-- RENOMMER UNE ORGANISATION (30/10/2026) — demande Channing : « me laisser la
-- possibilité de modifier le nom d'une organisation ». Le nom est la clé
-- (organisations.name) et il est recopié en texte dans profiles.organisation,
-- profiles.managed_orgs, auth_allowlist.organisation, daily_searches.lead_org
-- et prospect_watches.lead_org : la RPC change tout d'un bloc, en
-- transaction, réservée aux admins. « MC Export » ne se renomme pas (c'est
-- la valeur par défaut dans les fonctions et les policies). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_rename_organisation(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text := trim(coalesce(p_old, ''));
  v_new text := trim(coalesce(p_new, ''));
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Réservé aux admins.';
  end if;
  if v_old = '' or v_new = '' then raise exception 'Nom vide.'; end if;
  if v_old = 'MC Export' then raise exception '« MC Export » ne se renomme pas.'; end if;
  if v_old = v_new then return; end if;
  if not exists (select 1 from public.organisations where name = v_old) then raise exception 'Organisation « % » introuvable.', v_old; end if;
  if exists (select 1 from public.organisations where name = v_new) then raise exception 'Une organisation « % » existe déjà.', v_new; end if;

  -- La clé d'abord (la ligne garde ses réglages), puis chaque recopie textuelle.
  update public.organisations set name = v_new where name = v_old;
  update public.profiles set organisation = v_new where organisation = v_old;
  update public.profiles set managed_orgs = array_replace(managed_orgs, v_old, v_new) where managed_orgs is not null and v_old = any(managed_orgs);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'auth_allowlist' and column_name = 'organisation') then
    update public.auth_allowlist set organisation = v_new where organisation = v_old;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'daily_searches' and column_name = 'lead_org') then
    update public.daily_searches set lead_org = v_new where lead_org = v_old;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prospect_watches' and column_name = 'lead_org') then
    update public.prospect_watches set lead_org = v_new where lead_org = v_old;
  end if;
end $$;
revoke all on function public.admin_rename_organisation(text, text) from public, anon;
grant execute on function public.admin_rename_organisation(text, text) to authenticated;

select exists (select 1 from pg_proc where proname = 'admin_rename_organisation') as tout_est_bon;

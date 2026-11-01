-- ═══════════════════════════════════════════════════════════════════════════
-- SUPPRIMER UN COMPTE (01/11/2026) — demande Channing : « pouvoir supprimer
-- les comptes, par exemple Hugolin ne fait plus partie de Weecars ». RPC
-- admin : efface l'utilisateur dans auth.users ; tout ce qui lui est lié en
-- cascade (profil, études, négociations personnelles, rappels, veilles…) part
-- avec lui — les leads qu'il avait pris gardent leur statut (taken_by remis à
-- null par la contrainte), les annonces qu'il a publiées en bonnes affaires
-- restent. Garde-fous : admins seuls, jamais soi-même, jamais un autre admin.
-- L'adresse sort aussi de la liste des adresses autorisées. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Réservé aux admins.';
  end if;
  if p_user = auth.uid() then raise exception 'On ne supprime pas son propre compte.'; end if;
  if exists (select 1 from public.profiles where id = p_user and is_admin) then
    raise exception 'Ce compte est administrateur : retire-lui d''abord ce rôle.';
  end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then raise exception 'Compte introuvable.'; end if;
  delete from public.profiles where id = p_user;
  delete from auth.users where id = p_user;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'auth_allowlist') then
    delete from public.auth_allowlist where lower(email) = lower(v_email);
  end if;
end $$;
revoke all on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;

select exists (select 1 from pg_proc where proname = 'admin_delete_account') as tout_est_bon;

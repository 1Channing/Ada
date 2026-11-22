/*
  22/11 — Le choix de l'admin prime sur la liste d'inscription (Channing : « j'avais passé Valentin de Segré vers
  Thouaré, cela n'avait pas tenu, il a fallu que je le refasse »).

  Preuve : admin_set_organisation(Valentin, 'Thouaré') répondait sans erreur et la ligne restait « Segré ».
  Cause : le RPC faisait INSERT … ON CONFLICT (id) DO UPDATE SET organisation = excluded.organisation ; le trigger
  BEFORE INSERT (profile_default_organisation) fait primer l'organisation de la ligne d'inscription de l'adresse
  (v.barbot → Segré) et EXCLUDED porte la valeur APRÈS ce trigger : l'update réécrivait Segré.

  Correction : le RPC fait d'abord un UPDATE (le trigger ne retouche pas une organisation non vide sur UPDATE), n'insère
  que si la ligne de profil manque, et aligne la ligne d'inscription EXACTE de l'adresse (une ligne « @domaine » est
  partagée, on n'y touche pas) pour qu'une renaissance du profil retombe au bon endroit. Additif, idempotent.
*/
create or replace function public.admin_set_organisation(p_user uuid, p_org text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
  v_org text := coalesce(nullif(trim(p_org), ''), 'MC Export');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Réservé aux admins.';
  end if;
  select u.email,
         coalesce(nullif(u.raw_user_meta_data->>'first_name', ''), split_part(u.email, '@', 1))
    into v_email, v_name
    from auth.users u where u.id = p_user;
  if v_email is null then
    raise exception 'Compte inconnu.';
  end if;
  insert into public.organisations (name) values (v_org) on conflict do nothing;
  -- La ligne d'inscription exacte suit le compte, AVANT toute naissance de profil.
  update public.auth_allowlist set organisation = v_org where lower(email) = lower(v_email);
  update public.profiles set organisation = v_org where id = p_user;
  if not found then
    insert into public.profiles (id, display_name, organisation) values (p_user, v_name, v_org);
  end if;
end;
$$;
revoke all on function public.admin_set_organisation(uuid, text) from public, anon;
grant execute on function public.admin_set_organisation(uuid, text) to authenticated;

select exists (select 1 from pg_proc where proname = 'admin_set_organisation') as tout_est_bon;

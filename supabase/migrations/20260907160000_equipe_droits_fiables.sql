-- ═══════════════════════════════════════════════════════════════════════════
-- ÉQUIPE — droits d'onglets FIABLES (07/09/2026, constat Channing : « j'enlève
-- des accès à Antoine, ils finissent par revenir »).
-- Cause de classe : la page faisait un UPDATE de profiles ; quand la ligne de
-- profil n'existe pas (inscription avec confirmation d'email : l'écriture du
-- profil sans session avait échoué) ou que la politique RLS filtre, l'UPDATE
-- touche ZÉRO ligne sans erreur, l'écran optimiste montre le changement, et
-- la lecture suivante retombe sur « rien d'enregistré = tout ».
-- Remède : une RPC admin (security definer) qui CRÉE la ligne si elle manque
-- et pose les droits, en une écriture vérifiable. Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_set_allowed_tabs(p_user uuid, p_tabs text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name text;
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
  insert into public.profiles (id, display_name, allowed_tabs)
  values (p_user, v_name, p_tabs)
  on conflict (id) do update set allowed_tabs = excluded.allowed_tabs;
end;
$$;
revoke all on function public.admin_set_allowed_tabs(uuid, text[]) from public, anon;
grant execute on function public.admin_set_allowed_tabs(uuid, text[]) to authenticated;

select 'ok' as tout_est_bon;

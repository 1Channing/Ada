/*
  # Apprentissage des sites : le NOM EXACT plutôt que l'adresse (31/10).

  L'extension Claude masque tout ce qui suit le « ? » d'une adresse (protection de la vie privée) : Claude ne peut
  ni lire ni recopier les paramètres d'une recherche. Il lit en revanche les noms affichés sur le site (« Classe
  cls »). Il envoie donc ce nom ; le worker construit les adresses possibles, les scrape et ne garde que celle dont
  les annonces sont conformes à 100 % — puis le contrôle et la validation automatique habituels.

  Additif, idempotent : à coller tel quel dans Supabase (SQL Editor). Dernière ligne : « tout_est_bon ».
*/

alter table public.linkgen_learning_items add column if not exists proposed_label text;

create or replace function public.linkgen_learning_propose_label(p_id uuid, p_label text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.ada_is_mc_export() then raise exception 'Réservé aux comptes MC Export'; end if;
  if coalesce(trim(p_label), '') = '' or length(p_label) > 120 then
    raise exception 'Nom invalide : recopier le nom du modèle tel que le site l''affiche';
  end if;
  update public.linkgen_learning_items
     set status = 'proposee', proposed_label = trim(p_label), proposed_url = null, proposed_by = auth.uid(), proposed_at = now(),
         absent_note = null, learned = null, check_result = null, verify_url = null, updated_at = now()
   where id = p_id and status = 'a_chercher' and kind = 'modele';
  if not found then raise exception 'Ligne introuvable, déjà proposée, ou pas une ligne de modèle'; end if;
end;
$$;

revoke all on function public.linkgen_learning_propose_label(uuid, text) from public, anon;
grant execute on function public.linkgen_learning_propose_label(uuid, text) to authenticated;

-- Vérification : « tout_est_bon » doit valoir true.
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'linkgen_learning_items' and column_name = 'proposed_label')
   and to_regprocedure('public.linkgen_learning_propose_label(uuid, text)') is not null as tout_est_bon;

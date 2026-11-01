/*
  # Suppression de « Apprentissage des sites » (01/11, Channing : « on supprime l'onglet apprentissage des sites,
    il fait doublon avec le Truth Center » ; « le Truth Center, c'est notre vérité »).

  À COLLER APRÈS le déploiement de l'application et du worker du 01/11 : ils n'utilisent plus aucun de ces objets.

  1. Les 8 modèles appris par l'ancien onglet s'écrivent désormais depuis le livre de leur site
     (linkgen_enum_mappings, vérifié en base le 01/11) : rien n'est perdu en supprimant la file et les règles.
  2. Supprime la file (linkgen_learning_items), les règles apprises (linkgen_learned_rules) et leurs fonctions.
  3. Ferme les rappels de la cloche qui menaient à l'ancien onglet (/apprentissage-sites).
  Garde daily_searches.mileage_min : le kilométrage minimum des recherches du jour sert toujours.

  Idempotent : à coller tel quel dans Supabase (SQL Editor). Dernière ligne : « tout_est_bon ».
*/

drop function if exists public.linkgen_note_gap(text, text, text, text, text, text, text, text, text);
drop function if exists public.linkgen_learning_propose(uuid, text);
drop function if exists public.linkgen_learning_propose_label(uuid, text);
drop function if exists public.linkgen_learning_absent(uuid, text);
drop function if exists public.linkgen_learning_decide(uuid, boolean, text);
drop function if exists public.linkgen_learning_ignore(uuid, text);
drop function if exists public.linkgen_learned_rule_retire(uuid, text);

drop table if exists public.linkgen_learned_rules;
drop table if exists public.linkgen_learning_items;

update public.user_tasks set status = 'done', done_at = now()
 where status = 'open' and (key like 'apprentissage%' or link like '/apprentissage-sites%');

-- Vérification : « tout_est_bon » doit valoir true.
select not exists (select 1 from information_schema.tables where table_schema = 'public'
                    and table_name in ('linkgen_learning_items', 'linkgen_learned_rules'))
   and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('linkgen_note_gap', 'linkgen_learning_propose',
                      'linkgen_learning_propose_label', 'linkgen_learning_absent', 'linkgen_learning_decide',
                      'linkgen_learning_ignore', 'linkgen_learned_rule_retire'))
   and exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'daily_searches' and column_name = 'mileage_min')
   and not exists (select 1 from public.user_tasks where status = 'open'
                    and (key like 'apprentissage%' or link like '/apprentissage-sites%'))
   as tout_est_bon;

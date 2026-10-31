/*
  # Apprentissage des sites : essais seuls ESPACÉS (31/10 après-midi).

  Une ligne qu'ADA n'a pas trouvée seule était ré-essayée chaque jour — et à chaque redémarrage du worker (le
  souvenir n'était qu'en mémoire). Désormais : 1 jour, puis 3, puis 7, puis tous les 14 jours, mémorisés ici.
  Les campagnes et re-scans mensuels nourrissent aussi la file (sources « campagne » et « campagne_echec ») :
  aucune colonne de plus n'est nécessaire pour cela.

  Additif, idempotent : à coller tel quel dans Supabase (SQL Editor). Dernière ligne : « tout_est_bon ».
*/

alter table public.linkgen_learning_items add column if not exists probed_at timestamptz;
alter table public.linkgen_learning_items add column if not exists probe_count integer not null default 0;

-- Vérification : « tout_est_bon » doit valoir true.
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'linkgen_learning_items' and column_name = 'probed_at')
   and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'linkgen_learning_items' and column_name = 'probe_count') as tout_est_bon;

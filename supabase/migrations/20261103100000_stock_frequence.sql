-- ═══════════════════════════════════════════════════════════════════════════
-- FRÉQUENCE DES RELEVÉS DE VITRINE (03/11/2026) — décision Channing : « si
-- cela ne coûte rien, on le lance sur l'ensemble des vitrines enregistrées ;
-- créneau de 1 h 00 tous les jours ; choix hebdomadaire ou quotidien,
-- quotidien par défaut ». Colonne stock_frequency sur network_contacts :
-- 'daily' (défaut) / 'weekly' / 'off'. L'ordonnanceur nocturne du worker la
-- lit ; la fiche du contact la règle. Additif, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.network_contacts
  add column if not exists stock_frequency text not null default 'daily';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'network_contacts_stock_frequency_check') then
    alter table public.network_contacts
      add constraint network_contacts_stock_frequency_check check (stock_frequency in ('daily', 'weekly', 'off'));
  end if;
end $$;

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'network_contacts' and column_name = 'stock_frequency'
) as tout_est_bon;

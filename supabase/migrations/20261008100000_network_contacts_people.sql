/*
  # Carte : plusieurs interlocuteurs par concession (08/10, signalement
  Achille : « pour une même concession pouvoir ajouter plusieurs contacts,
  là on est limité à un seul »)

  people = [{ name, role, phone, email }] : les interlocuteurs en plus du
  contact principal (contact_name / phone / email, inchangés).
  Additif, idempotent.
*/
alter table public.network_contacts
  add column if not exists people jsonb not null default '[]'::jsonb;

select exists (select 1 from information_schema.columns where table_name = 'network_contacts' and column_name = 'people') as tout_est_bon;

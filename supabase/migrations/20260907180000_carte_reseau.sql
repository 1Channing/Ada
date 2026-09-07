-- ═══════════════════════════════════════════════════════════════════════════
-- CARTE EUROPE DU RÉSEAU (07/09/2026, chantier réservé par Channing le 03/09,
-- GO 07/09). Contacts Acheteur/Vendeur épinglés sur une carte Europe, avec
-- leurs marques/modèles suivis, leur vitrine et leur niveau de relation.
-- Tables additives ; lecture pour toute l'équipe, ÉDITION réservée aux
-- comptes portant le droit « carte:edition » (page Équipe) et aux admins.
-- Graine : fichier « McExport Tab MARKET NL » (11 groupes néerlandais avec
-- stock par marque + 7 prospects NL/DK/FR + 1 convoyeur). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.network_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- concession | loueur | trader | convoyeur | autre
  kind text not null default 'concession',
  -- vendeur (nous achetons chez lui) | acheteur (il nous achète) | les_deux
  role text not null default 'vendeur',
  country text not null,              -- code ISO-2 (NL, DK, FR…)
  city text,
  lat double precision,
  lng double precision,
  contact_name text,
  phone text,
  email text,
  website text,
  -- froid | tiede | chaud | nouveau | '' (texte libre court)
  relation text not null default '',
  vehicle_types text not null default '',
  monthly_volume text not null default '',
  opportunity text not null default '',
  margin text not null default '',
  reliability text not null default '',
  comment text not null default '',
  notes text not null default '',
  market_share numeric,
  stock_total integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_network_contacts_country on public.network_contacts (country);

create table if not exists public.network_contact_models (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.network_contacts(id) on delete cascade,
  brand text not null,
  model text not null default '',
  qty integer,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_network_contact_models_contact on public.network_contact_models (contact_id);
create unique index if not exists uq_network_contact_models on public.network_contact_models (contact_id, brand, model);

alter table public.network_contacts enable row level security;
alter table public.network_contact_models enable row level security;

-- Droit d'édition : admin, ou « carte:edition » dans profiles.allowed_tabs.
create or replace function public.network_can_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_admin or 'carte:edition' = any(coalesce(p.allowed_tabs, '{}')))
  );
$$;
grant execute on function public.network_can_edit() to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'network_contacts' and policyname = 'network_contacts_read') then
    create policy network_contacts_read on public.network_contacts for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'network_contacts' and policyname = 'network_contacts_write') then
    create policy network_contacts_write on public.network_contacts for all to authenticated
      using (public.network_can_edit()) with check (public.network_can_edit());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'network_contact_models' and policyname = 'network_contact_models_read') then
    create policy network_contact_models_read on public.network_contact_models for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'network_contact_models' and policyname = 'network_contact_models_write') then
    create policy network_contact_models_write on public.network_contact_models for all to authenticated
      using (public.network_can_edit()) with check (public.network_can_edit());
  end if;
end $$;
grant select, insert, update, delete on public.network_contacts, public.network_contact_models to authenticated;

-- updated_at automatique.
create or replace function public.network_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_network_contacts_touch on public.network_contacts;
create trigger trg_network_contacts_touch before update on public.network_contacts
  for each row execute function public.network_touch_updated_at();

-- Temps réel (la carte suit les modifications de l'équipe).
do $$ begin
  begin
    alter publication supabase_realtime add table public.network_contacts;
  exception when duplicate_object then null; when undefined_object then null; end;
  begin
    alter publication supabase_realtime add table public.network_contact_models;
  exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- ── Graine : répertoire NL (vendeurs, stock par marque) ─────────────────────
-- Villes : sièges connus ou indicatif téléphonique (0416 Waalwijk, 0318 Ede,
-- 0341 Ermelo, 020 Amsterdam, 0314 Doetinchem, 070 La Haye, 033 Leusden,
-- 038 Zwolle, 050 Groningue) — épingle déplaçable dans la carte.
insert into public.network_contacts (id, name, kind, role, country, city, lat, lng, contact_name, phone, email, website, relation, vehicle_types, opportunity, comment, market_share, stock_total)
values
  ('a0000000-0000-4000-8000-000000000001', 'Van Mossel', 'concession', 'vendeur', 'NL', 'Waalwijk', 51.687, 5.072, 'Edy Timmer', '+31 416 671 111', '', 'https://www.vanmossel.nl/voorraad?country=nl&type=used', '', '', '', '', 19.23, 144),
  ('a0000000-0000-4000-8000-000000000002', 'Emil Frey Nederland', 'concession', 'vendeur', 'NL', 'Ede', 52.045, 5.665, 'Pascal Buitenkamp', '+31 318 58 13 18', '', 'https://www.emilfrey.nl/voorraad?filter%5BvehicleState%5D%5Bused%5D=&page=1&sorting=created_at_desc', '', '', '', '', 15.89, 119),
  ('a0000000-0000-4000-8000-000000000003', 'Broekhuis Groep', 'concession', 'vendeur', 'NL', 'Ermelo', 52.298, 5.622, 'Frank Dekker', '+31 341 75 11 00', '', 'https://broekhuis.nl/auto/occasion', '', '', '', '', 15.22, 114),
  ('a0000000-0000-4000-8000-000000000004', 'Hedin Automotive', 'concession', 'vendeur', 'NL', 'Amsterdam', 52.370, 4.895, 'Gerrit Tigelaar', '+31 20 658 39 80', '', 'https://www.hedinautomotive.nl/occasions', '', '', '', '', 14.95, 112),
  ('a0000000-0000-4000-8000-000000000005', 'Zeeuw & Zeeuw', 'concession', 'les_deux', 'NL', 'Delft', 52.012, 4.357, 'Jelle Beekhuis', '+31 88 374 74 74', 'j.beekhuis@zeeuwandzeeuw.nl', 'https://www.zeeuwenzeeuw.nl/voorraad/?from=0&size=12&&filters=search&soort[]=occasion', 'nouveau', 'Hybrids / EV', 'Units / batch', 'Concession Suzuki / Renault. Jamais eu en contact, potentiel volume sur de la Suzuki et de la Renault HEV. Contact tel 13/05.', 6.94, 52),
  ('a0000000-0000-4000-8000-000000000006', 'Wassink Autogroep', 'concession', 'vendeur', 'NL', 'Doetinchem', 51.965, 6.288, 'Edgar van Schaik', '+31 314 33 28 51', '', 'https://www.wassinkautogroep.nl/voorraad/?from=0&size=12&&filters=search&soort[]=occasion', '', '', '', '', 6.81, 51),
  ('a0000000-0000-4000-8000-000000000007', 'Louwman Dealer Group', 'concession', 'vendeur', 'NL', 'La Haye', 52.078, 4.313, '', '+31 70 304 73 00', '', 'https://www.louwman.nl/aanbod/filters/gebruikt/', '', '', '', '', 6.28, 47),
  ('a0000000-0000-4000-8000-000000000008', 'Pon Automotive', 'concession', 'vendeur', 'NL', 'Leusden', 52.133, 5.431, '', '+31 33 494 91 11', '', 'https://www.poncenter.nl/auto-kopen/totaal-aanbod?sources%5B%5D=Occasions&sort=newly_added&page=1', '', '', '', '', 4.67, 35),
  ('a0000000-0000-4000-8000-000000000009', 'Wensink Automotive', 'concession', 'vendeur', 'NL', 'Zwolle', 52.516, 6.083, 'Xander Pama', '+31 38 425 57 55', '', 'https://www.wensink.nl/voorraad/personenauto/occasions-kopen/personenwagens', '', '', '', '', 4.41, 33),
  ('a0000000-0000-4000-8000-000000000010', 'Century Autogroep', 'concession', 'vendeur', 'NL', 'Groningue', 53.219, 6.568, '', '+31 50 853 71 00', '', 'https://www.century.nl/ons-aanbod/occasions?filter%5BvehicleState%5D%5Bused%5D=&page=1&sorting=created_at_desc', '', '', '', '', 3.47, 26),
  ('a0000000-0000-4000-8000-000000000011', 'Vallei Auto Groep', 'concession', 'vendeur', 'NL', 'Ede', 52.040, 5.660, 'Frank Aarts', '+31 318 50 99 99', '', 'https://www.valleiautogroep.nl/auto-zoeken?type=occasions&sort=meest-bekeken', '', '', '', '', 2.14, 16),
  -- Prospects (acheteurs) — ville inconnue = épingle « à placer » au centre du pays.
  ('a0000000-0000-4000-8000-000000000012', 'Van Dijk Automotive', 'concession', 'acheteur', 'NL', null, null, null, 'Thomas', '+31 6 27970897', '', '', 'nouveau', 'Hybrids / EV / LCV', 'Units / batch', 'Concession multimarque. Déjà en contact avec Channing, attend des offres.', null, null),
  ('a0000000-0000-4000-8000-000000000013', 'Auto Smeeing', 'concession', 'acheteur', 'NL', 'Soest', 52.173, 5.291, 'Aloma', '', 'aloma@autosmeeing.nl', '', 'nouveau', 'Hybrids / EV', 'Units / batch', 'Concession multimarque. Véhicules en export déjà présents sur nos camions. Contact tel 13/05.', null, null),
  ('a0000000-0000-4000-8000-000000000014', 'Auto Centrum Krimpenerwaard', 'concession', 'acheteur', 'NL', 'Krimpen aan den IJssel', 51.915, 4.598, 'Ruben', '', 'info@autocentrumkrimpenerwaad.nl', '', 'nouveau', 'Hybrids / EV', 'Units / batch', 'Concession multimarque. Véhicules en export déjà présents sur nos camions. Contact tel 13/05.', null, null),
  ('a0000000-0000-4000-8000-000000000015', 'Rævhede Auto', 'concession', 'acheteur', 'DK', null, null, null, 'Claus Rasmussen', '', 'claus@raevhede.dk', '', 'nouveau', 'EV', 'Units / batch', 'Concession multimarque. On leur a déjà vendu un Skoda Elroq par le biais d''un trader. Contact tel 13/05. Intérêt : listing EV.', null, null),
  ('a0000000-0000-4000-8000-000000000016', 'Kraftbiler A/S', 'concession', 'acheteur', 'DK', null, null, null, 'Pim', '', 'jsh@kraftbiler.dk', '', 'nouveau', 'EV', 'Units / batch', 'Concession multimarque. Véhicules en export déjà présents sur nos camions. Contact tel 13/05.', null, null),
  ('a0000000-0000-4000-8000-000000000017', 'Groupe Sellens', 'concession', 'acheteur', 'FR', null, null, null, 'Vincent Meunier', '', 'vincent.meunier@sellens.fr', '', 'nouveau', '', 'Units / batch', 'Concession multimarque. En attente de rappel.', null, null),
  ('a0000000-0000-4000-8000-000000000018', 'Convoyeur Lozère — Gaëtan Brager-Therond', 'convoyeur', 'les_deux', 'FR', 'Mende', 44.518, 3.500, 'Gaëtan Brager-Therond', '+33 6 33 84 87 81', '', '', '', '', '', 'Convoyeur (Lozère).', null, null)
on conflict (id) do nothing;

-- Stock par marque du répertoire NL (ordre du fichier : Ford, Peugeot, Opel,
-- Citroën/DS, Mercedes, Renault, Dacia, VW, Kia, Skoda, Fiat, Audi, Seat,
-- Nissan, MG, Volvo, BMW, Toyota, Hyundai, Mitsubishi, Jeep, Suzuki, Alfa
-- Romeo, Cupra, BYD, Land Rover, Lexus, Mazda). Zéros non enregistrés.
with brands as (
  select * from unnest(array['FORD','PEUGEOT','OPEL','CITROEN','MERCEDES','RENAULT','DACIA','VOLKSWAGEN','KIA','SKODA','FIAT','AUDI','SEAT','NISSAN','MG','VOLVO','BMW','TOYOTA','HYUNDAI','MITSUBISHI','JEEP','SUZUKI','ALFA ROMEO','CUPRA','BYD','LAND ROVER','LEXUS','MAZDA']) with ordinality as b(brand, i)
), stock as (
  select * from (values
    ('a0000000-0000-4000-8000-000000000001'::uuid, array[14,11,10,7,7,16,14,6,5,3,4,1,3,6,22,2,0,0,4,0,2,0,2,2,0,3,0,0]),
    ('a0000000-0000-4000-8000-000000000002'::uuid, array[0,10,8,12,7,12,12,7,0,4,6,5,1,11,0,0,12,0,5,6,0,0,0,1,0,0,0,0]),
    ('a0000000-0000-4000-8000-000000000003'::uuid, array[13,15,16,9,0,0,0,9,0,8,6,5,8,0,0,12,0,0,3,0,3,0,3,3,0,1,0,0]),
    ('a0000000-0000-4000-8000-000000000004'::uuid, array[12,6,9,7,9,10,10,0,9,0,8,0,0,5,0,7,7,0,0,0,3,0,3,0,6,1,0,0]),
    ('a0000000-0000-4000-8000-000000000005'::uuid, array[8,0,0,0,0,8,8,0,8,0,0,0,0,5,0,0,0,0,4,6,0,5,0,0,0,0,0,0]),
    ('a0000000-0000-4000-8000-000000000006'::uuid, array[4,9,7,12,0,0,0,0,5,0,6,0,0,0,0,0,0,0,2,0,4,0,2,0,0,0,0,0]),
    ('a0000000-0000-4000-8000-000000000007'::uuid, array[0,0,0,0,7,0,0,0,5,0,0,0,0,0,0,0,0,19,0,0,0,7,0,0,0,0,5,4]),
    ('a0000000-0000-4000-8000-000000000008'::uuid, array[0,0,0,0,0,0,0,10,0,9,0,9,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]),
    ('a0000000-0000-4000-8000-000000000009'::uuid, array[10,0,0,0,17,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]),
    ('a0000000-0000-4000-8000-000000000010'::uuid, array[0,0,0,0,0,0,0,6,0,7,0,5,6,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0]),
    ('a0000000-0000-4000-8000-000000000011'::uuid, array[0,0,0,0,0,0,0,5,0,4,0,4,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])
  ) as s(contact_id, counts)
)
insert into public.network_contact_models (contact_id, brand, model, qty)
select s.contact_id, b.brand, '', s.counts[b.i]
from stock s cross join brands b
where s.counts[b.i] > 0
on conflict (contact_id, brand, model) do nothing;

-- Marques d'intérêt des prospects (sans quantité).
insert into public.network_contact_models (contact_id, brand, model, qty, note) values
  ('a0000000-0000-4000-8000-000000000005', 'SUZUKI', '', null, 'potentiel volume HEV'),
  ('a0000000-0000-4000-8000-000000000005', 'RENAULT', '', null, 'potentiel volume HEV'),
  ('a0000000-0000-4000-8000-000000000015', 'SKODA', 'ELROQ', null, 'déjà vendu un exemplaire')
on conflict (contact_id, brand, model) do nothing;

select 'ok' as tout_est_bon;

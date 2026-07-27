-- ═══════════════════════════════════════════════════════════════════════════
-- RÉFÉRENTIEL FISCAL AUTOMOBILE PAR PAYS (UE + Schengen) — demande Channing 27/07.
-- Priorités : coût à l''immatriculation, où les électriques sont favorisées,
-- malus, historique des bonus par pays.
--
-- Cycle de vie d''un profil :
--   1. Amorce ci-dessous : connaissances générales, verified=false → affiché
--      « à vérifier » dans ADA, sources vides (on n''invente pas d''URL).
--   2. Collecte IA du worker (legalWatchCollector + ANTHROPIC_API_KEY sur
--      Railway) : recherche web réelle, met à jour le profil, verified=true,
--      sources remplies.
-- Additif uniquement ; le seed utilise ON CONFLICT DO NOTHING pour ne jamais
-- écraser un profil déjà rafraîchi par la collecte.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.country_fiscal_profiles (
  country text primary key,                              -- code ISO2 (GR pour la Grèce)
  country_name text not null default '',
  bloc text not null default 'UE',                       -- 'UE' | 'Schengen (hors UE)'
  ada_market boolean not null default false,             -- pays de chasse ADA (mis en avant)
  registration_cost text not null default '',            -- coût à l''immatriculation, en clair
  registration_cost_level text not null default 'moyen', -- 'faible' | 'moyen' | 'eleve'
  ev_favorable boolean,                                  -- null = inconnu
  ev_incentives text not null default '',
  malus text not null default '',
  bonus_history jsonb not null default '[]'::jsonb,      -- [{"year": "...", "label": "..."}]
  sources jsonb not null default '[]'::jsonb,            -- [url] — remplies par la collecte
  verified boolean not null default false,               -- true = confirmé (collecte IA ou humain)
  updated_by text not null default 'seed',
  updated_at timestamptz not null default now()
);

alter table public.country_fiscal_profiles enable row level security;
drop policy if exists "fiscal_profiles_select" on public.country_fiscal_profiles;
create policy "fiscal_profiles_select" on public.country_fiscal_profiles
  for select to authenticated using (true);
drop policy if exists "fiscal_profiles_write" on public.country_fiscal_profiles;
create policy "fiscal_profiles_write" on public.country_fiscal_profiles
  for all to authenticated using (true) with check (true);

-- ── Amorce : les 7 pays ADA (détaillés) puis le reste de l''UE/Schengen ──────
insert into public.country_fiscal_profiles
  (country, country_name, bloc, ada_market, registration_cost, registration_cost_level, ev_favorable, ev_incentives, malus, bonus_history, updated_by)
values
  ('FR', 'France', 'UE', true,
   'Carte grise : taxe régionale par cheval fiscal (~30-60 EUR/CV) + malus CO2 et malus au poids sur les imports — décote de 10 % par année d''ancienneté pour les occasions importées.',
   'eleve', true,
   'Exonération totale de malus ; carte grise gratuite ou à moitié prix selon les régions ; leasing social.',
   'Malus CO2 dès ~113 g/km, plafond durci chaque année (dizaines de milliers d''EUR possibles) ; malus au poids dès 1 600 kg pour les thermiques.',
   '[{"year":"2020-2022","label":"Bonus jusqu''à 7 000 EUR (VE < 45 000 EUR)"},{"year":"2023","label":"Bonus 5 000 à 7 000 EUR selon revenus"},{"year":"2024","label":"Score environnemental : VE produits hors Europe exclus du bonus"},{"year":"2025","label":"Bonus réduit (2 000 à 4 000 EUR selon revenus) + leasing social"},{"year":"2026","label":"Aide basculée sur le dispositif CEE (coup de pouce VE)"}]'::jsonb,
   'seed (à vérifier)'),

  ('NL', 'Pays-Bas', 'UE', true,
   'BPM indexée CO2, parmi les plus lourdes d''Europe — les occasions importées paient la BPM au prorata de la décote (table officielle). Voir l''onglet BPM TAX du classeur MC Export.',
   'eleve', true,
   'BPM quasi nulle pour les VE (montant fixe réduit depuis 2025) ; taxe de circulation (MRB) à tarif réduit — avantages en extinction progressive.',
   'Pas de malus séparé : la BPM CO2 en tient lieu et pénalise fortement les thermiques émetteurs.',
   '[{"year":"2020-2024","label":"Subvention SEPP : 2 950 EUR neuf / 2 000 EUR occasion"},{"year":"2025","label":"SEPP supprimée (enveloppe épuisée)"}]'::jsonb,
   'seed (à vérifier)'),

  ('DK', 'Danemark', 'UE', true,
   'Registreringsafgift par tranches de valeur (jusqu''à ~150 % sur la tranche haute) — le pays le plus cher d''Europe à l''immatriculation.',
   'eleve', true,
   'VE : taxe d''immatriculation fortement abattue (pourcentage réduit + abattement batterie), remontée progressive planifiée vers 2035.',
   'Intégré à la taxe d''immatriculation (supplément selon émissions/consommation).',
   '[{"year":"2016-2020","label":"Réintroduction progressive de la taxe sur les VE"},{"year":"2021-2025","label":"Accord climat : VE à taxation très réduite pendant la montée en charge"}]'::jsonb,
   'seed (à vérifier)'),

  ('DE', 'Allemagne', 'UE', true,
   'Pas de taxe d''immatriculation — simples frais administratifs (~30-70 EUR). Marché source majeur : sortie de véhicule bon marché.',
   'faible', true,
   'Exonération de Kfz-Steuer (taxe annuelle) pour les VE ; avantage en nature réduit pour les VE de fonction.',
   'Pas de malus à l''achat ; Kfz-Steuer annuelle indexée CO2.',
   '[{"year":"2016-2022","label":"Umweltbonus jusqu''à 9 000 EUR"},{"year":"2023","label":"Réduit à ~4 500 EUR, hybrides rechargeables exclus"},{"year":"2023-12","label":"Suppression brutale (crise budgétaire) — chute des ventes VE 2024"},{"year":"2025","label":"Débat sur une nouvelle aide ciblée bas revenus"}]'::jsonb,
   'seed (à vérifier)'),

  ('IT', 'Italie', 'UE', true,
   'IPT provinciale (~150-500 EUR selon kW et province) + frais PRA — pas de taxe CO2 à l''immatriculation.',
   'moyen', true,
   'Exonération de bollo (taxe annuelle) 5 ans, permanente au Piémont et en Lombardie ; IPT réduite selon provinces.',
   'Pas de malus généralisé ; superbollo de 20 EUR/kW au-delà de 185 kW (pénalise les sportives).',
   '[{"year":"2019-2021","label":"Ecobonus + ecotassa (malus 1 100-2 500 EUR, supprimé fin 2021)"},{"year":"2022-2023","label":"Ecobonus 3 000-5 000 EUR avec mise à la casse"},{"year":"2024","label":"Jusqu''à 13 750 EUR (bas revenus + casse) — enveloppe épuisée en heures"},{"year":"2025","label":"Relances ponctuelles, budget limité"}]'::jsonb,
   'seed (à vérifier)'),

  ('ES', 'Espagne', 'UE', true,
   'Impuesto de matriculación indexé CO2 : 0 % sous ~120 g/km, paliers jusqu''à 14,75 % au-delà de ~200 g/km.',
   'moyen', true,
   '0 % de taxe d''immatriculation pour les VE ; réductions locales de taxe de circulation (IVTM) jusqu''à -75 % dans les grandes villes ; étiquette CERO (accès ZFE).',
   'La taxe d''immatriculation CO2 fait office de malus sur les fortes émissions.',
   '[{"year":"2020","label":"Plan MOVES II"},{"year":"2021-2025","label":"MOVES III : jusqu''à 7 000 EUR avec mise à la casse, prolongé plusieurs fois"}]'::jsonb,
   'seed (à vérifier)'),

  ('BE', 'Belgique', 'UE', true,
   'Taxe de mise en circulation (TMC) régionale : Flandre indexée CO2/norme Euro, Wallonie et Bruxelles par CV/kW.',
   'moyen', true,
   'VE exonérés de TMC et de taxe de circulation en Flandre ; déductibilité 100 % pour les sociétés.',
   'Flandre : TMC alourdie pour les fortes émissions ; déductibilité fiscale des thermiques de société vers 0 % (2026-2028) — flux massif de thermiques récents vers le marché de l''occasion.',
   '[{"year":"2024","label":"Flandre : prime 5 000 EUR neuf / 3 000 EUR occasion"},{"year":"2025","label":"Prime flamande arrêtée (enveloppe épuisée)"}]'::jsonb,
   'seed (à vérifier)'),

  -- ── Reste de l''UE ─────────────────────────────────────────────────────────
  ('AT', 'Autriche', 'UE', false,
   'NoVA indexée CO2 sur le prix (progressive, lourde pour les fortes émissions) + TVA.',
   'eleve', true,
   'VE exonérés de NoVA et de taxe moteur ; TVA déductible pour les entreprises.',
   'La NoVA joue le rôle de malus (majoration au-delà des seuils CO2).',
   '[{"year":"2020-2023","label":"Bonus 3 000 à 5 000 EUR"},{"year":"2024-2025","label":"Aide réduite, recentrée sur les pros puis les particuliers modestes"}]'::jsonb,
   'seed (à vérifier)'),

  ('PT', 'Portugal', 'UE', false,
   'ISV basée cylindrée + CO2, très lourde — voitures parmi les plus chères d''Europe ; les imports d''occasion paient une ISV décotée.',
   'eleve', true,
   'VE exonérés d''ISV et d''IUC (taxe annuelle).',
   'La composante CO2 de l''ISV fait office de malus.',
   '[{"year":"2020-2025","label":"Incitation à l''achat VE ~3 000-4 000 EUR, enveloppes annuelles limitées"}]'::jsonb,
   'seed (à vérifier)'),

  ('IE', 'Irlande', 'UE', false,
   'VRT de 7 à 41 % de la valeur marchande (OMSP) selon CO2 + taxe NOx — s''applique aussi aux imports d''occasion.',
   'eleve', true,
   'Abattement VRT pour les VE (jusqu''à 5 000 EUR, dégressif et plafonné par la valeur).',
   'Barème VRT + NOx : les diesels anciens sont lourdement taxés à l''import.',
   '[{"year":"2020-2023","label":"Aide SEAI 5 000 EUR"},{"year":"2023-2025","label":"Réduite à 3 500 EUR"}]'::jsonb,
   'seed (à vérifier)'),

  ('FI', 'Finlande', 'UE', false,
   'Autovero : pourcentage de la valeur indexé CO2 — les imports d''occasion paient une autovero décotée.',
   'moyen', true,
   'Autovero à 0 % pour les VE depuis fin 2021.',
   'La composante CO2 de l''autovero fait office de malus.',
   '[{"year":"2018-2022","label":"Prime à l''achat VE 2 000 EUR (supprimée)"}]'::jsonb,
   'seed (à vérifier)'),

  ('SE', 'Suède', 'UE', false,
   'Pas de taxe d''immatriculation — frais administratifs minimes.',
   'faible', null,
   'Plus de bonus à l''achat ; taxe annuelle standard pour les VE.',
   'Fordonsskatt majorée les 3 premières années pour les fortes émissions (système malus conservé après la fin du bonus).',
   '[{"year":"2018-2022","label":"Klimatbonus jusqu''à ~70 000 SEK"},{"year":"2022-11","label":"Bonus supprimé du jour au lendemain"}]'::jsonb,
   'seed (à vérifier)'),

  ('PL', 'Pologne', 'UE', false,
   'Accise à l''import : 3,1 % (moteur ≤ 2,0 L) ou 18,6 % (> 2,0 L) de la valeur — hybrides réduits, VE exonérés.',
   'moyen', true,
   'VE exonérés d''accise ; avantages de circulation (voies bus, parking).',
   'Pas de malus CO2 ; l''accise 18,6 % pénalise de fait les grosses cylindrées.',
   '[{"year":"2021-2024","label":"Mój Elektryk : jusqu''à ~27 000 PLN"},{"year":"2025","label":"NaszEauto : jusqu''à ~40 000 PLN (avec casse et plafond revenu)"}]'::jsonb,
   'seed (à vérifier)'),

  ('CZ', 'Tchéquie', 'UE', false,
   'Pas de taxe d''immatriculation — écotaxe unique (3 000 à 10 000 CZK) sur les vieilles normes Euro 0-2 uniquement.',
   'faible', null,
   'Aides surtout pour les entreprises ; VE exonérés de vignette autoroutière.',
   'Pas de malus.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('SK', 'Slovaquie', 'UE', false,
   'Frais d''immatriculation selon la puissance (kW) et l''âge — de ~33 EUR à quelques milliers d''EUR pour les grosses puissances récentes.',
   'moyen', null,
   'Frais minimum pour les VE.',
   'Pas de malus CO2 ; le barème kW pénalise les fortes puissances.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('HU', 'Hongrie', 'UE', false,
   'Regisztrációs adó par cylindrée et norme environnementale — VE à 0 Ft.',
   'moyen', true,
   'Plaque verte : taxe d''immatriculation nulle, gratuités de circulation et de parking.',
   'Pas de malus CO2 ; barème défavorable aux vieilles normes.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('RO', 'Roumanie', 'UE', false,
   'Pas de taxe d''immatriculation depuis la suppression du timbru de mediu (2017) — simples frais administratifs.',
   'faible', true,
   'Programme Rabla Plus pour les VE.',
   'Pas de malus.',
   '[{"year":"2020-2024","label":"Rabla Plus : jusqu''à ~10 000 EUR pour un VE (le plus généreux d''Europe)"},{"year":"2025","label":"Aide fortement réduite (~3 700 EUR)"}]'::jsonb,
   'seed (à vérifier)'),

  ('BG', 'Bulgarie', 'UE', false,
   'Éco-taxe modeste + frais administratifs — parmi les entrées les moins chères de l''UE.',
   'faible', null,
   'Exonération de taxe annuelle pour les VE dans plusieurs communes.',
   'Pas de malus.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('HR', 'Croatie', 'UE', false,
   'Taxe spéciale (trošarina) sur la valeur + composante CO2.',
   'moyen', true,
   'VE exonérés de la taxe spéciale ; enveloppes de subvention annuelles.',
   'La composante CO2 de la taxe fait office de malus.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('SI', 'Slovénie', 'UE', false,
   'DMV de 0,5 à 31 % de la valeur selon CO2 et carburant.',
   'moyen', true,
   'DMV à 0,5 % pour les VE ; subventions Eko sklad.',
   'Le barème CO2 de la DMV fait office de malus.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('EE', 'Estonie', 'UE', false,
   'NOUVEAU : taxe d''immatriculation introduite en 2025 (base + composantes CO2 et masse) — auparavant quasi gratuite.',
   'moyen', null,
   'Barème réduit pour les VE.',
   'Composante CO2 de la nouvelle taxe.',
   '[{"year":"2025","label":"Introduction de la première taxe d''immatriculation estonienne"}]'::jsonb,
   'seed (à vérifier)'),

  ('LV', 'Lettonie', 'UE', false,
   'Frais d''immatriculation modestes ; taxe d''exploitation annuelle indexée CO2.',
   'faible', null,
   'Taxe annuelle réduite pour les VE.',
   'Pas de malus à l''achat.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('LT', 'Lituanie', 'UE', false,
   'Taxe pollution à l''immatriculation depuis 2020 (selon CO2 et carburant, de ~14 à ~540 EUR).',
   'faible', true,
   'VE exonérés de la taxe pollution ; primes à la casse pour VE d''occasion.',
   'La taxe pollution croît avec le CO2 (diesel pénalisé).',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('GR', 'Grèce', 'UE', false,
   'Taxe d''immatriculation sur la valeur avec majorations CO2 et norme Euro — lourde pour les imports anciens.',
   'eleve', true,
   'VE exonérés de taxe d''immatriculation et de taxe de circulation.',
   'Majorations fortes pour les vieilles normes Euro.',
   '[{"year":"2020-2025","label":"Kinoume Ilektrika : subvention VE renouvelée par vagues"}]'::jsonb,
   'seed (à vérifier)'),

  ('CY', 'Chypre', 'UE', false,
   'Droits d''immatriculation et taxe de circulation indexés CO2.',
   'moyen', true,
   'Subventions VE par appels à projets ; taxe réduite.',
   'Barème CO2 progressif.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('MT', 'Malte', 'UE', false,
   'Taxe d''immatriculation élevée (valeur, CO2, longueur du véhicule) — conduite à droite : marché non pertinent pour l''export continental.',
   'eleve', true,
   'Fortes subventions VE (jusqu''à ~11 000 EUR avec casse).',
   'Barème CO2 progressif.',
   '[]'::jsonb,
   'seed (à vérifier)'),

  ('LU', 'Luxembourg', 'UE', false,
   'Pas de taxe d''immatriculation — frais minimes (vignette).',
   'faible', true,
   'Klimabonus pour les VE.',
   'Pas de malus ; taxe annuelle CO2 modérée.',
   '[{"year":"2019-2024","label":"Klimabonus jusqu''à 8 000 EUR"},{"year":"2024-2026","label":"Réduit à ~6 000 EUR (critères d''efficience)"}]'::jsonb,
   'seed (à vérifier)'),

  -- ── Schengen hors UE : attention, export = formalités douanières ───────────
  ('NO', 'Norvège', 'Schengen (hors UE)', false,
   'HORS UNION DOUANIÈRE : export = déclaration douane + TVA locale. Taxe d''immatriculation poids/CO2/NOx élevée pour les thermiques.',
   'eleve', true,
   'VE historiquement exonérés de tout (TVA comprise) — TVA 25 % réintroduite au-delà de 500 000 NOK depuis 2023 ; ~90 % des ventes neuves sont électriques.',
   'Barème poids + CO2 + NOx : les thermiques sont massivement taxés.',
   '[{"year":"1990-2022","label":"Paquet VE le plus généreux du monde (0 TVA, 0 taxe, péages gratuits)"},{"year":"2023-2025","label":"Avantages rognés progressivement (TVA partielle, péages payants)"}]'::jsonb,
   'seed (à vérifier)'),

  ('CH', 'Suisse', 'Schengen (hors UE)', false,
   'HORS UE : import = droit auto 4 % + TVA 8,1 % + dédouanement. Pas de taxe fédérale d''immatriculation ; taxes cantonales annuelles.',
   'faible', null,
   'Exonération du droit auto 4 % pour les VE supprimée en 2024 ; avantages cantonaux variables.',
   'Pas de malus fédéral ; quelques cantons majorent les fortes émissions.',
   '[{"year":"1997-2023","label":"VE exonérés du droit d''importation de 4 %"},{"year":"2024","label":"Exonération supprimée"}]'::jsonb,
   'seed (à vérifier)'),

  ('IS', 'Islande', 'Schengen (hors UE)', false,
   'HORS UE : droits d''importation + accise indexée CO2 + TVA.',
   'moyen', true,
   'Abattement TVA VE remplacé par une subvention directe plafonnée (2024).',
   'Accise CO2 progressive.',
   '[]'::jsonb,
   'seed (à vérifier)')
on conflict (country) do nothing;

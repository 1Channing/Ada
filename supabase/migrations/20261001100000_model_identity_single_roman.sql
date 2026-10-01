/*
  Identité v4 : une lettre seule n'est pas une génération (01/10).

  Constat (campagne Model X du 01/10) : ada_model_key retirait tout numéral
  romain en fin de nom pour fondre « Golf IV » dans « Golf ». « X » vaut 10 :
  « Model X » devenait « Model ». Dégâts constatés, tous sur preuve :
    - référentiel : le Model X importé sous le nom « Model » (2015→) ;
    - mémoire : un mapping Marktplaats TESLA « MODEL » né d'une recherche
      texte libre « tesla model » (29/07), validé « humain » deux fois, avec
      2 relevés MI qui mélangent toutes les Tesla ;
    - campagne « Model x » : 0 étude précise, 4 pages marque ;
    - MI : « Model X » (Leboncoin, 8 obs) fondu dans « Model » au menu ;
    - « Aygo X » (386 relevés, modèle distinct depuis 2022) fondu dans « Aygo ».

  Correctif : on ne retire que II à IX. Règle jumelle de ROMAN_GENERATION_RE
  (marketData.ts, même commit) et des importeurs Python.

  Colonnes de clés : brand_key / model_key étaient GÉNÉRÉES STORED sur
  market_listing_observations (26/08) — impossibles à recalculer sans
  réécrire toute la table. Elles deviennent des colonnes ORDINAIRES tenues
  par un trigger (même valeur, même index), ce qui permet de ne recalculer
  QUE les lignes touchées (noms finissant par I, V ou X). Aucune réécriture
  de table, pas de REINDEX : l'index suit les UPDATE.

  Données : référentiel Tesla « Model » → « Model X » (clé MODELX), Toyota
  « Aygo » 2022→ → « Aygo X » (AYGOX), motorisations EEA TESLA MODEL → MODELX ;
  suppression du mapping Marktplaats « MODEL » et de ses 2 relevés (des
  données fausses valent moins que zéro donnée).
*/

-- ── 1. Clé modèle v4 : romains II à IX seulement (reste du corps v3 intact) ─
create or replace function ada_model_key(p_brand text, p_model text)
returns text language plpgsql immutable parallel safe as $$
declare
  v text := trim(coalesce(p_model, ''));
  v2 text;
  m text[];
begin
  -- 1. Génération en romain, II à IX seulement (Golf IV, C4 III, Ignis II).
  --    Jamais une lettre seule : « Model X », « Aygo X », « 500 X » sont des noms.
  v := regexp_replace(v, '\s+(II|III|IV|VI{1,3}|IX)$', '', 'i');
  -- 2. Mercedes : X-Class / Classe X / X-Klasse → code nu.
  if public.ada_brand_key(p_brand) = 'MERCEDES' then
    m := regexp_match(v, '^([A-Za-z]{1,3})[- ]?(?:CLASS|KLASSE)$', 'i');
    if m is null then
      m := regexp_match(v, '^(?:CLASSE|CLASE|CLASS)\s+([A-Za-z]{1,3})$', 'i');
    end if;
    if m is not null then v := m[1]; end if;
  end if;
  -- 3. Séries : SERIE 3 / SÉRIE 3 / 3-Series / 3-serie / 3er(-Reihe) → 3.
  m := regexp_match(v, '^(?:SERIE|SÉRIE|SERIES)\s+(\w{1,3})$', 'i');
  if m is null then m := regexp_match(v, '^(\w{1,3})[- ]?SERIES?$', 'i'); end if;
  if m is null then m := regexp_match(v, '^(\d)[- ]?ER(?:[- ]?REIHE)?$', 'i'); end if;
  if m is not null then v := m[1]; end if;
  -- 4. Motorisation en fin de nom → dépouillée tant qu'il reste un nom.
  loop
    v2 := regexp_replace(v, '\s+(EV|BEV|HEV|PHEV|MHEV|FHEV|HYBRIDE?|ELECTRIC|[ÉE]LECTRIQUE|ELETTRICA|PLUG[- ]?IN([- ]HYBRIDE?)?)$', '', 'i');
    exit when v2 = v or btrim(v2) = '';
    v := v2;
  end loop;
  -- 5. Clé canonique déburrée.
  return regexp_replace(public.ada_deburr(v), '[^A-Z0-9]', '', 'g');
end $$;

grant execute on function ada_model_key(text, text) to anon, authenticated;

-- ── 2. Colonnes de clés : générées → ordinaires + trigger (idempotent) ──────
do $$ begin
  if exists (select 1 from pg_attribute
             where attrelid = 'public.market_listing_observations'::regclass
               and attname = 'model_key' and attgenerated = 's') then
    alter table market_listing_observations
      alter column brand_key drop expression,
      alter column model_key drop expression;
  end if;
end $$;

create or replace function ada_set_identity_keys()
returns trigger language plpgsql as $$
begin
  new.brand_key := public.ada_brand_key(new.brand);
  new.model_key := public.ada_model_key(new.brand, new.model);
  return new;
end $$;

drop trigger if exists trg_mlo_identity_keys on market_listing_observations;
create trigger trg_mlo_identity_keys
  before insert or update of brand, model on market_listing_observations
  for each row execute function ada_set_identity_keys();

-- L'archive (créée LIKE la table chaude, colonnes ordinaires) reçoit le même
-- trigger : une ligne déplacée ou corrigée garde une clé juste.
do $$ begin
  if to_regclass('public.market_listing_observations_archive') is not null
     and exists (select 1 from pg_attribute
                 where attrelid = 'public.market_listing_observations_archive'::regclass
                   and attname = 'model_key' and not attisdropped) then
    drop trigger if exists trg_mlo_archive_identity_keys on market_listing_observations_archive;
    create trigger trg_mlo_archive_identity_keys
      before insert or update of brand, model on market_listing_observations_archive
      for each row execute function ada_set_identity_keys();
  end if;
end $$;

-- ── 3. Recalcul des SEULES lignes touchées (nom finissant par I, V ou X) ────
update market_listing_observations
   set model_key = public.ada_model_key(brand, model)
 where model ~* '\s(I|V|X)\s*$'
   and model_key is distinct from public.ada_model_key(brand, model);

do $$ begin
  if to_regclass('public.market_listing_observations_archive') is not null then
    update market_listing_observations_archive
       set model_key = public.ada_model_key(brand, model)
     where model ~* '\s(I|V|X)\s*$'
       and model_key is distinct from public.ada_model_key(brand, model);
  end if;
end $$;

-- ── 4. Référentiel : les deux modèles mutilés retrouvent leur nom ───────────
update vehicle_ref_generations
   set model_key = 'MODELX', model_label = 'Model X'
 where brand_key = 'TESLA' and model_key = 'MODEL';

update vehicle_ref_generations
   set model_key = 'AYGOX', model_label = 'Aygo X'
 where brand_key = 'TOYOTA' and model_key = 'AYGO' and year_from >= 2022;

update vehicle_ref_motorisations
   set model_key = 'MODELX'
 where brand_key = 'TESLA' and model_key = 'MODEL'
   and not exists (select 1 from vehicle_ref_motorisations x
                   where x.brand_key = 'TESLA' and x.model_key = 'MODELX'
                     and x.fuel = vehicle_ref_motorisations.fuel
                     and x.source = vehicle_ref_motorisations.source);

-- ── 5. Faux mapping « tesla model » (Marktplaats) et ses relevés ────────────
delete from market_listing_observations
 where snapshot_id in ('a244ac78-a40b-4068-94c1-2c094c4ab89f', '3b88ecf0-9754-4092-a755-98705c48ea4a');
do $$ begin
  if to_regclass('public.market_listing_observations_archive') is not null then
    delete from market_listing_observations_archive
     where snapshot_id in ('a244ac78-a40b-4068-94c1-2c094c4ab89f', '3b88ecf0-9754-4092-a755-98705c48ea4a');
  end if;
end $$;
delete from market_snapshots
 where id in ('a244ac78-a40b-4068-94c1-2c094c4ab89f', '3b88ecf0-9754-4092-a755-98705c48ea4a');
delete from linkgen_mapping_memory
 where id = '44108c86-3ef2-4d43-9314-b296b406177a'
    or (upper(brand) = 'TESLA' and upper(model) = 'MODEL');

-- ── 6. Contrôle (seul résultat affiché par l'éditeur SQL) ───────────────────
select
      public.ada_model_key('TESLA', 'Model X')      = 'MODELX'
  and public.ada_model_key('TOYOTA', 'Aygo X')      = 'AYGOX'
  and public.ada_model_key('FIAT', '500 X')         = '500X'
  and public.ada_model_key('VOLKSWAGEN', 'Golf IV') = 'GOLF'       -- II à IX intacts
  and public.ada_model_key('CITROEN', 'C4 III')     = 'C4'
  and public.ada_model_key('SUZUKI', 'Ignis II')    = 'IGNIS'
  and public.ada_model_key('HYUNDAI', 'KONA EV')    = 'KONA'       -- v2 intacte
  and public.ada_model_key('MERCEDES', 'CLASSE E')  = 'E'          -- v1 intacte
  and public.ada_model_key('BMW', 'SÉRIE 3')        = '3'
  and public.ada_model_key('SEAT', 'LÉON')          = 'LEON'       -- v3 intacte
  and not exists (select 1 from pg_attribute
                  where attrelid = 'public.market_listing_observations'::regclass
                    and attname = 'model_key' and attgenerated = 's')
  and not exists (select 1 from market_listing_observations
                  where model ~* '\s(I|V|X)\s*$'
                    and model_key is distinct from public.ada_model_key(brand, model))
  and exists (select 1 from vehicle_ref_generations where brand_key = 'TESLA' and model_key = 'MODELX')
  and not exists (select 1 from linkgen_mapping_memory where upper(brand) = 'TESLA' and upper(model) = 'MODEL')
  as tout_est_bon;

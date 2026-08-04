/*
  Identité modèle v2 : la motorisation n'est pas un modèle (04/08).

  Constat MI : le menu Modèle listait « KONA » ET « KONA EV », « TUCSON » /
  « TUCSON HEV » / « TUCSON PHEV » comme des modèles distincts (héritage du
  référentiel constructeur) — segments dédoublés, radar inter-pays aveugle
  aux paires. La motorisation vit dans le champ CARBURANT : ada_model_key
  dépouille désormais les suffixes EV/BEV/HEV/PHEV/MHEV/FHEV/Hybrid(e)/
  Electric/Électrique/Elettrica/Plug-in (Hybrid) en fin de nom, en boucle,
  tant qu'il reste un nom. Jetons complets uniquement : « CLASSE E »
  (E seul), « EV6 »/« EV9 » Kia (un seul jeton), « Mach-E » sont intouchés.
  Même logique répliquée côté TypeScript (refModelKey) — les vecteurs de
  contrôle font foi des deux côtés.

  IMPORTANT — REINDEX OBLIGATOIRE : l'index d'expression
  idx_mlo_identity_scraped stocke les valeurs CALCULÉES par ada_model_key à
  l'insertion. Redéfinir la fonction rend ces valeurs périmées (l'index
  répondrait faux en silence) : le REINDEX en fin de fichier les recalcule.
*/

create or replace function ada_model_key(p_brand text, p_model text)
returns text language plpgsql immutable parallel safe as $$
declare
  v text := trim(coalesce(p_model, ''));
  v2 text;
  m text[];
begin
  -- 1. Numéral romain de génération en fin de nom (Golf IV, C4 III, Ignis II).
  v := regexp_replace(v, '\s+(I{1,3}|IV|V|VI{0,3}|IX|X{1,2})$', '', 'i');
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
  -- 5. Clé canonique.
  return regexp_replace(upper(v), '[^A-Z0-9]', '', 'g');
end $$;

grant execute on function ada_model_key(text, text) to anon, authenticated;

-- Recalcule les valeurs stockées de l'index d'expression (voir en-tête).
reindex index idx_mlo_identity_scraped;

-- ── Contrôles après application — vecteurs partagés avec le TS ─────────────
-- select ada_model_key('HYUNDAI', 'KONA EV')            = 'KONA';    -- true
-- select ada_model_key('HYUNDAI', 'TUCSON PHEV')        = 'TUCSON';  -- true
-- select ada_model_key('TOYOTA', 'PRIUS PLUG-IN HYBRID') = 'PRIUS';  -- true
-- select ada_model_key('MITSUBISHI', 'OUTLANDER PHEV')  = 'OUTLANDER'; -- true
-- select ada_model_key('MERCEDES', 'CLASSE E')          = 'E';       -- true (intouché)
-- select ada_model_key('KIA', 'EV6')                    = 'EV6';     -- true (intouché)
-- select ada_model_key('MERCEDES', 'CLASSE CLA')        = 'CLA';     -- true (v1 intacte)
-- select ada_model_key('BMW', 'SÉRIE 3')                = '3';       -- true (v1 intacte)
-- select count(*) from mi_cheap_medians(now() - interval '30 days'); -- répond < 30 s

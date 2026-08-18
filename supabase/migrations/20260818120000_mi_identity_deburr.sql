/*
  Identité v3 : translittération des accents dans les clés (18/08).

  Constat MI : « ŠKODA » (référentiel, 2 944 obs) et « SKODA » (sites,
  7 588 obs) vivaient comme DEUX marques — ada_brand_key supprimait le Š
  (hors [A-Z]) au lieu de le translittérer : 'ŠKODA' → 'KODA' ≠ 'SKODA'.
  Même scission pour CITROËN → 'CITRON' (419 vs 1 605 CITROEN) et
  LÉON → 'LON' (741 vs 3 283 LEON). Menus dédoublés, comparaisons qui ne
  voient qu'une partie du marché, radar inter-pays aveugle entre graphies.

  Correctif : ada_deburr translittère (Š→S, Ë→E, É→E, Ø→O…) AVANT le strip
  alphanumérique, dans ada_brand_key et ada_model_key. Aucune donnée
  réécrite : les libellés stockés restent tels quels, seule la CLÉ change.
  Règle strictement jumelle du canonKey TypeScript (même commit) — la table
  translate couvre chaque lettre accentuée des langues du réseau et a été
  vérifiée caractère par caractère contre la décomposition NFD du TS.

  IMPORTANT — REINDEX OBLIGATOIRE : l'index d'expression
  idx_mlo_identity_scraped stocke les valeurs CALCULÉES par ces fonctions ;
  les redéfinir rend l'index périmé (réponses fausses en silence). Le
  REINDEX en fin de fichier recalcule tout — laisse-le finir.
*/

-- ── 1. Translittération partagée (MAJ + accents → ASCII) ────────────────────
create or replace function ada_deburr(p text)
returns text language sql immutable parallel safe as $$
  select translate(upper(coalesce(p, '')),
    'ÀÁÂÃÄÅĀĂĄÇĆĈČĎĐÈÉÊËĒĖĘĚĜĞĢÌÍÎÏĨĪĮĶĹĻĽŁÑŃŅŇÒÓÔÕÖŐØŌŔŘŚŜŞŠȘŢŤȚÙÚÛÜŨŪŬŮŰŲŴÝŶŸŹŻŽ',
    'AAAAAAAAACCCCDDEEEEEEEEGGGIIIIIIIKLLLLNNNNOOOOOOOORRSSSSSTTTUUUUUUUUUUWYYYZZZ')
$$;

grant execute on function ada_deburr(text) to anon, authenticated;

-- ── 2. Clé marque v2 : déburrée ─────────────────────────────────────────────
create or replace function ada_brand_key(p text)
returns text language sql immutable parallel safe as $$
  select case regexp_replace(public.ada_deburr(p), '[^A-Z0-9]', '', 'g')
    when 'MERCEDESBENZ' then 'MERCEDES'
    when 'VW' then 'VOLKSWAGEN'
    else regexp_replace(public.ada_deburr(p), '[^A-Z0-9]', '', 'g')
  end
$$;

-- ── 3. Clé modèle v3 : corps v2 inchangé (romains, Classes, Séries,
--       motorisations en boucle) — seule l'étape finale déburre ─────────────
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
  -- 5. Clé canonique déburrée ('MÉGANE' → 'MEGANE', plus jamais 'MGANE').
  return regexp_replace(public.ada_deburr(v), '[^A-Z0-9]', '', 'g');
end $$;

grant execute on function ada_model_key(text, text) to anon, authenticated;

-- ── 4. Recalcule les valeurs stockées de l'index d'expression ───────────────
reindex index idx_mlo_identity_scraped;

-- ── 5. Contrôle (seul résultat affiché par l'éditeur SQL) ───────────────────
select
      public.ada_brand_key('ŠKODA')   = public.ada_brand_key('Skoda')
  and public.ada_brand_key('ŠKODA')   = 'SKODA'
  and public.ada_brand_key('CITROËN') = 'CITROEN'
  and public.ada_model_key('SEAT', 'LÉON')      = 'LEON'
  and public.ada_model_key('RENAULT', 'MÉGANE') = 'MEGANE'
  and public.ada_model_key('CITROEN', 'ë-C4')   = 'EC4'
  and public.ada_model_key('HYUNDAI', 'KONA EV')  = 'KONA'   -- v2 intacte
  and public.ada_model_key('MERCEDES', 'CLASSE E') = 'E'     -- v1 intacte
  and public.ada_model_key('BMW', 'SÉRIE 3')       = '3'     -- v1 intacte
  and public.ada_model_key('KIA', 'EV6')           = 'EV6'   -- intouché
  as tout_est_bon;

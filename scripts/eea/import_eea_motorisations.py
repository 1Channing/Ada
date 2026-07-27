#!/usr/bin/env python3
"""
Référentiel MOTORISATIONS depuis l'EEA (immatriculations neuves UE).

Source officielle et gratuite : European Environment Agency, « Monitoring of
CO2 emissions from passenger cars » (règlement UE 2019/631) — chaque
immatriculation neuve de l'UE, interrogée via l'API DiscoData avec agrégation
côté serveur (jamais de téléchargement des fichiers bruts multi-Go).

Produit : supabase/data/vehicle_ref_motorisations.sql
  une ligne par (brand_key, model_key, fuel) avec les immatriculations par
  année (jsonb) + total — clés canoniques IDENTIQUES à l'importeur Teoalida
  (scripts/teoalida/import_teoalida.py) et à src/services/vehicleRef.ts.

Mapping carburants Ft × Fm → enums ADA (PROUVÉ sur les distributions 2024,
27/07/2026) :
  electric (E)                → ELECTRIQUE
  petrol/electric, diesel/electric (P) → PLUG_IN_HYBRID
  petrol + H (mild OU full)   → ESSENCE **ET** HYBRIDE (générosité anti-faux-
                                blocage : les sites étiquettent ces voitures
                                tantôt essence, tantôt hybride)
  diesel + H                  → DIESEL **ET** HYBRIDE
  petrol/diesel (M)           → ESSENCE / DIESEL
  e85 → ESSENCE · lpg → GPL · ng → GNV · hydrogen → HYDROGENE

Repli des clés fragmentées (27/07/2026) : l'EEA enregistre souvent la
désignation commerciale complète (« Z4 sDrive20i » → Z4SDRIVE20I,
« NX 350h » → NX350H, « X3 xDrive20d » → X3XDRIVE20D) — la clé du modèle de
base (Z4, NX, X3) n'existe alors pas et le service reste fail-open (aucun
verdict). On replie chaque clé fragmentée sur le modèle de base en prenant
pour AUTORITÉ le référentiel générations (supabase/data/
vehicle_ref_generations.sql) : préfixe le plus long de la même marque, parmi
les seuls modèles ayant une génération vivante sur la fenêtre EEA
(year_to ≥ 2019 ou en cours) — évite p. ex. de replier le BMW 320d moderne
sur la clé « 320 » de 1937. Garde-fous :
  - une clé qui EST déjà un modèle du référentiel n'est jamais repliée
    (YARISCROSS reste distinct de YARIS) ;
  - cible d'une seule lettre (classes Mercedes E/C/S…, séries BMW 1-8)
    acceptée uniquement si le reste commence par un chiffre (E220D → E,
    320D → 3, mais AMGGT ne tombe jamais dans A) ;
  - un repli ne fait qu'AJOUTER des immatriculations au modèle de base :
    il ne peut que débloquer des verdicts, jamais créer de faux blocage.

Usage :
  python3 scripts/eea/import_eea_motorisations.py            # extraction live
  python3 scripts/eea/import_eea_motorisations.py cache.json # depuis un cache
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

SOURCE = 'eea_co2cars_2026_07'
# Aligné sur MIN_MODEL_TOTAL (src/services/vehicleMotorisations.ts) : sous ce
# volume total le service ne rend AUCUN verdict (fail-open), donc les lignes
# de ces modèles ne servent à rien — les écarter divise le SQL par ~6 sans
# aucune perte fonctionnelle (98,4 % des immatriculations restent couvertes).
MIN_MODEL_TOTAL = 1000
TABLES = {
    2020: 'co2cars_2020Fv22', 2021: 'co2cars_2021Fv24', 2022: 'co2cars_2022Fv26',
    2023: 'co2cars_2023Fv28', 2024: 'co2cars_2024Pv29', 2025: 'co2cars_2025Pv31',
}

# ── Clés canoniques : MÊME logique que scripts/teoalida/import_teoalida.py ──
ROMAN_RE = re.compile(r'\s+(?:I{1,3}|IV|V|VI{0,3}|IX|X{1,2})$', re.I)
PAREN_RE = re.compile(r'\s*\([^)]*\)\s*$')
MERC_CLASS_RE = [
    re.compile(r'^([A-Z]{1,3})[- ]?(?:CLASS|KLASSE)$', re.I),
    re.compile(r'^(?:CLASSE|CLASE|CLASS)\s+([A-Z]{1,3})$', re.I),
]
SERIES_RE = [
    re.compile(r'^(?:SERIE|SÉRIE|SERIES)\s+(\w{1,3})$', re.I),
    re.compile(r'^(\w{1,3})[- ]?SERIES?$', re.I),
    re.compile(r'^(\d)[- ]?ER(?:[- ]?REIHE)?$', re.I),
]
# Alias marques : base importeur + graphies EEA observées (top Mk, 27/07/2026).
BRAND_ALIASES = {
    'VW': 'VOLKSWAGEN', 'MERCEDESBENZ': 'MERCEDES', 'MERCEDESAMG': 'MERCEDES',
    'VOLKSWAGENVW': 'VOLKSWAGEN', 'BMWI': 'BMW', 'FORDCNGTECHNIK': 'FORD',
    'CITROENDS': 'CITROEN', 'FORDWERKEGMBH': 'FORD', 'ADAMOPEL': 'OPEL',
    'AUTOMOBILESPEUGEOT': 'PEUGEOT', 'AUTOMOBILESCITROEN': 'CITROEN',
}


def canon_key(v: str) -> str:
    s = unicodedata.normalize('NFD', str(v or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]', '', s.upper())


def brand_key(v: str) -> str:
    k = canon_key(v)
    return BRAND_ALIASES.get(k, k)


def clean_model_label(model: str) -> str:
    m = str(model or '').strip()
    m = PAREN_RE.sub('', m)
    m = ROMAN_RE.sub('', m)
    return m.strip()


def ref_model_key(bk: str, model: str) -> str:
    m = clean_model_label(model)
    if bk == 'MERCEDES':
        for rx in MERC_CLASS_RE:
            g = rx.match(m)
            if g:
                m = g.group(1)
                break
    for rx in SERIES_RE:
        g = rx.match(m)
        if g:
            m = g.group(1)
            break
    return canon_key(m)


def fuels_of(ft: str, fm: str) -> list[str]:
    ft = (ft or '').strip().lower()
    fm = (fm or '').strip().upper()
    if ft == 'electric':
        return ['ELECTRIQUE']
    if ft in ('petrol/electric', 'diesel/electric'):
        return ['PLUG_IN_HYBRID']
    if ft == 'petrol':
        return ['ESSENCE', 'HYBRIDE'] if fm == 'H' else ['ESSENCE']
    if ft == 'diesel':
        return ['DIESEL', 'HYBRIDE'] if fm == 'H' else ['DIESEL']
    if ft == 'e85':
        return ['ESSENCE']
    if ft == 'lpg':
        return ['GPL']
    if ft == 'ng':
        return ['GNV']
    if ft == 'hydrogen':
        return ['HYDROGENE']
    return []


_BRAND_WORDS: dict[str, set] = {}


def strip_brand_echo(bk: str, raw_mk: str, cn: str) -> str:
    """« TOYOTA YARIS CROSS » → « YARIS CROSS » (écho de marque observé)."""
    words = _BRAND_WORDS.get(bk)
    if words is None:
        words = set()
        extra = 'MERCEDES-BENZ' if bk == 'MERCEDES' else ('VW' if bk == 'VOLKSWAGEN' else '')
        for src in (raw_mk, bk, extra):
            for w in re.split(r'[\s\-,./]+', str(src).upper()):
                if w:
                    words.add(canon_key(w))
        _BRAND_WORDS[bk] = words
    toks = cn.split()
    while toks and canon_key(toks[0]) in words:
        toks = toks[1:]
    return ' '.join(toks)


# ── Repli des clés fragmentées via le référentiel générations ──────────────
GEN_ROW_RE = re.compile(
    r"^\('([A-Z0-9]+)','([A-Z0-9]+)',.*,(\d+|NULL),(\d+|NULL),'[^']*','[^']*',(?:true|false)\),?$")
FOLD_MODERN_YEAR = 2019  # une génération finie avant ça ne peut pas porter d'immat. 2020-2025


def load_generation_keys(path: Path) -> tuple[dict, dict]:
    """→ (toutes_clés, cibles_modernes) : marque → ensemble de model_key.

    toutes_clés sert au garde « déjà un modèle connu → jamais replié » ;
    cibles_modernes (au moins une génération vivante ≥ FOLD_MODERN_YEAR)
    sont les seuls modèles de base sur lesquels on accepte de replier.
    """
    all_keys: dict[str, set] = defaultdict(set)
    modern: dict[str, set] = defaultdict(set)
    for line in open(path, encoding='utf-8'):
        g = GEN_ROW_RE.match(line.strip())
        if not g:
            continue
        bk, mk, _yf, yt = g.group(1), g.group(2), g.group(3), g.group(4)
        if not re.search(r'[A-Z]', bk):
            continue  # ligne parasite du fichier source (clés numériques)
        all_keys[bk].add(mk)
        if yt == 'NULL' or int(yt) >= FOLD_MODERN_YEAR:
            modern[bk].add(mk)
    return all_keys, modern


def fold_model_key(bk: str, mkey: str, gen_all: dict, gen_modern: dict) -> str:
    if mkey in gen_all.get(bk, ()):  # déjà un modèle du référentiel → intact
        return mkey
    best = ''
    for g in gen_modern.get(bk, ()):
        if len(g) <= len(best) or not mkey.startswith(g) or g == mkey:
            continue
        rest = mkey[len(g):]
        if len(g) == 1 and not (rest and rest[0].isdigit()):
            continue  # classe/série d'une lettre : suite numérique exigée
        best = g
    return best or mkey


def discodata(q: str, hits: int = 25000):
    url = 'https://discodata.eea.europa.eu/sql?' + urllib.parse.urlencode(
        {'query': q, 'p': 1, 'nrOfHits': hits})
    with urllib.request.urlopen(url, timeout=300) as r:
        return json.load(r)['results']


def extract_live() -> dict:
    out = {}
    for year, t in TABLES.items():
        q = (f"SELECT Mk, Cn, Ft, Fm, COUNT_BIG(*) AS n "
             f"FROM [CO2Emission].[latest].[{t}] GROUP BY Mk, Cn, Ft, Fm ORDER BY n DESC")
        out[str(year)] = discodata(q)
        print(f'  {year} {t}: {len(out[str(year)])} groupes')
        time.sleep(1)
    return out


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    if len(sys.argv) > 1:
        data = json.load(open(sys.argv[1]))
        print(f'cache: {sys.argv[1]}')
    else:
        print('extraction DiscoData…')
        data = extract_live()

    gen_all, gen_modern = load_generation_keys(
        root / 'supabase' / 'data' / 'vehicle_ref_generations.sql')
    print(f'référentiel générations : {sum(len(v) for v in gen_all.values()):,} modèles '
          f'({sum(len(v) for v in gen_modern.values()):,} cibles de repli modernes)')

    agg: dict[tuple, Counter] = defaultdict(Counter)
    kept = dropped = folded = 0
    fold_cache: dict[tuple, str] = {}
    for ystr, rows in data.items():
        y = int(ystr)
        for r in rows:
            n = int(r['n'])
            mk_raw = str(r['Mk'] or '').strip()
            cn_raw = str(r['Cn'] or '').strip()
            if not re.search(r'[A-Za-z]', mk_raw):
                dropped += n
                continue
            bk = brand_key(mk_raw)
            cn = strip_brand_echo(bk, mk_raw, cn_raw.upper().split(' / ')[0].strip())
            mkey = ref_model_key(bk, cn) if cn else ''
            if not mkey or len(mkey) > 26:
                dropped += n
                continue
            base = fold_cache.get((bk, mkey))
            if base is None:
                base = fold_model_key(bk, mkey, gen_all, gen_modern)
                fold_cache[(bk, mkey)] = base
            if base != mkey:
                folded += n
                mkey = base
            fuels = fuels_of(r.get('Ft'), r.get('Fm'))
            if not fuels:
                dropped += n
                continue
            for f in fuels:
                agg[(bk, mkey, f)][y] += n
            kept += n

    n_folded_keys = sum(1 for k, v in fold_cache.items() if v != k[1])
    print(f'immat. gardées {kept:,} · rejetées {dropped:,} · combos {len(agg):,}')
    print(f'repli générations : {n_folded_keys:,} clés fragmentées → modèle de base '
          f'({folded:,} immat. repliées)')

    model_total: Counter = Counter()
    for (bk, mk, _f), years in agg.items():
        model_total[(bk, mk)] += sum(years.values())

    out = root / 'supabase' / 'data' / 'vehicle_ref_motorisations.sql'
    out.parent.mkdir(parents=True, exist_ok=True)
    rows_sql = []
    for (bk, mk, f), years in sorted(agg.items()):
        if model_total[(bk, mk)] < MIN_MODEL_TOTAL:
            continue
        yjson = json.dumps({str(y): n for y, n in sorted(years.items())}, separators=(',', ':'))
        total = sum(years.values())
        rows_sql.append(f"('{bk}','{mk}','{f}','{yjson}',{total},'{SOURCE}')")
    with open(out, 'w') as fh:
        fh.write('-- Référentiel motorisations — EEA CO2 cars 2020-2025 (immatriculations UE)\n')
        fh.write(f'-- Généré par scripts/eea/import_eea_motorisations.py · source {SOURCE}\n')
        fh.write('-- Réimport idempotent : purge de la même source puis insertion.\n')
        fh.write(f"delete from public.vehicle_ref_motorisations where source = '{SOURCE}';\n\n")
        for i in range(0, len(rows_sql), 500):
            chunk = ',\n'.join(rows_sql[i:i + 500])
            fh.write('insert into public.vehicle_ref_motorisations '
                     '(brand_key, model_key, fuel, years, total, source) values\n'
                     f'{chunk};\n\n')
    print(f'écrit: {out} ({out.stat().st_size / 1e6:.1f} Mo, {len(rows_sql):,} lignes)')


if __name__ == '__main__':
    main()

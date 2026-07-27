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

    agg: dict[tuple, Counter] = defaultdict(Counter)
    kept = dropped = 0
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
            fuels = fuels_of(r.get('Ft'), r.get('Fm'))
            if not fuels:
                dropped += n
                continue
            for f in fuels:
                agg[(bk, mkey, f)][y] += n
            kept += n

    print(f'immat. gardées {kept:,} · rejetées {dropped:,} · combos {len(agg):,}')

    out = root / 'supabase' / 'data' / 'vehicle_ref_motorisations.sql'
    out.parent.mkdir(parents=True, exist_ok=True)
    rows_sql = []
    for (bk, mk, f), years in sorted(agg.items()):
        yjson = json.dumps({str(y): n for y, n in sorted(years.items())})
        total = sum(years.values())
        rows_sql.append(f"('{bk}','{mk}','{f}','{yjson}'::jsonb,{total},'{SOURCE}')")
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

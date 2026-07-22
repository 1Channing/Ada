#!/usr/bin/env python3
"""
Importeur du référentiel Teoalida « Car Models List — Cars sold in Europe »
(xlsx acheté le 22/07/2026, un an de mises à jour gratuites).

Produit `supabase/data/vehicle_ref_generations.sql` : purge source-scopée
(les lignes manual_lock/manuelles survivent) + INSERTs par lots, à appliquer
à la main dans l'éditeur SQL Supabase — comme toutes nos migrations.

Nettoyage appliqué (voir rapport imprimé en fin d'exécution) :
- seules les lignes Make + Model + « Production years » commençant par une
  année sont retenues (les notes du compilateur sont écartées, listées) ;
- groupes en virgule (« C-Class, CLC-class ») et alias en slash → une ligne
  par nom ;
- clés canoniques = réplique EXACTE de src/services/vehicleRef.ts
  (refModelKey : numéraux romains retirés, famille Mercedes → code nu) —
  les vecteurs du smoke test TS font foi ;
- « 2024-____ » → year_to NULL (en production) ; « 2024 » seul → from=to.

Usage :
  python3 scripts/teoalida/import_teoalida.py <fichier.xlsx>
"""

import re
import sys
import unicodedata
from collections import Counter

import openpyxl

OUT = 'supabase/data/vehicle_ref_generations.sql'
SOURCE = 'teoalida_eu_2026_07'

# ── Réplique de canonKey / brandKey / refModelKey (vehicleRef.ts) ────────────

BRAND_KEY_ALIASES = {'VW': 'VOLKSWAGEN', 'MERCEDESBENZ': 'MERCEDES'}
ROMAN_RE = re.compile(r'\s+(?:I{1,3}|IV|V|VI{0,3}|IX|X{1,2})$', re.I)
MERC_CLASS_RE = [
    re.compile(r'^([A-Z]{1,3})[- ]?(?:CLASS|KLASSE)$', re.I),
    re.compile(r'^(?:CLASSE|CLASE|CLASS)\s+([A-Z]{1,3})$', re.I),
]


def canon_key(v: str) -> str:
    s = unicodedata.normalize('NFD', str(v or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]', '', s.upper())


def brand_key(v: str) -> str:
    k = canon_key(v)
    return BRAND_KEY_ALIASES.get(k, k)


def ref_model_key(brand: str, model: str) -> str:
    m = str(model or '').strip()
    m = ROMAN_RE.sub('', m)
    if brand_key(brand) == 'MERCEDES':
        for rx in MERC_CLASS_RE:
            g = rx.match(m)
            if g:
                m = g.group(1)
                break
    return canon_key(m)


# ── Lignes manuelles (les ~2 % absents de la base, vérifiés constructeur) ────
MANUAL_ROWS = [
    # (brand, model, generation_label, code, year_from, year_to, classification)
    ('Toyota', 'Yaris Cross', 'XP210', 'XP210', 2021, None, 'Small crossover'),
    ('Suzuki', 'Ignis', '2nd/3rd gen MF', 'MF', 2016, None, 'Small car'),
    ('MAN', 'TGE', '1st gen', '', 2017, None, 'Van'),
]


def parse_years(s):
    s = str(s or '').strip()
    m = re.match(r'^(\d{4})\s*-\s*(\d{4}|_{2,}|present)\s*$', s, re.I)
    if m:
        to = m.group(2)
        return int(m.group(1)), (None if not to.isdigit() else int(to))
    m = re.match(r'^(\d{4})$', s)
    if m:
        return int(m.group(1)), int(m.group(1))
    return None


def sql_str(v) -> str:
    return "'" + str(v if v is not None else '').replace("'", "''") + "'"


def main(path: str) -> None:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb['Car models list EUROPE']
    rows = list(ws.iter_rows(values_only=True))

    kept, skipped_notes, skipped_years = [], [], []
    for r in rows[2:]:
        make, model, gen, classif, years = r[1], r[2], r[3], r[4], r[5]
        if not (make and model):
            continue
        # Les notes du compilateur sont de longues phrases sans années.
        yrs = parse_years(years)
        if yrs is None:
            (skipped_years if years else skipped_notes).append(
                f'{make} | {model} | {years}')
            continue
        y_from, y_to = yrs
        # Groupes/alias : « C-Class, CLC-class », « Bravo, Brava », noms en slash.
        for name in re.split(r'[,/]', str(model)):
            name = name.strip()
            if not name:
                continue
            kept.append({
                'brand': str(make).strip(), 'model': name,
                'gen': str(gen or '').strip().replace('-', '')[:80] and str(gen or '').strip(),
                'classif': str(classif or '').strip(),
                'from': y_from, 'to': y_to,
            })

    # Déduplication exacte (les alias en slash retombent parfois sur le même nom).
    seen = set()
    unique = []
    for k in kept:
        key = (brand_key(k['brand']), ref_model_key(k['brand'], k['model']), k['gen'], k['from'])
        if key in seen:
            continue
        seen.add(key)
        unique.append(k)

    lines = [
        '-- Généré par scripts/teoalida/import_teoalida.py — NE PAS ÉDITER À LA MAIN.',
        f"-- Source : {SOURCE} ; lignes retenues : {len(unique)} (+{len(MANUAL_ROWS)} manuelles).",
        '-- Réimport idempotent : purge UNIQUEMENT cette source, les verrous manuels survivent.',
        f"DELETE FROM vehicle_ref_generations WHERE source = {sql_str(SOURCE)} AND manual_lock = false;",
        f"DELETE FROM vehicle_ref_generations WHERE source = 'manuel' AND manual_lock = true;",
    ]

    def emit(batch, source, lock):
        vals = []
        for k in batch:
            vals.append('({},{},{},{},{},{},{},{},{},{},{})'.format(
                sql_str(brand_key(k['brand'])), sql_str(ref_model_key(k['brand'], k['model'])),
                sql_str(k['brand']), sql_str(k['model']), sql_str(k['gen']), sql_str(k.get('code', '')),
                k['from'], 'NULL' if k['to'] is None else k['to'],
                sql_str(k['classif']), sql_str(source), 'true' if lock else 'false'))
        lines.append(
            'INSERT INTO vehicle_ref_generations '
            '(brand_key, model_key, brand_label, model_label, generation_label, generation_code, '
            'year_from, year_to, classification, source, manual_lock) VALUES\n'
            + ',\n'.join(vals) + ';')

    BATCH = 300
    for i in range(0, len(unique), BATCH):
        emit(unique[i:i + BATCH], SOURCE, False)
    emit([
        {'brand': b, 'model': m, 'gen': g, 'code': c, 'classif': cl, 'from': f, 'to': t}
        for (b, m, g, c, f, t, cl) in MANUAL_ROWS
    ], 'manuel', True)

    with open(OUT, 'w', encoding='utf8') as f:
        f.write('\n'.join(lines) + '\n')

    print(f'écrit : {OUT}')
    print(f'lignes retenues : {len(unique)} | notes écartées : {len(skipped_notes)} | années non parsables : {len(skipped_years)}')
    for s in skipped_years[:10]:
        print('  année illisible :', s[:100])
    marks = Counter(k['brand'] for k in unique)
    print('marques :', len(marks), '| top :', marks.most_common(5))


if __name__ == '__main__':
    main(sys.argv[1])

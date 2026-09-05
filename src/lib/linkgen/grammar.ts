/**
 * REGISTRE UNIQUE DES GRAMMAIRES D'URL (26/08/2026).
 *
 * UNE table par site, consommée par TOUTES les voies : la voie mémoire
 * (URL apprise réécrite) l'applique via applyVariableCriteria/injectTrimIntoUrl,
 * la voie native (adaptateurs) est contre-vérifiée par le test de matrice au
 * gate (scripts/grammar-gate.mts) — une grammaire prouvée une fois s'applique
 * partout et ne peut plus dériver en silence. (Genèse : bmax fossile Gaspedaal
 * 25/08 et regdate perdu Leboncoin 26/08 — deux voies, deux savoirs, un bug.)
 *
 * DOCTRINE (validée Channing, rappelée 25-26/08) :
 *  - Rien sans PREUVE : chaque paramètre du registre vient d'une URL humaine
 *    ou d'un constat live daté (provenance en commentaire). Critère sans
 *    grammaire prouvée = paramètre ABSENT du registre = jamais posé.
 *  - Règle des VARIABLES (année/km/puissance/boîte) : chaque paramètre est
 *    POSÉ quand le critère existe, RETIRÉ quand il n'existe pas — jamais
 *    hérité d'une URL apprise (anti-fossile).
 *  - La finition est POSÉE seulement (slot texte-libre par site) ; Leboncoin
 *    fait exception (canal text= imposé, u_car_finition banni — décision
 *    Channing 17/07).
 */

import { resolveYearRange } from '../study-core/marketplaces/urlTemplate';
import { learnedEnumCode } from './taxonomy';
import { canonicalizeBody } from '../study-core/bodyTypes';
import type { LinkGenParams } from './types';

// ─── Outils de pose chirurgicale ─────────────────────────────────────────────

/**
 * POSE CHIRURGICALE d'un paramètre de query — remplace `new URL()` +
 * `searchParams.set()` + `toString()` dans TOUT le post-traitement.
 *
 * OBLIGATOIRE : URLSearchParams re-sérialise la query ENTIÈRE à chaque set()
 * — les virgules deviennent %2C et les %20 deviennent +. Or Leboncoin attend
 * des listes d'enums à virgules LITTÉRALES (`u_car_model=A,B`) : après
 * ré-encodage, le site reçoit un seul enum géant invalide et répond
 * searchData.total=0. C'est ce qui a éteint six études quotidiennes du 29/07
 * au 01/08. Ici : seule la paire visée est touchée, le reste de l'URL est
 * conservé OCTET PAR OCTET. `value: null` supprime le paramètre.
 */
export function setQueryParamRaw(url: string, param: string, value: string | null): string {
  const hashIdx = url.indexOf('#');
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const qIdx = base.indexOf('?');
  const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  let pairs = qIdx >= 0 ? base.slice(qIdx + 1).split('&').filter(Boolean) : [];
  pairs = pairs.filter((p) => p !== param && !p.startsWith(`${param}=`));
  if (value !== null && value !== '') {
    // Encodage standard du seul VALUE posé — virgules restaurées (séparateur
    // de liste des sites, jamais un caractère à échapper pour eux).
    pairs.push(`${param}=${encodeURIComponent(value).replace(/%2C/gi, ',')}`);
  }
  return path + (pairs.length ? `?${pairs.join('&')}` : '') + hash;
}

/**
 * Pose chirurgicale dans un hash Marktplaats (`#cle:valeur|…`). Les clés du
 * hash sont l'état des filtres du site (LRP) — invariantes d'une URL à
 * l'autre, donc posables SANS mapping appris. `value: null` supprime.
 */
function setHashParamRaw(url: string, key: string, value: string | null): string {
  const hashIdx = url.indexOf('#');
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  let segs = hashIdx >= 0 ? url.slice(hashIdx + 1).split('|').filter(Boolean) : [];
  segs = segs.filter((s) => !s.startsWith(`${key}:`));
  if (value !== null && value !== '') segs.push(`${key}:${value}`);
  return segs.length ? `${base}#${segs.join('|')}` : base;
}

/**
 * Variante formulaire (Skelbiu) : le site attend le formulaire COMPLET,
 * champs vides inclus (`power_min=&…`, URL humaine 02/08) — un paramètre
 * sans valeur est posé VIDE, jamais supprimé.
 */
function setQueryParamKeepEmpty(url: string, param: string, value: string): string {
  const stripped = setQueryParamRaw(url, param, null);
  if (value !== '') return setQueryParamRaw(stripped, param, value);
  const hashIdx = stripped.indexOf('#');
  const base = hashIdx >= 0 ? stripped.slice(0, hashIdx) : stripped;
  const hash = hashIdx >= 0 ? stripped.slice(hashIdx) : '';
  return base + (base.includes('?') ? '&' : '?') + `${param}=` + hash;
}

// ─── Conversions & lectures de critères ──────────────────────────────────────

/** ch DIN → kW, arrondi bas (borne min inclusive) — prouvé live AS24 18/08
 *  (260 ch : powerfrom=191&powertype=kw → 47 annonces, toutes ≥ 260 ch). */
const CH_PER_KW = 1.35962;
const chToKw = (ch: number) => Math.floor(ch / CH_PER_KW);

const powerCh = (params: LinkGenParams): number | null => {
  const hp = Number(params.minPower ?? '');
  return Number.isFinite(hp) && hp > 0 ? hp : null;
};
const mileageKm = (params: LinkGenParams): number | null => {
  const km = Number(params.mileage ?? '');
  return Number.isFinite(km) && km > 0 ? km : null;
};
const isAutomatic = (params: LinkGenParams): boolean =>
  /^AUTOMAT/i.test(String(params.gearbox ?? '').trim());

// Normalisation texte-libre Marktplaats (chemin /q/…/ à tokens `+`).
export const mpNormalize = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
    .replace(/\s+/g, '+').replace(/[^a-z0-9+\-]/g, '');

// ─── Le registre ─────────────────────────────────────────────────────────────

export interface SiteGrammar {
  /** Sous-chaîne d'hôte qui sélectionne l'entrée (unique par site). */
  host: string;
  /** Réparations d'URL apprise (formes mortes du site) — avant les critères. */
  repair?: (url: string, params: LinkGenParams) => string;
  /** Chaque applicateur POSE son paramètre quand le critère existe et le
   *  RETIRE quand il n'existe pas (règle des variables, anti-fossile). */
  year?: (url: string, yearFrom: string, yearTo: string) => string;
  mileage?: (url: string, km: number | null) => string;
  power?: (url: string, ch: number | null) => string;
  gearbox?: (url: string, params: LinkGenParams) => string;
  fuel?: (url: string, params: LinkGenParams) => string;
  /** Carrosserie (canon ADA 30/08 = nomenclature LBC) — posée-ou-retirée. */
  vehicleType?: (url: string, params: LinkGenParams) => string;
  /** Finition IMPOSÉE (posée-ou-retirée à chaque passage) — LBC seulement. */
  trimEnforced?: (url: string, trim: string) => string;
  /** Slot texte-libre : POSE seulement (une URL apprise à finition scopée
   *  garde son texte — le gating vit dans generateSearchUrlsWithMemory). */
  trimSlot?: (url: string, trim: string) => string;
  /** Politique de site (pas un critère) — appliquée à chaque passage. */
  policy?: (url: string) => string;
}

export const SITE_GRAMMARS: SiteGrammar[] = [
  {
    // ── AutoScout24 (6 pays, même grammaire) ─────────────────────────────────
    host: 'autoscout24.',
    // Année en CHEMIN (segment SEO re_YYYY) hors d'atteinte des params :
    // rapport 20/07, /rav-4/re_2021 réutilisée pour 2025 → year 0/55.
    // Lookahead [/?#] : l'ancien code ne couvrait que /re_YYYY/ suivi d'un
    // slash — un segment en fin de chemin (…/re_2021?fregfrom=…) survivait
    // (défaut révélé par le gate de matrice, 26/08).
    repair: (url) => url.replace(/\/re_\d{4}(?=[/?#]|$)/, ''),
    year: (url, from, to) => {
      let out = setQueryParamRaw(url, 'fregfrom', from || null);
      return setQueryParamRaw(out, 'fregto', to || null);
    },
    mileage: (url, km) => setQueryParamRaw(url, 'kmto', km ? String(km) : null),
    // powerfrom EN KW + powertype=kw — prouvé live 18/08 ('hp' ignoré, valeur
    // nue lue en kW : 260 → 0 annonce). Sans critère, le TRIO saute (y compris
    // un powertype=hp hérité de notre ancienne injection cassée).
    power: (url, ch) => {
      if (ch) {
        const out = setQueryParamRaw(url, 'powerfrom', String(chToKw(ch)));
        return setQueryParamRaw(out, 'powertype', 'kw');
      }
      let out = setQueryParamRaw(url, 'powerfrom', null);
      out = setQueryParamRaw(out, 'powerto', null);
      return setQueryParamRaw(out, 'powertype', null);
    },
    // gear=A/M/S — table fixe vérifiée de l'API publique (adaptateur).
    gearbox: (url, params) => {
      const code = { AUTOMATIQUE: 'A', AUTOMATIC: 'A', AUTOMATIK: 'A', MANUELLE: 'M', MANUAL: 'M', MANUELL: 'M' }[
        String(params.gearbox ?? '').trim().toUpperCase()
      ];
      return setQueryParamRaw(url, 'gear', code ?? null);
    },
    // fuel=B/D/E/2/L/C — table fixe vérifiée (FUEL_MAP de l'adaptateur).
    // Jusqu'ici la voie mémoire ne posait le carburant que si l'ingestion
    // l'avait appris — dossier Yaris Cross 26/08 : URL apprise sans fuel=,
    // « carburant non exprimé » chaque matin. Posé-ou-retiré comme le reste.
    fuel: (url, params) => {
      const code = {
        ESSENCE: 'B', GASOLINE: 'B', PETROL: 'B',
        DIESEL: 'D',
        ELECTRIQUE: 'E', ELECTRIC: 'E',
        HYBRIDE: '2', HYBRID: '2', PLUG_IN_HYBRID: '2', PHEV: '2',
        GPL: 'L', LPG: 'L', GNV: 'C', CNG: 'C',
      }[String(params.fuel ?? '').trim().toUpperCase()];
      return setQueryParamRaw(url, 'fuel', code ?? null);
    },
    trimSlot: (url, t) => setQueryParamRaw(url, 'kwd', t),
    // Carrosserie : codes NUMÉRIQUES internationaux prouvés par URLs humaines
    // 30/08 (.fr : body=1%2C2 = citadine+cabriolet ; liste complète
    // body=1,2,3,4,5,6,12,13 appariée à l'ordre de la facette). Retenus face
    // aux segments /bt_citadine : les slugs bt_ sont LOCALISÉS par TLD, les
    // codes body= non. Tout segment bt_ hérité est purgé (anti-fossile).
    // « Société » SANS équivalent : l'Utilitaire AS24 (13) n'est PAS la
    // voiture société (précision Channing) — critère retiré, post-filtre aval.
    vehicleType: (url, params) => {
      const out = url.replace(/\/bt_[^/?#]+/g, '');
      const tok = canonicalizeBody(String(params.vehicleType ?? ''));
      const code = tok ? {
        citadine: '1', cabriolet: '2', coupe: '3', suv: '4',
        break: '5', berline: '6', monospace: '12',
      }[tok as string] : undefined;
      return setQueryParamRaw(out, 'body', code ?? null);
    },
  },
  {
    // ── Leboncoin ────────────────────────────────────────────────────────────
    host: 'leboncoin.fr',
    // Formes prouvées par URLs humaines : '2021-2021' (borné), '2021-max'
    // (ouvert vers le haut). Borne basse seule absente : non prouvée → forme
    // bornée symétrique.
    year: (url, from, to) => {
      if (!from && !to) return setQueryParamRaw(url, 'regdate', null);
      return setQueryParamRaw(url, 'regdate', `${from || to}-${to || 'max'}`);
    },
    // `mileage=min-90000` — le littéral `min` fait partie de la syntaxe (8 URLs
    // humaines) ; la valeur nue est lue comme borne BASSE (études GR SPORT à 0
    // dès l'ajout du critère, 29/07).
    mileage: (url, km) => setQueryParamRaw(url, 'mileage', km ? `min-${km}` : null),
    // Puissance min : horse_power_din=280-max — la FORME est dans les 12
    // lignes mémoire humaines (toutes en `N-max`, relues 29/08). La valeur
    // nue était lue min=max par le site (constat Elroq 29/08 : « Puissance
    // DIN 280 à 280 », zéro alerte pendant des jours). Même syntaxe à
    // littéraux que mileage=min-N / regdate=N-max. Unité ch DIN.
    power: (url, ch) => setQueryParamRaw(url, 'horse_power_din', ch ? `${ch}-max` : null),
    // Carburant : codes 1/2/4 = enum humain confirmé en base (ESSENCE/DIESEL/
    // ELECTRIQUE), 6 = HYBRIDE prouvé par URL humaine en mémoire (fuel=6,
    // ligne Ignis 27/08), 8 = HYBRIDE RECHARGEABLE — moisson des annonces
    // 30/07-01/08 (l'adaptateur le savait) RE-prouvé par URL humaine GLA
    // 27/08 (&fuel=8). Rechargeable ≠ famille 6 sur CE site : le registre
    // qui rabattait PHEV→6 écrasait le 8 natif (étude GLA faussée 27/08).
    // Seul MILD_HYBRID reste rangé famille hybride (pas de code distinct).
    fuel: (url, params) => {
      const code = {
        ESSENCE: '1', PETROL: '1', GASOLINE: '1',
        DIESEL: '2',
        ELECTRIQUE: '4', ELECTRIC: '4',
        HYBRIDE: '6', HYBRID: '6', MILD_HYBRID: '6',
        PLUG_IN_HYBRID: '8', PHEV: '8',
      }[String(params.fuel ?? '').trim().toUpperCase()]
        // Repli GARDÉ sur l'enum appris (dictionnaire LEBONCOIN fuel : 3 →
        // GPL, 7 → GNV — enum humain confirmé, constat Bibliothèque 03/09) ;
        // un code Leboncoin est toujours numérique.
        ?? (() => { const c = learnedEnumCode('LEBONCOIN', 'fuel', String(params.fuel ?? '')); return c && /^\d+$/.test(c) ? c : undefined; })();
      return setQueryParamRaw(url, 'fuel', code ?? null);
    },
    // Boîte : codes du site PROUVÉS (enum humain confirmé en base,
    // linkgen_enum_mappings LEBONCOIN gearbox : Manuelle=1, Automatique=2 ;
    // URL humaine en mémoire gearbox=2). Constat Ignis 27/08 : le savoir
    // vivait dans une ligne mémoire — une étude Automatique scrapait la page
    // toutes-boîtes dès que la voie native/le mauvais scope servait.
    gearbox: (url, params) => {
      const g = String(params.gearbox ?? '').trim().toUpperCase();
      const code = /^AUTOMAT/.test(g) ? '2' : /^MANUEL/.test(g) ? '1' : null;
      return setQueryParamRaw(url, 'gearbox', code);
    },
    // Décision Channing 17/07 (rappelée 18/08) : la finition passe par la
    // BARRE DE RECHERCHE (text=), jamais par u_car_finition (énum trop
    // stricte — lacune « COLLECTION » 18/08).
    trimEnforced: (url, t) => {
      const out = setQueryParamRaw(url, 'u_car_finition', null);
      return setQueryParamRaw(out, 'text', t || null);
    },
    trimSlot: (url, t) => setQueryParamRaw(url, 'text', t),
    // Carrosserie : slugs PROUVÉS par les deux URLs humaines Channing 30/08
    // (vehicle_type=4x4 seul, puis la liste complète à virgules LITTÉRALES :
    // 4x4,berline,cabriolet,break,citadine,coupe,monospace,voituresociete —
    // préservées par setQueryParamRaw, leçon u_car_model). Un critère hors
    // canon = paramètre RETIRÉ, jamais deviné.
    vehicleType: (url, params) => {
      const tok = canonicalizeBody(String(params.vehicleType ?? ''));
      const slug = tok ? {
        suv: '4x4', berline: 'berline', break: 'break', citadine: 'citadine',
        monospace: 'monospace', coupe: 'coupe', cabriolet: 'cabriolet',
        societe: 'voituresociete',
      }[tok] : undefined;
      return setQueryParamRaw(url, 'vehicle_type', slug ?? null);
    },
    // u_car_model = UNE valeur (audit 05/09). Les anciennes URLs (mémoire :
    // 152 lignes validées) portaient une liste de devinettes à virgules
    // (« TOYOTA_Yaris Cross,YARIS CROSS,Yaris Cross,… ») ; LBC rend
    // total=0 dès qu'un membre est invalide — toutes les lignes « No ads
    // array (total=0) » du journal étaient ces listes, la forme simple
    // servait 53 annonces. On garde le membre le plus probable : l'enum
    // appris s'il est dans la liste, sinon « MARQUE_Forme du site ».
    policy: (url) => {
      const m = url.match(/([?&])u_car_model=([^&#]*)/);
      if (!m || !m[2].includes(',')) return url;
      const brand = (url.match(/[?&]u_car_brand=([^&#]*)/)?.[1] ?? '').toUpperCase();
      const members = m[2].split(',').map((v) => { try { return decodeURIComponent(v); } catch { return v; } }).filter(Boolean);
      const siteCase = (base: string) => base.split(/\s+/).map((w) => {
        const letters = w.replace(/[^A-Za-z]/g, '');
        return /\d/.test(w) || letters.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase();
      }).join(' ');
      let best = members[0]; let bestScore = -1;
      for (const v of members) {
        const prefixed = brand && v.toUpperCase().startsWith(`${brand}_`);
        const rest = prefixed ? v.slice(brand.length + 1) : v;
        let score = prefixed ? 2 : 0;
        if (prefixed && rest === siteCase(rest)) score += 1;
        if (prefixed && learnedEnumCode('LEBONCOIN', 'u_car_model', rest) === v) score += 3;
        if (score > bestScore) { best = v; bestScore = score; }
      }
      // Remplacement EN PLACE (l'ordre des paramètres reste celui de l'URL —
      // idempotence du registre, gate de grammaire).
      return url.replace(m[0], `${m[1]}u_car_model=${encodeURIComponent(best)}`);
    },
  },
  {
    // ── Bilbasen ─────────────────────────────────────────────────────────────
    host: 'bilbasen.dk',
    // Le site IGNORE make=/model= en query (prouvé campagne Tiguan + rapport
    // 20/07 : ?make=VW&model=… servait des ID.3) — réécrits en chemin natif.
    repair: (url) => {
      try {
        const u = new URL(url);
        const make = u.searchParams.get('make');
        const model = u.searchParams.get('model');
        if (!make) return url;
        const slug = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')
          .trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9._-]/g, '');
        const out = setQueryParamRaw(setQueryParamRaw(url, 'make', null), 'model', null);
        const m = out.match(/^(https?:\/\/[^/]+)([^?#]*)(.*)$/);
        return m ? `${m[1]}/brugt/bil/${slug(make)}${model ? `/${slug(model)}` : ''}${m[3]}` : url;
      } catch { return url; }
    },
    // Première immatriculation (regfrom/regto MENSUELS) — yearfrom/yearto est
    // l'année-modèle danoise (36/64 e-tron immatriculées N-1, 01/08) ; les
    // deux familles combinées restreindraient doublement → anciens retirés.
    year: (url, from, to) => {
      let out = setQueryParamRaw(url, 'regfrom', from ? `${from}-01` : null);
      out = setQueryParamRaw(out, 'regto', to ? `${to}-12` : null);
      out = setQueryParamRaw(out, 'yearfrom', null);
      return setQueryParamRaw(out, 'yearto', null);
    },
    mileage: (url, km) => setQueryParamRaw(url, 'mileageto', km ? String(km) : null),
    // hpfrom EN CH (hk) — URL humaine hpfrom=250.
    power: (url, ch) => setQueryParamRaw(url, 'hpfrom', ch ? String(ch) : null),
    // Carburant : codes 1/2/3/6 PROUVÉS (URLs humaines 26/08, FUEL_MAP de
    // l'adaptateur) — promu au registre pour la voie mémoire (inventaire
    // 27/08 : le savoir ne servait que la voie native).
    fuel: (url, params) => {
      const code = {
        ESSENCE: '1', PETROL: '1', GASOLINE: '1',
        DIESEL: '2',
        ELECTRIQUE: '3', ELECTRIC: '3',
        HYBRIDE: '6', HYBRID: '6', PLUG_IN_HYBRID: '6', MILD_HYBRID: '6',
      }[String(params.fuel ?? '').trim().toUpperCase()];
      return setQueryParamRaw(url, 'fuel', code ?? null);
    },
    // gear=automatic — PROUVÉ URL humaine 26/08 ; seule valeur prouvée.
    gearbox: (url, params) => setQueryParamRaw(url, 'gear', isAutomatic(params) ? 'automatic' : null),
    trimSlot: (url, t) => setQueryParamRaw(url, 'free', t),
    // Carrosserie : cartype= répété pour le multi (URLs humaines 30/08 :
    // stationcar seul, puis les 7 — stationcar=break, suv, mpv=monospace,
    // sedan=berline, hatchback=citadine, cabriolet, coupe ; pas de société).
    // La pose chirurgicale purge toutes les paires héritées.
    vehicleType: (url, params) => {
      const tok = canonicalizeBody(String(params.vehicleType ?? ''));
      const code = tok ? {
        break: 'stationcar', suv: 'suv', monospace: 'mpv', berline: 'sedan',
        citadine: 'hatchback', cabriolet: 'cabriolet', coupe: 'coupe',
      }[tok as string] : undefined;
      return setQueryParamRaw(url, 'cartype', code ?? null);
    },
  },
  {
    // ── mobile.de ────────────────────────────────────────────────────────────
    host: 'mobile.de',
    // Format composite natif fr=min:max — la valeur simple (fr=2022) est lue
    // « à partir de 2022 » (campagne 21h55 : années 12/34 sur étude 2022).
    year: (url, from, to) => {
      if (!from && !to) return setQueryParamRaw(url, 'fr', null);
      return setQueryParamRaw(url, 'fr', `${from}:${to}`);
    },
    // ml composite aussi : borne max seule = `ml=:80000` (URL humaine 26/07) ;
    // la valeur nue serait lue MINIMUM 80 000 km — l'inverse du besoin.
    mileage: (url, km) => setQueryParamRaw(url, 'ml', km ? `:${km}` : null),
    // pw EN KW, valeur nue = borne MIN ouverte — PROUVÉ par contre-épreuve
    // vivante 30/08 (classe Elroq soldée) : RAV4 2021, sans pw = 76 annonces
    // (152-306 ch) ; pw=150 = 62 annonces, min 218 ch (150 kW = 204 ch — les
    // 152 ch exclues, donc kW et pas ch), max toujours 306 ch (donc MIN
    // ouvert, pas min=max). Capture 26/07 (184 kW = 250 ch) confirmée.
    power: (url, ch) => setQueryParamRaw(url, 'pw', ch ? String(chToKw(ch)) : null),
    // tr=AUTOMATIC_GEAR — PROUVÉ URL humaine 26/08 ; seule valeur prouvée.
    gearbox: (url, params) => setQueryParamRaw(url, 'tr', isAutomatic(params) ? 'AUTOMATIC_GEAR' : null),
    // FINITION = 4e segment de ms (ms=make;model;;trim — PROUVÉ URL humaine
    // 26/08 : ms=24100;28;;GR+Sport). Posable seulement si ms porte déjà
    // make;model — jamais inventé sans modèle.
    trimSlot: (url, t) => {
      try {
        const u = new URL(url);
        const ms = (u.searchParams.get('ms') ?? '').split(';');
        if (ms.length < 2 || !ms[0] || !ms[1]) return url;
        return setQueryParamRaw(url, 'ms', `${ms[0]};${ms[1]};;${t}`);
      } catch { return url; }
    },
    // Carrosserie : c= à codes anglais, RÉPÉTÉ pour le multi (URLs humaines
    // 30/08 : c=Cabrio seul, puis c=Cabrio&c=OffRoad&c=SmallCar&c=EstateCar&
    // c=Limousine&c=SportsCar&c=Van). OffRoad=SUV, SmallCar=citadine,
    // EstateCar=break, Limousine=berline, SportsCar=coupé, Van=monospace
    // (fourgonnette/minivan — précision Channing). Société sans équivalent →
    // retiré, post-filtre aval. setQueryParamRaw supprime TOUTES les paires
    // c= avant de poser la nôtre : purge multi incluse.
    vehicleType: (url, params) => {
      const tok = canonicalizeBody(String(params.vehicleType ?? ''));
      const code = tok ? {
        suv: 'OffRoad', citadine: 'SmallCar', break: 'EstateCar',
        berline: 'Limousine', coupe: 'SportsCar', cabriolet: 'Cabrio',
        monospace: 'Van',
      }[tok as string] : undefined;
      return setQueryParamRaw(url, 'c', code ?? null);
    },
    // Sans véhicules ENDOMMAGÉS, à la source — dam=false prouvé URL humaine
    // 26/08 (backlog 4sexies : les accidentées trustaient le bas du tri prix).
    // Politique de site, pas un critère : appliquée aux DEUX voies.
    // cn=DE : annonces ALLEMANDES seulement — preuve vive 05/09 (Toyota 2024
    // tri prix : sans cn, 22 DE + 1 FR + 1 IT ; avec cn=DE, 25 DE, 0 étranger).
    // Sans lui, mobile.de sert IT/NL/BE/LU/DK que le worker écartait après
    // coup (jusqu'à 50 annonces / 48 h perdues en profondeur).
    policy: (url) => setQueryParamRaw(setQueryParamRaw(url, 'dam', 'false'), 'cn', 'DE'),
  },
  {
    // ── Gaspedaal ────────────────────────────────────────────────────────────
    host: 'gaspedaal.nl',
    // bmin/bmax/kmax prouvés par URLs humaines (re-donnés par Channing 25/08).
    year: (url, from, to) => {
      const out = setQueryParamRaw(url, 'bmin', from || null);
      return setQueryParamRaw(out, 'bmax', to || null);
    },
    mileage: (url, km) => setQueryParamRaw(url, 'kmax', km ? String(km) : null),
    // vmin EN CH — PROUVÉ URL humaine 26/08 (vmin=130).
    power: (url, ch) => setQueryParamRaw(url, 'vmin', ch ? String(ch) : null),
    // trns=AUTOMATISCH — PROUVÉ URL humaine 26/08 ; seule valeur prouvée.
    gearbox: (url, params) => setQueryParamRaw(url, 'trns', isAutomatic(params) ? 'AUTOMATISCH' : null),
    // Carburant = SEGMENT DE CHEMIN /{brand}/{model?}/{fuel} — slugs prouvés
    // par URLs humaines : /hybride (01/08), /diesel (02/08). Gaspedaal n'a
    // PAS de catégorie hybride rechargeable (Channing 27/08) : PHEV/mild →
    // famille /hybride, l'affinage se fait en aval. Posé-ou-retiré : tout
    // segment carburant du vocabulaire du site est d'abord retiré (anti-
    // fossile — une URL apprise /hybride resservie pour une étude diesel).
    fuel: (url, params) => {
      try {
        const u = new URL(url);
        const VOCAB = new Set(['benzine', 'diesel', 'elektrisch', 'hybride', 'lpg', 'waterstof']);
        const segs = u.pathname.split('/').filter(Boolean).filter((s) => !VOCAB.has(s.toLowerCase()));
        const want = String(params.fuel ?? '').trim().toUpperCase();
        const slug = {
          HYBRIDE: 'hybride', HYBRID: 'hybride',
          PLUG_IN_HYBRID: 'hybride', PHEV: 'hybride', MILD_HYBRID: 'hybride',
          DIESEL: 'diesel',
          // Segments du site moissonnés (gp:fuel : benzine, elektrisch, lpg —
          // slugs littéraux du vocabulaire Gaspedaal, constat Bibliothèque
          // 03/09 : « Essence » ne posait rien).
          ESSENCE: 'benzine', PETROL: 'benzine', GASOLINE: 'benzine',
          ELECTRIQUE: 'elektrisch', ELECTRIC: 'elektrisch',
          GPL: 'lpg', LPG: 'lpg',
        }[want]
          // Repli gardé : enum appris, accepté seulement s'il est un segment
          // du vocabulaire du site (écarte le bruit « 5-serie »).
          ?? (() => { const c = learnedEnumCode('GASPEDAAL', 'fuel', want); return c && VOCAB.has(c.toLowerCase()) ? c.toLowerCase() : undefined; })();
        if (slug) segs.push(slug);
        u.pathname = `/${segs.join('/')}`;
        return u.toString();
      } catch { return url; }
    },
    // trefw = la barre de recherche (trefw=GR+SPORT re-prouvé 25/08).
    trimSlot: (url, t) => setQueryParamRaw(url, 'trefw', t),
    // Carrosserie = PARAMÈTRE crs= (tokens MAJUSCULES du vocabulaire
    // officiel, URL humaine 30/08 : /zoeken?crs=CABRIOLET,COUPE,HATCHBACK,
    // MPV,SEDAN,STATIONWAGEN,SUV,BEDRIJFSWAGEN). PAS le segment de chemin :
    // le site PLAFONNE les segments — /toyota/corolla/hybride/stationwagen
    // (4 segments) est IGNORÉ EN SILENCE (sonde 30/08 : total 776 identique
    // avec et sans, constat Channing « facette non cochée »). crs= agit sur
    // notre chemin carburant : ?crs=STATIONWAGEN = 562/776 (et le chemin à
    // 3 segments /corolla/stationwagen = 585 breaks tous carburants —
    // cohérence croisée). Tout segment carrosserie hérité (position ≥ 2,
    // jamais le modèle — Mazda MPV) est purgé.
    vehicleType: (url, params) => {
      try {
        const u = new URL(url);
        const VOCAB = new Set(['cabriolet', 'coupe', 'hatchback', 'mpv', 'sedan', 'stationwagen', 'suv', 'bedrijfswagen']);
        const segs = u.pathname.split('/').filter(Boolean)
          .filter((s, i) => i <= 1 || !VOCAB.has(s.toLowerCase()));
        u.pathname = `/${segs.join('/')}`;
        const tok = canonicalizeBody(String(params.vehicleType ?? ''));
        const code = tok ? {
          suv: 'SUV', berline: 'SEDAN', break: 'STATIONWAGEN', citadine: 'HATCHBACK',
          monospace: 'MPV', coupe: 'COUPE', cabriolet: 'CABRIOLET', societe: 'BEDRIJFSWAGEN',
        }[tok as string] : undefined;
        return setQueryParamRaw(u.toString(), 'crs', code ?? null);
      } catch { return url; }
    },
  },
  {
    // ── Marktplaats ──────────────────────────────────────────────────────────
    // Année/km vivent dans le HASH (#constructionYearFrom:…), aux clés
    // INVARIANTES du site — posées-ou-retirées ici SANS dépendre du mapping
    // appris. (Dossier X3 26/08 : la ligne mémoire « M Sport » n'avait pas
    // appris constructionYearTo [son URL d'origine était « 2022 et + »] —
    // toute étude BORNÉE la réutilisant perdait sa borne haute en silence :
    // page « 2023 et + » servie pour une étude 2023-2023.) Le worker lit ces
    // clés côté API (attributeRanges constructionYear/mileage). Les facettes
    // (modèle, carburant, Automaat 534, Vraagprijs 10882) restent des ids
    // opaques du chemin /f/ — jamais réécrites ici.
    host: 'marktplaats.nl',
    year: (url, from, to) => {
      const out = setHashParamRaw(url, 'constructionYearFrom', from || null);
      return setHashParamRaw(out, 'constructionYearTo', to || null);
    },
    mileage: (url, km) => setHashParamRaw(url, 'mileageTo', km ? String(km) : null),
    // Texte libre = chemin /q/…/ (le hash #q: n'est JAMAIS envoyé au serveur —
    // étude RAV4 GR SPORT 27/07). Fusion sans doublon, /q/ AVANT le groupe /f/.
    trimSlot: (url, t) => {
      try {
        const u = new URL(url);
        const norm = mpNormalize(t);
        if (!norm) return url;
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.length < 3 || segs[0] !== 'l') return url;
        const qIdx = segs.indexOf('q', 3);
        if (qIdx >= 0 && qIdx + 1 < segs.length) {
          const existing = segs[qIdx + 1].split('+').filter(Boolean);
          for (const tok of norm.split('+')) if (tok && !existing.includes(tok)) existing.push(tok);
          segs[qIdx + 1] = existing.join('+');
        } else {
          const fIdx = segs.indexOf('f', 3);
          segs.splice(fIdx >= 0 ? fIdx : segs.length, 0, 'q', norm);
        }
        u.pathname = `/${segs.join('/')}/`;
        return u.toString();
      } catch { return url; }
    },
    // Carrosserie : facettes 481-488 (URLs humaines 30/08 : /f/{slug}/{id}/
    // par type + multi #f:482,483,484,485,486,488 — hatchback 481=citadine,
    // mpv 482=monospace, sedan 483=berline, stationwagon 484=break,
    // cabriolet 485, coupe 486, suv-of-terreinwagen 488 ; pas de « société »).
    // Le worker traduit déjà le hash f: vers l'API (attributesById[]) — canal
    // prouvé par le sous-type hybride 13956 (backlog 0ter). Pose CHIRURGICALE
    // INTRA-LISTE : seuls les ids carrosserie sont retirés/posés, les autres
    // facettes du f: (Automaat 534, 13956…) survivent octet par octet.
    vehicleType: (url, params) => {
      const BODY_IDS = new Set(['481', '482', '483', '484', '485', '486', '488']);
      const tok = canonicalizeBody(String(params.vehicleType ?? ''));
      const want = tok ? {
        citadine: '481', monospace: '482', berline: '483', break: '484',
        cabriolet: '485', coupe: '486', suv: '488',
      }[tok as string] : undefined;
      const hashIdx = url.indexOf('#');
      const segs = hashIdx >= 0 ? url.slice(hashIdx + 1).split('|').filter(Boolean) : [];
      const fSeg = segs.find((s) => s.startsWith('f:'));
      const kept = (fSeg ? fSeg.slice(2).split(/[+,]/).filter(Boolean) : [])
        .filter((id) => !BODY_IDS.has(id));
      if (want) kept.push(want);
      return setHashParamRaw(url, 'f', kept.length ? kept.join(',') : null);
    },
  },
  {
    // ── Blocket ──────────────────────────────────────────────────────────────
    host: 'blocket.se',
    year: (url, from, to) => {
      const out = setQueryParamRaw(url, 'year_from', from || null);
      return setQueryParamRaw(out, 'year_to', to || null);
    },
    // MIL SUÉDOIS : km → mil (÷10) — l'oublier fausserait TOUTES les données.
    mileage: (url, km) => setQueryParamRaw(url, 'mileage_to', km ? String(Math.round(km / 10)) : null),
    // engine_effect_from — PROUVÉ URL humaine 26/08 (unité hk ≈ ch DIN,
    // convention du site — l'URL-preuve révèle le NOM, pas l'unité).
    power: (url, ch) => setQueryParamRaw(url, 'engine_effect_from', ch ? String(ch) : null),
    // transmission=2 (Automat) — PROUVÉ URL humaine 26/08.
    gearbox: (url, params) => setQueryParamRaw(url, 'transmission', isAutomatic(params) ? '2' : null),
    // q= texte libre — PROUVÉ URL humaine 26/08 (&q=Gr+sport).
    trimSlot: (url, t) => setQueryParamRaw(url, 'q', t),
    // Carrosserie : body_type= répété (URLs humaines 30/08) — berline 3,
    // break 4, monospace 5, coupé 6, cabriolet 7, suv 9 ; CITADINE = DEUX
    // codes (1 = 3 portes, 2 = 5 portes, « on les met ensemble »).
    // Utilitaire 10 ≠ société → jamais posé. Purge multi puis pose de
    // chaque code du token.
    vehicleType: (url, params) => {
      const tok = canonicalizeBody(String(params.vehicleType ?? ''));
      const codes = tok ? {
        berline: ['3'], break: ['4'], monospace: ['5'], coupe: ['6'],
        cabriolet: ['7'], suv: ['9'], citadine: ['1', '2'],
      }[tok as string] : undefined;
      let out = setQueryParamRaw(url, 'body_type', null);
      for (const c of codes ?? []) {
        out += (out.includes('?') ? '&' : '?') + `body_type=${c}`;
      }
      return out;
    },
  },
  {
    // ── Skelbiu (style FORMULAIRE : champs posés vides, jamais supprimés) ────
    host: 'skelbiu.lt',
    year: (url, from, to) => {
      const out = setQueryParamKeepEmpty(url, 'year_min', from);
      return setQueryParamKeepEmpty(out, 'year_max', to);
    },
    mileage: (url, km) => setQueryParamKeepEmpty(url, 'mileage_max', km ? String(km) : ''),
    // power_min EN KW — PROUVÉ URL humaine 26/08 (power_min=110, libellé
    // « puissance kW » du formulaire) ; nos critères en ch → conversion.
    power: (url, ch) => setQueryParamKeepEmpty(url, 'power_min', ch ? String(chToKw(ch)) : ''),
    // keywords = texte libre — PROUVÉ URL humaine 26/08.
    trimSlot: (url, t) => setQueryParamKeepEmpty(url, 'keywords', t),
    // Carrosserie : body%5B%5D= (body[]) répété — URLs humaines 30/08,
    // codes CROISÉS avec le dictionnaire sk:body moissonné (Sedanas 1=
    // berline, Hečbekas 2=citadine, Universalas 3=break [l'URL humaine
    // « break » était un copier-collé de la citadine — le dictionnaire du
    // site tranche], Visureigis 5=suv, Kupe 6=coupé, Kabrioletas 7=
    // cabriolet, Vienatūris 9=monospace). Société (Komercinis 10) : code au
    // dictionnaire mais jamais vu posé en URL → non posé, post-filtre aval.
    // Posé-ou-RETIRÉ (pas keepEmpty : le formulaire du site n'envoie body[]
    // que coché).
    vehicleType: (url, params) => {
      const tok = canonicalizeBody(String(params.vehicleType ?? ''));
      const code = tok ? {
        berline: '1', citadine: '2', break: '3', suv: '5',
        coupe: '6', cabriolet: '7', monospace: '9',
      }[tok as string] : undefined;
      let out = setQueryParamRaw(url, 'body%5B%5D', null);
      out = setQueryParamRaw(out, 'body[]', null);
      return code ? `${out}${out.includes('?') ? '&' : '?'}body%5B%5D=${code}` : out;
    },
  },
  {
    // ── Subito ───────────────────────────────────────────────────────────────
    host: 'subito.it',
    year: (url, from, to) => {
      const out = setQueryParamRaw(url, 'ys', from || null);
      return setQueryParamRaw(out, 'ye', to || null);
    },
    // me= est un CODE ENUM, PAS des km (URL humaine 26/08 : me=18 ⇔ 90 000 km,
    // seul palier prouvé). Autre valeur : paramètre RETIRÉ (jamais deviné —
    // me=30000 brut filtrerait n'importe quoi), tri km en aval.
    mileage: (url, km) => setQueryParamRaw(url, 'me', km === 90000 ? '18' : null),
    // hps EN CV — PROUVÉ URL humaine 26/08 (hps=150).
    power: (url, ch) => setQueryParamRaw(url, 'hps', ch ? String(ch) : null),
    // gr=2 (Automatico — key '2' du dictionnaire /gearbox des annonces) —
    // PROUVÉ URL humaine 26/08.
    gearbox: (url, params) => setQueryParamRaw(url, 'gr', isAutomatic(params) ? '2' : null),
    // Slot texte libre prouvé (02/08 : ?q=m+sport) — minuscule comme le site.
    trimSlot: (url, t) => setQueryParamRaw(url, 'q', t.toLowerCase()),
    // Carrosserie : SEGMENT DE CHEMIN italien (URLs humaines 30/08 :
    // /auto/berlina/, /station-wagon/, /monovolume/, /cabrio/, /coupe/,
    // /city-car/, /suv-fuoristrada/ ; multi cart=2,3). Société absente.
    // ORDRE PROUVÉ PAR SCRAPE LIVE 30/08 : la carrosserie se place AVANT le
    // carburant — /toyota/suv-fuoristrada/ibrida = 100 hybrides SUV (1 779
    // au total), /toyota/ibrida/suv-fuoristrada = 0 (page morte).
    vehicleType: (url, params) => {
      try {
        const u = new URL(url);
        const VOCAB = new Set(['berlina', 'station-wagon', 'monovolume', 'cabrio', 'coupe', 'city-car', 'suv-fuoristrada']);
        const SUBITO_FUELS = new Set(['ibrida', 'elettrica', 'diesel', 'benzina']);
        const segs = u.pathname.split('/').filter(Boolean);
        const autoIdx = segs.indexOf('auto');
        // On ne strippe qu'APRÈS la marque (position auto+2 et suivantes) —
        // même prudence que Gaspedaal (homonymes modèle, Fiat Coupé).
        const keptSegs = segs.filter((s, i) => i <= autoIdx + 1 || !VOCAB.has(s.toLowerCase()));
        const tok = canonicalizeBody(String(params.vehicleType ?? ''));
        const slug = tok ? {
          berline: 'berlina', break: 'station-wagon', monospace: 'monovolume',
          cabriolet: 'cabrio', coupe: 'coupe', citadine: 'city-car',
          suv: 'suv-fuoristrada',
        }[tok as string] : undefined;
        if (slug && autoIdx >= 0) {
          const fuelIdx = keptSegs.findIndex((s, i) => i > autoIdx && SUBITO_FUELS.has(s.toLowerCase()));
          if (fuelIdx >= 0) keptSegs.splice(fuelIdx, 0, slug);
          else keptSegs.push(slug);
        }
        u.pathname = `/${keptSegs.join('/')}/`;
        return u.toString();
      } catch { return url; }
    },
  },
  {
    // ── La Centrale ──────────────────────────────────────────────────────────
    // Grammaire ENTIÈRE prouvée par le corpus d'URLs-preuves Channing 29/08
    // (26 URLs posées à la main, gravé au BACKLOG) : yearMin/yearMax,
    // mileageMax, powerDINMin (ch DIN, bornes séparées — pas de piège N-max),
    // gearbox=AUTO|MANUAL, energies=, versions= (minuscules, espace %20).
    host: 'lacentrale.fr',
    year: (url, from, to) => {
      const out = setQueryParamRaw(url, 'yearMin', from || null);
      return setQueryParamRaw(out, 'yearMax', to || null);
    },
    mileage: (url, km) => setQueryParamRaw(url, 'mileageMax', km ? String(km) : null),
    power: (url, ch) => setQueryParamRaw(url, 'powerDINMin', ch ? String(ch) : null),
    // Les DEUX valeurs sont prouvées (corpus) — MANUAL posé aussi, contrairement
    // aux sites où seule la grammaire automatique est connue.
    gearbox: (url, params) => {
      const g = String(params.gearbox ?? '').trim().toUpperCase();
      const code = /^AUTOMAT/.test(g) ? 'AUTO' : /^MANUEL|^MANUAL/.test(g) ? 'MANUAL' : null;
      return setQueryParamRaw(url, 'gearbox', code);
    },
    // plug_hyb NATIF (le site distingue rechargeable / non-rechargeable) —
    // page au sous-type VRAI, inscrite à SUBTYPE_TRUE_URL côté marketData.
    fuel: (url, params) => {
      const code = {
        ESSENCE: 'ess', PETROL: 'ess', GASOLINE: 'ess',
        DIESEL: 'dies',
        ELECTRIQUE: 'elec', ELECTRIC: 'elec',
        HYBRIDE: 'hyb', HYBRID: 'hyb', MILD_HYBRID: 'hyb',
        PLUG_IN_HYBRID: 'plug_hyb', PHEV: 'plug_hyb',
        GPL: 'gpl', LPG: 'gpl', ETHANOL: 'eth',
      }[String(params.fuel ?? '').trim().toUpperCase()];
      return setQueryParamRaw(url, 'energies', code ?? null);
    },
    trimSlot: (url, t) => setQueryParamRaw(url, 'versions', t.toLowerCase()),
    // Carrosserie : categories= à codes numériques, multi-codes séparés par
    // UNDERSCORE — 8 URLs humaines Channing 30/08 (SUV 47, berline 41_42
    // [deux sous-codes cochés par la facette], monospace 44, cabriolet 46,
    // citadine 40, break 43, coupé 45, commerciale/société 80).
    vehicleType: (url, params) => {
      const tok = canonicalizeBody(String(params.vehicleType ?? ''));
      const code = tok ? {
        suv: '47', berline: '41_42', monospace: '44', cabriolet: '46',
        citadine: '40', break: '43', coupe: '45', societe: '80',
      }[tok as string] : undefined;
      return setQueryParamRaw(url, 'categories', code ?? null);
    },
  },
  {
    // ── Jófogás ──────────────────────────────────────────────────────────────
    host: 'jofogas.hu',
    // rs TOUJOURS posé (constat Channing 01/08 : sans lui le site bloque la
    // recherche) — défaut large 2000 ; re posé-ou-retiré.
    year: (url, from, to) => {
      const out = setQueryParamRaw(url, 'rs', from || '2000');
      return setQueryParamRaw(out, 're', to || null);
    },
    // me EN KM ici (me=90000, URL humaine 02/08) — même nom que le code enum
    // de Subito, sens différent : le registre est PAR SITE, jamais partagé.
    mileage: (url, km) => setQueryParamRaw(url, 'me', km ? String(km) : null),
    trimSlot: (url, t) => setQueryParamRaw(url, 'q', t.toLowerCase()),
    // Carrosserie : SEGMENT DE CHEMIN, multi par + DANS LE MÊME SEGMENT
    // (URLs humaines 30/08 : /auto/sedan, /auto/coupe-10, tous =
    // /auto/cabrio-3+coupe-10+ferdehatu+kisbusz+kombi+sedan+suv+terepjaro).
    // sedan=berline, coupe-10=coupé, cabrio-3=cabriolet, ferdehatu=citadine
    // (hatchback), kisbusz=monospace (minibus), kombi=break, SUV = les DEUX
    // slugs combinés suv+terepjaro (« on combine les deux »). Société absente.
    // Combinaison avec marque/modèle à contre-éprouver par scrape.
    vehicleType: (url, params) => {
      try {
        const u = new URL(url);
        const VOCAB = new Set(['sedan', 'coupe-10', 'cabrio-3', 'ferdehatu', 'kisbusz', 'kombi', 'suv', 'terepjaro']);
        const segs = u.pathname.split('/').filter(Boolean);
        const autoIdx = segs.indexOf('auto');
        // Un segment est carrosserie si TOUS ses sous-tokens (+) sont au
        // vocabulaire — jamais strippé avant la marque.
        const kept = segs.filter((s, i) =>
          i <= autoIdx || !s.split('+').every((t) => VOCAB.has(t.toLowerCase())));
        const tok = canonicalizeBody(String(params.vehicleType ?? ''));
        const slug = tok ? {
          berline: 'sedan', coupe: 'coupe-10', cabriolet: 'cabrio-3',
          citadine: 'ferdehatu', monospace: 'kisbusz', break: 'kombi',
          suv: 'suv+terepjaro',
        }[tok as string] : undefined;
        if (slug && autoIdx >= 0) kept.push(slug);
        u.pathname = `/${kept.join('/')}`;
        return u.toString();
      } catch { return url; }
    },
  },
];

export function grammarForUrl(url: string): SiteGrammar | undefined {
  return SITE_GRAMMARS.find((g) => url.includes(g.host));
}

// ─── Détecteurs par famille de critère ───────────────────────────────────────
// Toutes les grammaires PROUVÉES, tous sites confondus — partagés entre le
// gate de matrice (scripts/grammar-gate.mts) et la décision de profondeur
// des études quotidiennes (une URL qui n'exprime pas un critère demandé ne
// mérite pas 5 pages : on scraperait large ce qu'on croit précis).
export const CRITERIA_DETECTORS: Record<string, RegExp> = {
  année: /regdate=|fregfrom=|fregto=|bmin=|bmax=|regfrom=|regto=|[?&]fr=|year_from=|year_to=|constructionYear|[?&]ys=|[?&]ye=|[?&]rs=|[?&]re=|year_min=[^&]|year_max=[^&]|yearMin=|yearMax=/i,
  km: /mileage=min|kmto=|kmax=|mileageto=|[?&]ml=|mileage_to=|mileageTo|[?&]me=|mileage_max=[^&]|mileageMax=|mileageMin=/i,
  puissance: /powerfrom=|hpfrom=|[?&]pw=|vmin=|engine_effect_from=|power_min=[^&]|[?&]hps=|horse_power_din=|powerDINMin=/i,
  boîte: /[?&]gear=|gearbox=[^&]|[?&]tr=|trns=|transmission=|[?&]gr=|534/i,
  finition: /text=|kwd=|trefw=|free=|\/q\/|[?&#]q[:=]|keywords=[^&]|%3B%3B|;;|versions=[^&]/i,
  carburant: /fuel=|fuel%5B%5D=[^&]|[?&]ft=|[?&]fe=|energies=|13838|473|474|\/hybride|\/elektr|\/elettric|\/ibrida|\/benzina|\/hibrid|\/dizel|\/elektromos|\/benzin\b|\/diesel|\/essence/i,
  carrosserie: /vehicle_type=[^&]|categories=[^&]|[?&]body=[^&]|\/bt_|[?&]c=[^&]|crs=|cartype=|body_type=|body(?:%5B%5D|\[\])=[^&]|[#|]f:[\d+,]*\b48[123468]\b|\/(?:cabriolet|hatchback|mpv|sedan|stationwagen|suv|bedrijfswagen|berlina|station-wagon|monovolume|cabrio|city-car|suv-fuoristrada|ferdehatu|kisbusz|kombi|coupe-10|cabrio-3)(\/|\?|$)|\/suv\+terepjaro|\/coupe(\/|\?|$)/i,
};

/**
 * Familles de critères que le REGISTRE sait poser sur l'URL de ce site —
 * sert à distinguer, pour un critère manquant, « se corrige tout seul à la
 * prochaine vague » (grammaire connue) de « nécessite un apprentissage »
 * (trou de dictionnaire / grammaire non prouvée).
 */
export function registryCoveredCriteria(url: string): Set<string> {
  const g = grammarForUrl(url);
  const out = new Set<string>();
  if (!g) return out;
  if (g.year) out.add('année');
  if (g.mileage) out.add('km');
  if (g.power) out.add('puissance');
  if (g.gearbox) out.add('boîte');
  if (g.fuel) out.add('carburant');
  if (g.vehicleType) out.add('carrosserie');
  if (g.trimSlot || g.trimEnforced) out.add('finition');
  return out;
}

/**
 * Familles de critères que l'étude DEMANDE mais que l'URL n'exprime PAS.
 * Vide = « tous les filtres sont dans l'URL » — la condition posée par
 * Channing (26/08) pour autoriser la profondeur 5 pages au lieu de 3.
 * Empirique : on lit l'URL réellement produite, pas ce qu'on croit avoir posé.
 */
export function missingUrlCriteria(url: string, params: LinkGenParams): string[] {
  if (!url) return Object.keys(CRITERIA_DETECTORS);
  const { yearFrom, yearTo } = resolveYearRange(params);
  const wanted: Array<[string, boolean]> = [
    ['année', Boolean(yearFrom || yearTo)],
    ['km', mileageKm(params) !== null],
    ['puissance', powerCh(params) !== null],
    // Boîte : seule la grammaire AUTOMATIQUE est prouvée sur les sites —
    // une demande manuelle non exprimable est couverte par le post-filtre
    // dur du worker, elle ne doit pas bloquer la profondeur.
    ['boîte', isAutomatic(params)],
    ['finition', Boolean(String(params.trim ?? '').trim())],
    ['carburant', Boolean(String(params.fuel ?? '').trim())],
    ['carrosserie', Boolean(String(params.vehicleType ?? '').trim())],
  ];
  return wanted.filter(([crit, has]) => has && !CRITERIA_DETECTORS[crit].test(url)).map(([c]) => c);
}

// ─── LA fonction d'application unique ────────────────────────────────────────

/**
 * Applique à une URL (apprise OU native) la grammaire prouvée de son site :
 * réparations, puis année/km/puissance/boîte (chacun posé-ou-retiré), la
 * finition imposée (LBC) et les politiques de site. Idempotente — sur une URL
 * native déjà correcte elle ne change rien ; sur une URL apprise elle écrase
 * les valeurs héritées et supprime les fossiles.
 */
export function applyVariableCriteria(url: string, params: LinkGenParams): string {
  if (!url) return url;
  const g = grammarForUrl(url);
  if (!g) return url;
  const { yearFrom, yearTo } = resolveYearRange(params);
  let out = url;
  if (g.repair) out = g.repair(out, params);
  if (g.year) out = g.year(out, yearFrom || '', yearTo || '');
  if (g.mileage) out = g.mileage(out, mileageKm(params));
  if (g.power) out = g.power(out, powerCh(params));
  if (g.gearbox) out = g.gearbox(out, params);
  if (g.fuel) out = g.fuel(out, params);
  if (g.vehicleType) out = g.vehicleType(out, params);
  if (g.trimEnforced) out = g.trimEnforced(out, String(params.trim ?? '').trim());
  if (g.policy) out = g.policy(out);
  return out;
}

/**
 * Pose la finition dans le slot texte-libre PROUVÉ du site. POSE seulement —
 * le gating (URL apprise à finition scopée qui garde son texte) appartient à
 * generateSearchUrlsWithMemory.
 */
export function injectTrimIntoUrl(url: string, trim: string): string {
  const t = trim.trim();
  if (!t || !url) return url;
  const g = grammarForUrl(url);
  return g?.trimSlot ? g.trimSlot(url, t) : url;
}

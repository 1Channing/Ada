/**
 * Market intelligence data layer: write a snapshot + per-listing observations
 * on each confirmed ingestion, and read/aggregate them for the dashboard
 * (depth, median over time, country comparison, price distribution, velocity).
 *
 * Prices are converted to EUR so cross-country charts are comparable
 * (Bilbasen is DKK). No study/arbitrage logic here — pure market recording.
 */

import { sharedSupabase as supabase } from '../lib/supabaseShared';
import type { Database } from '../lib/database.types';
import { generateInternalRef } from '../lib/internalRefGenerator';
import { canonicalizeFuel, refineFuelToken, FUEL_LABELS } from '../lib/study-core/ingestion';
import { isDamagedVehicleText, modelKeyLoose } from '../lib/study-core/business-logic';
import type { FuelToken } from '../lib/study-core/ingestion';
import type { ScrapedListing } from '../lib/study-core/types';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import { fetchAllPages } from '../lib/fetchAllPages';

type ObsInsert = Database['public']['Tables']['market_listing_observations']['Insert'];

export { FUEL_LABELS };
export function fuelLabel(token: string): string {
  return (FUEL_LABELS as Record<string, string>)[token] ?? (token || '—');
}

/** Token carburant canonique → label de critère LinkGen (génération d'URL). */
export const FUEL_TOKEN_TO_CRITERIA: Record<string, string> = {
  electric: 'ELECTRIQUE', petrol: 'ESSENCE', diesel: 'DIESEL',
  hybrid: 'HYBRIDE', mild_hybrid: 'MILD_HYBRID', phev: 'PLUG_IN_HYBRID',
  lpg: 'GPL', cng: 'CNG',
};

// Taux alignés sur business-logic FX_RATES (source unique de vérité métier).
const TO_EUR: Record<string, number> = { DKK: 0.134, SEK: 0.089, HUF: 0.0025 };
function toEur(price: number, currency: string): number {
  const r = TO_EUR[currency];
  return r ? Math.round(price * r) : price;
}

// ─── Percentiles ──────────────────────────────────────────────────────────────

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export interface MarketSegmentKey {
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;
  trim: string;
}

/**
 * Record one market snapshot + its listing observations for a confirmed
 * segment. Prices normalised to EUR. Silent best-effort (never blocks the
 * ingestion UX).
 */
/**
 * Non-retail price guard: Bilbasen serves "WithoutTax"/engros (wholesale,
 * ex-VAT) prices — a CLA at 2 375 kr in production logs — that must never
 * enter a median or an opportunity. Unknown/absent price types stay in.
 */
function isRetailPrice(l: ScrapedListing): boolean {
  const t = (l.priceType ?? '').toLowerCase();
  return !/withouttax|without tax|engros|wholesale|excl/.test(t);
}

export async function writeMarketSnapshot(params: {
  segment: MarketSegmentKey;
  listings: ScrapedListing[];
  totalCount: number | null;
  sourceUrl: string;
  submittedBy?: string;
  /** Vide PROUVÉ (le site a confirmé « aucun résultat » sur page complète) :
   *  autorise un snapshot profondeur 0 — voir le bloc marché-vide plus bas. */
  verifiedEmpty?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const { segment, listings, totalCount, sourceUrl, submittedBy } = params;
  // GARDE D'IDENTITÉ À L'ÉCRITURE (constat 02/08 : l'étude quotidienne
  // Gaspedaal « RAV4 » recevait la page TOUT Toyota — chaque Yaris/C-HR est
  // entrée en base sous model=RAV4, contaminant le MI ET le radar inter-pays).
  // Chaque observation copie l'identité du SEGMENT : une annonce dont la
  // marque ou le modèle STRUCTURÉ contredit ce segment ne doit JAMAIS entrer,
  // quel que soit l'appelant (campagne, étude quotidienne, mise à jour MI,
  // ingestion). Fail-open : sans champ structuré (LBC, AS24…), l'annonce
  // reste — les post-filtres texte amont couvrent ces sites-là. On n'écarte
  // que sur DOUBLE désaccord (clé lâche ET identité référentiel) pour ne pas
  // rejeter les graphies honnêtes (« CLASSE CLA » vs « CLA »).
  const segBrandKey = brandKey(segment.brand ?? '');
  const segModel = (segment.model ?? '').trim();
  const identityOk = (l: ScrapedListing): boolean => {
    const lb = (l.brand ?? '').trim();
    if (segBrandKey && lb && brandKey(lb) !== segBrandKey) return false;
    const lm = (l.model ?? '').trim();
    if (!segModel || !lm) return true;
    return modelKeyLoose(lm) === modelKeyLoose(segModel)
      || refModelKey(segment.brand, lm) === refModelKey(segment.brand, segModel);
  };
  const contradicted = listings.filter((l) => !identityOk(l)).length;
  if (contradicted > 0) {
    console.warn(`[MARKET_SNAPSHOT] ${contradicted} annonce(s) écartée(s) — identité structurée contraire au segment ${segment.brand} ${segment.model} (${segment.site})`);
  }
  const priced = listings.filter((l) => typeof l.price === 'number' && l.price > 0 && isRetailPrice(l) && identityOk(l));
  if (priced.length === 0) {
    // MARCHÉ VIDE VÉRIFIÉ (constat cloche re-scan 27/08) : un scan qui prouve
    // « 0 annonce, filtres appliqués » est une INFORMATION de marché — sans
    // snapshot, le segment restait « périmé » à jamais et chaque relance
    // re-payait un scrape pour re-découvrir le même vide. On écrit un
    // snapshot profondeur 0, sans prix ni observations. Réservé au vide
    // PROUVÉ (verifiedEmpty) — un parseur en échec ne « rafraîchit » rien.
    if (!params.verifiedEmpty) return { ok: false, error: 'no priced listings' };
    const { error: emptyErr } = await supabase.from('market_snapshots').insert({
      site: segment.site, country: segment.country,
      brand: segment.brand, model: segment.model,
      fuel: segment.fuel, trim: segment.trim,
      scraped_at: new Date().toISOString(),
      listing_count: totalCount ?? 0, sample_size: 0,
      currency: 'EUR', source_url: sourceUrl, submitted_by: submittedBy ?? null,
    });
    if (emptyErr) return { ok: false, error: emptyErr.message };
    return { ok: true };
  }

  const scrapedAt = new Date().toISOString();
  const pricesEur = priced.map((l) => toEur(l.price, l.currency)).sort((a, b) => a - b);
  const avg = Math.round(pricesEur.reduce((s, p) => s + p, 0) / pricesEur.length);

  const { data: snap, error: snapErr } = await supabase
    .from('market_snapshots')
    .insert({
      site: segment.site,
      country: segment.country,
      brand: segment.brand,
      model: segment.model,
      fuel: segment.fuel,
      trim: segment.trim,
      scraped_at: scrapedAt,
      listing_count: totalCount,
      sample_size: priced.length,
      price_min: pricesEur[0],
      price_p25: Math.round(percentile(pricesEur, 0.25)),
      price_median: Math.round(percentile(pricesEur, 0.5)),
      price_p75: Math.round(percentile(pricesEur, 0.75)),
      price_max: pricesEur[pricesEur.length - 1],
      price_avg: avg,
      currency: 'EUR',
      source_url: sourceUrl,
      submitted_by: submittedBy ?? null,
    })
    .select('id')
    .single();

  if (snapErr || !snap) {
    console.warn(`[MARKET_SNAPSHOT] snapshot insert failed for ${segment.country} ${segment.brand} ${segment.model}: ${snapErr?.message ?? 'insert failed'}`);
    return { ok: false, error: snapErr?.message ?? 'insert failed' };
  }

  // Sous-type certifié par la RECHERCHE elle-même : une page filtrée plug-in
  // (facette MP 13956, critère CONFIRMÉ par l'ingestion — c'est la condition
  // pour que segment.fuel soit renseigné) ne contient QUE des rechargeables,
  // mais chaque carte n'étiquette que la famille « Hybride » — 7/7 NX 450h+
  // rangées 'hybrid', invisibles du filtre rechargeable du MI (01/08). Quand
  // le segment confirmé porte le sous-type et que la carte ne dit que la
  // famille, le sous-type gagne. Une carte qui CONTREDIT (diesel…) garde son
  // propre attribut — la preuve au grain le plus fin prime.
  const SEGMENT_FUEL_SUBTYPE: Record<string, FuelToken> = { PLUG_IN_HYBRID: 'phev', MILD_HYBRID: 'mild_hybrid' };
  // La promotion famille→sous-type n'est légitime QUE sur une page dont le
  // filtre est réellement au sous-type (LBC fuel=8, facette MP 13956). Sur
  // une page FAMILLE (AS24/Gaspedaal/Subito « hybride » — depuis le retrait
  // du kwd=PHEV forcé, constat ES 29/08), promouvoir étiquetterait les
  // full-hybrids en rechargeables ; là, seul le TITRE départage (450h+,
  // plug-in…) via refineFuelToken.
  const SUBTYPE_TRUE_URL: Array<[RegExp, RegExp]> = [
    [/leboncoin\.fr/, /[?&]fuel=8(&|$)/],
    [/marktplaats\.nl/, /13956/],
  ];
  const subtypeTrusted = !!sourceUrl && SUBTYPE_TRUE_URL.some(([h, p]) => h.test(sourceUrl) && p.test(sourceUrl));
  const segmentSubtype = subtypeTrusted ? SEGMENT_FUEL_SUBTYPE[(segment.fuel ?? '').trim().toUpperCase()] : undefined;

  const observations: ObsInsert[] = priced.map((l) => ({
    snapshot_id: snap.id,
    site: segment.site,
    country: segment.country,
    brand: segment.brand,
    model: segment.model,
    // Per-listing attributes (vary within a snapshot when the search wasn't
    // filtered on them) — this is what lets the dashboard slice by trim/fuel.
    // PHEV refinement: cards label plug-ins as plain "Hybride"; the ad text
    // ("Plug-In", "eHybrid"…) upgrades the token so 'phev' data exists at all.
    fuel: (() => {
      const t = refineFuelToken(canonicalizeFuel(l.fuel ?? ''), `${l.title ?? ''} ${l.description ?? ''} ${l.trim ?? ''}`);
      return (segmentSubtype && (t === 'hybrid' || t === '') ? segmentSubtype : t) || '';
    })(),
    trim: (l.trim ?? '').trim(),
    internal_ref: generateInternalRef({ listing_url: l.listing_url }),
    price: toEur(l.price, l.currency),
    year: l.year,
    mileage: l.mileage,
    power_din: l.powerDin ?? null,
    gearbox: (l.gearbox ?? '').trim() || null,
    doors: l.doors ?? null,
    seats: l.seats ?? null,
    color: (l.color ?? '').trim() || null,
    seller_type: (l.sellerType ?? '').trim() || null,
    price_type: (l.priceType ?? '').trim() || null,
    listing_url: l.listing_url,
    title: (l.title ?? '').slice(0, 200),
    currency: 'EUR',
    scraped_at: scrapedAt,
    published_at: l.publishedAt ?? null,
  }));

  const { error: obsErr } = await supabase
    .from('market_listing_observations')
    .insert(observations);

  if (obsErr) {
    console.warn(`[MARKET_SNAPSHOT] observations insert failed for ${segment.country} ${segment.brand} ${segment.model} (${observations.length} rows): ${obsErr.message}`);
    return { ok: false, error: obsErr.message };
  }
  console.log(`[MARKET_SNAPSHOT] ✅ recorded ${segment.country} ${segment.brand} ${segment.model} · ${priced.length} annonces (site=${segment.site})`);
  return { ok: true };
}

// ─── Read + aggregate ─────────────────────────────────────────────────────────

export interface Snapshot {
  id: string;
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;
  trim: string;
  scraped_at: string;
  listing_count: number | null;
  sample_size: number;
  price_min: number | null;
  price_p25: number | null;
  price_median: number | null;
  price_p75: number | null;
  price_max: number | null;
  price_avg: number | null;
}

export interface Observation {
  snapshot_id: string;
  site: string;
  country: string;
  brand: string;
  model: string;
  fuel: string;        // per-listing canonical token
  trim: string;         // per-listing version
  internal_ref: string;
  price: number | null;
  year: number | null;
  mileage: number | null;
  power_din: number | null;
  gearbox?: string | null;
  doors?: number | null;
  seats?: number | null;
  color?: string | null;
  seller_type?: string | null;
  price_type?: string | null;
  listing_url: string | null;
  title: string | null;
  scraped_at: string;
  /** Mise en ligne DÉCLARÉE par le site (ISO) — null si le site la cache
   *  (mobile.de, Blocket) ou observation antérieure au 28/08. */
  published_at?: string | null;
}

export interface MarketFilters {
  site?: string;
  country?: string;
  brand?: string;
  model?: string;
  trim?: string;
  fuel?: FuelToken | '';
  gearbox?: string;
  yearMin?: number | null;
  yearMax?: number | null;
  mileageMax?: number | null;
  powerMin?: number | null;
}

const EMPTY_FILTERS: MarketFilters = {};

/** True when only site/country/brand/model are set (no per-listing narrowing). */
export function isCoarseOnly(f: MarketFilters): boolean {
  return !f.trim && !f.fuel && !f.gearbox && f.yearMin == null && f.yearMax == null && f.mileageMax == null && f.powerMin == null;
}

const normText = (s: string | null | undefined) => (s ?? '').toLowerCase();

/**
 * Clé canonique marque/modèle : chaque site écrit le même véhicule à sa façon
 * ('RAV4' Leboncoin, 'RAV-4' slug AS24, 'RAV 4' Marktplaats, 'C-HR'/'CHR') —
 * la clé (MAJ + alphanumérique) les regroupe, l'affichage garde UNE variante
 * représentative (la plus fréquente dans les données).
 *
 * Déburrage AVANT le strip (18/08) : sans lui 'ŠKODA' → 'KODA' ≠ 'SKODA'
 * (7 588 vs 2 944 obs scindées en deux marques), 'CITROËN' → 'CITRON',
 * 'LÉON' → 'LON'. Ø/Ł/Đ n'ont pas de décomposition NFD → table explicite.
 * Règle STRICTEMENT jumelle de ada_deburr côté SQL (migration 20260818) —
 * les clés TS sont passées telles quelles aux RPC (mi_obs_for_segment).
 */
const NFD_LESS: Record<string, string> = { 'Ø': 'O', 'Ł': 'L', 'Đ': 'D' };
export function canonKey(v: string): string {
  return (v ?? '')
    .toUpperCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[ØŁĐ]/g, (c) => NFD_LESS[c] ?? c)
    .replace(/[^A-Z0-9]/g, '');
}
const BRAND_KEY_ALIASES: Record<string, string> = { VW: 'VOLKSWAGEN', MERCEDESBENZ: 'MERCEDES' };
export function brandKey(v: string): string {
  const k = canonKey(v);
  return BRAND_KEY_ALIASES[k] ?? k;
}

/**
 * Clé d'IDENTITÉ modèle du système (chantier nommage 02/08) : canonKey plus
 * les conventions d'écriture qui polluent l'identité :
 * - « Golf IV », « C4 III » → numéral romain de génération retiré ;
 * - Mercedes : « GLC-Class » ≡ « CLASSE GLC » ≡ « GLC » — code nu ;
 * - Séries : « 3-Series » (Teoalida) ≡ « SÉRIE 3 » ≡ « 3er » ≡ « 3-serie »
 *   (Gaspedaal) → code nu.
 * Constat fondateur : les snapshots portaient « CLA » ET « CLASSE CLA » comme
 * deux modèles — segments MI dédoublés, radar inter-pays aveugle à la paire.
 * Répliquée à L'IDENTIQUE : importeur Python (scripts/teoalida) et SQL
 * (ada_model_key, migration 20260802220000) — les vecteurs des smokes font
 * foi des trois côtés.
 */
export function refModelKey(brand: string, model: string): string {
  let m = String(model ?? '').trim();
  // Numéral romain de génération en fin de nom (Golf IV, C4 III, Ignis II).
  m = m.replace(/\s+(?:I{1,3}|IV|V|VI{0,3}|IX|X{1,2})$/i, '');
  // Mercedes : X-Class / Classe X / X-Klasse → code nu.
  const bk = brandKey(brand);
  if (bk === 'MERCEDES') {
    const cm = m.match(/^([A-Z]{1,3})[- ]?(?:CLASS|KLASSE)$/i)
      ?? m.match(/^(?:CLASSE|CLASE|CLASS)\s+([A-Z]{1,3})$/i);
    if (cm) m = cm[1];
  }
  const sm = m.match(/^(?:SERIE|SÉRIE|SERIES)\s+(\w{1,3})$/i)
    ?? m.match(/^(\w{1,3})[- ]?SERIES?$/i)
    ?? m.match(/^(\d)[- ]?ER(?:[- ]?REIHE)?$/i);
  if (sm) m = sm[1];
  // Motorisation déguisée en nom de modèle (constat MI 04/08 : le menu
  // listait « KONA » ET « KONA EV », « TUCSON » / « TUCSON HEV » / « TUCSON
  // PHEV » comme des modèles distincts — héritage référentiel). La
  // motorisation vit dans le champ CARBURANT, pas dans l'identité modèle :
  // suffixes dépouillés en boucle tant qu'il reste un nom. Jetons COMPLETS
  // uniquement : « CLASSE E » (E seul), « EV6 »/« EV9 » Kia (un seul jeton,
  // pas de suffixe), « Mach-E » restent intouchés.
  for (;;) {
    const stripped = m.replace(
      /\s+(?:EV|BEV|HEV|PHEV|MHEV|FHEV|HYBRIDE?|ELECTRIC|[ÉE]LECTRIQUE|ELETTRICA|PLUG[- ]?IN(?:[- ]HYBRIDE?)?)$/i, '');
    if (stripped === m || !stripped.trim()) break;
    m = stripped;
  }
  return canonKey(m);
}

/** Union dédupliquée par clé canonique — la variante du 1er argument gagne. */
export function canonUnion(primary: string[], secondary: string[], keyFn: (v: string) => string): string[] {
  const seen = new Map<string, string>();
  for (const v of [...primary, ...secondary]) {
    const k = keyFn(v);
    if (!k || seen.has(k)) continue;
    seen.set(k, v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Fuel filter is HIERARCHICAL: « Hybride » is the family (full hybrid +
 * rechargeable + léger), because ads split unpredictably between the three —
 * a strict equality hid the Spanish Golfs stored as 'phev' from a Hybride
 * study. Picking the precise variant ('phev', 'mild_hybrid') stays exact.
 */
export function fuelFilterMatches(obsFuel: string, wanted: string): boolean {
  if (!wanted) return true;
  if (obsFuel === wanted) return true;
  if (wanted === 'hybrid') return obsFuel === 'phev' || obsFuel === 'mild_hybrid';
  return false;
}

/**
 * BOÎTE DE VITESSES — canonisation multilingue.
 *
 * Chaque site écrit la boîte dans sa langue : la base contient 25 graphies
 * pour 3 réalités ('Automatik', 'Boîte automatique', 'Automatisch',
 * 'Automatico', 'Automaat', 'Automatique', 'Automático', 'Automatisk gear'…).
 * Le filtre listait ces 25 graphies et n'en sélectionnait qu'une à la fois :
 * choisir « Automatik » écartait les automatiques françaises, néerlandaises,
 * italiennes… (constat 29/07). On canonise à la LECTURE, la base garde la
 * graphie d'origine.
 *
 * Ordre des tests critique : 'Semiautomatico', 'Halbautomatik' et
 * 'Half/Semi-automaat' contiennent le motif automatique — le semi passe donc
 * en premier. Les libellés commençant par « - » sont des entrées vides des
 * sites (« - Boîte », « - Cambio »), pas des valeurs.
 */
export type GearboxToken = 'automatique' | 'manuelle' | 'semi';

export const GEARBOX_LABELS: Record<GearboxToken, string> = {
  automatique: 'Automatique',
  manuelle: 'Manuelle',
  semi: 'Semi-automatique',
};

export function canonicalizeGearbox(raw: string | null | undefined): GearboxToken | '' {
  // Accents retirés ICI : le normText partagé ne fait que minuscules, or
  // l'espagnol écrit « Automático » (8 966 annonces) — sans dépouiller le
  // 'á', le motif 'automa' ne matche pas et tout le stock espagnol tombe.
  const s = String(raw ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (!s || s.startsWith('-')) return '';
  if (s.includes('semi') || s.includes('halb')) return 'semi';
  // 'automa' et non 'automat' : le néerlandais écrit « Automaat » (10 939
  // annonces), qui ne contient PAS 'automat' — elles étaient toutes ignorées.
  if (s.includes('automa')) return 'automatique'; // automatik/automatisch/automatico/automaat/automatisk…
  if (s.includes('manu') || s.includes('schalt') || s.includes('handgeschakeld')) return 'manuelle';
  return '';
}

/**
 * Trim is a CONTAINS match over the listing's version AND its title: sites
 * write finitions their own way ("60 Sportline 150 kW 63 kWh" vs "Sportline"),
 * an exact-equality filter returned 0 for everything. Typing "sportline"
 * matches any ad that carries it anywhere in its text.
 */
/**
 * Dédoublonnage LECTURE des annonces clonées : certaines agences repostent la
 * MÊME voiture dans plusieurs villes (4× « CLA 250e, 24 990 €, 41 764 km » —
 * signalement Channing 23/07), ce qui gonfle artificiellement stock et stats.
 * Conforme au principe directeur : tout est stocké fidèlement, on corrige la
 * lecture. Empreinte = même site, même véhicule (modèle/année/prix/km exact/
 * puissance/boîte/titre) le MÊME JOUR — le même véhicule revu un autre jour
 * reste distinct (c'est le signal de vélocité), la première occurrence gagne.
 */
export function dedupeClonedListings(obs: Observation[]): Observation[] {
  const seen = new Set<string>();
  const out: Observation[] = [];
  for (const o of obs) {
    const day = String(o.scraped_at ?? '').slice(0, 10);
    const key = [
      o.site, brandKey(o.brand), canonKey(o.model), o.year ?? '', o.price ?? '',
      o.mileage ?? '', o.power_din ?? '', normText(o.gearbox), normText(o.title), day,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

/**
 * ÉTAT ACTUEL DU MARCHÉ : une ligne par annonce, dans sa version la plus
 * récemment vue.
 *
 * Remplace l'ancienne définition « observations vues dans les 60 s du dernier
 * scrape » : celle-ci ne tenait que si le filtre visait UN segment scanné d'un
 * seul tenant. Dès que le filtre couvrait plusieurs pays ou sites (Pays =
 * Tous), elle se réduisait au dernier scan d'un seul site — le tableau
 * n'affichait plus que les annonces de ce scan-là (que des EQA françaises de
 * 2024 démarrant à 31 400 €) pendant que les indicateurs, eux, comptaient tout
 * le marché (minimum à 12 990 € en Allemagne). Et comme le « dernier scan »
 * change à chaque étude, le contenu variait tout seul — constat 29/07.
 *
 * L'identité d'une annonce est son URL, à défaut sa référence interne, à
 * défaut son empreinte véhicule (SANS le prix : une baisse de prix ne doit pas
 * créer une seconde annonce, elle doit remplacer l'ancienne).
 */
export function latestPerListing(obs: Observation[]): Observation[] {
  const byListing = new Map<string, Observation>();
  for (const o of obs) {
    const id = (o.listing_url ?? '').trim()
      || (o.internal_ref ?? '').trim()
      || [o.site, brandKey(o.brand), canonKey(o.model), o.year ?? '', o.mileage ?? '', o.power_din ?? '', normText(o.title)].join('|');
    const cur = byListing.get(id);
    if (!cur || String(o.scraped_at ?? '') > String(cur.scraped_at ?? '')) byListing.set(id, o);
  }
  return [...byListing.values()];
}

/**
 * Purge des annonces disparues : une annonce dont le segment (tel que scanné :
 * site + pays + marque + modèle + carburant + finition du snapshot) a été
 * re-scanné plus récemment et qui n'apparaît plus dans ce dernier scan
 * n'existe très probablement plus sur le site — elle sort de l'« état actuel »
 * (liste ET métriques). L'historique en base reste intact : les courbes
 * temporelles et la vélocité (qui se nourrit précisément des disparitions)
 * gardent chaque passage. Snapshot inconnu de la fenêtre chargée = conservé
 * (fail-open : on ne supprime que sur preuve d'un re-scan du même segment).
 */
/**
 * V2 par PÉRIMÈTRE (constat Channing 27/08 : les vendues survivaient à une
 * mise à jour MI). La v1 ne comparait que des scans du MÊME segment exact
 * (fuel+trim compris) — or chaque canal écrit son grain : études
 * quotidiennes fuel=''/trim='', mise à jour MI fuel/trim remplis, campagnes
 * année par année. Un scan frais ne faisait donc jamais disparaître les
 * annonces des autres canaux.
 *
 * Règle v2 : une annonce disparaît si un scan POSTÉRIEUR l'a RECOUVERTE
 * sans la revoir. « Recouverte » = même site/pays/marque/modèle ET :
 *  - portée carburant : scan sans carburant (tout) ou carburant compatible ;
 *  - portée finition : scan sans finition ou finition contenue dans l'annonce ;
 *  - fourchette d'ANNÉES du scan (lue dans ses propres observations — les
 *    campagnes scannent millésime par millésime, constat EV3 02/08) ;
 *  - bande de PRIX du scan (price_max : un scan trié prix croissant coupé à
 *    la page 5 ne prouve rien au-delà de sa dernière annonce).
 * Fail-open sur chaque garde : sans preuve de couverture, l'annonce reste.
 */
export function pruneVanishedListings(
  obs: Observation[],
  snapshots: Snapshot[],
  /** Source de COUVERTURE des scans (années effectivement vues) : le jeu
   *  COMPLET d'observations, AVANT filtres d'étude et déduplication.
   *  Constat Ignis 27/08 : la couverture était lue dans la liste déjà
   *  filtrée/dédupliquée — quand les annonces du scan frais étaient
   *  dédupliquées au profit d'un clone d'un autre site, le scan perdait sa
   *  couverture et ne purgeait plus rien (fail-open devenu passoire). */
  coverageSource?: Observation[],
): Observation[] {
  if (snapshots.length === 0) return obs;
  const groupOf = (s: Snapshot) =>
    [s.site, s.country, brandKey(s.brand), refModelKey(s.brand, s.model)].join('|');
  const byId = new Map<string, Snapshot>();
  const byGroup = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    byId.set(s.id, s);
    const k = groupOf(s);
    (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(s);
  }
  for (const list of byGroup.values()) list.sort((a, b) => String(b.scraped_at).localeCompare(String(a.scraped_at)));
  // Fourchette d'années effectivement vue par CHAQUE scan (ses propres obs).
  const yearCover = new Map<string, { min: number; max: number }>();
  for (const o of coverageSource ?? obs) {
    if (o.year == null) continue;
    const cur = yearCover.get(o.snapshot_id);
    yearCover.set(o.snapshot_id, {
      min: cur ? Math.min(cur.min, o.year) : o.year,
      max: cur ? Math.max(cur.max, o.year) : o.year,
    });
  }
  return obs.filter((o) => {
    const own = byId.get(o.snapshot_id);
    if (!own) return true;
    for (const cand of byGroup.get(groupOf(own)) ?? []) {
      if (String(cand.scraped_at) <= String(own.scraped_at)) break; // triés desc — plus rien de postérieur
      // Portée carburant : '' = tous ; sinon l'annonce doit y appartenir.
      // Le snapshot porte la forme CRITÈRE ('HYBRIDE', 'PLUG_IN_HYBRID'…),
      // les observations le token ('hybrid', 'phev'…) — on retraduit.
      const scanFuelRaw = (cand.fuel ?? '').trim();
      const scanFuelToken = scanFuelRaw
        ? (Object.entries(FUEL_TOKEN_TO_CRITERIA).find(([, c]) => c === scanFuelRaw.toUpperCase())?.[0] ?? scanFuelRaw.toLowerCase())
        : '';
      if (scanFuelToken !== '' && !fuelFilterMatches(o.fuel ?? '', scanFuelToken)) continue;
      // Portée finition : '' = toutes ; sinon contenue dans l'annonce.
      const wantTrim = canonKey(cand.trim ?? '');
      if (wantTrim && !canonKey(`${o.trim ?? ''} ${o.title ?? ''}`).includes(wantTrim)) continue;
      // Fourchette d'années du scan candidat (sans preuve → pas couvert).
      const cover = yearCover.get(cand.id);
      if (!cover || o.year == null) continue;
      if (o.year < cover.min || o.year > cover.max) continue;
      // Bande de prix : au-delà du prix max vu par le scan (tri prix, pages
      // limitées), rien n'est prouvé. Comparaison en EUR seulement.
      if (cand.price_max != null && typeof o.price === 'number'
        && ((o as { currency?: string }).currency ?? 'EUR') === 'EUR' && o.price > Number(cand.price_max)) continue;
      return false; // scan postérieur couvrant, annonce non revue → disparue
    }
    return true;
  });
}

/**
 * Texte « souple » pour la FINITION : minuscules, accents dépouillés, toute
 * ponctuation devenue espace. Constat Channing 27/08 (Corolla NL) : le filtre
 * « GR sport » ratait « GR-Sport » — les titres Gaspedaal écrivent la
 * finition avec un TIRET, normText gardait la ponctuation et l'inclusion
 * échouait ; les 6 annonces du scan (URL pourtant bien filtrée trefw=GR+sport)
 * étaient éliminées À L'AFFICHAGE. Espaces conservés comme frontières : on ne
 * colle pas les mots (un besoin « RS » ne doit pas matcher « veRSion » plus
 * qu'avant).
 */
const softText = (v: string | null | undefined) =>
  (v ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

export function filterObservations(obs: Observation[], f: MarketFilters = EMPTY_FILTERS): Observation[] {
  const trimNeedle = softText(f.trim);
  // Boîte : comparaison sur le TOKEN canonique — « Automatique » retient
  // aussi Automatik, Automatisch, Automatico, Automaat, Automatisk gear…
  const gearboxToken = canonicalizeGearbox(f.gearbox);
  return dedupeClonedListings(obs).filter((o) =>
    // Accidentées : JAMAIS dans l'état du marché — elles s'agglutinent au bas
    // du classement prix et faussaient précisément le prix d'attaque et le
    // radar (129 titres confirmés en base au 01/08 : Accidenté, Unfall,
    // Motorschaden…). Détection négation-aware : « non accidenté » et
    // « Unfallfrei » sont des voitures SAINES et restent affichées.
    !isDamagedVehicleText(o.title) &&
    (!f.site || o.site === f.site) &&
    (!f.country || o.country === f.country) &&
    (!f.brand || brandKey(o.brand) === brandKey(f.brand)) &&
    // refModelKey et non canonKey : « CLA » ≡ « CLASSE CLA », « SÉRIE 3 » ≡
    // « 3-SERIES » — l'identité modèle unifiée (chantier nommage 02/08).
    (!f.model || refModelKey(o.brand, o.model) === refModelKey(f.brand ?? o.brand, f.model)) &&
    (!trimNeedle || softText(o.trim).includes(trimNeedle) || softText(o.title).includes(trimNeedle)) &&
    fuelFilterMatches(o.fuel, f.fuel ?? '') &&
    (!gearboxToken || canonicalizeGearbox(o.gearbox) === gearboxToken) &&
    (f.yearMin == null || (o.year != null && o.year >= f.yearMin)) &&
    (f.yearMax == null || (o.year != null && o.year <= f.yearMax)) &&
    (f.mileageMax == null || (o.mileage != null && o.mileage <= f.mileageMax)) &&
    (f.powerMin == null || (o.power_din != null && o.power_din >= f.powerMin)) &&
    // Prix fantaisistes (« 203 € » sur une 500e, constat 26/08 : mensualité ou
    // acompte parsé comme prix) : même plancher que le radar (1 000 €) — une
    // « annonce » sous ce seuil n'est jamais un prix de véhicule et faussait
    // le min affiché et le nuage. Les obs sans prix restent (comptées à part).
    !(typeof o.price === 'number' && o.price > 0 && o.price < 1000)
  );
}

/** Distinct values for a field among observations, respecting the other filters (cascading). */
export function distinctValues(obs: Observation[], field: keyof Observation, applied: MarketFilters): string[] {
  const scoped = filterObservations(obs, { ...applied, [fieldToFilterKey(field)]: undefined } as MarketFilters);

  // Brand/model: one entry per CANONICAL key, represented by the variant the
  // data uses most ('RAV4' + 'RAV-4' + 'RAV 4' → a single dropdown line).
  if (field === 'brand' || field === 'model') {
    const keyFn = field === 'brand' ? brandKey : canonKey;
    const byKey = new Map<string, Map<string, number>>();
    for (const o of scoped) {
      const raw = String(o[field] ?? '').trim();
      if (!raw) continue;
      const k = keyFn(raw);
      const variants = byKey.get(k) ?? byKey.set(k, new Map()).get(k)!;
      variants.set(raw, (variants.get(raw) ?? 0) + 1);
    }
    return [...byKey.values()]
      .map((variants) => [...variants.entries()].sort((a, b) => b[1] - a[1])[0][0])
      .sort((a, b) => a.localeCompare(b));
  }

  // Boîte : les 25 graphies multilingues de la base se réduisent aux 3
  // réalités — une option par réalité, jamais une par langue.
  if (field === 'gearbox') {
    const set = new Set<GearboxToken>();
    for (const o of scoped) {
      const t = canonicalizeGearbox(o.gearbox);
      if (t) set.add(t);
    }
    return (['automatique', 'manuelle', 'semi'] as GearboxToken[])
      .filter((t) => set.has(t))
      .map((t) => GEARBOX_LABELS[t]);
  }

  const set = new Set<string>();
  for (const o of scoped) {
    const v = String(o[field] ?? '').trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
function fieldToFilterKey(field: keyof Observation): keyof MarketFilters {
  return field as keyof MarketFilters;
}

/**
 * The full universe ADA knows about — not just what has observations yet.
 * Sites/countries come from the registered adapters (everything we cover);
 * brands/models come from the LEARNED mappings (linkgen_mapping_memory). This
 * is what wires the mapping to the Market Intelligence dropdowns, so a segment
 * you've mapped is selectable even before its observations land (the charts
 * then show the "awaiting data" state). Values are uppercased to match the
 * observation convention so a selection filters correctly.
 */
export interface KnownDimensions {
  sites: string[];
  countries: string[];
  brands: string[];
  modelsByBrand: Record<string, string[]>;
  /** Canonical fuel tokens confirmed per `BRAND|MODEL`, plus a flat fallback. */
  fuelsByBrandModel: Record<string, string[]>;
  allFuels: string[];
}

export async function loadKnownDimensions(): Promise<KnownDimensions> {
  const data = await fetchAllPages<{ site: string | null; country: string | null; brand: string | null; model: string | null; fuel: string | null }>(
    (from, to) => supabase
      .from('linkgen_mapping_memory')
      .select('site, country, brand, model, fuel')
      .order('created_at', { ascending: false })
      .range(from, to),
    20_000,
  );

  const sites = new Set<string>();
  const countries = new Set<string>();
  // Brand/model deduped by CANONICAL key, most frequent raw variant wins.
  const brandVariants = new Map<string, Map<string, number>>();
  const modelVariants = new Map<string, Map<string, Map<string, number>>>(); // brandKey → modelKey → raw → n
  const fuelsByBrandModel: Record<string, Set<string>> = {}; // `${brandKey}|${modelKey}`
  const allFuels = new Set<string>();

  const bump = (m: Map<string, number>, raw: string) => m.set(raw, (m.get(raw) ?? 0) + 1);

  for (const r of data) {
    if (r.site) sites.add(r.site);
    if (r.country) countries.add(r.country.toUpperCase());
    const b = (r.brand ?? '').trim().toUpperCase();
    if (!b) continue;
    const bk = brandKey(b);
    bump(brandVariants.get(bk) ?? brandVariants.set(bk, new Map()).get(bk)!, b);
    const m = (r.model ?? '').trim().toUpperCase();
    if (m) {
      const mk = refModelKey(b, m);
      const byModel = modelVariants.get(bk) ?? modelVariants.set(bk, new Map()).get(bk)!;
      bump(byModel.get(mk) ?? byModel.set(mk, new Map()).get(mk)!, m);
      // Fuel is stored as the declared label ('HYBRIDE') — canonicalise it to
      // the token ('hybrid') that observations and the filter use.
      const fuel = canonicalizeFuel(r.fuel ?? '');
      if (fuel) {
        (fuelsByBrandModel[`${bk}|${mk}`] ??= new Set()).add(fuel);
        allFuels.add(fuel);
      }
    }
  }

  // Registered adapters = full site + country coverage, even with zero mappings.
  for (const a of allSiteAdapters()) {
    sites.add(a.key);
    if (a.countryCode) countries.add(a.countryCode.toUpperCase());
  }

  const sortStr = (a: string, b: string) => a.localeCompare(b);
  const rep = (variants: Map<string, number>) => [...variants.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    sites: [...sites].sort(sortStr),
    countries: [...countries].sort(sortStr),
    brands: [...brandVariants.values()].map(rep).sort(sortStr),
    // Keyed by brandKey — callers look up with brandKey(selectedBrand).
    modelsByBrand: Object.fromEntries(
      [...modelVariants.entries()].map(([bk, byModel]) => [bk, [...byModel.values()].map(rep).sort(sortStr)])
    ),
    fuelsByBrandModel: Object.fromEntries(Object.entries(fuelsByBrandModel).map(([k, s]) => [k, [...s]])),
    allFuels: [...allFuels],
  };
}

/** Union of two string lists, deduped and alphabetically sorted. */
export function sortedUnion(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
}

// ═════════════════════════════════════════════════════════════════════════════
// LECTURES SCOPÉES (option A, 01/08/2026) — la base trie, le navigateur reçoit
// UNIQUEMENT le segment étudié. Fin des plafonds : 186 467 observations au
// 01/08 (+35 000/j en campagne), tout chargement intégral était condamné.
// Chaque lecture tente d'abord la RPC SQL (migration mi_scoped_reads) et se
// replie sur l'ancienne lecture intégrale tant que la migration n'est pas
// appliquée — le MI ne casse jamais, il accélère quand le SQL est en place.
// ═════════════════════════════════════════════════════════════════════════════

/** Pont RPC typé : les fonctions SQL ne sont pas déclarées dans
 *  database.types (chantier hygiène) — le contrat d'appel est ici. */
/**
 * Lecture RPC paginée : PostgREST plafonne AUSSI les fonctions à ~1000 lignes
 * par réponse (mi_dimensions rendait pile 1000 — les menus perdaient des
 * modèles en silence, constat 01/08). Même contrat que fetchAllPages, via
 * .range() sur le builder RPC. Une page en erreur interrompt sans jeter :
 * les pages déjà lues valent mieux que rien (l'appelant a ses replis).
 */
async function callRpcAllPages<T>(fn: string, args: Record<string, unknown> | undefined, maxRows: number): Promise<{ data: T[] | null; error: { message: string } | null; partial?: boolean }> {
  const PAGE = 1000;
  // PostgREST RÉ-EXÉCUTE la fonction à chaque page : en série, 5 pages de
  // radar ≈ 5 × son coût (constat 26/08 : « les écarts inter-pays mettent du
  // temps à apparaître »). La 1ʳᵉ page rapporte le TOTAL (count exact), les
  // suivantes partent en PARALLÈLE (4 de front — assez pour écraser le mur,
  // pas de quoi étouffer la base). Retry par page conservé ; un échec rend
  // un PARTIEL toujours CONTIGU (les pages après le trou sont écartées pour
  // garder l'ordre déterministe du ORDER BY).
  type PageRes = { data: unknown; error: { message: string } | null; count?: number | null };
  const fetchPage = async (from: number, withCount: boolean): Promise<PageRes> => {
    let page: PageRes = { data: null, error: null };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
      const builder = (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>, o?: { count?: 'exact' }) =>
        { range: (f: number, t: number) => PromiseLike<PageRes> })(fn, args, withCount ? { count: 'exact' } : undefined);
      page = await builder.range(from, Math.min(from + PAGE, maxRows) - 1);
      if (!page.error) break;
    }
    return page;
  };

  const first = await fetchPage(0, true);
  if (first.error) return { data: null, error: first.error };
  const out: T[] = [...((Array.isArray(first.data) ? first.data : []) as T[])];
  if (out.length < PAGE) return { data: out, error: null };

  const total = Math.min(typeof first.count === 'number' ? first.count : maxRows, maxRows);
  const froms: number[] = [];
  for (let f = PAGE; f < total; f += PAGE) froms.push(f);
  if (froms.length === 0) return { data: out, error: null };

  const results: Array<T[] | undefined> = new Array(froms.length);
  let failedAt = Number.POSITIVE_INFINITY;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, froms.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= froms.length || i > failedAt) return;
      const p = await fetchPage(froms[i], false);
      if (p.error) { failedAt = Math.min(failedAt, i); return; }
      results[i] = (Array.isArray(p.data) ? p.data : []) as T[];
    }
  });
  await Promise.all(workers);

  let partial = false;
  for (let i = 0; i < froms.length; i++) {
    const rows = results[i];
    if (i >= failedAt || !rows) {
      console.warn(`[MI_SCOPE] ${fn}: pagination interrompue à ${out.length} ligne(s) — résultat PARTIEL`);
      partial = true;
      break;
    }
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: out, error: null, partial };
}

// Le radar a déjà rendu trois fois un PARTIEL silencieux pris pour un bug
// (95, 34, 36 écarts — constats 02/08, 25-26/08) : le dernier chargement
// d'opportunités mémorise s'il était complet, et le panneau l'affiche.
let opportunitiesPartial = false;
export function wasLastOpportunitiesLoadPartial(): boolean {
  return opportunitiesPartial;
}

/** Clés canoniques d'une marque, alias compris (VOLKSWAGEN → aussi VW). */
function brandKeysForQuery(brand: string): string[] {
  const canonical = brandKey(brand);
  const keys = [canonical];
  for (const [alias, target] of Object.entries(BRAND_KEY_ALIASES)) {
    if (target === canonical) keys.push(alias);
  }
  return keys;
}

// (l'ancien repli « lecture intégrale » legacyAll a été retiré le 26/08 —
// étage 1 anti-mille-feuille : plus aucun chemin ne relit toute la table.)

export interface DimensionRow {
  site: string; country: string; brand: string; model: string; fuel: string;
  n: number; last_seen: string;
}

// ── Tableaux de bord PRÉCALCULÉS (étage 1 anti-mille-feuille, 26/08) ────────
// Le worker régénère mi_dashboard_* après chaque vague d'écriture
// (mi_refresh_dashboards) ; la page ne fait plus que LIRE ces petites tables.
// mi_dashboard_meta date le dernier calcul — affiché à l'écran.
let dashboardsRefreshedAt: string | null = null;
export function getDashboardsRefreshedAt(): string | null {
  return dashboardsRefreshedAt;
}
async function trackDashboardsMeta(): Promise<void> {
  try {
    const { data } = await supabase.from('mi_dashboard_meta').select('*');
    const rows = (data ?? []) as Array<{ id: string; refreshed_at: string }>;
    const med = rows.find((r) => r.id === 'medians') ?? rows[0];
    if (med?.refreshed_at) dashboardsRefreshedAt = med.refreshed_at;
  } catch { /* table absente avant migration — sans gravité */ }
}

/** Dimensions observées — table précalculée d'abord, fonction à la volée en
 *  transition. FINI le repli « lecture intégrale » (400 requêtes, la page
 *  tenue en otage des minutes — c'était LUI le mille-feuille qui s'écroule) :
 *  sans données, les menus retombent sur la taxonomie connue, jamais sur un
 *  chargement de masse. */
export async function loadObservedDimensions(): Promise<DimensionRow[]> {
  const table = await fetchAllPages<DimensionRow>(
    (from, to) => supabase.from('mi_dashboard_dimensions').select('*')
      .order('site').order('country').order('brand').order('model').order('fuel')
      .range(from, to),
    20_000, 'MI_SCOPE',
  );
  if (table.length > 0) {
    void trackDashboardsMeta();
    return table;
  }
  const single = await supabase.rpc('mi_dimensions_json' as never);
  if (!single.error && Array.isArray(single.data)) return single.data as unknown as DimensionRow[];
  console.warn('[MI_SCOPE] tableaux précalculés indisponibles (migration 20260826140000 à appliquer ?) — menus limités à la taxonomie');
  return [];
}

/** Les snapshots restent une lecture intégrale : ~4 000 lignes, sans danger. */
export async function loadSnapshots(): Promise<Snapshot[]> {
  // 50 000 : 4 843 snapshots au 04/08, ~3 000 de plus par grande campagne
  // (plafond monté à 3 000 études) — l'ancien cap 20 000 aurait mordu en
  // quelques semaines et tronqué purge/vélocité/repli en silence.
  return fetchAllPages<Snapshot>(
    (from, to) => supabase.from('market_snapshots').select('*').order('scraped_at', { ascending: false }).range(from, to),
    50_000, 'MI_SCOPE',
  );
}

/**
 * Observations d'une étude : marque obligatoire (sans marque il n'y a pas de
 * segment — la page affiche l'invite), modèle et pays optionnels. Les filtres
 * fins (finition, carburant, années, km) restent appliqués côté client par
 * filterObservations, sur ce jeu déjà réduit.
 */
export async function loadObservationsForStudy(f: MarketFilters): Promise<Observation[]> {
  const brand = (f.brand ?? '').trim();
  if (!brand) return [];
  // 3 tentatives : le premier appel à FROID peut dépasser le statement timeout
  // (57014 constaté le 01/08 — AUDI/Q5/FR en échec, puis 4,1 s / 1,3 s / 0,8 s
  // sur les essais suivants : le cache de la base fait tout). Réessayer suffit
  // presque toujours ; l'échec définitif remonte au caller, qui l'AFFICHE au
  // lieu de montrer un faux zéro.
  let error: { message?: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700 * attempt));
    // PAGINÉ (constat 04/08) : un appel RPC nu est plafonné à 1000 lignes par
    // PostgREST quel que soit p_limit — les gros segments (CLA : 4 226 obs)
    // étaient TRONQUÉS en silence. La pagination .range() est stable depuis
    // l'ORDER BY id de mi_obs_for_segment v4 (migration 20260802235000).
    const res = await callRpcAllPages<Observation>('mi_obs_for_segment', {
      p_brand_keys: brandKeysForQuery(brand),
      // refModelKey — aligné sur ada_model_key côté SQL (migration
      // 20260802220000) : « CLA » et « CLASSE CLA » chargent le même segment.
      p_model_key: (f.model ?? '').trim() ? refModelKey(brand, f.model!) : null,
      p_country: (f.country ?? '').trim() || null,
      p_limit: 30_000,
    }, 30_000);
    if (!res.error && Array.isArray(res.data)) return res.data;
    error = res.error;
    if (!/timeout|57014/i.test(String(res.error?.message ?? ''))) break;
  }
  console.warn('[MI_SCOPE] mi_obs_for_segment indisponible — repli via snapshots:', error?.message);
  // Repli SCOPÉ via les snapshots — surtout PAS la lecture intégrale (jusqu'à
  // 250 pages de 1 000 lignes : des MINUTES de « Chargement du segment » dès
  // que la RPC timeoutait trois fois, constat 01/08 sur Q6 E-TRON). Chaque
  // snapshot porte son segment : on les filtre par clés canoniques CÔTÉ CLIENT
  // (~4 200 lignes), puis on lit les observations par snapshot_id — 0,7 s
  // mesuré sur le segment qui bloquait.
  const snaps = await loadSnapshots();
  const bks = new Set(brandKeysForQuery(brand));
  const mk = (f.model ?? '').trim() ? refModelKey(brand, f.model!) : null;
  const ctry = (f.country ?? '').trim() || null;
  const ids = snaps
    .filter((s) => bks.has(brandKey(s.brand))
      && (!mk || refModelKey(s.brand, s.model) === mk)
      && (!ctry || s.country === ctry))
    .map((s) => s.id);
  if (ids.length === 0) return [];
  const out: Observation[] = [];
  for (let i = 0; i < ids.length && out.length < 30_000; i += 40) {
    const chunk = ids.slice(i, i + 40);
    // Vue chaud + archive (étage 2) : les observations > 60 j vivent dans
    // l'archive — l'historique par étude doit voir TOUT (exigence 26/08).
    const rows = await fetchAllPages<Observation>(
      (from, to) => supabase.from('market_listing_observations_all').select('*')
        .in('snapshot_id', chunk).order('scraped_at', { ascending: false }).range(from, to),
      30_000,
      'MI_SCOPE_FALLBACK',
    );
    out.push(...rows);
  }
  return out.slice(0, 30_000);
}

/** Median/percentiles of the filtered observation prices. */
export function priceStats(obs: Observation[]): { count: number; median: number; p25: number; p75: number; min: number; max: number; avg: number } {
  const prices = obs.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return { count: 0, median: 0, p25: 0, p75: 0, min: 0, max: 0, avg: 0 };
  return {
    count: prices.length,
    median: Math.round(percentile(prices, 0.5)),
    p25: Math.round(percentile(prices, 0.25)),
    p75: Math.round(percentile(prices, 0.75)),
    min: prices[0],
    max: prices[prices.length - 1],
    avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
  };
}

/**
 * Prix d'attaque : à partir de quel prix une annonce est réellement compétitive
 * sur le segment — médiane des N annonces les moins chères. La médiane globale
 * décrit le MILIEU du marché ; pour se placer, c'est le bas qui compte, mais le
 * minimum brut est souvent une épave ou une arnaque : la médiane d'une petite
 * fenêtre résiste à 1-2 annonces pourries.
 *
 * N est adaptatif : une fenêtre fixe change de sens avec la profondeur (5 moins
 * chères sur 12 annonces = 40 % du marché, ce n'est plus « le bas » ; 3 sur 300
 * reste fragile face à une seule annonce cassée).
 */
export function attackWindowSize(count: number): number {
  if (count >= 100) return 8;
  if (count >= 20) return 5;
  return 3;
}

export function attackPrice(obs: Observation[]): { price: number; window: number } | null {
  const prices = obs.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const window = Math.min(attackWindowSize(prices.length), prices.length);
  return { price: Math.round(percentile(prices.slice(0, window), 0.5)), window };
}

/**
 * Série temporelle des médianes : UN point par JOUR (et plus par scan —
 * constat 04/08 : les campagnes année par année posent plusieurs snapshots
 * le même jour, l'axe répétait les dates et la médiane sautait d'une tranche
 * d'année à l'autre). Toutes les observations du jour sont réunies, chaque
 * annonce comptée UNE fois (sa version la plus récente du jour), puis les
 * stats sont calculées sur ce marché du jour — même grain que les
 * indicateurs. La série reçoit les observations DÉJÀ filtrées (carburant,
 * années, km, finition) : chaque filtre du MI change donc bien la courbe.
 */
export function timeSeries(obs: Observation[]): { date: string; median: number; p25: number; p75: number; count: number; ts: number }[] {
  const byDay = new Map<string, Observation[]>();
  for (const o of obs) {
    const day = String(o.scraped_at ?? '').slice(0, 10);
    if (!day) continue;
    const arr = byDay.get(day) ?? [];
    arr.push(o);
    byDay.set(day, arr);
  }
  const rows = [...byDay.entries()].map(([day, group]) => {
    const st = priceStats(latestPerListing(group));
    return {
      ts: new Date(`${day}T12:00:00Z`).getTime(),
      date: `${day}T12:00:00Z`,
      median: st.median,
      p25: st.p25,
      p75: st.p75,
      count: st.count,
    };
  });
  return rows.sort((a, b) => a.ts - b.ts);
}

export interface MarketData {
  snapshots: Snapshot[];
  observations: Observation[];
  /** Non nul si le plafond de lecture a mordu : date de la plus ancienne
   *  observation affichée — tout ce qui précède est absent de la page. */
  truncatedFrom?: string | null;
}

/**
 * Le plafond de 60 000 lignes était atteint depuis les campagnes de masse
 * (170 000 observations en base le 29/07) : la lecture, triée du plus récent
 * au plus ancien, ne montrait plus que les ~2 derniers jours et 42 couples
 * marque/modèle disparaissaient purement de la page. Comme la borne avance à
 * chaque scrape, l'affichage changeait tout seul d'une visite à l'autre —
 * d'où l'impression de résultats aléatoires. Le plafond est relevé, et s'il
 * mord un jour la page le DIT au lieu de tronquer en silence.
 */
export const MARKET_OBS_CAP = 250_000;

export async function loadMarketData(maxObservations = MARKET_OBS_CAP): Promise<MarketData> {
  const [snapshots, observations] = await Promise.all([
    fetchAllPages<Snapshot>(
      (from, to) => supabase.from('market_snapshots').select('*').order('scraped_at', { ascending: false }).range(from, to),
      20_000,
      'MARKET_DATA',
    ),
    // Vue chaud + archive (étage 2) — « tout » veut dire tout, archive comprise.
    fetchAllPages<Observation>(
      (from, to) => supabase.from('market_listing_observations_all').select('*').order('scraped_at', { ascending: false }).range(from, to),
      maxObservations,
      'MARKET_DATA',
    ),
  ]);
  // Plafond atteint = des observations plus anciennes existent sans être lues.
  const truncatedFrom = observations.length >= maxObservations
    ? (observations[observations.length - 1]?.scraped_at ?? null)
    : null;
  if (truncatedFrom) {
    console.warn(`[MARKET_DATA] plafond ${maxObservations} atteint — rien d'antérieur à ${truncatedFrom} n'est affiché`);
  }
  return { snapshots, observations, truncatedFrom };
}

export function priceHistogramFrom(obs: Observation[], buckets = 12): { range: string; count: number; from: number; to: number }[] {
  const prices = obs.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0);
  if (prices.length === 0) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return [{ range: `${Math.round(min / 1000)}k`, count: prices.length, from: min, to: min }];
  const width = (max - min) / buckets;
  const bins = Array.from({ length: buckets }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const p of prices) bins[Math.min(buckets - 1, Math.floor((p - min) / width))].count += 1;
  return bins.map((b) => ({ range: `${Math.round(b.from / 1000)}–${Math.round(b.to / 1000)}k`, count: b.count, from: b.from, to: b.to }));
}

// A segment label used across the dashboard.
export function segmentLabel(s: { brand: string; model: string; fuel: string; trim: string }): string {
  return [s.brand, s.model, s.fuel, s.trim].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ');
}
export function segmentId(s: { site: string; brand: string; model: string; fuel: string; trim: string }): string {
  return [s.site, s.brand, s.model, s.fuel, s.trim].join('|');
}

// ─── Velocity ─────────────────────────────────────────────────────────────────

export interface VelocityStat {
  segmentId: string;
  label: string;
  site: string;
  country: string;
  soldCount: number;         // observations no longer seen in the latest snapshot
  activeCount: number;        // still present (censored)
  avgDaysToDisappear: number; // proxy for time-to-sell (page-1 sampling caveat)
  // ─── Vélocité RÉELLE (28/08) — quand le site déclare la mise en ligne ───
  /** Médiane d'ÂGE du stock ACTIF (jours depuis la mise en ligne déclarée). */
  stockMedianAgeDays: number | null;
  /** Médiane de DURÉE DE VIE des disparues (mise en ligne → dernière vue). */
  soldMedianLifeDays: number | null;
  /** Actives datées / disparues datées — la matière derrière les médianes. */
  datedActiveCount: number;
  datedSoldCount: number;
}

/**
 * Velocity proxy: a listing's lifetime = first_seen → last_seen across the
 * snapshots of its segment. A ref absent from the segment's LATEST snapshot is
 * treated as "gone" (sold/delisted); still-present refs are censored (active).
 *
 * CAVEAT: ingestion scrapes only page 1 (cheapest ~30), so a listing can drop
 * off page 1 without selling. Treat this as a rough signal until the periodic
 * scanner (deeper pages) lands. Needs ≥2 snapshots of a segment to say anything.
 */
export function computeVelocity(data: MarketData): VelocityStat[] {
  const snapById = new Map(data.snapshots.map((s) => [s.id, s]));
  // Group snapshots per segment, find the latest snapshot time per segment.
  const latestBySeg = new Map<string, number>();
  const countryBySeg = new Map<string, string>();
  const siteBySeg = new Map<string, string>();
  for (const s of data.snapshots) {
    const seg = segmentId(s);
    const t = new Date(s.scraped_at).getTime();
    latestBySeg.set(seg, Math.max(latestBySeg.get(seg) ?? 0, t));
    countryBySeg.set(seg, s.country);
    siteBySeg.set(seg, s.site);
  }

  // Per (segment, internal_ref): first/last seen.
  interface Life { first: number; last: number; }
  const lives = new Map<string, Map<string, Life>>();
  for (const o of data.observations) {
    const snap = snapById.get(o.snapshot_id);
    if (!snap) continue;
    const seg = segmentId(snap);
    const t = new Date(o.scraped_at).getTime();
    let m = lives.get(seg);
    if (!m) { m = new Map(); lives.set(seg, m); }
    const cur = m.get(o.internal_ref);
    if (!cur) m.set(o.internal_ref, { first: t, last: t });
    else { cur.first = Math.min(cur.first, t); cur.last = Math.max(cur.last, t); }
  }

  const out: VelocityStat[] = [];
  for (const [seg, refs] of lives) {
    const latest = latestBySeg.get(seg) ?? 0;
    let soldCount = 0, activeCount = 0, sumDays = 0;
    for (const life of refs.values()) {
      const seenAtLatest = life.last >= latest - 60_000; // within 1 min of latest snapshot
      if (seenAtLatest) { activeCount += 1; continue; }
      soldCount += 1;
      sumDays += (life.last - life.first) / 86_400_000;
    }
    out.push({
      segmentId: seg,
      label: segmentLabel({ brand: seg.split('|')[1], model: seg.split('|')[2], fuel: seg.split('|')[3], trim: seg.split('|')[4] }),
      site: siteBySeg.get(seg) ?? '',
      country: countryBySeg.get(seg) ?? '',
      soldCount,
      activeCount,
      avgDaysToDisappear: soldCount > 0 ? Math.round((sumDays / soldCount) * 10) / 10 : 0,
      // Voie datée servie par velocityFromObservations (le canal du MI) —
      // cette agrégation historique reste proxy-seulement.
      stockMedianAgeDays: null, soldMedianLifeDays: null,
      datedActiveCount: 0, datedSoldCount: 0,
    });
  }
  return out.sort((a, b) => b.soldCount - a.soldCount);
}

/** Minimum observation window before velocity means anything. */
export const VELOCITY_MIN_DAYS = 14;

/**
 * Longest observation window (days) across segments of a filtered slice —
 * powers the "collecte en cours — Xj/14" state before velocity unlocks.
 */
export function velocityCoverageDays(obs: Observation[]): number {
  const groups = new Map<string, number[]>();
  for (const o of obs) {
    const key = segmentId(o);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(new Date(o.scraped_at).getTime());
  }
  let best = 0;
  for (const times of groups.values()) {
    if (times.length < 2) continue;
    best = Math.max(best, (Math.max(...times) - Math.min(...times)) / 86_400_000);
  }
  return Math.floor(best);
}

/**
 * Velocity over an already-filtered observation set, grouped by segment.
 * Same first_seen→last_seen logic as computeVelocity but slice-aware, so it
 * respects the dashboard filters. A segment only qualifies once its window
 * spans ≥ VELOCITY_MIN_DAYS: two scans hours apart produced absurd
 * "sold in 0.2 days" readings.
 */
export function velocityFromObservations(obs: Observation[]): VelocityStat[] {
  const groups = new Map<string, Observation[]>();
  for (const o of obs) {
    const key = segmentId(o);
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return Math.round(m * 10) / 10;
  };
  const now = Date.now();
  const out: VelocityStat[] = [];
  for (const [seg, list] of groups) {
    const times = [...new Set(list.map((o) => new Date(o.scraped_at).getTime()))];
    const latest = Math.max(...times);
    const windowOk = times.length >= 2
      && (latest - Math.min(...times)) >= VELOCITY_MIN_DAYS * 86_400_000;
    const lives = new Map<string, { first: number; last: number; published: number | null }>();
    for (const o of list) {
      const t = new Date(o.scraped_at).getTime();
      // Mise en ligne DÉCLARÉE par le site : la plus ancienne vue pour cette
      // annonce (une re-remontée peut réécrire index_date — la naissance, non).
      const p = o.published_at ? new Date(o.published_at).getTime() : NaN;
      const cur = lives.get(o.internal_ref);
      if (!cur) {
        lives.set(o.internal_ref, { first: t, last: t, published: Number.isFinite(p) ? p : null });
      } else {
        cur.first = Math.min(cur.first, t); cur.last = Math.max(cur.last, t);
        if (Number.isFinite(p)) cur.published = cur.published == null ? p : Math.min(cur.published, p);
      }
    }
    let soldCount = 0, activeCount = 0, sumDays = 0;
    const stockAges: number[] = [];
    const soldLives: number[] = [];
    for (const life of lives.values()) {
      const active = life.last >= latest - 60_000;
      if (active) {
        activeCount += 1;
        // ÂGE RÉEL du stock : la date de naissance est déclarée par le site —
        // un SEUL scan suffit, aucune fenêtre d'observation requise.
        if (life.published != null) stockAges.push((now - life.published) / 86_400_000);
        continue;
      }
      // Disparue : le proxy garde ses gardes-fous (fenêtre ≥ 14 j) ; la voie
      // datée n'en a pas besoin — la durée de vie part de la vraie naissance.
      if (life.published != null) soldLives.push((life.last - life.published) / 86_400_000);
      if (!windowOk) continue;
      soldCount += 1;
      sumDays += (life.last - life.first) / 86_400_000;
    }
    const datedSold = windowOk || times.length >= 2 ? soldLives : [];
    if (!windowOk && stockAges.length === 0 && datedSold.length === 0) continue;
    const bits = seg.split('|');
    const label = [bits[1], bits[2], fuelLabel(bits[3]), bits[4]]
      .map((x) => (x ?? '').trim()).filter((x) => x && x !== '—').join(' · ');
    out.push({
      segmentId: seg,
      label: label || bits[2],
      site: bits[0],
      country: list[0].country,
      soldCount, activeCount,
      avgDaysToDisappear: soldCount > 0 ? Math.round((sumDays / soldCount) * 10) / 10 : 0,
      stockMedianAgeDays: median(stockAges),
      soldMedianLifeDays: median(datedSold),
      datedActiveCount: stockAges.length,
      datedSoldCount: datedSold.length,
    });
  }
  // Segments DATÉS d'abord (la vraie vélocité), puis le proxy par volume.
  return out.sort((a, b) =>
    (b.datedActiveCount + b.datedSoldCount) - (a.datedActiveCount + a.datedSoldCount)
    || b.soldCount - a.soldCount);
}

// ─── Vélocité v3 : lecture PAYS → tranches de prix / km (demande 28/08) ─────

export interface VelocityBandStat {
  label: string;
  stockMedianAgeDays: number | null;
  soldMedianLifeDays: number | null;
  activeN: number;
  soldN: number;
}
export interface CountryVelocity {
  country: string;
  datedActiveN: number;
  datedSoldN: number;
  /** Dont naissances ESTIMÉES par première observation (sites sans date
   *  déclarée — AS24/Bilbasen/mobile.de/Blocket) : seules les annonces
   *  APPARUES en cours de suivi comptent, exactes à ±1 vague. */
  estimatedN: number;
  stockMedianAgeDays: number | null;
  soldMedianLifeDays: number | null;
  /** Repli pour les pays sans dates déclarées (mobile.de, Blocket…). */
  proxyMedianDisappearDays: number | null;
  proxySoldN: number;
  priceBands: VelocityBandStat[];
  mileageBands: VelocityBandStat[];
}

const PRICE_EDGES = [15_000, 25_000, 35_000, 50_000];
const PRICE_LABELS = ['< 15 k€', '15–25 k€', '25–35 k€', '35–50 k€', '≥ 50 k€'];
const KM_EDGES = [30_000, 60_000, 100_000];
const KM_LABELS = ['< 30 000 km', '30–60 000 km', '60–100 000 km', '≥ 100 000 km'];
const bandIndex = (v: number, edges: number[]): number => {
  let i = 0;
  while (i < edges.length && v >= edges[i]) i++;
  return i;
};
const medianOf = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
};

/**
 * Vélocité lisible : par PAYS (cliquable côté carte), puis délais par tranche
 * de PRIX et de KILOMÉTRAGE — c'est là que la décision d'achat se joue
 * (Channing 28/08). Voie datée (mise en ligne déclarée) partout où elle
 * existe ; les pays sans dates gardent une médiane proxy par disparition
 * (fenêtre ≥ 14 j par segment, comme avant).
 */
export function velocityByCountry(obs: Observation[]): CountryVelocity[] {
  const segLatest = new Map<string, number>();
  const segFirst = new Map<string, number>();
  for (const o of obs) {
    const s = segmentId(o);
    const t = new Date(o.scraped_at).getTime();
    if ((segLatest.get(s) ?? 0) < t) segLatest.set(s, t);
    if ((segFirst.get(s) ?? Infinity) > t) segFirst.set(s, t);
  }
  interface Life {
    country: string; seg: string;
    price: number | null; mileage: number | null;
    first: number; last: number; published: number | null;
  }
  const lives = new Map<string, Life>();
  for (const o of obs) {
    const seg = segmentId(o);
    const key = `${seg}|${o.internal_ref}`;
    const t = new Date(o.scraped_at).getTime();
    const p = o.published_at ? new Date(o.published_at).getTime() : NaN;
    const cur = lives.get(key);
    if (!cur) {
      lives.set(key, {
        country: o.country, seg, price: o.price, mileage: o.mileage,
        first: t, last: t, published: Number.isFinite(p) ? p : null,
      });
    } else {
      if (t >= cur.last) { cur.price = o.price; cur.mileage = o.mileage; }
      cur.first = Math.min(cur.first, t);
      cur.last = Math.max(cur.last, t);
      if (Number.isFinite(p)) cur.published = cur.published == null ? p : Math.min(cur.published, p);
    }
  }

  const now = Date.now();
  interface Acc {
    stockAges: number[]; soldLives: number[]; proxyLives: number[]; estimatedN: number;
    price: Array<{ stock: number[]; sold: number[] }>;
    km: Array<{ stock: number[]; sold: number[] }>;
  }
  const mkAcc = (): Acc => ({
    stockAges: [], soldLives: [], proxyLives: [], estimatedN: 0,
    price: PRICE_LABELS.map(() => ({ stock: [], sold: [] })),
    km: KM_LABELS.map(() => ({ stock: [], sold: [] })),
  });
  const byCountry = new Map<string, Acc>();
  for (const life of lives.values()) {
    const acc = byCountry.get(life.country) ?? byCountry.set(life.country, mkAcc()).get(life.country)!;
    const latest = segLatest.get(life.seg) ?? 0;
    const active = life.last >= latest - 60_000;
    const windowOk = latest - (segFirst.get(life.seg) ?? latest) >= VELOCITY_MIN_DAYS * 86_400_000;
    // Naissance ESTIMÉE (sites sans date déclarée — sondes 28-29/08 : AS24 et
    // Bilbasen n'exposent rien en liste) : une annonce APPARUE en cours de
    // suivi (première vue > 36 h après le début du suivi du segment) est née
    // entre deux vagues — sa première observation est sa naissance à ±1 j.
    // Celles déjà présentes au premier scan restent d'âge inconnu : jamais
    // datées d'office, ce serait un mensonge.
    let birth = life.published;
    if (birth == null && life.first > (segFirst.get(life.seg) ?? life.first) + 36 * 3_600_000) {
      birth = life.first;
      acc.estimatedN += 1;
    }
    if (birth != null) {
      const days = active ? (now - birth) / 86_400_000 : (life.last - birth) / 86_400_000;
      const target: 'stock' | 'sold' = active ? 'stock' : 'sold';
      (active ? acc.stockAges : acc.soldLives).push(days);
      if (life.price != null && life.price > 0) acc.price[bandIndex(life.price, PRICE_EDGES)][target].push(days);
      if (life.mileage != null && life.mileage > 0) acc.km[bandIndex(life.mileage, KM_EDGES)][target].push(days);
    } else if (!active && windowOk) {
      acc.proxyLives.push((life.last - life.first) / 86_400_000);
    }
  }

  const out: CountryVelocity[] = [];
  for (const [country, acc] of byCountry) {
    const bands = (labels: string[], src: Array<{ stock: number[]; sold: number[] }>): VelocityBandStat[] =>
      labels.map((label, i) => ({
        label,
        stockMedianAgeDays: medianOf(src[i].stock),
        soldMedianLifeDays: medianOf(src[i].sold),
        activeN: src[i].stock.length,
        soldN: src[i].sold.length,
      })).filter((b) => b.activeN + b.soldN > 0);
    out.push({
      country,
      datedActiveN: acc.stockAges.length,
      datedSoldN: acc.soldLives.length,
      estimatedN: acc.estimatedN,
      stockMedianAgeDays: medianOf(acc.stockAges),
      soldMedianLifeDays: medianOf(acc.soldLives),
      proxyMedianDisappearDays: medianOf(acc.proxyLives),
      proxySoldN: acc.proxyLives.length,
      priceBands: bands(PRICE_LABELS, acc.price),
      mileageBands: bands(KM_LABELS, acc.km),
    });
  }
  return out.sort((a, b) => (b.datedActiveN + b.datedSoldN) - (a.datedActiveN + a.datedSoldN));
}

/** Une annonce du segment, vue vélocité : son temps en ligne, cliquable. */
export interface SegmentListingVelocity {
  title: string | null;
  listing_url: string | null;
  price: number | null;
  days: number;
  active: boolean;   // encore en ligne au dernier scan
  dated: boolean;    // naissance déclarée/estimée (false = simple proxy vu→disparu)
}

/**
 * Le grain le plus fin de la vélocité (demande 29/08) : les ANNONCES d'un
 * segment avec leur temps en ligne — mêmes règles de naissance que
 * velocityByCountry (déclarée par le site, sinon estimée par apparition en
 * cours de suivi, sinon proxy première→dernière vue).
 */
export function velocitySegmentListings(obs: Observation[], segId: string): SegmentListingVelocity[] {
  const list = obs.filter((o) => segmentId(o) === segId);
  if (list.length === 0) return [];
  const times = [...new Set(list.map((o) => new Date(o.scraped_at).getTime()))];
  const latest = Math.max(...times);
  const first = Math.min(...times);
  interface L { first: number; last: number; published: number | null; title: string | null; url: string | null; price: number | null }
  const lives = new Map<string, L>();
  for (const o of list) {
    const t = new Date(o.scraped_at).getTime();
    const p = o.published_at ? new Date(o.published_at).getTime() : NaN;
    const cur = lives.get(o.internal_ref);
    if (!cur) {
      lives.set(o.internal_ref, { first: t, last: t, published: Number.isFinite(p) ? p : null, title: o.title, url: o.listing_url, price: o.price });
    } else {
      if (t >= cur.last) { cur.title = o.title; cur.url = o.listing_url; cur.price = o.price; }
      cur.first = Math.min(cur.first, t);
      cur.last = Math.max(cur.last, t);
      if (Number.isFinite(p)) cur.published = cur.published == null ? p : Math.min(cur.published, p);
    }
  }
  const now = Date.now();
  const out: SegmentListingVelocity[] = [];
  for (const l of lives.values()) {
    const active = l.last >= latest - 60_000;
    const birth = l.published ?? (l.first > first + 36 * 3_600_000 ? l.first : null);
    const days = birth != null
      ? (active ? now - birth : l.last - birth) / 86_400_000
      : (l.last - l.first) / 86_400_000;
    out.push({
      title: l.title, listing_url: l.url, price: l.price,
      days: Math.round(days * 10) / 10, active, dated: birth != null,
    });
  }
  // Les plus vieilles en tête — c'est le stock qui dort qu'on veut voir.
  return out.sort((a, b) => (a.active === b.active ? b.days - a.days : a.active ? -1 : 1));
}

/** Histogram buckets over the latest snapshot's listing prices for a segment. */
export function priceHistogram(observations: Observation[], buckets = 10): { range: string; count: number; from: number }[] {
  const prices = observations.map((o) => o.price).filter((p): p is number => typeof p === 'number' && p > 0);
  if (prices.length === 0) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return [{ range: `${Math.round(min / 1000)}k`, count: prices.length, from: min }];
  const width = (max - min) / buckets;
  const bins = Array.from({ length: buckets }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const p of prices) {
    const i = Math.min(buckets - 1, Math.floor((p - min) / width));
    bins[i].count += 1;
  }
  return bins.map((b) => ({
    range: `${Math.round(b.from / 1000)}–${Math.round(b.to / 1000)}k`,
    count: b.count,
    from: b.from,
  }));
}

// ─── Cross-country opportunity alerts ─────────────────────────────────────────
//
// "Objectif omniprésence" : every campaign/ingestion scrape already records
// per-listing observations; this layer mines them for NEW MARKETS — a model
// whose cheap end (median of the 5 cheapest, sorted-ascending page 1 is
// exactly what we scrape) differs by ≥ threshold between two countries.
// Deliberately COARSE (brand+model+fuel), unlike market studies: the goal is
// spotting a market to work, not picking listings.

export interface MarketOpportunity {
  brand: string;
  model: string;
  fuel: string;        // canonical token ('electric'…)
  /** Comparison year — both sides compare THE SAME vintage, never 1998 vs 2022. */
  year: number;
  lowCountry: string;
  lowSite: string;
  lowMedian: number;   // EUR — median of the 5 cheapest
  lowCount: number;
  highCountry: string;
  highSite: string;
  highMedian: number;
  highCount: number;
  deltaEur: number;
}

const OPP_WINDOW_DAYS = 30;
const OPP_MIN_PRICE_EUR = 1000; // wrecks/leasing noise guard

export function opportunityKey(o: MarketOpportunity): string {
  return [o.brand, o.model, o.fuel, o.year, o.lowCountry, o.highCountry].join('|');
}

/** Clé de session où le Market Intelligence lit ses études au montage. */
export const MARKET_STUDIES_KEY = 'ada_market_studies';

/**
 * Un écart du radar → les deux études comparées (pays bas vs pays haut),
 * même carburant et même millésime des deux côtés.
 */
export function studiesFromOpportunity(o: MarketOpportunity): MarketFilters[] {
  const base = { brand: o.brand, model: o.model, fuel: o.fuel as FuelToken, yearMin: o.year, yearMax: o.year };
  return [{ ...base, country: o.lowCountry }, { ...base, country: o.highCountry }];
}

/**
 * « Inspecter » depuis une AUTRE page que le MI (l'Accueil) : la navigation
 * y recharge la page entière, donc l'écart cliqué ne peut pas voyager en
 * mémoire — il était purement perdu et le MI s'ouvrait vierge (constat
 * 29/07). On le dépose dans la session que le MI lit au montage, puis on
 * navigue.
 */
export function inspectOpportunityInMarket(o: MarketOpportunity, navigateTo: (path: string) => void): void {
  try {
    sessionStorage.setItem(MARKET_STUDIES_KEY, JSON.stringify(studiesFromOpportunity(o)));
  } catch { /* session pleine ou navigation privée : le MI s'ouvrira sur ses filtres courants */ }
  // Depuis le keep-alive (étage 3), un MI DÉJÀ monté ne repasse plus par son
  // montage — l'événement lui dit d'appliquer les études déposées en session.
  window.dispatchEvent(new Event('ada:open-market-studies'));
  navigateTo('/market');
}

export async function loadMarketOpportunities(
  minDelta = 5000,
  minPerCountry = 5,
  /** Si fourni : ne garde que les marchés TOUCHÉS (re-scrapés) depuis cette
   *  date — « opportunités apparues sur la dernière campagne » (accueil).
   *  La comparaison de prix garde toute la fenêtre (il faut les deux pays). */
  touchedSinceIso?: string | null,
): Promise<MarketOpportunity[]> {
  // RPC d'abord : les médianes basses sont calculées EN BASE (mi_cheap_medians)
  // — le front n'apparie plus que quelques centaines de segments au lieu de
  // repaginer 40 000 observations (fenêtre déjà dépassée par les campagnes).
  const since = new Date(Date.now() - OPP_WINDOW_DAYS * 86_400_000).toISOString();
  // Variante UN APPEL d'abord (mi_cheap_medians_json, 26/08) : chaque page
  // PostgREST ré-exécutait la fonction entière (~8 s × 5 — la base faisait
  // cinq fois le même travail, « les écarts mettent du temps à apparaître »).
  // Repli transparent sur la voie paginée si la migration n'est pas passée.
  let medianRows: unknown = null;
  let rpcError: { message: string } | null = null;
  opportunitiesPartial = false;
  // ÉTAGE 1 : la table précalculée d'abord (lecture < 1 s), la fonction à la
  // volée en transition. Fini les cascades paginées : soit le résultat est
  // complet, soit le badge « partiel » l'annonce.
  const tableRows = await fetchAllPages<unknown>(
    (from, to) => supabase.from('mi_dashboard_medians').select('*')
      .order('brand_label').order('model_label').order('fuel').order('year').order('country')
      .range(from, to),
    20_000, 'MI_SCOPE',
  );
  if (tableRows.length > 0) {
    medianRows = tableRows;
    void trackDashboardsMeta();
  } else {
    const single = await supabase.rpc('mi_cheap_medians_json' as never, {
      p_since: since, p_min_price: OPP_MIN_PRICE_EUR,
    } as never);
    if (!single.error && Array.isArray(single.data)) {
      medianRows = single.data;
    } else {
      rpcError = (single.error as { message: string } | null) ?? { message: 'tableaux précalculés vides' };
      opportunitiesPartial = true;
    }
  }
  if (!rpcError && Array.isArray(medianRows)) {
    type Row = { brand_label: string; model_label: string; fuel: string; year: number; country: string; site: string; median: number | null; cnt: number; last_seen: string };
    const groups = new Map<string, Row[]>();
    for (const r of medianRows as Row[]) {
      if (r.median == null || r.cnt < minPerCountry) continue;
      // refModelKey : « SÉRIE 3 » (étude FR) et « 3-SERIES » (référentiel)
      // sont LE MÊME segment — le radar inter-pays doit les apparier.
      const key = `${brandKey(r.brand_label)}|${refModelKey(r.brand_label, r.model_label)}|${r.fuel}|${r.year}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    const out: MarketOpportunity[] = [];
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      if (touchedSinceIso && !rows.some((r) => r.last_seen >= touchedSinceIso)) continue;
      const sides = [...rows].sort((a, b) => (a.median! - b.median!));
      const low = sides[0];
      const high = sides[sides.length - 1];
      const delta = Math.round(high.median! - low.median!);
      if (delta < minDelta) continue;
      out.push({
        brand: low.brand_label.toUpperCase(), model: low.model_label.toUpperCase(),
        fuel: low.fuel, year: low.year,
        lowCountry: low.country, lowSite: low.site, lowMedian: Math.round(low.median!), lowCount: Number(low.cnt),
        highCountry: high.country, highSite: high.site, highMedian: Math.round(high.median!), highCount: Number(high.cnt),
        deltaEur: delta,
      });
    }
    return out.sort((a, b) => (b.deltaEur * Math.min(b.lowCount, b.highCount)) - (a.deltaEur * Math.min(a.lowCount, a.highCount)));
  }
  // Plus AUCUN repli « calcul client » (il relisait 40 000 observations
  // paginées — l'étage le plus bas du mille-feuille) : sans données, liste
  // vide + badge « partiel », jamais un chargement de masse.
  console.warn('[MI_SCOPE] radar indisponible (migration 20260826140000 à appliquer ?):', rpcError?.message);
  opportunitiesPartial = true;
  return [];
}


/** key → acked delta (EUR). An alert stays hidden while |Δnow − Δacked| < 1000. */
export async function loadOpportunityAcks(): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('market_opportunity_acks')
    .select('brand, model, fuel, year, low_country, high_country, delta_eur')
    .limit(2000);
  const map = new Map<string, number>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    // Year is part of the key: a control on the 2022s never hides the 2019s.
    map.set([r.brand, r.model, r.fuel, r.year, r.low_country, r.high_country].join('|'), Number(r.delta_eur));
  }
  return map;
}

export async function ackOpportunity(o: MarketOpportunity, by: string): Promise<void> {
  await supabase.from('market_opportunity_acks').insert({
    brand: o.brand, model: o.model, fuel: o.fuel, year: o.year,
    low_country: o.lowCountry, high_country: o.highCountry,
    delta_eur: o.deltaEur, acked_by: by,
  });
}

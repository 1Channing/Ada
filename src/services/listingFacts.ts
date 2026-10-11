/**
 * TRAJECTOIRE DES PRIX — faits par annonce (bêta, 11/10).
 *
 * Décision Channing : « on remplace l'outil de vélocité qui n'est pas encore
 * fiable, et en vélocité ce qu'on est sûr uniquement, pas de supposition ».
 *
 * Ce service ne DÉDUIT rien. Pour chaque annonce, il aligne ce qu'ADA a
 * réellement constaté (dates de relevé, prix à chaque passage) et ce que le
 * site a lui-même déclaré (date de mise en ligne, ancien prix barré) :
 *  - première / dernière vue par ADA, nombre de relevés où elle apparaît ;
 *  - prix au premier relevé → prix courant, baisses et hausses OBSERVÉES
 *    entre deux relevés successifs, écart cumulé ;
 *  - ancien prix AFFICHÉ par le site (previous_price), quand il existe ;
 *  - mise en ligne DÉCLARÉE par le site (published_at), quand elle existe ;
 *  - statut : « en ligne » (revue au dernier scan qui la couvrait) ou
 *    « absente depuis le JJ/MM » = date du PREMIER scan postérieur qui la
 *    couvrait sans la revoir (même preuve que la purge de l'état actuel).
 * Une annonce absente n'est jamais dite « vendue » : on ne le sait pas.
 * Les durées sont exactes quand le site date l'annonce ; sinon ce sont des
 * bornes basses (« vue pendant ≥ N j »), jamais des estimations.
 */
import { supabase } from '../lib/supabase';
import {
  collapseMirroredListings, listingIdentity, vanishedAtIndex, filterObservations, loadObservationsForStudy,
  FUEL_TOKEN_TO_CRITERIA, type Observation, type Snapshot, type MarketFilters,
} from './marketData';
import type { FuelToken } from '../lib/study-core/ingestion';
import type { DailySearch } from './workflow';

export interface ListingFact {
  id: string;
  /** Dernière version observée (prix courant, titre, URL…). */
  latest: Observation;
  country: string;
  site: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Nombre de relevés distincts où l'annonce apparaît. */
  seenCount: number;
  /** Mise en ligne déclarée par le site (la plus ancienne vue), ou null. */
  publishedAt: string | null;
  /** Prix au premier relevé et prix courant (EUR). */
  firstPrice: number | null;
  currentPrice: number | null;
  /** Changements OBSERVÉS entre deux relevés successifs. */
  drops: number;
  rises: number;
  /** Trajet des prix : premier prix puis chaque changement, daté du relevé
   *  qui l'a constaté (prix 1 (15/09) → prix 2 (28/09) → …). */
  steps: Array<{ at: string; price: number }>;
  /** Écart cumulé observé, en % du premier prix (négatif = baisse). */
  observedDeltaPct: number | null;
  /** Ancien prix AFFICHÉ par le site sur la dernière version (barré), si > prix. */
  sitePreviousPrice: number | null;
  /** Remise AFFICHÉE par le site, en % (négatif), si previous_price > prix. */
  siteDiscountPct: number | null;
  status: 'online' | 'gone';
  /** Date du premier scan postérieur prouvant l'absence (statut gone). */
  goneSince: string | null;
  /** Jours entre première et dernière vue par ADA (borne basse de présence). */
  observedDays: number;
  /** Âge exact au dernier relevé quand le site date l'annonce, sinon null. */
  ageDaysAtLastSeen: number | null;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / DAY));

/**
 * Faits par annonce sur un jeu d'observations (toutes versions, toutes dates).
 * `snapshots` + `coverageSource` (jeu complet avant filtres) servent la preuve
 * d'absence, comme pour l'état actuel.
 */
export function listingFacts(obs: Observation[], snapshots: Snapshot[], coverageSource?: Observation[]): ListingFact[] {
  const byId = new Map<string, Observation[]>();
  for (const o of obs) {
    const id = listingIdentity(o);
    (byId.get(id) ?? byId.set(id, []).get(id)!).push(o);
  }
  const vanishedAt = vanishedAtIndex(snapshots, coverageSource ?? obs);
  const out: ListingFact[] = [];
  for (const [id, list] of byId) {
    list.sort((a, b) => String(a.scraped_at).localeCompare(String(b.scraped_at)));
    const first = list[0];
    const latest = list[list.length - 1];
    // Un relevé = un instant ; deux observations au même instant (miroirs
    // d'un même site) ne comptent qu'une fois et ne font pas « bouger » le prix.
    const seenAt = new Set<string>();
    let prevPrice: number | null = null;
    let prevAt = '';
    let drops = 0, rises = 0;
    let published: string | null = null;
    const steps: Array<{ at: string; price: number }> = [];
    for (const o of list) {
      seenAt.add(String(o.scraped_at));
      if (o.published_at && (!published || o.published_at < published)) published = o.published_at;
      if (typeof o.price !== 'number' || o.price <= 0) continue;
      if (prevPrice == null) steps.push({ at: String(o.scraped_at), price: o.price });
      else if (String(o.scraped_at) !== prevAt && o.price !== prevPrice) {
        if (o.price < prevPrice) drops++; else rises++;
        steps.push({ at: String(o.scraped_at), price: o.price });
      }
      prevPrice = o.price; prevAt = String(o.scraped_at);
    }
    const firstPrice = typeof first.price === 'number' && first.price > 0 ? first.price : null;
    const currentPrice = typeof latest.price === 'number' && latest.price > 0 ? latest.price : null;
    const sitePrev = typeof latest.previous_price === 'number' && currentPrice != null && latest.previous_price > currentPrice ? latest.previous_price : null;
    const gone = vanishedAt(latest);
    out.push({
      id, latest, country: latest.country, site: latest.site,
      firstSeenAt: String(first.scraped_at), lastSeenAt: String(latest.scraped_at),
      seenCount: seenAt.size,
      publishedAt: published,
      firstPrice, currentPrice, drops, rises, steps,
      observedDeltaPct: firstPrice != null && currentPrice != null && (drops + rises) > 0
        ? Math.round(((currentPrice - firstPrice) / firstPrice) * 1000) / 10 : null,
      sitePreviousPrice: sitePrev,
      siteDiscountPct: sitePrev != null && currentPrice != null ? Math.round(((currentPrice - sitePrev) / sitePrev) * 1000) / 10 : null,
      status: gone ? 'gone' : 'online',
      goneSince: gone,
      observedDays: days(String(first.scraped_at), String(latest.scraped_at)),
      ageDaysAtLastSeen: published ? days(published, String(latest.scraped_at)) : null,
    });
  }
  // Une VOITURE = une annonce (même règle que l'état actuel) : la même
  // Elroq Sportline 46 970 → 49 470 € comptait trois hausses (AutoScout NL +
  // deux entrées Marktplaats) — les miroirs d'autres sites s'effacent.
  const kept = new Set(collapseMirroredListings(out.map((f) => f.latest)));
  return out.filter((f) => kept.has(f.latest));
}

export interface FactsSummary {
  country: string;
  total: number;
  online: number;
  gone: number;
  /** Annonces vues à ≥ 2 relevés (seules elles peuvent montrer un mouvement). */
  followed: number;
  withDrop: number;
  withRise: number;
  /** Médiane de l'écart cumulé observé parmi les annonces avec ≥ 1 baisse (%). */
  medianDropPct: number | null;
  /** Annonces dont le site affiche un ancien prix barré supérieur. */
  withSiteDiscount: number;
  medianSiteDiscountPct: number | null;
  /** Annonces datées par le site, en ligne : âge médian au dernier relevé. */
  datedOnline: number;
  medianAgeDays: number | null;
  /** Absentes : médiane de la présence observée par ADA (borne basse, jours). */
  medianGoneObservedDays: number | null;
  /** Absentes datées par le site : médiane de l'âge à la dernière vue (exact). */
  datedGone: number;
  medianGoneAgeDays: number | null;
  /** Étendue des relevés (première → dernière date de scan) en jours. */
  spanDays: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
}

export function summarizeFacts(facts: ListingFact[], country = ''): FactsSummary {
  const online = facts.filter((f) => f.status === 'online');
  const gone = facts.filter((f) => f.status === 'gone');
  const withDrop = facts.filter((f) => f.drops > 0);
  const withSite = facts.filter((f) => f.siteDiscountPct != null);
  const datedOnline = online.filter((f) => f.ageDaysAtLastSeen != null);
  const datedGone = gone.filter((f) => f.ageDaysAtLastSeen != null);
  const dates = facts.flatMap((f) => [Date.parse(f.firstSeenAt), Date.parse(f.lastSeenAt)]).filter(Number.isFinite);
  return {
    country,
    total: facts.length,
    online: online.length,
    gone: gone.length,
    followed: facts.filter((f) => f.seenCount >= 2).length,
    withDrop: withDrop.length,
    withRise: facts.filter((f) => f.rises > 0).length,
    medianDropPct: median(withDrop.map((f) => f.observedDeltaPct).filter((x): x is number => x != null)),
    withSiteDiscount: withSite.length,
    medianSiteDiscountPct: median(withSite.map((f) => f.siteDiscountPct!)),
    datedOnline: datedOnline.length,
    medianAgeDays: median(datedOnline.map((f) => f.ageDaysAtLastSeen!)),
    medianGoneObservedDays: median(gone.map((f) => f.observedDays)),
    datedGone: datedGone.length,
    medianGoneAgeDays: median(datedGone.map((f) => f.ageDaysAtLastSeen!)),
    spanDays: dates.length ? Math.round((Math.max(...dates) - Math.min(...dates)) / DAY) : 0,
  };
}

/** Un résumé par pays, du plus fourni au moins fourni. */
export function summarizeByCountry(facts: ListingFact[]): FactsSummary[] {
  const by = new Map<string, ListingFact[]>();
  for (const f of facts) (by.get(f.country) ?? by.set(f.country, []).get(f.country)!).push(f);
  return [...by.entries()].map(([c, list]) => summarizeFacts(list, c)).sort((a, b) => b.total - a.total);
}

/** Fusion de plusieurs jeux de faits (études comparées) : une annonce une fois. */
export function mergeFacts(sets: ListingFact[][]): ListingFact[] {
  const seen = new Map<string, ListingFact>();
  for (const s of sets) for (const f of s) if (!seen.has(f.id)) seen.set(f.id, f);
  return [...seen.values()];
}

// ─── Chargement par ÉTUDE QUOTIDIENNE (Accueil, 11/10) ──────────────────────
// Décision Channing : la trajectoire ne vit pas dans le MI mais dans l'Accueil
// de chacun, et ne montre que les véhicules en étude quotidienne — ceux sur
// lesquels ADA accumule le plus de relevés (un passage chaque matin).

export interface StudyTrajectory {
  study: DailySearch;
  /** Faits côté pays d'achat (source) et côté pays de vente (cible). */
  source: ListingFact[];
  target: ListingFact[];
  /** Relevés distincts vus de chaque côté (dates ISO, croissantes). */
  sourceScans: string[];
  targetScans: string[];
  loadedAt: number;
}

function criteriaToToken(criteria: string): FuelToken | '' {
  const c = (criteria ?? '').trim().toUpperCase();
  if (!c) return '';
  const hit = Object.entries(FUEL_TOKEN_TO_CRITERIA).find(([, v]) => v === c);
  return (hit?.[0] as FuelToken | undefined) ?? '';
}

/** Snapshots des relevés qui ont produit ces observations (par id, par lots). */
async function snapshotsOf(obs: Observation[]): Promise<Snapshot[]> {
  const ids = [...new Set(obs.map((o) => o.snapshot_id).filter(Boolean))];
  const out: Snapshot[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('market_snapshots').select('*').in('id', ids.slice(i, i + 100));
    out.push(...((data ?? []) as Snapshot[]));
  }
  return out;
}

function distinctScans(obs: Observation[]): string[] {
  return [...new Set(obs.map((o) => String(o.scraped_at)))].sort();
}

/**
 * Trajectoire d'une étude quotidienne : observations du modèle dans chacun des
 * deux pays (vue chaud + archive, même lecture que le MI), filtrées aux
 * critères de l'étude (années, carburant, finition, boîte, puissance, km),
 * preuve d'absence lue sur le jeu complet du pays.
 */
export async function loadStudyTrajectory(study: DailySearch): Promise<StudyTrajectory> {
  const base = { brand: study.brand, model: study.model };
  const [srcAll, tgtAll] = await Promise.all([
    loadObservationsForStudy({ ...base, country: study.source_country }),
    loadObservationsForStudy({ ...base, country: study.target_country }),
  ]);
  const [srcSnaps, tgtSnaps] = await Promise.all([snapshotsOf(srcAll), snapshotsOf(tgtAll)]);
  const common: MarketFilters = {
    ...base,
    yearMin: study.year_min ?? null, yearMax: study.year_max ?? null,
    fuel: criteriaToToken(study.fuel),
    gearbox: (study.gearbox ?? '').trim() || undefined,
    powerMin: study.power_min ?? null,
    mileageMax: study.mileage_max ?? null,
    vehicleType: (study.vehicle_type ?? '').trim() || undefined,
  };
  const src = filterObservations(srcAll, { ...common, country: study.source_country, trim: (study.trim ?? '').trim() || undefined });
  const tgt = filterObservations(tgtAll, { ...common, country: study.target_country, trim: ((study.trim_target || study.trim) ?? '').trim() || undefined });
  return {
    study,
    source: listingFacts(src, srcSnaps, srcAll),
    target: listingFacts(tgt, tgtSnaps, tgtAll),
    sourceScans: distinctScans(src),
    targetScans: distinctScans(tgt),
    loadedAt: Date.now(),
  };
}

/**
 * OFFRES FOURNISSEUR — « OÙ VENDRE » (demande Channing 14/09 : « lancer des
 * scrapings ciblés et vérifier les prix, confronter les pays aux besoins,
 * on connaît les URLs »).
 *
 * 1. LOTS : les véhicules retenus sont regroupés par marque + modèle + année
 *    + énergie + boîte (un lot = une recherche de marché) ; le km maxi du
 *    lot borne la recherche.
 * 2. URLs : pour chaque lot et chaque pays coché, une URL par site du pays,
 *    générée par le MÊME générateur que les études (mémoire + registre) —
 *    visibles et cliquables avant de lancer quoi que ce soit.
 * 3. RELEVÉ : chaque URL part dans la même file que le Market Intelligence
 *    (edge ingest-url, pipeline serveur, relevé en base avec sa clé de
 *    segment) ; ici on lit le résultat du job (jusqu'à 100 annonces) pour
 *    la médiane, le premier quartile et le nombre de concurrentes.
 * 4. VERDICT : prix de marché TTC ramené en HT avec la TVA du pays, comparé
 *    à notre prix HT. Le Danemark inclut la taxe d'immatriculation : dit
 *    explicitement, jamais caché derrière un chiffre.
 */
import { sharedSupabase as supabase } from '../supabaseShared';
import { generateSearchUrlsWithMemory } from '../linkgen/generator';
import type { SiteKey } from '../linkgen/types';
import { allSiteAdapters } from '../study-core/marketplaces';
import { structuredModelMatches } from '../study-core/business-logic';
import { titleContradictsModel } from '../../services/marketData';
import type { OfferVehicle } from './parseSupplierFile';

export interface OfferLot {
  key: string; label: string; brand: string; model: string; year: number | null; fuel: string | null; gearbox: string | null;
  kmMax: number | null; count: number; vehicleIds: string[]; ourPriceMin: number | null; ourPriceMax: number | null; ourPriceAvg: number | null;
  /** Fenêtre d'années cherchée (par défaut l'année du lot, réglable). */
  yearFrom: number | null; yearTo: number | null;
  /** Critères ajustés à la main (constat Channing 17/09 : « ASTRA L » faussait la recherche). */
  adjusted: boolean;
}

/** Critères de recherche d'un lot réglés à la main — stockés dans l'offre (lot_criteria, clé = lot). */
export interface LotCriteria {
  brand?: string; model?: string; yearFrom?: number | null; yearTo?: number | null; kmMax?: number | null; fuel?: string | null; gearbox?: string | null;
}

export function lotLabel(l: Pick<OfferLot, 'brand' | 'model' | 'yearFrom' | 'yearTo' | 'fuel' | 'gearbox' | 'kmMax'>): string {
  const years = l.yearFrom != null && l.yearTo != null && l.yearFrom !== l.yearTo ? `${l.yearFrom}–${l.yearTo}` : l.yearFrom ?? l.yearTo ?? '';
  return [`${l.brand} ${l.model}`, years, l.fuel ?? '', l.gearbox === 'AUTOMATIQUE' ? 'auto' : l.gearbox === 'MANUELLE' ? 'manuelle' : '', l.kmMax ? `≤ ${l.kmMax.toLocaleString('fr-FR')} km` : ''].filter(Boolean).join(' · ');
}

/** Applique les critères réglés à la main (clé inchangée : le lot reste celui des véhicules). */
export function applyLotCriteria(lot: OfferLot, c: LotCriteria | undefined): OfferLot {
  if (!c) return lot;
  const next: OfferLot = {
    ...lot,
    brand: c.brand?.trim() ? c.brand.trim().toUpperCase() : lot.brand,
    model: c.model?.trim() ? c.model.trim().toUpperCase() : lot.model,
    yearFrom: c.yearFrom !== undefined ? c.yearFrom : lot.yearFrom,
    yearTo: c.yearTo !== undefined ? c.yearTo : lot.yearTo,
    kmMax: c.kmMax !== undefined ? c.kmMax : lot.kmMax,
    fuel: c.fuel !== undefined ? c.fuel : lot.fuel,
    gearbox: c.gearbox !== undefined ? c.gearbox : lot.gearbox,
    adjusted: true,
  };
  return { ...next, label: lotLabel(next) };
}

/** TVA par pays de revente (taux normal, 2026). DK : les prix affichés incluent aussi la taxe d'immatriculation. */
export const VAT_RATE: Record<string, number> = { FR: 0.20, DE: 0.19, NL: 0.21, BE: 0.21, DK: 0.25, SE: 0.25, ES: 0.21, IT: 0.22, LT: 0.21, HU: 0.27 };
export const COUNTRY_CAVEAT: Record<string, string> = { DK: 'prix danois taxe d’immatriculation comprise — HT équivalent surestimé' };

const FUEL_CRITERIA: Record<string, string> = {
  ESSENCE: 'ESSENCE', DIESEL: 'DIESEL', HYBRIDE: 'HYBRIDE', 'HYBRIDE RECHARGEABLE': 'PLUG_IN_HYBRID', ELECTRIQUE: 'ELECTRIQUE', GPL: 'GPL',
};

export function lotsOf(vehicles: OfferVehicle[]): OfferLot[] {
  const map = new Map<string, OfferVehicle[]>();
  for (const v of vehicles.filter((x) => x.selected)) {
    const key = [v.brand, v.model, v.year ?? '?', v.fuel ?? '?', v.gearbox ?? '?'].join('|');
    map.set(key, [...(map.get(key) ?? []), v]);
  }
  return [...map.entries()].map(([key, list]) => {
    const v0 = list[0];
    const kms = list.map((v) => v.km).filter((k): k is number => k != null);
    const prices = list.map((v) => v.sale_price).filter((p): p is number => p != null);
    const kmMax = kms.length ? Math.ceil((Math.max(...kms) * 1.1) / 10_000) * 10_000 : null;
    const base = { brand: v0.brand, model: v0.model, yearFrom: v0.year, yearTo: v0.year, fuel: v0.fuel, gearbox: v0.gearbox, kmMax };
    return {
      key, ...base, year: v0.year, label: lotLabel(base), adjusted: false,
      count: list.length, vehicleIds: list.map((v) => v.id),
      ourPriceMin: prices.length ? Math.min(...prices) : null, ourPriceMax: prices.length ? Math.max(...prices) : null,
      ourPriceAvg: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
    };
  }).sort((a, b) => b.count - a.count);
}

function criteriaOf(lot: OfferLot) {
  return {
    brand: lot.brand, model: lot.model,
    yearFrom: lot.yearFrom != null ? String(lot.yearFrom) : undefined, yearTo: lot.yearTo != null ? String(lot.yearTo) : undefined,
    mileage: lot.kmMax != null ? String(lot.kmMax) : undefined,
    fuel: lot.fuel ? FUEL_CRITERIA[lot.fuel] ?? lot.fuel : undefined,
    gearbox: lot.gearbox === 'AUTOMATIQUE' || lot.gearbox === 'MANUELLE' ? lot.gearbox : undefined,
  };
}

export interface LotTarget {
  country: string; site: string; url: string | null; warnings: string[];
  /** L'URL n'est qu'une page MARQUE (modèle sans slug/libellé prouvé) : le tri modèle se fait sur les titres, strictement. */
  brandPageOnly: boolean;
}

/** Les URLs d'un lot : une par site de chaque pays coché — à vérifier avant de lancer. */
export async function lotTargets(lot: OfferLot, countries: string[]): Promise<LotTarget[]> {
  const out: LotTarget[] = [];
  for (const country of countries) {
    const sites = allSiteAdapters().filter((a) => a.countryCode === country);
    for (const site of sites) {
      try {
        const gen = await generateSearchUrlsWithMemory({ selectedSites: [site.key as SiteKey], ...criteriaOf(lot), mileage: lot.kmMax ?? undefined });
        const g = gen[0];
        const warnings = (g?.warnings ?? []).map((w) => w.replace(/^\[LINKGEN_WARNING\]\s*/, ''));
        out.push({ country, site: site.key, url: g?.url && g.url.length > 10 ? g.url : null, warnings, brandPageOnly: warnings.some((w) => /page marque/i.test(w)) });
      } catch (e) {
        out.push({ country, site: site.key, url: null, warnings: [e instanceof Error ? e.message : String(e)], brandPageOnly: false });
      }
    }
  }
  return out;
}

const soft = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * Identité modèle d'une annonce brute du job — même règle que le snapshot
 * serveur (modèle structuré + titre qui ne contredit pas), et, sur une page
 * MARQUE, exigence que le titre NOMME le modèle (sinon la médiane Astra
 * serait celle de toute la gamme Opel).
 */
export function listingIsLot(l: { title?: string | null; model?: string | null; priceType?: string | null; fiscalTerritory?: string | null }, model: string, strict: boolean): boolean {
  if (/withouttax|without tax|engros|wholesale|excl/.test((l.priceType ?? '').toLowerCase())) return false;
  // Hors TVA UE (Canaries / IGIC, DOM…) : pas un débouché comparable.
  if (l.fiscalTerritory) return false;
  if (!structuredModelMatches(l.model, model)) return false;
  if (titleContradictsModel(model, l.title ?? '')) return false;
  if (!strict) return true;
  const t = ` ${soft(l.title ?? '')} `;
  return soft(model).split(' ').filter(Boolean).every((w) => t.includes(` ${w} `));
}

export async function startLotJob(url: string, lot: OfferLot): Promise<string> {
  const start = await supabase.functions.invoke('ingest-url', {
    body: { url, async: true, criteria: criteriaOf(lot), submittedBy: 'Offres fournisseur' },
  });
  if (start.error) throw new Error(start.error.message ?? 'edge ingest-url en échec');
  const jobId = (start.data as { jobId?: string } | null)?.jobId;
  if (!jobId) throw new Error('worker sans mode job');
  return jobId;
}

export interface SiteResult { site: string; url: string; at: string; count: number; total: number | null; median: number | null; p25: number | null; min: number | null; error: string | null }
export interface CountryResult { sites: Record<string, SiteResult>; medianTtc: number | null; medianHt: number | null; competitors: number; at: string }
/** offer.market : lotKey → country → résultat. */
export type OfferMarket = Record<string, Record<string, CountryResult>>;

/** Interroge un job jusqu'à sa fin (4 s, 20 min) et en tire les statistiques de prix. */
export async function awaitLotJob(jobId: string, site: string, url: string, identity: { model: string; strict: boolean }): Promise<SiteResult> {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const poll = await supabase.functions.invoke('ingest-url', { body: { jobId } });
    if (poll.error) {
      const status = ((poll.error as { context?: unknown }).context as { status?: number } | undefined)?.status;
      if (status === 404) return { site, url, at: new Date().toISOString(), count: 0, total: null, median: null, p25: null, min: null, error: 'suivi perdu (worker redémarré) — le relevé a pu aboutir, relance pour le lire' };
      continue;
    }
    const d = poll.data as { jobStatus?: string; message?: string; listings?: Array<{ price?: number | null; title?: string | null; model?: string | null; priceType?: string | null }>; totalCount?: number | null; error?: string | null } | null;
    if (d?.jobStatus === 'running') continue;
    if (d?.jobStatus === 'error') return { site, url, at: new Date().toISOString(), count: 0, total: null, median: null, p25: null, min: null, error: d.message ?? 'échec' };
    const all = d?.listings ?? [];
    const kept = all.filter((l) => listingIsLot(l, identity.model, identity.strict));
    const prices = kept.map((l) => (typeof l.price === 'number' ? l.price : null)).filter((p): p is number => p != null && p >= 1000).sort((a, b) => a - b);
    const q = (f: number) => (prices.length ? prices[Math.min(prices.length - 1, Math.floor((prices.length - 1) * f))] : null);
    // Total du site : seulement quand l'échantillon est bien celui du modèle
    // (page marque → le total du site compte toute la gamme, on s'en tient
    // aux annonces lues et reconnues).
    const total = identity.strict || kept.length < all.length ? null : d?.totalCount ?? null;
    return { site, url, at: new Date().toISOString(), count: prices.length, total, median: q(0.5), p25: q(0.25), min: prices[0] ?? null, error: d?.error ?? null };
  }
  return { site, url, at: new Date().toISOString(), count: 0, total: null, median: null, p25: null, min: null, error: 'délai dépassé — le worker continue, relance pour lire' };
}

export function mergeCountry(prev: CountryResult | undefined, country: string, r: SiteResult): CountryResult {
  const sites = { ...(prev?.sites ?? {}), [r.site]: r };
  const medians = Object.values(sites).map((s) => s.median).filter((m): m is number => m != null).sort((a, b) => a - b);
  const medianTtc = medians.length ? medians[Math.floor((medians.length - 1) / 2)] : null;
  const vat = VAT_RATE[country] ?? 0.2;
  const competitors = Object.values(sites).reduce((a, s) => a + (s.total ?? s.count), 0);
  return { sites, medianTtc, medianHt: medianTtc != null ? Math.round(medianTtc / (1 + vat)) : null, competitors, at: new Date().toISOString() };
}

export type Verdict = { tone: 'good' | 'warn' | 'bad' | 'idle'; text: string; marginPct: number | null };
/** Notre prix HT face au marché HT équivalent du pays. */
export function verdictOf(ourHt: number | null, c: CountryResult | undefined, country: string): Verdict {
  if (!c || c.medianHt == null) return { tone: 'idle', text: 'pas de relevé', marginPct: null };
  if (ourHt == null) return { tone: 'idle', text: 'prix MC Export manquant', marginPct: null };
  const margin = (c.medianHt - ourHt) / ourHt;
  const pct = Math.round(margin * 100);
  const caveat = COUNTRY_CAVEAT[country] ? ' ⚠' : '';
  if (c.competitors === 0) return { tone: 'warn', text: `marché vide${caveat}`, marginPct: pct };
  if (margin >= 0.15) return { tone: 'good', text: `+${pct} % sous le marché${caveat}`, marginPct: pct };
  if (margin >= 0.05) return { tone: 'warn', text: `+${pct} % (juste)${caveat}`, marginPct: pct };
  return { tone: 'bad', text: `${pct >= 0 ? '+' : ''}${pct} % — trop cher${caveat}`, marginPct: pct };
}

/**
 * ÉTUDES QUOTIDIENNES — ordonnanceur du worker.
 *
 * Chaque compte enregistre ses recherches (Workflow) ; ici on les exécute à
 * l'heure choisie (heure de Paris), une fois par jour :
 *   - tous les sites du PAYS SOURCE, URL mémoire-d'abord (même chemin que les
 *     campagnes — pas de mille-feuilles) ;
 *   - TRI PRIX CROISSANT (défaut de tous les adaptateurs) + plafond 3 pages :
 *     le bas du marché est exactement ce qu'on arbitre ;
 *   - le PAYS CIBLE est scrapé À CHAQUE passage lui aussi (mêmes garde-fous,
 *     finition équivalente) : la médiane de comparaison vient des tarifs du
 *     JOUR, pas d'observations qui datent — et chaque passage éprouve les
 *     URLs cibles (le repli silencieux Marktplaats/Bilbasen est détecté et
 *     ces pages sont écartées du calcul) ; repli sur les observations MI si
 *     le scrape cible est trop maigre ;
 *   - diff contre daily_search_hits : premier passage compris, toute annonce
 *     dans les critères d'écart va dans la boîte (demande Channing 27/07 :
 *     « on traite les annonces à partir de maintenant ») — ensuite, seules
 *     les NOUVELLES et les BAISSES reviennent, jamais deux fois la même ;
 *   - hors de [gap_min, gap_max] l'annonce est mémorisée mais pas montrée ;
 *     médiane inconnue → montrée quand même (fail-open, jamais de filtre
 *     aveugle).
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { generateSearchUrlsWithMemory } from '../src/lib/linkgen/generator';
import { allSiteAdapters } from '../src/lib/study-core/marketplaces';
import type { SiteKey } from '../src/lib/linkgen/types';
import { brandKey, canonKey } from '../src/services/marketData';
import { scrapeSearch } from './scraper';

const TICK_MS = 10 * 60 * 1000;
const MAX_PAGES = 3;
const MIN_PRICE_EUR = 500;      // ignore les loyers/leasing parasites
const REAL_DROP_EUR = 100;      // en dessous : bruit d'arrondi, pas une baisse
const TZ = 'Europe/Paris';

// Critère ADA → jeton carburant canonique des observations MI.
const CRITERIA_TO_TOKEN: Record<string, string> = {
  ELECTRIQUE: 'electric', ESSENCE: 'petrol', DIESEL: 'diesel',
  HYBRIDE: 'hybrid', PLUG_IN_HYBRID: 'phev', GPL: 'lpg',
};

interface SearchRow {
  id: string; user_id: string; label: string;
  source_country: string; target_country: string;
  brand: string; model: string;
  year_min: number | null; year_max: number | null;
  fuel: string; trim: string; trim_target: string;
  mileage_max: number | null;
  price_gap_min: number; price_gap_max: number;
  run_hour: number; active: boolean; last_run_at: string | null;
}

function parisHour(): number {
  // fr-FR formate « 20 h » (suffixe !) → Number() = NaN et la requête
  // plantait (prouvé worker_logs 27/07 18:01). On ne garde que les chiffres.
  const raw = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: TZ }).format(new Date());
  const h = Number(raw.replace(/\D/g, ''));
  return Number.isFinite(h) ? h : new Date().getUTCHours();
}
function parisDay(iso?: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: TZ }).format(iso ? new Date(iso) : new Date());
}

let running = false;

export function startDailySearchScheduler(): void {
  setTimeout(() => void tick(), 45_000);
  setInterval(() => void tick(), TICK_MS);
  // warn (pas log) : la ligne part dans worker_logs — preuve de vie de
  // l'ordonnanceur dans la boîte noire après chaque déploiement.
  console.warn(`[DAILY] ordonnanceur actif (tick 10 min) — heure Paris détectée : ${parisHour()} h`);
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const hour = parisHour();
    const today = parisDay();
    const { data, error } = await supabase
      .from('daily_searches')
      .select('*')
      .eq('active', true)
      .lte('run_hour', hour);
    if (error) { console.warn(`[DAILY] lecture des recherches impossible: ${error.message}`); return; }
    const due = ((data ?? []) as SearchRow[]).filter((s) => parisDay(s.last_run_at ?? undefined) !== today || !s.last_run_at);
    for (const s of due) {
      try {
        await runDailySearch(s);
      } catch (e) {
        console.warn(`[DAILY] échec « ${s.label || s.brand} »: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    running = false;
  }
}

/** Scrape tous les sites d'un pays pour les critères donnés (3 pages, prix
 *  croissant). Les pages en REPLI SILENCIEUX (filtre modèle non appliqué —
 *  Marktplaats/Bilbasen savent faire ça) sont écartées et loggées. */
async function scrapeCountry(
  s: SearchRow, country: string, trim: string, name: string,
): Promise<Array<{ site: string; listings: Array<{ title?: string | null; price?: number | null; year?: number | null; mileage?: number | null; listing_url?: string | null }> }>> {
  const out: Array<{ site: string; listings: never[] }> = [];
  const sites = allSiteAdapters().filter((a) => (a as { countryCode?: string }).countryCode === country);
  for (const site of sites) {
    let url: string | null = null;
    try {
      const gen = await generateSearchUrlsWithMemory({
        selectedSites: [site.key as SiteKey],
        brand: s.brand, model: s.model || '',
        fuel: s.fuel || undefined, trim: trim || undefined,
        yearFrom: s.year_min ? String(s.year_min) : undefined,
        yearTo: s.year_max ? String(s.year_max) : undefined,
        mileage: s.mileage_max ?? undefined,
      });
      url = gen[0]?.url && gen[0].url.length > 10 ? gen[0].url : null;
    } catch { url = null; }
    if (!url) { console.warn(`[DAILY] « ${name} »: URL non générable pour ${site.key}`); continue; }
    const result = await scrapeSearch(url, 'full', { maxPagesCap: MAX_PAGES });
    if (result.diagnostics?.silentFallback?.modelApplied === false) {
      console.warn(`[DAILY] « ${name} »: ${site.key} a servi la page marque entière (repli silencieux) — annonces écartées, mapping à corriger`);
      continue;
    }
    out.push({ site: site.key, listings: (result.listings ?? []) as never[] });
  }
  return out;
}

/** Médiane des 6 PREMIÈRES annonces (tri prix croissant — règle Channing
 *  27/07 : le bas du marché fait le prix, pas la moyenne du stock). */
export const MEDIAN_SAMPLE = 6;
function cheapMedian(prices: number[]): number | null {
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length < MEDIAN_SAMPLE) return null;
  const cheap = sorted.slice(0, MEDIAN_SAMPLE);
  return cheap[Math.floor((cheap.length - 1) / 2)];
}

/** REPLI seulement (scrape cible trop maigre) : médiane depuis les
 *  observations MI des 45 derniers jours, finition équivalente comprise. */
async function targetCheapMedian(s: SearchRow): Promise<number | null> {
  const token = CRITERIA_TO_TOKEN[s.fuel] ?? '';
  let q = supabase
    .from('market_listing_observations')
    .select('price, brand, model, fuel, year, trim')
    .eq('country', s.target_country)
    .gte('scraped_at', new Date(Date.now() - 45 * 86_400_000).toISOString())
    .gt('price', MIN_PRICE_EUR)
    .limit(4000);
  if (token) q = q.eq('fuel', token);
  const { data } = await q;
  const bk = brandKey(s.brand);
  const mk = canonKey(s.model);
  const tk = canonKey(s.trim_target ?? '');
  const prices = ((data ?? []) as Array<{ price: number | null; brand: string | null; model: string | null; year: number | null; trim: string | null }>)
    .filter((r) => r.price != null
      && brandKey(r.brand ?? '') === bk
      && (!mk || canonKey(r.model ?? '') === mk)
      && (!tk || canonKey(r.trim ?? '').includes(tk))
      && (s.year_min == null || (r.year ?? 9999) >= s.year_min)
      && (s.year_max == null || (r.year ?? 0) <= s.year_max))
    .map((r) => r.price as number)
    .sort((a, b) => a - b);
  if (prices.length < 5) return null; // trop peu de données cible → fail-open
  const cheap = prices.slice(0, 5);
  return cheap[Math.floor(cheap.length / 2)];
}

async function runDailySearch(s: SearchRow): Promise<void> {
  const name = s.label || `${s.brand} ${s.model}`.trim();

  // Mémoire anti-doublon de la recherche (url → dernier prix vu).
  const { data: known } = await supabase
    .from('daily_search_hits')
    .select('id, listing_url, price, status')
    .eq('search_id', s.id)
    .limit(10000);
  const seen = new Map<string, { id: string; price: number | null; status: string }>();
  for (const k of (known ?? []) as Array<{ id: string; listing_url: string; price: number | null; status: string }>) {
    seen.set(k.listing_url, k);
  }

  // 1) PAYS CIBLE d'abord : les tarifs du jour font la médiane de
  //    comparaison (finition équivalente) — et chaque passage éprouve les
  //    URLs cibles. Repli sur les observations MI si trop maigre.
  const targetScrape = await scrapeCountry(s, s.target_country, s.trim_target, name);
  const targetPrices = targetScrape.flatMap((r) => r.listings)
    .map((l) => (typeof l.price === 'number' ? l.price : null))
    .filter((p): p is number => p != null && p >= MIN_PRICE_EUR);
  let medianSource = 'jour';
  let median = cheapMedian(targetPrices);
  if (median == null) {
    median = await targetCheapMedian(s);
    medianSource = median != null ? 'observations MI' : 'inconnue';
  }

  // 2) PAYS SOURCE : le flux d'annonces à traiter.
  const sourceScrape = await scrapeCountry(s, s.source_country, s.trim, name);
  const nowIso = new Date().toISOString();
  let scanned = 0, fresh = 0, drops = 0, noUrl = 0;

  for (const { site, listings } of sourceScrape) {
    for (const l of listings) {
      const price = typeof l.price === 'number' ? l.price : null;
      if (price == null || price < MIN_PRICE_EUR) continue;
      // Kilométrage max : filtre dur même si le site a ignoré le paramètre.
      if (s.mileage_max != null && typeof l.mileage === 'number' && l.mileage > s.mileage_max) continue;
      scanned++;
      const listingUrl = (l.listing_url ?? '').trim();
      if (!listingUrl.startsWith('http')) { noUrl++; continue; } // sans URL stable, pas de diff fiable
      const gap = median != null ? median - price : null;
      const inRange = gap == null || (gap >= s.price_gap_min && gap <= s.price_gap_max);
      const prior = seen.get(listingUrl);

      if (!prior) {
        // Premier passage compris : ce qui matche les critères va dans la
        // boîte tout de suite — on traite les annonces dès le départ.
        const status = inRange ? 'inbox' : 'dismissed';
        const { data: ins } = await supabase.from('daily_search_hits').insert({
          search_id: s.id, user_id: s.user_id, listing_url: listingUrl,
          title: l.title ?? '', price, year: l.year ?? null, mileage: l.mileage ?? null,
          fuel: s.fuel, site, source_country: s.source_country,
          target_median: median, price_gap: gap, kind: 'new', status,
          first_seen_at: nowIso, last_seen_at: nowIso,
        }).select('id').maybeSingle();
        if (ins) seen.set(listingUrl, { id: ins.id, price, status });
        if (status === 'inbox') fresh++;
      } else if (prior.price != null && price <= prior.price - REAL_DROP_EUR) {
        // Baisse réelle : elle re-rentre dans la boîte, même si déjà triée.
        const status = inRange ? 'inbox' : prior.status;
        await supabase.from('daily_search_hits').update({
          kind: 'price_drop', previous_price: prior.price, price,
          target_median: median, price_gap: gap, status, last_seen_at: nowIso,
        }).eq('id', prior.id);
        seen.set(listingUrl, { ...prior, price, status });
        if (status === 'inbox') drops++;
      } else {
        await supabase.from('daily_search_hits').update({ last_seen_at: nowIso }).eq('id', prior.id);
      }
    }
  }

  await supabase.from('daily_searches').update({ last_run_at: nowIso, updated_at: nowIso }).eq('id', s.id);
  // Détail PAR SITE dans la boîte noire : un site à 0 sur une recherche qui
  // devrait rendre (LBC rafale du 28/07) devient visible immédiatement.
  const perSite = (arr: Array<{ site: string; listings: unknown[] }>) =>
    arr.map((x) => `${x.site} ${x.listings.length}`).join(' · ') || 'aucun site';
  console.warn(
    `[DAILY] « ${name} » (${s.source_country}→${s.target_country}) : source ${sourceScrape.length} site(s)/${scanned} annonces [${perSite(sourceScrape)}], `
    + `cible ${targetScrape.length} site(s)/${targetPrices.length} prix [${perSite(targetScrape)}], ${fresh} nouvelle(s), ${drops} baisse(s)`
    + (median != null ? ` · médiane cible ${median.toLocaleString('fr-FR')} € (${medianSource})` : ' · médiane cible inconnue (fail-open : tout est montré)')
    + (noUrl > 0 ? ` · ${noUrl} sans URL ignorées` : ''),
  );
}

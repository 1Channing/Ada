/**
 * ÉTUDES QUOTIDIENNES — ordonnanceur du worker.
 *
 * Chaque compte enregistre ses recherches (Workflow) ; ici on les exécute à
 * l'heure choisie (heure de Paris), une fois par jour :
 *   - tous les sites du PAYS SOURCE, URL mémoire-d'abord (même chemin que les
 *     campagnes — pas de mille-feuilles) ;
 *   - TRI PRIX CROISSANT (défaut de tous les adaptateurs) + plafond 3 pages :
 *     le bas du marché est exactement ce qu'on arbitre ;
 *   - diff contre daily_search_hits : seules les NOUVELLES annonces et les
 *     BAISSES de prix remontent — jamais deux fois la même annonce ;
 *   - écart vs médiane bas-de-marché du PAYS CIBLE (observations MI) : hors
 *     de [gap_min, gap_max] l'annonce est mémorisée mais pas montrée ;
 *     médiane inconnue → montrée quand même (fail-open, jamais de filtre
 *     aveugle).
 *
 * Premier passage d'une recherche = amorçage : tout est mémorisé en 'seed',
 * rien n'est montré (on ne présente que ce qui APPARAÎT ensuite).
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

/** Médiane des 5 moins chers du pays cible (mêmes règles que les opportunités
 *  MI). Si une finition ÉQUIVALENTE cible est renseignée, la médiane ne se
 *  calcule que sur cette finition (comparaison à équipement comparable). */
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
  const seeding = !s.last_run_at;
  const sites = allSiteAdapters().filter((a) => (a as { countryCode?: string }).countryCode === s.source_country);
  if (sites.length === 0) {
    console.warn(`[DAILY] « ${name} »: aucun site pour le pays ${s.source_country}`);
    return;
  }

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

  const median = await targetCheapMedian(s);
  const nowIso = new Date().toISOString();
  let scanned = 0, fresh = 0, drops = 0, noUrl = 0;

  for (const site of sites) {
    let url: string | null = null;
    try {
      const gen = await generateSearchUrlsWithMemory({
        selectedSites: [site.key as SiteKey],
        brand: s.brand, model: s.model || '',
        fuel: s.fuel || undefined, trim: s.trim || undefined,
        yearFrom: s.year_min ? String(s.year_min) : undefined,
        yearTo: s.year_max ? String(s.year_max) : undefined,
      });
      url = gen[0]?.url && gen[0].url.length > 10 ? gen[0].url : null;
    } catch { url = null; }
    if (!url) { console.warn(`[DAILY] « ${name} »: URL non générable pour ${site.key}`); continue; }

    const result = await scrapeSearch(url, 'full', { maxPagesCap: MAX_PAGES });
    for (const l of result.listings ?? []) {
      const price = typeof l.price === 'number' ? l.price : null;
      if (price == null || price < MIN_PRICE_EUR) continue;
      scanned++;
      const listingUrl = (l.listing_url ?? '').trim();
      if (!listingUrl.startsWith('http')) { noUrl++; continue; } // sans URL stable, pas de diff fiable
      const gap = median != null ? median - price : null;
      const inRange = gap == null || (gap >= s.price_gap_min && gap <= s.price_gap_max);
      const prior = seen.get(listingUrl);

      if (!prior) {
        const kind = seeding ? 'seed' : 'new';
        const status = seeding ? 'dismissed' : inRange ? 'inbox' : 'dismissed';
        const { data: ins } = await supabase.from('daily_search_hits').insert({
          search_id: s.id, user_id: s.user_id, listing_url: listingUrl,
          title: l.title ?? '', price, year: l.year ?? null, mileage: l.mileage ?? null,
          fuel: s.fuel, site: site.key, source_country: s.source_country,
          target_median: median, price_gap: gap, kind, status,
          first_seen_at: nowIso, last_seen_at: nowIso,
        }).select('id').maybeSingle();
        if (ins) seen.set(listingUrl, { id: ins.id, price, status });
        if (kind === 'new' && status === 'inbox') fresh++;
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
  console.warn(
    `[DAILY] « ${name} » (${s.source_country}→${s.target_country}) : ${sites.length} site(s), ${scanned} annonces vues, `
    + (seeding ? `amorçage (${seen.size} mémorisées)` : `${fresh} nouvelle(s), ${drops} baisse(s)`)
    + (median != null ? ` · médiane cible ${median.toLocaleString('fr-FR')} €` : ' · médiane cible inconnue (fail-open)')
    + (noUrl > 0 ? ` · ${noUrl} sans URL ignorées` : ''),
  );
}

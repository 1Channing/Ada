/**
 * VEILLES DE PROSPECTION PAR ADRESSE (29/10, Channing : « les managers des organisations de
 * prospection lancent des études quotidiennes à partir d'une URL pour trouver les dernières voitures
 * mises en vente par des particuliers sur leur secteur ; premier passage = les véhicules des
 * dernières 24 h, puis chaque jour les nouveaux, sans reprendre ceux déjà ajoutés »).
 *
 * Tout à part des études quotidiennes MC Export (tables prospect_watches / prospect_watch_hits, cet
 * ordonnanceur) : rien de commun, rien d'interférent.
 *
 * Un passage : la page de recherche telle que donnée (Leboncoin : tri « plus récentes » ajouté quand
 * l'adresse n'en porte pas), PAGE PAR PAGE jusqu'au déjà-vu. Mémoire = les lignes
 * prospect_watch_hits, tous statuts.
 *   - PREMIER passage : les annonces publiées depuis moins de 24 h deviennent des leads (inbox) ;
 *     on tourne les pages tant qu'elles en apportent, puis on s'arrête (une page sans annonce des
 *     dernières 24 h = la suite est plus ancienne). Les plus anciennes rencontrées entrent en 'seed'
 *     (mémoire, jamais montrées). Sans date de publication lisible : seed (rien d'inventé).
 *   - Passages SUIVANTS : on tourne les pages tant qu'elles apportent des annonces inconnues ; une
 *     page dont tout est déjà connu arrête le passage. Toute inconnue devient un lead ; une connue
 *     revue met à jour last_seen_at (et le prix). Jamais de doublon : clé (veille, adresse).
 * Tick 10 min (heure Paris ≥ run_hour, une fois par jour), « Lancer maintenant » sondé toutes les 30 s.
 */
import { sharedSupabase } from '../src/lib/supabaseShared';

// Tables hors des types générés (SQL du 29/10) : client non typé, comme dealerStock.
const supabase = sharedSupabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
import { scrapeSearch } from './scraper';
import { findSiteAdapterByDomain } from '../src/lib/study-core/marketplaces';
import type { ScrapedListing } from '../src/lib/study-core/types';

const TZ = 'Europe/Paris';
const TICK_MS = 10 * 60_000;
// Pagination JUSQU'AU DÉJÀ-VU (29/10 soir, Channing : « continuer jusqu'à trouver des annonces déjà
// scrapées la veille ; le premier jour, toutes les annonces de J-1 ») — plafond de sûreté.
const MAX_PAGES = 30;
const FRESH_MS = 24 * 3600_000;

interface WatchRow { id: string; user_id: string; label: string; url: string; run_hour: number; active: boolean; last_run_at: string | null; force_requested_at: string | null }

function parisHour(): number {
  const raw = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: TZ }).format(new Date());
  const h = Number(raw.replace(/\D/g, ''));
  return Number.isFinite(h) ? h : new Date().getUTCHours();
}
const parisDay = (iso?: string): string => new Intl.DateTimeFormat('fr-CA', { timeZone: TZ }).format(iso ? new Date(iso) : new Date());

/** L'adresse à scraper : Leboncoin sans tri → tri « plus récentes » (les nouveautés d'abord, 3 pages suffisent). */
export function watchScrapeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (/leboncoin\.fr$/i.test(u.hostname) && !u.searchParams.has('sort')) u.searchParams.set('sort', 'time');
    return u.toString();
  } catch { return url; }
}

let running = false;

export function startProspectWatchScheduler(): void {
  setTimeout(() => void tick(), 75_000);
  setInterval(() => void tick(), TICK_MS);
  setInterval(() => void pollForced(), 30_000);
  console.warn(`[VEILLE] ordonnanceur des veilles de prospection actif (tick 10 min + forçage 30 s) — heure Paris : ${parisHour()} h`);
}

async function pollForced(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { data, error } = await supabase.from('prospect_watches').select('*').not('force_requested_at', 'is', null).limit(5);
    if (error || !data?.length) return; // table absente (SQL à coller) ou rien à faire
    for (const w of data as WatchRow[]) {
      await supabase.from('prospect_watches').update({ force_requested_at: null }).eq('id', w.id);
      console.warn(`[VEILLE] ⚡ lancement forcé « ${w.label || w.url} »`);
      try { await runWatch(w); } catch (e) { console.warn(`[VEILLE] échec du forçage « ${w.label || w.url} » : ${e instanceof Error ? e.message : String(e)}`); }
    }
  } finally { running = false; }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const hour = parisHour(), today = parisDay();
    const { data, error } = await supabase.from('prospect_watches').select('*').eq('active', true).lte('run_hour', hour);
    if (error) { if (!/prospect_watches/.test(error.message)) console.warn(`[VEILLE] lecture impossible : ${error.message}`); return; }
    const due = ((data ?? []) as WatchRow[]).filter((w) => !w.last_run_at || parisDay(w.last_run_at) !== today);
    if (due.length) console.warn(`[VEILLE] vague : ${due.length} veille(s) due(s)`);
    for (const w of due) {
      try { await runWatch(w); } catch (e) { console.warn(`[VEILLE] échec « ${w.label || w.url} » : ${e instanceof Error ? e.message : String(e)}`); }
    }
  } finally { running = false; }
}

export async function runWatch(w: WatchRow): Promise<{ leads: number; seeds: number; seen: number }> {
  const name = w.label || w.url;
  const startedAt = new Date();
  // Mémoire de la veille (toutes les lignes, tous statuts).
  const known = new Map<string, { id: string; status: string; price: number | null }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('prospect_watch_hits').select('id, listing_url, status, price').eq('watch_id', w.id).order('id').range(from, from + 999);
    if (error) throw new Error(`mémoire illisible : ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; listing_url: string; status: string; price: number | null }>) known.set(r.listing_url, r);
    if (!data || data.length < 1000) break;
  }
  const firstRun = known.size === 0 && !w.last_run_at;
  const baseUrl = watchScrapeUrl(w.url);
  const adapter = findSiteAdapterByDomain(baseUrl);
  const nowIso = new Date().toISOString();
  let leads = 0, seeds = 0, seen = 0, undated = 0, read = 0, pages = 0;
  let site = '';
  let firstError: string | null = null;
  const rows: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = page === 1 ? baseUrl : (adapter ? adapter.buildPaginatedUrl(baseUrl, page) : baseUrl);
    if (page > 1 && pageUrl === baseUrl) break; // site sans pagination connue
    // 'fast' = UNE page (pas de profondeur interne) : la profondeur, c'est cette boucle qui la décide.
    const r = await scrapeSearch(pageUrl, 'fast');
    if (page === 1) site = r.diagnostics.site;
    if (r.error && r.listings.length === 0) {
      if (page === 1) { firstError = `${r.error}${r.errorReason ? ` (${r.errorReason})` : ''}`; }
      else console.warn(`[VEILLE] « ${name} » : page ${page} illisible (${r.error}) — arrêt, ${read} annonce(s) lue(s)`);
      break;
    }
    if (r.listings.length === 0) break;
    pages = page;
    read += r.listings.length;
    let freshOnPage = 0, unknownOnPage = 0;
    for (const l of r.listings as ScrapedListing[]) {
      const url = (l.listing_url ?? '').trim();
      if (!url.startsWith('http')) continue;
      const prior = known.get(url);
      if (prior) {
        if (prior.id) {
          seen++;
          const patch: Record<string, unknown> = { last_seen_at: nowIso };
          if (typeof l.price === 'number' && l.price > 0 && l.price !== prior.price) patch.price = l.price;
          await supabase.from('prospect_watch_hits').update(patch).eq('id', prior.id);
        }
        continue;
      }
      unknownOnPage++;
      let status: 'inbox' | 'seed' = 'inbox';
      if (firstRun) {
        const pub = l.publishedAt ? Date.parse(l.publishedAt) : NaN;
        if (!Number.isFinite(pub)) { status = 'seed'; undated++; }
        else status = startedAt.getTime() - pub <= FRESH_MS ? 'inbox' : 'seed';
      }
      if (status === 'inbox') { leads++; freshOnPage++; } else seeds++;
      rows.push({
        watch_id: w.id, listing_url: url, title: (l.title ?? '').slice(0, 200), price: typeof l.price === 'number' && l.price > 0 ? Math.round(l.price) : null,
        year: l.year ?? null, mileage: l.mileage ?? null, fuel: l.fuel ?? '', site, published_at: l.publishedAt ?? null,
        status, first_seen_at: nowIso, last_seen_at: nowIso,
      });
      known.set(url, { id: '', status, price: null });
    }
    // Arrêt : premier passage → plus rien des dernières 24 h sur cette page ; ensuite → plus rien d'inconnu.
    if (firstRun ? freshOnPage === 0 : unknownOnPage === 0) break;
  }
  if (firstError) {
    const summary = `échec : ${firstError}`;
    await supabase.from('prospect_watches').update({ last_run_at: startedAt.toISOString(), last_summary: summary }).eq('id', w.id);
    console.warn(`[VEILLE] « ${name} » : ${summary}`);
    return { leads: 0, seeds: 0, seen: 0 };
  }
  if (rows.length) {
    const { error } = await supabase.from('prospect_watch_hits').upsert(rows, { onConflict: 'watch_id,listing_url', ignoreDuplicates: true });
    if (error) throw new Error(`écriture impossible : ${error.message}`);
  }
  const summary = firstRun
    ? `premier passage : ${read} annonce(s) lue(s) sur ${site} (${pages} page${pages > 1 ? 's' : ''}), ${leads} des dernières 24 h → leads, ${seeds} plus ancienne(s) en mémoire${undated ? ` (dont ${undated} sans date)` : ''}`
    : `${read} annonce(s) lue(s) sur ${site} (${pages} page${pages > 1 ? 's' : ''}, jusqu'au déjà-vu), ${leads} nouvelle(s) → leads, ${seen} déjà connue(s)`;
  await supabase.from('prospect_watches').update({ last_run_at: startedAt.toISOString(), last_summary: summary }).eq('id', w.id);
  console.warn(`[VEILLE] « ${name} » : ${summary}`);
  return { leads, seeds, seen };
}

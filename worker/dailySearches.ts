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
import { missingUrlCriteria } from '../src/lib/linkgen/grammar';
import { allSiteAdapters } from '../src/lib/study-core/marketplaces';
import type { SiteKey } from '../src/lib/linkgen/types';
import { brandKey, canonKey } from '../src/services/marketData';
import { canonicalizeGearbox } from '../src/lib/study-core/ingestion';
import { isDamagedVehicleText, structuredModelMatches } from '../src/lib/study-core/business-logic';
import { archiveOldObservations, refreshDashboards } from './dashboards';
import { scrapeSearch, recordStudyMarketSnapshot } from './scraper';
import { persistTaxonomyHarvest } from '../src/lib/linkgen/taxonomy';

const TICK_MS = 10 * 60 * 1000;
// Profondeur des quotidiennes — règle Channing 26/08 : 5 pages À CONDITION
// que TOUS les filtres de l'étude soient exprimés dans l'URL (mesuré par les
// détecteurs du registre de grammaires) ; sinon 3 pages prudentes — creuser
// une recherche floue n'ajouterait que du bruit. Le plafond d'annonces suit
// (5 pages × ~25-30 par page), sinon la 5e page serait coupée à 100.
const MAX_PAGES = 3;
const MAX_PAGES_PRECISE = 5;
const MAX_LISTINGS_PRECISE = 150;
// 1 000 € — ALIGNÉ sur le radar SQL et la lecture MI (26/08) : les loyers de
// leasing dépassent souvent 500 € (« 294 €/mois », « 620 €/mois »…) et un
// vrai véhicule de notre univers d'arbitrage n'existe pas sous 1 000 €.
const MIN_PRICE_EUR = 1000;
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
  /** 'AUTOMATIQUE' | 'MANUELLE' | '' — optionnel tant que la migration
   *  gearbox n'est pas appliquée, d'où le `?`. */
  gearbox?: string | null;
  /** Puissance min (ch DIN) — optionnel tant que la migration power_min
   *  n'est pas appliquée, d'où le `?`. */
  power_min?: number | null;
  mileage_max: number | null;
  price_gap_min: number; price_gap_max: number;
  run_hour: number; active: boolean; last_run_at: string | null;
  /** Drapeau « Lancer maintenant » (menu ⋯) — sondé toutes les 30 s. */
  force_requested_at?: string | null;
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
  // « Lancer maintenant » (menu ⋯ du Workflow) : sondage léger toutes les
  // 30 s — un select sur drapeau, quasi gratuit. L'étude part immédiatement,
  // même en pause et hors heure programmée : c'est l'outil de TEST.
  setInterval(() => void pollForcedRuns(), 30_000);
  // warn (pas log) : la ligne part dans worker_logs — preuve de vie de
  // l'ordonnanceur dans la boîte noire après chaque déploiement.
  console.warn(`[DAILY] ordonnanceur actif (tick 10 min + forçage 30 s) — heure Paris détectée : ${parisHour()} h`);
}

async function pollForcedRuns(): Promise<void> {
  if (running) return; // jamais en même temps qu'un tick (ou qu'un autre forçage)
  running = true;
  try {
    const { data, error } = await supabase
      .from('daily_searches')
      .select('*')
      .not('force_requested_at', 'is', null)
      .limit(5);
    if (error || !data?.length) return; // colonne absente (migration à venir) ou rien à faire
    for (const s of data as SearchRow[]) {
      // Drapeau effacé AVANT le run : un crash en cours d'étude ne doit pas
      // la relancer en boucle toutes les 30 s.
      await supabase.from('daily_searches').update({ force_requested_at: null }).eq('id', s.id);
      console.warn(`[DAILY] ⚡ lancement FORCÉ « ${s.label || s.brand} » (demandé ${s.force_requested_at})`);
      try {
        await runDailySearch(s);
      } catch (e) {
        console.warn(`[DAILY] échec du forçage « ${s.label || s.brand} »: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // Les tableaux MI précalculés suivent la vague d'écriture (étage 1).
    await refreshDashboards('étude forcée');
  } finally {
    running = false;
  }
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
    // Fin de vague d'écriture → rangement (étage 2 : > 60 j vers l'archive,
    // jamais de suppression) puis recalcul des tableaux MI (étage 1).
    if (due.length > 0) {
      await archiveOldObservations('études quotidiennes');
      await refreshDashboards('études quotidiennes');
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
    let genWarnings: string[] = [];
    let genParams: Parameters<typeof generateSearchUrlsWithMemory>[0] | null = null;
    try {
      genParams = {
        selectedSites: [site.key as SiteKey],
        brand: s.brand, model: s.model || '',
        fuel: s.fuel || undefined, trim: trim || undefined,
        yearFrom: s.year_min ? String(s.year_min) : undefined,
        yearTo: s.year_max ? String(s.year_max) : undefined,
        mileage: s.mileage_max ?? undefined,
        gearbox: s.gearbox || undefined,
        // Puissance min (ch DIN) : posée en URL partout où le site sait
        // (AS24 powerfrom, Bilbasen hpfrom, LBC horse_power_din appris).
        minPower: s.power_min != null ? String(s.power_min) : undefined,
      };
      const gen = await generateSearchUrlsWithMemory(genParams);
      url = gen[0]?.url && gen[0].url.length > 10 ? gen[0].url : null;
      genWarnings = gen[0]?.warnings ?? [];
    } catch { url = null; }
    if (!url) { console.warn(`[DAILY] « ${name} »: URL non générable pour ${site.key}`); continue; }
    // PROFONDEUR CONDITIONNELLE (règle Channing 26/08) : 5 pages seulement si
    // l'URL exprime TOUS les critères de l'étude (mesuré sur l'URL produite,
    // détecteurs du registre) ET que la génération n'a rien signalé d'omis
    // (warnings = carburant sans code, modèle sans slug… → page trop large).
    const missing = genParams ? missingUrlCriteria(url, genParams) : ['inconnu'];
    const precise = missing.length === 0 && genWarnings.length === 0;
    if (!precise) {
      const why = missing.length > 0 ? `critères hors URL: ${missing.join(', ')}` : 'warnings de génération';
      console.log(`[DAILY] « ${name} »: ${site.key} profondeur ${MAX_PAGES} pages (${why})`);
    }
    const result = await scrapeSearch(url, 'full', precise
      ? { maxPagesCap: MAX_PAGES_PRECISE, maxListingsCap: MAX_LISTINGS_PRECISE }
      : { maxPagesCap: MAX_PAGES });
    if (result.diagnostics?.silentFallback?.modelApplied === false) {
      console.warn(`[DAILY] « ${name} »: ${site.key} a servi la page marque entière (repli silencieux) — annonces écartées, mapping à corriger`);
      continue;
    }
    // Moisson taxonomy (enums modèle vus dans les annonces, ex. LBC
    // u_car_model 'BMW_iX1') : les études quotidiennes apprennent comme les
    // campagnes — best-effort.
    const harvest = result.diagnostics?.taxonomyHarvest;
    if (harvest && harvest.length > 0) {
      await persistTaxonomyHarvest(site.key, harvest).catch(() => undefined);
    }
    // Chaque scrape d'étude quotidienne nourrit aussi le Market Intelligence
    // (médianes + vélocité) — demande Channing 28/07. Marqué à sa source pour
    // rester distinguable des campagnes ; best-effort, jamais bloquant.
    await recordStudyMarketSnapshot(
      supabase,
      { site: site.key, country, brand: s.brand.toUpperCase(), model: (s.model || '').toUpperCase() },
      result.listings ?? [],
      url,
      'Étude quotidienne',
    );
    // Boîte de vitesses : post-filtre DUR même si le site a ignoré le
    // paramètre — comparaison en jeton canonique (Automatik≡Automatique≡
    // Automaat). Boîte illisible = conservée (fail-open : on n'écarte que
    // sur une contradiction LUE). Le snapshot MI ci-dessus garde TOUT :
    // on stocke fidèlement, on filtre la lecture.
    let listings = (result.listings ?? []) as Array<{ gearbox?: string | null; powerDin?: number | null }>;
    if (s.gearbox) {
      const wanted = canonicalizeGearbox(s.gearbox);
      if (wanted) {
        const before = listings.length;
        listings = listings.filter((l) => {
          const got = canonicalizeGearbox(l.gearbox ?? '');
          return !got || got === wanted;
        });
        if (listings.length < before) {
          console.warn(`[DAILY] « ${name} »: ${site.key} — ${before - listings.length} annonce(s) écartée(s) (boîte ≠ ${s.gearbox})`);
        }
      }
    }
    // Puissance min : post-filtre DUR même si le site a ignoré le paramètre.
    // Puissance illisible = conservée (fail-open, même règle que la boîte).
    if (s.power_min != null) {
      const before = listings.length;
      listings = listings.filter((l) => l.powerDin == null || l.powerDin >= (s.power_min as number));
      if (listings.length < before) {
        console.warn(`[DAILY] « ${name} »: ${site.key} — ${before - listings.length} annonce(s) écartée(s) (< ${s.power_min} ch)`);
      }
    }
    // Modèle STRUCTURÉ : les adaptateurs v1 (Subito, Gaspedaal) servent la
    // page MARQUE entière (modèle pas encore posé en URL) — sans ce filtre,
    // les 100 Toyota toutes gammes de Gaspedaal entraient dans la médiane
    // cible d'une étude Yaris Cross (constat 02/08 au matin : « GASPEDAAL
    // 100 prix » sur chaque étude NL). Une annonce qui PORTE son modèle
    // structuré et ne matche pas est écartée ; sans modèle structuré (LBC,
    // AS24…), rien ne change — fail-open. Les suffixes de série Subito
    // (« RAV4 5ª serie », « C-HR (2016-2023) ») sont dépouillés avant
    // comparaison canonique.
    if (s.model) {
      // Jetons triés (structuredModelMatches) et non plus égalité ordonnée :
      // Gaspedaal nomme « 5-serie » ce que l'étude appelle « Série 5 » —
      // l'ancienne clé ordonnée (SERIE5 ≠ 5SERIE) jetait 100 % des annonces.
      const before = listings.length;
      listings = listings.filter((l) =>
        structuredModelMatches((l as { model?: string | null }).model, s.model!));
      if (listings.length < before) {
        console.warn(`[DAILY] « ${name} »: ${site.key} — ${before - listings.length} annonce(s) écartée(s) (modèle structuré ≠ ${s.model})`);
      }
    }
    // Accidentées : titre + description (on les A ici, au scrape) — jamais
    // dans les résultats d'étude. Détection négation-aware : « non
    // accidenté » / « Unfallfrei » sont des voitures saines, conservées.
    {
      const before = listings.length;
      listings = listings.filter((l) => !isDamagedVehicleText(
        `${(l as { title?: string | null }).title ?? ''} ${(l as { description?: string | null }).description ?? ''}`));
      if (listings.length < before) {
        console.warn(`[DAILY] « ${name} »: ${site.key} — ${before - listings.length} annonce(s) écartée(s) (accidentée)`);
      }
    }
    out.push({ site: site.key, listings: listings as never[] });
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
    .select('id, listing_url, price, status, resolution, mileage, year')
    .eq('search_id', s.id)
    .limit(10000);
  const seen = new Map<string, { id: string; price: number | null; status: string; resolution?: string | null }>();
  for (const k of (known ?? []) as Array<{ id: string; listing_url: string; price: number | null; status: string; resolution: string | null }>) {
    seen.set(k.listing_url, k);
  }

  // MISE EN CONFORMITÉ des annonces DÉJÀ accumulées avec les critères actuels.
  // L'accumulation garantit que rien n'est perdu, mais elle gardait aussi dans
  // la boîte des annonces entrées sous des critères plus larges : un
  // kilométrage max resserré à 90 000 laissait des 107 356 km à traiter
  // (constat 30/07). Les critères STRUCTURELS (km, année) ne peuvent plus
  // devenir conformes — l'annonce part donc aux archives en « hors critères »,
  // définitif, jamais supprimée. Le prix n'entre pas ici : une baisse doit
  // toujours pouvoir ramener une annonce (règle du 28/07).
  const offCriteria = ((known ?? []) as Array<{ id: string; status: string; resolution: string | null; mileage: number | null; year: number | null }>)
    .filter((k) => k.status !== 'saved' // un véhicule en négociation n'est jamais touché
      && k.resolution !== 'hors_criteres' // déjà archivé pour ce motif
      && ((s.mileage_max != null && typeof k.mileage === 'number' && k.mileage > s.mileage_max)
        || (s.year_min != null && typeof k.year === 'number' && k.year < s.year_min)
        || (s.year_max != null && typeof k.year === 'number' && k.year > s.year_max)));
  if (offCriteria.length > 0) {
    await supabase.from('daily_search_hits')
      .update({ status: 'dismissed', resolution: 'hors_criteres' })
      .in('id', offCriteria.map((k) => k.id));
    console.warn(`[DAILY] « ${name} » : ${offCriteria.length} annonce(s) archivée(s) — hors critères actuels (km max ${s.mileage_max ?? '—'}, années ${s.year_min ?? '—'}–${s.year_max ?? '—'})`);
    for (const k of offCriteria) {
      const cur = [...seen.entries()].find(([, v]) => v.id === k.id);
      if (cur) seen.set(cur[0], { ...cur[1], status: 'dismissed', resolution: 'hors_criteres' });
    }
  }

  // Véhicules déjà en NÉGOCIATION chez ce compte (tous statuts — un véhicule
  // validé un jour n'est jamais re-présenté, règle Channing 29/07) : une
  // annonce croisée par une AUTRE étude entre directement en 'saved'.
  const { data: negos } = await supabase
    .from('negotiations')
    .select('listing_url')
    .eq('user_id', s.user_id)
    .limit(5000);
  const negoUrls = new Set(
    ((negos ?? []) as Array<{ listing_url: string | null }>)
      .map((n) => (n.listing_url ?? '').trim())
      .filter((u) => u.startsWith('http')),
  );

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
      // Médiane cible INCONNUE ≠ écart favorable : l'ancien `gap == null →
      // inRange` déversait tout le scrape en inbox (« YARIS CROSS TRAIL »
      // FR→FR, cible 0 prix : 119 annonces à traiter d'un coup, 01/08).
      // Sans médiane, les annonces sont stockées hors écart (diagnostic
      // « vues hors écart » visible) et reviendront quand la cible parlera.
      const inRange = gap != null && gap >= s.price_gap_min && gap <= s.price_gap_max;
      const prior = seen.get(listingUrl);

      if (!prior) {
        // Premier passage compris : ce qui matche les critères va dans la
        // boîte tout de suite — on traite les annonces dès le départ.
        // SAUF un véhicule déjà EN NÉGOCIATION (règle Channing 29/07) : il ne
        // re-apparaît jamais dans les résultats, il vit dans l'onglet Ventes.
        const status = negoUrls.has(listingUrl) ? 'saved' : inRange ? 'inbox' : 'dismissed';
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
        // Baisse réelle : elle re-rentre dans la boîte, même si déjà triée —
        // SAUF « hors critères » (définitif, règle 28/07) et SAUF un véhicule
        // en négociation (règle 29/07 : validé = plus jamais dans le feed).
        const canReturn = prior.resolution !== 'hors_criteres' && prior.status !== 'saved';
        const status = inRange && canReturn ? 'inbox' : prior.status;
        await supabase.from('daily_search_hits').update({
          kind: 'price_drop', previous_price: prior.price, price,
          target_median: median, price_gap: gap, status, last_seen_at: nowIso,
          ...(status === 'inbox' ? { resolution: null } : {}),
        }).eq('id', prior.id);
        seen.set(listingUrl, { ...prior, price, status, resolution: status === 'inbox' ? null : prior.resolution });
        if (status === 'inbox') drops++;
      } else if (prior.resolution === 'plus_disponible' && prior.status === 'dismissed') {
        // « Plus disponible » (option Channing 25/08) : le LIEN avait été
        // marqué mort à la main — le revoir dans un scrape postérieur prouve
        // le contraire (annonce revenue en ligne, ou marquage erroné) :
        // l'annonce redevient triable. Hors écart, elle reste archivée mais
        // nettoyée de son motif (le flux la reprendra si l'écart parle).
        // Une annonce repostée sous une NOUVELLE URL re-rentre déjà par la
        // voie normale : l'anti-doublon est par URL, jamais par contenu.
        const status = inRange && !negoUrls.has(listingUrl) ? 'inbox' : 'dismissed';
        await supabase.from('daily_search_hits').update({
          status, resolution: null, target_median: median, price_gap: gap, last_seen_at: nowIso,
        }).eq('id', prior.id);
        seen.set(listingUrl, { ...prior, status, resolution: null });
        if (status === 'inbox') {
          fresh++;
          console.warn(`[DAILY] « ${name} »: annonce marquée « plus disponible » revue en ligne — remise à traiter (${listingUrl.slice(0, 90)})`);
        }
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

/**
 * STOCK D'UNE CONCESSION (30/09, demande Channing : « dans la carte, un bouton
 * quand un site vitrine peut être scrappé : la liste de leurs voitures et ce
 * qui manque par rapport au dernier relevé — vélocité et force de
 * proposition »).
 *
 * Un site de concession n'est pas une place de marché : pas d'URL de
 * recherche, une seule page « aanbod / occasions » et un fournisseur de site
 * derrière. Trois fournisseurs reconnus sur PREUVE (recon du 30/09, sans
 * navigateur, sans Zyte) :
 *   - dvnl       (Auto Smeeing)      : JSON `vehicle-overview-initial-state`
 *                                       dans la page, 20 par page, `pages.total`,
 *                                       plaque, VIN, km, année, énergie, boîte,
 *                                       date de mise en ligne (createdAt) ;
 *   - datamotive (Century, Next.js)  : JSON-LD ItemList de Car, 12 par page,
 *                                       `numberOfItems`, marque / modèle / prix ;
 *   - autodata   (Krimpenerwaard)    : POST /pages/find-autodata-vehicle-data
 *                                       avec cookie de session + jeton CSRF lu
 *                                       dans la page, 6 cartes HTML par page.
 *
 * Chaque relevé est persisté : network_stock_vehicles (une ligne par voiture
 * et par concession, first_seen / last_seen / gone_at, prix précédent) et
 * network_stock_runs (bilan). Le DIFF entre deux relevés = vélocité :
 * disparus = vendus (ou retirés), nouveaux = arrivages, prix changés.
 *
 * Accès direct (fetch) : ces sites ne bloquent pas ; jamais de Zyte ici.
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { recordLearningCase, resolveLearningCase } from './learningBox';
import { fetchHtmlWithZyte } from './scraper';
import { getFxRates } from './fx';

export type DealerProvider = 'dvnl' | 'dvapi' | 'datamotive' | 'dmapi' | 'autodata' | 'listerpage' | 'cmsms' | 'cartelcaw' | 'dtcvm' | 'carcards' | 'autrado';
const PROVIDERS_KNOWN: DealerProvider[] = ['dvnl', 'dvapi', 'datamotive', 'dmapi', 'autodata', 'listerpage', 'cmsms', 'cartelcaw', 'dtcvm', 'carcards', 'autrado'];

/**
 * BOÎTE À APPRENDRE (01/10, demande Channing) : une vitrine inconnue n'est
 * pas qu'une erreur, c'est un cas à traiter ensemble plus tard. Le relevé
 * échoue (rien d'inventé) ET le cas est enregistré dans learning_cases avec
 * l'hôte, le titre de la page et les indices techniques repérés.
 */
export class UnknownDealerSiteError extends Error {
  constructor(message: string, public readonly site: { host: string; url: string; title: string | null; hints: string[] }) { super(message); }
}
const SITE_HINTS: Array<[string, RegExp]> = [
  ['wordpress', /wp-content|wp-json/i], ['hexon', /hexon/i], ['nextjs', /__NEXT_DATA__|_next\/static/i], ['nuxt', /__NUXT__|_nuxt\//i],
  ['drupal', /drupalSettings|\/sites\/default\/files/i], ['typesense', /typesense/i], ['algolia', /algolia/i], ['elastic', /elasticsearch|appbase/i],
  ['dvnl-media', /export\.dv\.nl|doorlinkenvoorraad/i], ['autotrack', /autotrack/i], ['shopify', /cdn\.shopify/i], ['wix', /wixstatic|wix\.com/i],
  ['angular', /ng-version=/i], ['react', /data-reactroot|react-dom/i], ['vue', /data-v-[0-9a-f]{6,}|vue\.runtime/i], ['json-ld', /ld\+json/i], ['iframe', /<iframe[^>]+src="https?:\/\/(?!www\.)[^"]+"/i],
];
export function siteHints(html: string): string[] {
  return SITE_HINTS.filter(([, re]) => re.test(html)).map(([name]) => name);
}

/**
 * STATUT D'UNE ANNONCE (01/10, constat Channing sur Auto Smeeing : « 0 € »
 * dans le relevé pour des voitures « Op aanvraag » / « Binnenkort verwacht »).
 * Un prix absent n'est JAMAIS 0 € : price = null et le statut dit pourquoi,
 * sur TOUS les fournisseurs :
 *   price_on_request — le site n'affiche pas de prix (« op aanvraag »)
 *   expected         — annoncée, pas encore livrée (« binnenkort verwacht »)
 *   reserved         — réservée (« gereserveerd »)
 *   sold             — vendue mais encore affichée (« verkocht »)
 * null = en vente, prix affiché.
 */
export type DealerVehicleStatus = 'price_on_request' | 'expected' | 'reserved' | 'sold';

export interface DealerVehicle {
  external_id: string; url: string | null; title: string; brand: string | null; model: string | null;
  price: number | null; km: number | null; year: number | null; fuel: string | null; gearbox: string | null;
  plate: string | null; vin: string | null; body: string | null; image: string | null; listed_at: string | null;
  status: DealerVehicleStatus | null;
  /** Devise du prix TEL QU'AFFICHÉ par le site ('EUR' par défaut ; 'DKK' raevhede.dk 06/10). */
  currency?: string;
}

/** Prix > 0 sinon null — un 0 € de site est un prix absent, pas un prix. */
const priceOrNull = (v: unknown): number | null => { const n = num(v); return n != null && n > 0 ? n : null; };

/** Statut depuis un texte libre du site (libellé de sticker, texte de carte). */
function statusFromText(text: string | null | undefined): DealerVehicleStatus | null {
  const t = String(text ?? '').toLowerCase();
  if (!t) return null;
  if (/verkocht|vendu|sold|venduto|vendido/.test(t)) return 'sold';
  if (/gereserveerd|réservé|reserve[dr]|riservat|reservad/.test(t)) return 'reserved';
  if (/verwacht|binnenkort|expected|coming soon|in arrivo|próximamente|bientôt/.test(t)) return 'expected';
  if (/op aanvraag|on request|sur demande|su richiesta|a consultar|prijs n\.?o\.?t\.?k/.test(t)) return 'price_on_request';
  return null;
}

/** `declared` = total annoncé par le site lui-même (null = inconnu) ; `total` y
 *  replie sur le nombre lu. Seul `declared === 0` vaut « stock vide » (BYMYCAR
 *  02/10 : total inconnu → 0 → le garde-fou se taisait). */
export interface DealerStockResult { provider: DealerProvider; total: number | null; declared: number | null; vehicles: DealerVehicle[]; pages: number; warnings: string[] }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAX_PAGES = 150;
const PAGE_DELAY_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * SITE DERRIÈRE CLOUDFLARE (02/10, Vallei Auto Groep : « page du stock :
 * HTTP 403 », en-tête cf-mitigated: challenge, page « Just a moment… »).
 * La lecture directe est refusée quels que soient les en-têtes. Repli :
 * Zyte (débloqueur brut d'abord, navigateur ensuite) — payant, donc compté
 * et dit dans le bilan du relevé. Sans clé Zyte ou si Zyte échoue aussi :
 * DealerSiteBlockedError → cas « dealer_site_blocked » dans la boîte.
 */
export class DealerSiteBlockedError extends Error {
  constructor(message: string, public readonly site: { host: string; url: string; guard: string }) { super(message); }
}
let zyteCallsThisRun = 0;
const isChallenge = (status: number, headers: Headers, text: string) =>
  (status === 403 || status === 503) && (headers.get('cf-mitigated') === 'challenge' || /just a moment|cf-chl|challenge-platform|_cf_chl/i.test(text.slice(0, 20_000)));

async function getText(url: string, init?: RequestInit): Promise<{ status: number; text: string; headers: Headers }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  let direct: { status: number; text: string; headers: Headers };
  try {
    const res = await fetch(url, { ...init, headers: { 'user-agent': UA, 'accept-language': 'nl,en;q=0.8,fr;q=0.6', ...(init?.headers as Record<string, string> | undefined) }, signal: ctrl.signal, redirect: 'follow' });
    direct = { status: res.status, text: await res.text(), headers: res.headers };
  } finally { clearTimeout(t); }
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' || !isChallenge(direct.status, direct.headers, direct.text)) return direct;
  // Repli Zyte : brut (débloqueur, le plus efficace sur les pages servies),
  // puis navigateur. Chaque appel est compté pour le bilan.
  for (const override of [{ httpResponseBody: true as const, geolocation: 'NL' }, { javascript: true as const, geolocation: 'NL' }]) {
    zyteCallsThisRun++;
    const r = await fetchHtmlWithZyte(url, 1, override as never);
    if (r.html && !/just a moment|cf-chl|challenge-platform/i.test(r.html.slice(0, 20_000))) {
      return { status: 200, text: r.html, headers: new Headers({ 'x-ada-via': 'zyte' }) };
    }
    if (r.status === 401 || r.status === 402 || r.status === 403) break; // compte Zyte bloqué : inutile d'insister
  }
  throw new DealerSiteBlockedError(
    `page du stock : HTTP ${direct.status} — site protégé par Cloudflare, lecture directe refusée et Zyte n'a pas rendu la page`,
    { host: new URL(url).hostname, url, guard: 'cloudflare' },
  );
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // « € 25.950,- » (notation néerlandaise, Mengelers 02/10) : le « ,- » final
  // n'est pas une décimale — retiré avant lecture.
  const n = Number(String(v).replace(/,-\s*$/, '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const decode = (s: string) => s.replace(/&euro;/g, '€').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const withPage = (url: string, page: number): string => {
  const u = new URL(url);
  // Pagination par DÉCALAGE (Wassink 06/10 : « ?from=0&size=12 » — `page=2`
  // y est ignoré, la page 1 revient et le relevé s'arrêtait à 12 / 1 110).
  const size = Number(u.searchParams.get('size') ?? '');
  if (u.searchParams.has('from') && Number.isFinite(size) && size > 0) {
    u.searchParams.set('from', String((page - 1) * size));
    return u.toString();
  }
  u.searchParams.set('page', String(page));
  return u.toString();
};

/**
 * Marque + modèle depuis le titre d'une vitrine qui ne les sépare pas
 * (autodata : « Toyota Yaris 1.5 Hybrid Sport », « Mercedes-Benz G-Klasse 63
 * AMG », « Land Rover Range Rover Evoque »). Sans modèle, le résumé par
 * modèle de l'outil MCP groupait par marque seule (constat 30/09).
 */
const TWO_WORD_BRANDS = ['alfa romeo', 'land rover', 'aston martin', 'rolls royce', 'rolls-royce', 'lynk & co', 'mercedes benz', 'great wall', 'mg motor'];
const TWO_WORD_MODELS = ['model', 'range', 'grand', 'serie', 'série', 'classe', 'klasse', 'santa', 'ds', 'id.', 'e-', 'c-', 'a-', 'b-', 'v-', 'x-', 'ioniq'];
export function splitTitle(title: string): { brand: string | null; model: string | null } {
  const words = title.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length === 0 || !words[0]) return { brand: null, model: null };
  const two = words.length >= 2 ? `${words[0]} ${words[1]}`.toLowerCase() : '';
  const brandLen = TWO_WORD_BRANDS.includes(two) ? 2 : 1;
  const brand = words.slice(0, brandLen).join(' ');
  const rest = words.slice(brandLen);
  if (rest.length === 0) return { brand, model: null };
  const first = rest[0].toLowerCase();
  const numberedSeries = /^\d$/.test(rest[0]) && /^(serie|series|série|reeks)$/i.test(rest[1] ?? ''); // « BMW 3 Serie 320i »
  const modelLen = rest.length >= 2 && (TWO_WORD_MODELS.includes(first) || numberedSeries || /^[a-z]-$/i.test(rest[0])) ? 2 : 1;
  return { brand, model: rest.slice(0, modelLen).join(' ') };
}

// ── Détection ───────────────────────────────────────────────────────────────
export function detectDealerProvider(html: string): DealerProvider | null {
  if (/id="vehicle-overview-initial-state"/.test(html)) return 'dvnl';
  if (/find-autodata-vehicle-data/.test(html)) return 'autodata';
  // Avant datamotive : ces pages portent AUSSI un JSON-LD ItemList, mais aux
  // prix de leasing mensuels (Wassink 06/10 : « 554 € » pour une 308).
  if (/window\.dtcVm\.initialHits\s*=\s*\{/.test(html)) return 'dtcvm';
  // Cartes HTML à attributs data-* (raevhede.dk 06/10 : <a class="car-card"
  // data-make data-model data-year data-price data-km …>, tout le stock sur
  // une page, filtres côté client).
  if (/<a[^>]+class="[^"]*\bcar-card\b[^"]*"[^>]+data-price=/.test(html)) return 'carcards';
  // autrado (Autexx, 08/10) : cartes <article class="c-vehicle" data-id>, images img.autrado.de.
  if (/class="c-vehicles-list__item/.test(html) && /class="c-vehicle\b[^"]*"[^>]*data-id="\d+"/.test(html)) return 'autrado';
  if (/"@type":\s*"ItemList"/.test(html) && /"Car"/.test(html)) return 'datamotive';
  if (/"listerpage":\s*\{[^}]*"ajax_url"/.test(html)) return 'listerpage';
  if (/data-update-url="[^"]*\/voorraad-api\/vehiclelist\/\d+\/vehicles\.json/.test(html)) return 'dvapi';
  if (/id="advancedSearchForm"/.test(html) && /returnid" value="\d+"/.test(html)) return 'cmsms';
  if (/data-vehicle-overview='\{[^']*dmUpdateUrl/.test(html) || /data-vehicle-overview="\{[^"]*dmUpdateUrl/.test(html)) return 'dmapi';
  if (/autovoorraad\.uname-it\.nl\/cawclient/.test(html) && /productList__item/.test(html)) return 'cartelcaw';
  return null;
}

// ── dvnl (Auto Smeeing) ─────────────────────────────────────────────────────
interface DvItem {
  id: string; brand?: string; model?: string; type?: string; price?: number; url?: string; createdAt?: string;
  images?: Array<{ path?: string }>; attributes?: Record<string, { value?: unknown }>;
  enrichedValues?: { reserved?: boolean; sticker?: { name?: string } };
}
function parseDv(html: string): { items: DvItem[]; total: number | null; pages: number | null } | null {
  const m = html.match(/<script[^>]*id="vehicle-overview-initial-state"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]) as { items?: DvItem[]; count?: number; pages?: { total?: number } };
    return { items: d.items ?? [], total: typeof d.count === 'number' ? d.count : null, pages: d.pages?.total ?? null };
  } catch { return null; }
}
/** Un item dvnl (JSON de page ou de l'API /voorraad-api) → véhicule ADA. */
function dvItemToVehicle(it: DvItem, origin: string): DealerVehicle | null {
  const a = (k: string) => it.attributes?.[k]?.value;
  const id = String(a('voertuignr') ?? a('voertuignr_hexon') ?? it.id ?? '').trim();
  if (!id) return null;
  const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'Ja';
  // Statut : « gereserveerd » (attribut), sticker autre que « Beschikbaar »
  // (Gereserveerd / Verkocht / Binnenkort verwacht), attributs verkocht /
  // verwacht (API Hedin), sinon prix absent = « op aanvraag » (preuve 01/10 :
  // Audi A1 price 0, page « Op aanvraag »).
  const price = priceOrNull(it.price);
  const sticker = it.enrichedValues?.sticker?.name;
  const status: DealerVehicleStatus | null = truthy(a('verkocht')) ? 'sold'
    : truthy(a('gereserveerd')) || it.enrichedValues?.reserved === true || it.enrichedValues?.reserved === 1 ? 'reserved'
      : truthy(a('verwacht')) ? 'expected'
        : (statusFromText(sticker) ?? (price == null ? 'price_on_request' : null));
  return {
    external_id: id, url: it.url ? (it.url.startsWith('http') ? it.url : origin + it.url) : null,
    title: [it.brand, it.model, it.type].filter(Boolean).join(' ').trim(), brand: it.brand ?? null, model: it.model ?? null,
    price, km: num(a('tellerstand')), year: num(a('bouwjaar')), fuel: a('brandstof') ? String(a('brandstof')) : null,
    gearbox: a('transmissie') ? String(a('transmissie')) : null, plate: a('kenteken') ? String(a('kenteken')) : null,
    vin: a('vin') ? String(a('vin')) : null, body: a('carrosserie') ? String(a('carrosserie')) : null,
    image: it.images?.[0]?.path ?? null, listed_at: it.createdAt ? new Date(it.createdAt).toISOString() : null,
    status,
  };
}

// ── dvapi (Hedin Automotive — même famille dvnl, servie par une API JSON,
//    preuve 01/10) : la page porte data-update-url="/voorraad-api/vehiclelist/
//    76/vehicles.json?limit=21&sort=…" ; GET avec limit=100&page=N →
//    { items[], pages:{current,next,total,limit}, count }. Items identiques
//    au JSON dvnl (brand/model/type/price/url/createdAt/attributes/images),
//    plus verkocht / verwacht / gereserveerd en attributs. 4 380 occasions en
//    44 pages le 01/10.
async function scrapeDvApi(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const raw = firstHtml.match(/data-update-url="([^"]*\/voorraad-api\/vehiclelist\/\d+\/vehicles\.json[^"]*)"/)?.[1];
  if (!raw) return { provider: 'dvapi', total: null, vehicles: [], pages: 0, warnings: ['data-update-url introuvable'] };
  const api = new URL(raw.replace(/&amp;/g, '&'), origin);
  api.searchParams.set('limit', '100');
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let page = 1;
  for (; page <= MAX_PAGES; page++) {
    api.searchParams.set('page', String(page));
    const res = await getText(api.toString(), { headers: { accept: 'application/json', referer: url } });
    if (res.status !== 200) { warnings.push(`page ${page} : HTTP ${res.status}`); break; }
    let d: { items?: DvItem[]; pages?: { total?: number }; count?: number };
    try { d = JSON.parse(res.text); } catch { warnings.push(`page ${page} : réponse illisible`); break; }
    total = num(d.count) ?? total;
    const items = d.items ?? [];
    if (items.length === 0) break;
    let added = 0;
    for (const it of items) {
      const v = dvItemToVehicle(it, origin);
      if (!v || seen.has(v.external_id)) continue;
      seen.add(v.external_id); added++; out.push(v);
    }
    if (added === 0) break;
    const pagesTotal = num(d.pages?.total);
    if (pagesTotal != null && page >= pagesTotal) break;
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'dvapi', total: total ?? out.length, declared: total, vehicles: out, pages: page, warnings };
}

async function scrapeDv(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let first = parseDv(firstHtml);
  let total = first?.total ?? null;
  const pagesTotal = Math.min(MAX_PAGES, first?.pages ?? MAX_PAGES);
  for (let page = 1; page <= pagesTotal; page++) {
    const parsed = page === 1 ? first : parseDv((await getText(withPage(url, page))).text);
    first = null;
    if (!parsed) { warnings.push(`page ${page} : JSON absent`); break; }
    if (parsed.items.length === 0) break;
    for (const it of parsed.items) {
      const v = dvItemToVehicle(it, origin);
      if (!v || seen.has(v.external_id)) continue;
      seen.add(v.external_id);
      out.push(v);
    }
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'dvnl', total: total ?? out.length, declared: total, vehicles: out, pages: pagesTotal, warnings };
}

// ── datamotive (Century) — en fait toute vitrine à JSON-LD ItemList de Car ──
// Deux formes prouvées : Century = ItemList en tête de bloc, numberOfItems =
// total du stock (1 161), 12 par page ; BYMYCAR (02/10, « il trouve rien ») =
// CollectionPage → mainEntity → ItemList, numberOfItems = 24 = la TAILLE DE
// PAGE, le vrai total est dans la page (« 6489 véhicules correspondent à votre
// recherche »), 271 pages ; km / carburant dans le JSON-LD, année dans l'URL
// (-occasion-2023-), modelDate « 1970 » = valeur bouche-trou.
type LdList = { '@type'?: string; numberOfItems?: number; itemListElement?: Array<Record<string, unknown>>; mainEntity?: unknown; '@graph'?: unknown };
function findItemList(d: unknown, depth = 0): LdList | null {
  if (!d || typeof d !== 'object' || depth > 4) return null;
  if (Array.isArray(d)) { for (const x of d) { const r = findItemList(x, depth + 1); if (r) return r; } return null; }
  const o = d as LdList;
  if (o['@type'] === 'ItemList' && Array.isArray(o.itemListElement)) return o;
  return findItemList(o.mainEntity, depth + 1) ?? findItemList(o['@graph'], depth + 1);
}
function parseItemList(html: string): { items: Array<Record<string, unknown>>; total: number | null } | null {
  // Balise tolérante aux attributs (Wassink 06/10 : `<script type="…ld+json"
  // id="vm-overview-itemlist-schema">` — la forme stricte rendait « JSON-LD
  // absent » sur une page qui en portait un).
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const list = findItemList(JSON.parse(m[1]));
      if (list) return { items: list.itemListElement ?? [], total: typeof list.numberOfItems === 'number' ? list.numberOfItems : null };
    } catch { /* bloc suivant */ }
  }
  return null;
}
/** Total affiché dans la page (« 6489 véhicules correspondent », « 362 occasions », « 1.161 resultaten »). */
function pageTotal(html: string): number | null {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const n = '(\\d{1,3}(?:[\\s\\u00a0\\u202f.]\\d{3})*|\\d+)';
  // D'abord un compteur de résultats explicite (« 6489 véhicules correspondent »,
  // « 362 occasions gevonden », « 1.161 resultaten »), sinon rien : un chiffre
  // marketing (« plus de 9 000 véhicules ») ne vaut pas total.
  const m = text.match(new RegExp(`${n}\\s*(?:véhicules?|voitures?|occasions?|voertuigen|auto'?s)\\s*(?:correspondent|trouvés?|gevonden|disponibles?|beschikbaar)`, 'i'))
    ?? text.match(new RegExp(`${n}\\s*(?:resultaten|résultats?)\\b`, 'i'));
  return m ? num(m[1].replace(/[\s  .]/g, '')) : null;
}
async function scrapeDatamotive(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let first: ReturnType<typeof parseItemList> = parseItemList(firstHtml);
  const perPage = first?.items.length ?? 0;
  // numberOfItems égal au nombre d'items de la page = taille de page, pas total.
  const declaredLd = first?.total != null && first.total > perPage ? first.total : null;
  const total = declaredLd ?? pageTotal(firstHtml) ?? (first?.total === 0 ? 0 : null);
  const pagesCap = total != null && perPage > 0 ? Math.min(400, Math.ceil(total / perPage) + 1) : MAX_PAGES;
  let pages = 0;
  // Une page qui échoue (HTTP ≠ 200, JSON-LD absent) est relue une fois après
  // une pause ; sinon on s'arrête EN LE DISANT (constat 02/10 : Century lu à
  // 986 / 1 189, arrêt muet à la page 84 alors que la page sert 12 items).
  const readPage = async (page: number): Promise<{ parsed: ReturnType<typeof parseItemList>; status: number }> => {
    let status = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(1500);
      const r = await getText(withPage(url, page));
      status = r.status;
      const parsed = r.status === 200 ? parseItemList(r.text) : null;
      if (parsed) return { parsed, status };
    }
    return { parsed: null, status };
  };
  for (let page = 1; page <= pagesCap; page++) {
    const got = page === 1 ? { parsed: first, status: 200 } : await readPage(page);
    const parsed = got.parsed;
    first = null;
    pages = page;
    // 404 = au-delà de la dernière page (Century : page 101 sur 100), fin normale.
    if (!parsed) { if (got.status !== 404) warnings.push(`arrêt à la page ${page} : HTTP ${got.status} ou JSON-LD absent — relevé partiel`); break; }
    if (parsed.items.length === 0) break;
    let added = 0;
    for (const el of parsed.items) {
      const item = (el.item ?? {}) as Record<string, unknown>;
      const u = String(el.url ?? item.url ?? '');
      const offers = (item.offers ?? {}) as Record<string, unknown>;
      const brand = typeof item.brand === 'object' && item.brand ? String((item.brand as { name?: string }).name ?? '') : String(item.brand ?? '');
      const idFromUrl = u.match(/-(\d{6,})(?:-\d+)?$/)?.[1];
      const id = String(item.sku ?? idFromUrl ?? u).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id); added++;
      const rawName = String(item.name ?? '').split('|')[0].replace(/\s+-\s+\d{4}$/, '').trim();
      const name = brand && !rawName.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${rawName}` : rawName;
      const odo = item.mileageFromOdometer as { value?: unknown } | number | undefined;
      const km = num(typeof odo === 'object' && odo ? odo.value : odo);
      const yearFromUrl = num(u.match(/-(?:occasion|used|gebruikt)-((?:19|20)\d{2})-/)?.[1]);
      const modelDate = num(String(item.modelDate ?? item.productionDate ?? item.vehicleModelDate ?? '').slice(0, 4));
      const year = yearFromUrl ?? (modelDate != null && modelDate > 1980 ? modelDate : null);
      out.push({
        external_id: id, url: u || null, title: name, brand: brand || splitTitle(name).brand, model: item.model ? String(item.model) : splitTitle(name).model,
        price: priceOrNull(offers.price), km, year, fuel: item.fuelType ? String(item.fuelType) : null,
        gearbox: item.vehicleTransmission ? String(item.vehicleTransmission) : null, plate: null,
        vin: item.vehicleIdentificationNumber ? String(item.vehicleIdentificationNumber) : null, body: item.bodyType ? String(item.bodyType) : null,
        image: Array.isArray(item.image) ? String(item.image[0] ?? '') || null : item.image ? String(item.image) : null, listed_at: null,
        // schema.org : InStock = en vente ; PreOrder = attendue ; SoldOut /
        // OutOfStock = vendue ; prix absent = sur demande.
        status: /preorder/i.test(String(offers.availability ?? '')) ? 'expected'
          : /soldout|outofstock|discontinued/i.test(String(offers.availability ?? '')) ? 'sold'
            : priceOrNull(offers.price) == null ? 'price_on_request' : null,
      });
    }
    if (added === 0) { if (total != null && out.length < total) warnings.push(`page ${page} : aucun véhicule nouveau — arrêt à ${out.length} / ${total}`); break; }
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  if (out.length > 0 && out.every((v) => v.km == null)) warnings.push('Ce fournisseur ne publie ni km ni année dans la liste (fiche détaillée seulement).');
  return { provider: 'datamotive', total: total ?? out.length, declared: total, vehicles: out, pages, warnings };
}

// ── dtcvm (Wassink Autogroep) ───────────────────────────────────────────────
// Constat 06/10 : la page porte un JSON-LD ItemList (reconnu « datamotive »)
// mais ses prix sont des MENSUALITÉS de private lease (554 € pour une 308 à
// 17 740 €) — et `window.dtcVm.initialHits = {"hits":{"total":1110,"from":0,
// "size":12,"hits":[…]}}` embarque le vrai stock : verkoopprijs_particulier,
// actieprijs, tellerstand, bouwjaar, kenteken, chassisnummer, brandstof,
// transmissie, verkocht, verwacht, deeplink, afbeeldingen, created_at.
// Pagination par `from=` (décalage), total = hits.total.
type DtcHit = Record<string, unknown>;
function parseDtcVm(html: string): { total: number | null; from: number; size: number; hits: DtcHit[] } | null {
  const marker = html.match(/window\.dtcVm\.initialHits\s*=\s*/);
  if (!marker || marker.index == null) return null;
  const start = marker.index + marker[0].length;
  let depth = 0; let inStr = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const d = JSON.parse(html.slice(start, i + 1)) as { hits?: { total?: unknown; from?: unknown; size?: unknown; hits?: unknown } };
          const h = d.hits ?? {};
          return { total: num(h.total), from: num(h.from) ?? 0, size: num(h.size) ?? 0, hits: Array.isArray(h.hits) ? (h.hits as DtcHit[]) : [] };
        } catch { return null; }
      }
    }
  }
  return null;
}
function dtcHitToVehicle(h: DtcHit): DealerVehicle | null {
  const s = (k: string): string => String(h[k] ?? '').trim();
  const id = s('voertuignr_hexon') || s('stocknummer') || s('id');
  if (!id) return null;
  const brand = s('merk') || null;
  const model = s('model') || null;
  const variant = s('motorvariant') || s('type').split('|')[0].trim();
  const title = [brand, model, variant].filter(Boolean).join(' ');
  // actieprijs > 0 = prix affiché (promotion) ; sinon prix particulier.
  const price = priceOrNull(s('actieprijs')) ?? priceOrNull(s('verkoopprijs_particulier'));
  const images = Array.isArray(h.afbeeldingen) ? (h.afbeeldingen as unknown[]) : [];
  const created = s('created_at');
  const status: DealerVehicleStatus | null = num(h.verkocht) === 1 ? 'sold'
    : num(h.verwacht) === 1 ? 'expected'
      : price == null ? 'price_on_request' : null;
  return {
    external_id: id, url: s('deeplink') || null, title, brand, model,
    price, km: num(s('tellerstand')), year: num(s('bouwjaar')), fuel: s('brandstof') || null, gearbox: s('transmissie') || null,
    plate: s('kenteken') || null, vin: s('chassisnummer') || null, body: s('carrosserie') || null,
    image: images.length ? String(images[0]) : null,
    listed_at: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(created) ? created.replace(' ', 'T') : null,
    status,
  };
}
async function scrapeDtcVm(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const first = parseDtcVm(firstHtml);
  if (!first) return { provider: 'dtcvm', total: null, declared: null, vehicles: [], pages: 1, warnings: ['bloc dtcVm.initialHits illisible'] };
  const total = first.total;
  const u = new URL(url);
  const size = first.size > 0 ? first.size : Number(u.searchParams.get('size') || 12);
  const pagesCap = total != null && size > 0 ? Math.min(400, Math.ceil(total / size)) : MAX_PAGES;
  let pages = 0;
  for (let page = 1; page <= pagesCap; page++) {
    let parsed = page === 1 ? first : null;
    if (page > 1) {
      const pu = new URL(url);
      pu.searchParams.set('from', String((page - 1) * size));
      pu.searchParams.set('size', String(size));
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        if (attempt > 0) await sleep(1500);
        const r = await getText(pu.toString());
        if (r.status === 200) parsed = parseDtcVm(r.text);
        else if (r.status === 404) break;
      }
      if (!parsed) { warnings.push(`arrêt à la page ${page} : bloc dtcVm absent — relevé partiel`); break; }
    }
    pages = page;
    let added = 0;
    for (const h of parsed!.hits) {
      const v = dtcHitToVehicle(h);
      if (!v || seen.has(v.external_id)) continue;
      seen.add(v.external_id); added++; out.push(v);
    }
    if (parsed!.hits.length === 0) break;
    if (added === 0) { if (total != null && out.length < total) warnings.push(`page ${page} : aucun véhicule nouveau — arrêt à ${out.length} / ${total}`); break; }
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'dtcvm', total: total ?? out.length, declared: total, vehicles: out, pages, warnings };
}

// ── carcards (Rævhede Auto, raevhede.dk) ─────────────────────────────────────
// Constat 06/10 : WordPress + bilinfo, TOUT le stock sur une page (« Viser 102
// biler »), une carte par voiture : <a class="car-card" href="…/bil/…-7216b24e/"
// data-make="Lynk &amp; Co" data-model="01" data-fuel="benzin"
// data-gearbox="automatic" data-body="CUV Aut." data-year="2021"
// data-price="192900" data-km="77000"> … <div class="car-variant">PHEV</div>
// <div class="car-price">192.900 kr.</div>. Prix en COURONNES DANOISES :
// gardés en DKK (currency), convertis à l'affichage au taux BCE du jour.
const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
function currencyOfSite(url: string, html: string): string {
  const host = new URL(url).hostname;
  const kr = /\d\s*kr\.?(?:\s|<|$)/.test(html);
  if (host.endsWith('.dk') && kr) return 'DKK';
  if (host.endsWith('.se') && kr) return 'SEK';
  if (host.endsWith('.no') && kr) return 'NOK';
  if (host.endsWith('.hu') && /\bFt\b/.test(html)) return 'HUF';
  if (host.endsWith('.pl') && /\bzł/.test(html)) return 'PLN';
  if (host.endsWith('.cz') && /\bKč/.test(html)) return 'CZK';
  return 'EUR';
}
async function scrapeCarCards(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const currency = currencyOfSite(url, firstHtml);
  const declared = num(firstHtml.match(/class="count-n"[^>]*>\s*([\d.\s]+)\s*</)?.[1]?.replace(/\D/g, ''));
  const re = /<a\b([^>]*\bclass="[^"]*\bcar-card\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g;
  const attr = (tag: string, name: string): string | null => {
    const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? unesc(m[1]) || null : null;
  };
  const text = (inner: string, cls: string): string | null => {
    const m = inner.match(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)<`));
    return m ? unesc(m[1].replace(/\s+/g, ' ')) || null : null;
  };
  for (const m of firstHtml.matchAll(re)) {
    const tag = m[1]; const inner = m[2];
    const href = attr(tag, 'href') ?? '';
    const id = href.match(/-([0-9a-f]{6,})\/?$/i)?.[1] ?? href.replace(/\/$/, '').split('/').pop() ?? '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const brand = attr(tag, 'data-make') ?? text(inner, 'car-make');
    const model = attr(tag, 'data-model') ?? text(inner, 'car-name');
    const variant = text(inner, 'car-variant');
    const title = [brand, model, variant].filter(Boolean).join(' ');
    const price = priceOrNull(attr(tag, 'data-price'));
    const img = inner.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/)?.[1] ?? null;
    const badges = [...inner.matchAll(/class="badge[^"]*"[^>]*>([^<]*)</g)].map((b) => unesc(b[1])).join(' ');
    const status: DealerVehicleStatus | null = statusFromText(badges) ?? (price == null ? 'price_on_request' : null);
    out.push({
      external_id: id, url: href || null, title, brand, model, price, currency,
      km: num(attr(tag, 'data-km')), year: num(attr(tag, 'data-year')),
      fuel: attr(tag, 'data-fuel'), gearbox: attr(tag, 'data-gearbox'), plate: null, vin: null,
      body: attr(tag, 'data-body'), image: img, listed_at: null, status,
    });
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} carte(s) lue(s) pour ${declared} annoncées — relevé partiel`);
  return { provider: 'carcards', total: declared ?? out.length, declared, vehicles: out, pages: 1, warnings };
}

// ── autrado (Autexx, www.autexx.de) ──────────────────────────────────────────
// Constat 08/10 (signalement Achille « Ada ne sait pas lire la vitrine ») :
// plateforme autrado — <article class="c-vehicle" data-id="2545"> avec
// <span itemprop="brand name">Seat Ibiza</span>, <span itemprop="name">1.0TSI
// Reference …</span>, lien relatif « seat-ibiza-x__2545.php », attributs
// Getriebe / Kraftstoff / Außenfarbe / Leistung « 70 kW (95 PS) » /
// Kilometerstand, catégorie « Neuwagen » / « Lagerfahrzeug », délai de
// livraison. PRIX RÉSERVÉ AUX COMPTES CONNECTÉS (« Nach Login ») : sans prix,
// statut « sur demande » — jamais 0. Pagination : « itemsperpage=100 » +
// « npage=N » (« page » seul est ignoré au-delà de 10 par page ; prouvé :
// 525 voitures en 6 pages).
export function parseAutradoCards(html: string, origin: string): DealerVehicle[] {
  const out: DealerVehicle[] = [];
  // Les icônes SVG embarquent un <style> : retiré avant lecture (constat 08/10 :
  // « .a{fill:none…} Kilometerstand 10 km » → km illisible).
  const text = (s: string) => unesc(s.replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  for (const m of html.matchAll(/<article\b([^>]*\bclass="[^"]*\bc-vehicle\b[^"]*"[^>]*)>([\s\S]*?)<\/article>/g)) {
    const id = m[1].match(/data-id="(\d+)"/)?.[1];
    if (!id) continue;
    const inner = m[2];
    const href = inner.match(/<a[^>]+class="[^"]*c-vehicle__link[^"]*"[^>]+href="([^"]+)"/)?.[1] ?? inner.match(/itemprop="url"[^>]*href="([^"]+)"/)?.[1] ?? '';
    const url = href ? (href.startsWith('http') ? href : `${origin}/${href.replace(/^\/+/, '')}`) : null;
    const brandModel = text(inner.match(/itemprop="brand name"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const sub = text(inner.match(/itemprop="name"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const attr = (key: string): string | null => {
      const r = inner.match(new RegExp(`<li[^>]*c-icon-details__item--${key}[^>]*>([\\s\\S]*?)<\\/li>`));
      if (!r) return null;
      const t = text(r[1]).replace(/^(Getriebe|Kraftstoff|Außenfarbe|Leistung|Kilometerstand|Fahrzeugnr\.|Erstzulassung)\s*/i, '').trim();
      return t || null;
    };
    const gearRaw = attr('gearing') ?? '';
    const fuelRaw = attr('fuel') ?? '';
    const powerRaw = attr('power') ?? '';
    const kmRaw = attr('mileage') ?? attr('kilometer') ?? (text(inner).match(/Kilometerstand\s*([\d.]+)\s*km/)?.[1] ?? '');
    const ezRaw = text(inner).match(/Erstzulassung\s*(\d{2}\/\d{4}|\d{2}\.\d{4}|\d{2}\.\d{2}\.\d{4})/)?.[1] ?? '';
    const category = text(inner).match(/\b(Neuwagen|Lagerfahrzeug|Gebrauchtwagen|Vorführwagen|Tageszulassung|Jahreswagen)\b/)?.[1] ?? null;
    const delivery = text(inner).match(/(?:Lieferzeit:\s*([^|]{2,30}?)\s{2,}|sofort lieferbar)/)?.[0]?.trim() ?? null;
    const price = priceOrNull(text(inner).match(/(\d{1,3}(?:\.\d{3})+|\d{4,6})(?:,\d{2})?\s*€/)?.[1]?.replace(/\./g, ''));
    const { brand, model } = splitTitle(brandModel);
    const ps = powerRaw.match(/\((\d+)\s*PS\)/)?.[1];
    const kw = powerRaw.match(/(\d+)\s*kW/)?.[1];
    out.push({
      external_id: id, url, title: `${brandModel} ${sub}`.trim(), brand, model,
      price, km: num(kmRaw.replace(/\./g, '')),
      year: ezRaw ? num(ezRaw.slice(-4)) : null,
      fuel: fuelRaw || null,
      gearbox: /schalt/i.test(gearRaw) ? 'Manuelle' : /automat|dsg|s-?tronic|dct|cvt/i.test(gearRaw) ? 'Automatique' : gearRaw || null,
      plate: null, vin: null, body: category, image: inner.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null,
      status: price == null ? 'price_on_request' : null,
      currency: 'EUR',
    });
    void ps; void kw; void delivery;
  }
  return out;
}
async function scrapeAutrado(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const u = new URL(url);
  const origin = u.origin;
  const PER = 100;
  const pageUrl = (n: number) => { const p = new URL(url); p.searchParams.set('itemsperpage', String(PER)); p.searchParams.set('page', '1'); p.searchParams.set('npage', String(n)); return p.toString(); };
  let pages = 0;
  for (let n = 1; n <= MAX_PAGES; n++) {
    let html: string | null = null;
    if (n === 1 && (u.searchParams.get('itemsperpage') === String(PER))) html = firstHtml;
    else {
      for (let attempt = 0; attempt < 2 && html == null; attempt++) {
        if (attempt > 0) await sleep(1500);
        const r = await getText(pageUrl(n));
        if (r.status === 200) html = r.text;
      }
      if (html == null) { warnings.push(`arrêt à la page ${n} : page illisible — relevé partiel`); break; }
    }
    pages = n;
    const cards = parseAutradoCards(html, origin);
    let added = 0;
    for (const v of cards) { if (seen.has(v.external_id)) continue; seen.add(v.external_id); out.push(v); added++; }
    if (cards.length === 0 || added === 0) break;   // page vide ou page resservie = fin
    if (cards.length < PER) break;
    await sleep(PAGE_DELAY_MS);
  }
  if (out.length > 0 && out.every((v) => v.price == null)) warnings.push('Prix réservés aux comptes connectés sur ce site (« Nach Login ») : stock relevé sans prix.');
  return { provider: 'autrado', total: out.length, declared: null, vehicles: out, pages, warnings };
}

// ── autodata (Krimpenerwaard) ───────────────────────────────────────────────
async function scrapeAutodata(url: string, firstHtml: string, firstHeaders: Headers): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const token = firstHtml.match(/'X-CSRF-Token'\s*:\s*"([0-9a-f]{32,})"/)?.[1];
  const cookies = (firstHeaders.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!token) return { provider: 'autodata', total: null, vehicles: [], pages: 0, warnings: ['jeton CSRF introuvable dans la page'] };
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let page = 1;
  for (; page <= MAX_PAGES; page++) {
    const res = await getText(`${origin}/pages/find-autodata-vehicle-data`, {
      method: 'POST',
      headers: { cookie: cookies, 'x-csrf-token': token, 'x-requested-with': 'XMLHttpRequest', referer: url, origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: `page_number=${page}&total_showed_product=${out.length}&search_name=''&scroll_pos=0&merk_ex=`,
    });
    if (res.status !== 200) { warnings.push(`page ${page} : HTTP ${res.status}`); break; }
    let d: { msg?: string; total_records?: number | string; content?: string };
    try { d = JSON.parse(res.text); } catch { warnings.push(`page ${page} : réponse illisible`); break; }
    if (d.msg !== 'success') { warnings.push(`page ${page} : ${d.msg ?? 'réponse sans succès'}`); break; }
    total = num(d.total_records);
    const cards = (d.content ?? '').split(/(?=<div class="[^"]*each_product_div)/).filter((c) => c.includes('each_product_div'));
    if (cards.length === 0) break;
    let added = 0;
    for (const card of cards) {
      const href = card.match(/href="([^"]+)"/)?.[1]?.replace(/\\\//g, '/') ?? null;
      const id = href?.match(/\/(\d{5,})-/)?.[1] ?? href ?? '';
      if (!id || seen.has(id)) continue;
      seen.add(id); added++;
      const text = stripTags(card);
      const title = (text.match(/Bekijk auto\s+(.*?)\s+€/)?.[1] ?? text.split('€')[0].replace(/^Bekijk auto\s*/, '')).trim();
      const price = num(text.match(/€\s*([\d.]+)/)?.[1]);
      const km = num(text.match(/([\d.]+)\s*km/i)?.[1]);
      const year = num(text.match(/km\s*-\s*(\d{4})/)?.[1] ?? text.match(/\b(19|20)\d{2}\b(?!.*\b(19|20)\d{2}\b)/)?.[0]);
      const image = card.match(/(?:data-src|src)="((?:https?:)?\/\/[^"]+\.(?:jpe?g|webp|png)[^"]*)"/i)?.[1] ?? null;
      const { brand, model } = splitTitle(title);
      // Statut : mots de la carte (« Gereserveerd », « Verkocht », « Verwacht »,
      // « Op aanvraag »), sinon prix absent = sur demande.
      const price0 = price != null && price > 0 ? price : null;
      const status: DealerVehicleStatus | null = statusFromText(text) ?? (price0 == null ? 'price_on_request' : null);
      out.push({ external_id: id, url: href ? (href.startsWith('http') ? href : origin + href) : null, title, brand, model, price: price0, km, year, fuel: null, gearbox: null, plate: null, vin: null, body: null, image, listed_at: null, status });
    }
    if (added === 0) break;
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'autodata', total: total ?? out.length, declared: total, vehicles: out, pages: page, warnings };
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
// ── listerpage (Broekhuis Groep — Drupal « listerpage », preuve 01/10) ──────
// La page HTML ne contient aucune annonce : le stock vient d'un POST JSON sur
// drupalSettings.broekhuis_listerpages.listerpage.ajax_url, corps
// { facets, search, geo_search, sort, pager:{page,size} } (lu dans
// listerpage.min.js). Réponse : { pager:{page,size,total,pages}, items[] } ;
// chaque item porte title/subtitle, href, product.price.price,
// product.status.label (« Op voorraad » / « Verwacht »), product.specs
// (kilometerstand, boîte, année, énergie), ecommerce.item_brand / item_variant.
// 4 698 véhicules en 68 pages de 72 le 01/10 — un groupe entier, pas une
// concession : les relevés servent le diff, pas la vélocité fine.
interface ListerSettings {
  listerpage?: { ajax_url?: string; required_values?: Record<string, string | string[]> };
  facets?: Record<string, { childFacet?: { field?: string; config?: { urlAlias?: string } } | null; config?: { urlAlias?: string } }>;
}
interface ListerItem {
  id?: string; href?: string; title?: string; subtitle?: string; images?: string[];
  product?: { specs?: Array<{ value?: unknown; numberFormat?: string | null }>; price?: { price?: unknown }; status?: { label?: string } | null };
  ecommerce?: { item_id?: string; item_brand?: string; item_variant?: string; item_category?: string };
}
function parseListerSettings(html: string): ListerSettings | null {
  for (const m of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!m[1].includes('"listerpage"')) continue;
    try {
      const d = JSON.parse(m[1]) as Record<string, unknown>;
      for (const v of Object.values(d)) {
        if (v && typeof v === 'object' && (v as ListerSettings).listerpage?.ajax_url) return v as ListerSettings;
      }
    } catch { /* script suivant */ }
  }
  return null;
}
async function scrapeListerpage(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const settings = parseListerSettings(firstHtml);
  if (!settings?.listerpage?.ajax_url) return { provider: 'listerpage', total: null, vehicles: [], pages: 0, warnings: ['configuration listerpage introuvable dans la page'] };
  // Facettes imposées par la page (ex. status = Gebruikt + Demo) : l'alias
  // d'URL de la configuration → le champ de la facette.
  const facets: Record<string, string[]> = {};
  const fieldByAlias = new Map<string, string>();
  for (const [field, f] of Object.entries(settings.facets ?? {})) {
    if (f?.config?.urlAlias) fieldByAlias.set(f.config.urlAlias, field);
    if (f?.childFacet?.field && f.childFacet.config?.urlAlias) fieldByAlias.set(f.childFacet.config.urlAlias, f.childFacet.field);
  }
  for (const [alias, val] of Object.entries(settings.listerpage.required_values ?? {})) {
    const field = fieldByAlias.get(alias);
    if (field) facets[field] = Array.isArray(val) ? val : [val];
  }
  const u = new URL(url);
  const sortBy = u.searchParams.get('sort_by'), sortOrder = u.searchParams.get('sort_order');
  const sort = sortBy ? { [sortBy]: sortOrder || 'DESC' } : undefined;
  const ajax = settings.listerpage.ajax_url.startsWith('http') ? settings.listerpage.ajax_url : origin + settings.listerpage.ajax_url;
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let page = 1;
  for (; page <= MAX_PAGES; page++) {
    const res = await getText(ajax, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', referer: url },
      body: JSON.stringify({ facets, search: '', geo_search: '', ...(sort ? { sort } : {}), pager: { page, size: 72 } }),
    });
    if (res.status !== 200) { warnings.push(`page ${page} : HTTP ${res.status}`); break; }
    let d: { pager?: { total?: number; pages?: number }; items?: ListerItem[] };
    try { d = JSON.parse(res.text); } catch { warnings.push(`page ${page} : réponse illisible`); break; }
    total = num(d.pager?.total) ?? total;
    const items = d.items ?? [];
    if (items.length === 0) break;
    let added = 0;
    for (const it of items) {
      const href = it.href ?? '';
      const id = String(it.ecommerce?.item_id ?? href.match(/\/(\d{5,})\/?$/)?.[1] ?? it.id ?? '').trim();
      if (!id || !href || seen.has(id)) continue; // les 2 lignes vides par page (bannières) n'ont ni href ni titre
      seen.add(id); added++;
      const specs = (it.product?.specs ?? []).map((s) => ({ v: String(s.value ?? '').trim(), f: s.numberFormat ?? null }));
      const km = num(specs.find((s) => s.f === 'kilometerstand')?.v);
      const year = num(specs.find((s) => /^(19|20)\d{2}$/.test(s.v))?.v);
      const gearbox = specs.find((s) => /automaat|handgeschakeld|automatic|manual/i.test(s.v))?.v ?? null;
      const fuel = specs.find((s) => /benzine|diesel|elektrisch|hybride|lpg|cng|waterstof/i.test(s.v))?.v ?? null;
      const price = priceOrNull(it.product?.price?.price);
      const title = [it.title, it.subtitle].filter(Boolean).join(' ').trim();
      const guess = splitTitle(title);
      const statusLabel = it.product?.status?.label ?? '';
      const status: DealerVehicleStatus | null = /voorraad/i.test(statusLabel) ? (price == null ? 'price_on_request' : null)
        : (statusFromText(statusLabel) ?? (price == null ? 'price_on_request' : null));
      out.push({
        external_id: id, url: href.startsWith('http') ? href : origin + href, title,
        brand: it.ecommerce?.item_brand || guess.brand, model: it.ecommerce?.item_variant || guess.model,
        price, km, year, fuel, gearbox, plate: null, vin: null, body: null,
        image: it.images?.[0] ?? null, listed_at: null, status,
      });
    }
    if (added === 0) break;
    const pages = num(d.pager?.pages);
    if (pages != null && page >= pages) break;
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'listerpage', total: total ?? out.length, declared: total, vehicles: out, pages: page, warnings };
}

// ── cmsms (Louwman — CMS Made Simple, module « Occasions », preuve 02/10) ───
// La page ne porte que le formulaire ; le stock vient d'un POST sur
// index.php?mact=Occasions,cntnt01,ajaxDoAdvancedSearch,0&cntnt01returnid=N
// &pagina=P avec request=xmlhttp&data=<formulaire sérialisé>&pagina=P →
// { total, occasions_html }. 24 cartes par page ; chaque carte porte un
// div.favAuto avec data-id / data-merk / data-model / data-uitvoering /
// data-prijs / data-kenteken / data-url / data-thumb, et un bloc texte
// « 2026 · Electra · 852 km ». 3 908 « gebruikt » le 02/10 (3 062 occasions).
async function scrapeCmsms(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const returnid = firstHtml.match(/returnid" value="(\d+)"/)?.[1];
  if (!returnid) return { provider: 'cmsms', total: null, vehicles: [], pages: 0, warnings: ['returnid introuvable dans la page'] };
  // Filtre repris du chemin de l'URL : /aanbod/filters/gebruikt/ → gebruikt ;
  // /occasion/ → occasion ; sinon tout l'aanbod.
  const path = new URL(url).pathname.toLowerCase();
  const cond = /gebruikt/.test(path) ? 'gebruikt' : /occasion/.test(path) ? 'occasion' : /nieuw/.test(path) ? 'nieuw' : '';
  const data = `${cond ? `new_or_occasion%5B%5D=${cond}&` : ''}orderby=default&sortorder=DESC`;
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let page = 1;
  // 24 cartes par page : 3 908 véhicules = 163 pages, au-delà du plafond
  // commun (150) — plafond propre à ce fournisseur.
  const CMSMS_MAX_PAGES = 250;
  for (; page <= CMSMS_MAX_PAGES; page++) {
    const body = `request=xmlhttp&data=${encodeURIComponent(data)}&pagina=${page}`;
    const res = await getText(`${origin}/index.php?mact=Occasions,cntnt01,ajaxDoAdvancedSearch,0&cntnt01returnid=${returnid}&pagina=${page}${page > 1 ? '&type=scroll' : ''}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', referer: url }, body,
    });
    if (res.status !== 200) { warnings.push(`page ${page} : HTTP ${res.status}`); break; }
    let d: { total?: number | string; occasions_html?: string };
    try { d = JSON.parse(res.text); } catch { warnings.push(`page ${page} : réponse illisible`); break; }
    total = num(d.total) ?? total;
    const cards = (d.occasions_html ?? '').split(/(?=<div class="occasion grid")/).filter((c) => c.includes('favAuto'));
    if (cards.length === 0) break;
    let added = 0;
    for (const card of cards) {
      // Les attributs data-* vivent sur la balise favAuto UNIQUEMENT (le bloc
      // « labels » porte aussi un data-id : « label_tao » — constat 02/10,
      // 1 358 relevés au lieu de 3 908 par collision d'identifiants).
      const fav = card.match(/<div class="favAuto"[^>]*>/)?.[0] ?? '';
      const attr = (k: string) => decode(fav.match(new RegExp(`data-${k}="([^"]*)"`))?.[1] ?? '').trim();
      const id = attr('id') || attr('kenteken');
      if (!id || seen.has(id)) continue;
      seen.add(id); added++;
      const text = stripTags(card.match(/<div class="grid-info">([\s\S]*?)<div class="locatie">/)?.[1] ?? '');
      const year = num(text.match(/\b(19|20)\d{2}\b/)?.[0]);
      const km = num(text.match(/([\d.]+)\s*km/i)?.[1]);
      const fuel = text.match(/\b(Benzine|Diesel|Electra|Elektrisch|Hybride|LPG|CNG|Waterstof)\b/i)?.[1] ?? null;
      const labels = stripTags(card.match(/<div class="labels">([\s\S]*?)<\/div>/)?.[1] ?? '');
      const price = priceOrNull(attr('prijs'));
      const status: DealerVehicleStatus | null = statusFromText(labels) ?? (price == null ? 'price_on_request' : null);
      const brand = attr('merk') || null, model = attr('model') || null;
      out.push({
        external_id: id, url: attr('url') || null, title: [brand, model, attr('uitvoering')].filter(Boolean).join(' ').trim(),
        brand, model, price, km, year, fuel, gearbox: null, plate: attr('kenteken') || null, vin: null, body: null,
        image: attr('thumb') || null, listed_at: null, status,
      });
    }
    if (added === 0) break;
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'cmsms', total: total ?? out.length, declared: total, vehicles: out, pages: page, warnings };
}

// ── dmapi (Pon Center — API Datamotive, preuve 02/10) ───────────────────────
// La page porte data-vehicle-overview='{"dmUpdateUrl":"https://api.datamotive
// .nl/api/v1/content/vehicle-list/3188","dmFilterSetId":302,…}' ; la liste
// vient de GET dmUpdateUrl?filterId=…&page=N&pageSize=48 (plafond du
// service : 48) + filtre vehicleState[used]=1 quand la page demande les
// occasions (647 occasions / 614 neuves le 02/10). Items : id, brand, model,
// edition, slug (fiche = /p/<slug>), establishment, prices.purchase.value
// (previousValue = ancien prix), media. Ni km, ni année, ni plaque en liste —
// même limite que les sites datamotive à JSON-LD (Century).
interface DmItem { id?: number | string; brand?: string; model?: string; edition?: string; slug?: string; establishment?: string; prices?: { purchase?: { value?: unknown; previousValue?: unknown } }; media?: Array<{ type?: string; url?: string }> }
async function scrapeDmApi(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const raw = firstHtml.match(/data-vehicle-overview='([^']*)'/)?.[1] ?? firstHtml.match(/data-vehicle-overview="([^"]*)"/)?.[1];
  let cfg: { dmUpdateUrl?: string; dmFilterSetId?: number; sort?: string } = {};
  try { cfg = JSON.parse(decode(raw ?? '{}')); } catch { /* lu plus bas */ }
  if (!cfg.dmUpdateUrl) return { provider: 'dmapi', total: null, vehicles: [], pages: 0, warnings: ['dmUpdateUrl introuvable dans data-vehicle-overview'] };
  // Occasions seulement quand la page le demande (sources[]=Occasions ou
  // chemin « occasion ») ; sinon tout l'aanbod, neuf compris.
  const u = new URL(url);
  const usedOnly = /occasion/i.test(u.pathname) || [...u.searchParams.values()].some((v) => /occasion/i.test(v));
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let page = 1;
  for (; page <= MAX_PAGES; page++) {
    const api = new URL(cfg.dmUpdateUrl);
    if (cfg.dmFilterSetId != null) api.searchParams.set('filterId', String(cfg.dmFilterSetId));
    api.searchParams.set('page', String(page));
    api.searchParams.set('pageSize', '48');
    api.searchParams.set('sort', cfg.sort || 'created_at_desc');
    if (usedOnly) api.searchParams.set('vehicleState[used]', '1');
    const res = await getText(api.toString(), { headers: { accept: 'application/json', 'accept-language': 'nl-NL', referer: url, origin } });
    if (res.status !== 200) { warnings.push(`page ${page} : HTTP ${res.status}`); break; }
    let d: { count?: number; pages?: { total?: number }; items?: DmItem[] };
    try { d = JSON.parse(res.text); } catch { warnings.push(`page ${page} : réponse illisible`); break; }
    total = num(d.count) ?? total;
    const items = d.items ?? [];
    if (items.length === 0) break;
    let added = 0;
    for (const it of items) {
      const id = String(it.id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id); added++;
      const price = priceOrNull(it.prices?.purchase?.value);
      const title = [it.brand, it.model, it.edition].filter(Boolean).join(' ').trim();
      const guess = splitTitle(title);
      out.push({
        external_id: id, url: it.slug ? `${origin}/p/${it.slug}` : null, title,
        brand: it.brand || guess.brand, model: it.model || guess.model, price, km: null, year: null, fuel: null, gearbox: null,
        plate: null, vin: null, body: null, image: it.media?.find((m) => m.type === 'image')?.url ?? null, listed_at: null,
        status: price == null ? 'price_on_request' : null,
      });
    }
    if (added === 0) break;
    const pagesTotal = num(d.pages?.total);
    if (pagesTotal != null && page >= pagesTotal) break;
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'dmapi', total: total ?? out.length, declared: total, vehicles: out, pages: page, warnings };
}

// ── cartelcaw (Mengelers — « Cartel CAW client » de uname-it, preuve 02/10) ──
// Pages servies rendues : <li class="overview__item productList__item"> avec
// titre (marque modèle), description (version), meta (année · km · énergie
// · boîte), lieu, prix « € 25.950,- », lien fiche dont le chemin porte
// _occasion_ / _demo_ et la plaque. Paramètres d'URL : max=96 (par page),
// pagina=N. 685 occasions en 8 pages le 02/10 ; le total est écrit dans la
// page (« 685 occasions »).
async function scrapeCartelCaw(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    for (const card of html.split(/(?=<li class="[^"]*productList__item)/).filter((c) => c.includes('teaser__title'))) {
      const href = card.match(/<a class="btn[^"]*" href="([^"]+)"/)?.[1] ?? card.match(/href="([^"]+\/\d{6,})"/)?.[1] ?? '';
      const id = href.match(/\/(\d{6,})\/?$/)?.[1] ?? '';
      if (!id || seen.has(id)) continue;
      seen.add(id); added++;
      const title = stripTags(card.match(/<h2 class="teaser__title">([\s\S]*?)<\/h2>/)?.[1] ?? '');
      const descr = stripTags(card.match(/<p class="teaser__descr">([\s\S]*?)<\/p>/)?.[1] ?? '');
      const meta = [...card.matchAll(/<div class="meta__item">([\s\S]*?)<\/div>/g)].map((m) => stripTags(m[1]));
      const year = num(meta.find((m) => /^(19|20)\d{2}$/.test(m)));
      const km = num(meta.find((m) => /km$/i.test(m))?.replace(/km/i, ''));
      const fuel = meta.find((m) => /benzine|diesel|hybride|elektrisch|electra|lpg|cng|waterstof/i.test(m)) ?? null;
      const gearbox = meta.find((m) => /automaat|handgeschakeld/i.test(m)) ?? null;
      const price = priceOrNull(stripTags(card.match(/<div class="price price--current">([\s\S]*?)<\/div>/)?.[1] ?? ''));
      const plate = href.match(/_([a-z0-9]{1,3}-[a-z0-9]{1,3}-[a-z0-9]{1,3})-locatie/i)?.[1]?.replace(/-/g, '').toUpperCase() ?? null;
      const labels = stripTags(card.match(/<div class="teaser__label[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '');
      const status: DealerVehicleStatus | null = statusFromText(labels) ?? (price == null ? 'price_on_request' : null);
      const guess = splitTitle(title);
      out.push({
        external_id: id, url: href.startsWith('http') ? href : origin + href, title: [title, descr].filter(Boolean).join(' ').trim(),
        brand: guess.brand, model: guess.model, price, km, year, fuel, gearbox, plate, vin: null, body: null,
        image: card.match(/<img src="([^"]+)"/)?.[1] ?? null, listed_at: null, status,
      });
    }
    return added;
  };
  const total = num(firstHtml.match(/(\d[\d.]*)\s*occasions/i)?.[1]);
  const base = new URL(url);
  base.searchParams.set('max', '96');
  let page = 1;
  for (; page <= MAX_PAGES; page++) {
    base.searchParams.set('pagina', String(page));
    const html = page === 1 && new URL(url).searchParams.get('max') === '96' ? firstHtml : (await getText(base.toString())).text;
    const added = parse(html);
    if (added === 0) break;
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'cartelcaw', total: total ?? out.length, declared: total, vehicles: out, pages: page, warnings };
}

export async function fetchDealerStock(url: string): Promise<DealerStockResult> {
  const first = await getText(url);
  if (first.status !== 200) throw new Error(`page du stock : HTTP ${first.status}`);
  const provider = detectDealerProvider(first.text);
  if (!provider) {
    const title = first.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
    const hints = siteHints(first.text);
    throw new UnknownDealerSiteError(
      `site vitrine non reconnu (ni ${PROVIDERS_KNOWN.join(', ni ')})${hints.length ? ` — indices : ${hints.join(', ')}` : ''}`,
      { host: new URL(url).hostname, url, title, hints },
    );
  }
  if (provider === 'dvnl') return scrapeDv(url, first.text);
  if (provider === 'dvapi') return scrapeDvApi(url, first.text);
  if (provider === 'datamotive') return scrapeDatamotive(url, first.text);
  if (provider === 'dtcvm') return scrapeDtcVm(url, first.text);
  if (provider === 'carcards') return scrapeCarCards(url, first.text);
  if (provider === 'autrado') return scrapeAutrado(url, first.text);
  if (provider === 'listerpage') return scrapeListerpage(url, first.text);
  if (provider === 'cmsms') return scrapeCmsms(url, first.text);
  if (provider === 'dmapi') return scrapeDmApi(url, first.text);
  if (provider === 'cartelcaw') return scrapeCartelCaw(url, first.text);
  return scrapeAutodata(url, first.text, first.headers);
}

export interface DealerStockSummary {
  provider: DealerProvider; total: number; newCount: number; goneCount: number; priceChanges: number; pages: number; warnings: string[]; runId: string | null;
}

/** Relève le stock d'une concession de la carte et le compare au relevé précédent. */
export async function runDealerStock(contactId: string, url: string, submittedBy: string): Promise<DealerStockSummary> {
  const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const startedAt = new Date().toISOString();
  // started_at = LE MÊME instant que first_seen_at / last_seen_at des véhicules
  // (constat Louwman 06/10 : 230 nouveaux en base, « 0 » à l'écran — la base
  // posait started_at 80 ms APRÈS le startedAt des véhicules, et l'écran
  // compare « première vue ≥ début du relevé »).
  const { data: run, error: runErr } = await sb.from('network_stock_runs').insert({ contact_id: contactId, url, status: 'running', submitted_by: submittedBy, started_at: startedAt }).select('id').single();
  if (runErr) throw new Error(/does not exist|schema cache/i.test(runErr.message) ? 'SQL du 30/09 (network_stock_*) à coller.' : runErr.message);
  const runId = (run as { id: string }).id;
  try {
    zyteCallsThisRun = 0;
    const stock = await fetchDealerStock(url);
    const currencies = [...new Set(stock.vehicles.map((v) => (v.currency ?? 'EUR').toUpperCase()).filter((c) => c !== 'EUR'))];
    if (currencies.length > 0) {
      const fx = await getFxRates();
      for (const c of currencies) {
        const r = fx.rates[c];
        stock.warnings.push(r
          ? `Prix en ${c} sur le site — affichés convertis en € au taux BCE du ${fx.date} (1 € = ${r.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ${c})${fx.source === 'fallback' ? ' — taux de repli, BCE injoignable' : ''}`
          : `Prix en ${c} sur le site — devise sans taux connu, affichés tels quels`);
      }
    }
    if (zyteCallsThisRun > 0) stock.warnings.push(`${zyteCallsThisRun} page(s) lue(s) via Zyte (site protégé par Cloudflare) — relevé payant`);
    // GARDE-FOU (01/10, constat Van Mossel : reconnu « datamotive », 0
    // véhicule) : un relevé vide sur un site reconnu n'est pas un stock vide,
    // c'est une lecture ratée — on n'écrit rien et on ne marque rien disparu.
    // Seul un total 0 annoncé par le site lui-même vaut stock vide (BYMYCAR
    // 02/10 : total inconnu replié sur 0 → le garde-fou se taisait).
    if (stock.vehicles.length === 0 && stock.declared !== 0) {
      const saved = await recordLearningCase({
        kind: 'dealer_scan_empty', key: new URL(url).hostname, url, link: '/carte', actor: 'dev', contactId, submittedBy,
        title: `Relevé vide sur un site reconnu : ${new URL(url).hostname} (${stock.provider})`,
        detail: { provider: stock.provider, warnings: stock.warnings, pages: stock.pages },
      });
      throw new Error(`relevé vide alors que le site est reconnu (${stock.provider})${stock.warnings.length ? ` — ${stock.warnings.join(' ; ')}` : ''} : rien n'a été écrit ni marqué disparu${saved ? ' — cas enregistré dans la boîte à apprendre' : ''}`);
    }
    // Prix précédents : pour compter les changements et garder price_prev.
    // Historique des prix (SQL du 01/10 soir) : lu s'il existe, sinon reconstruit
    // depuis price_prev / price — la lecture ne doit jamais bloquer le relevé.
    type Prev = { external_id: string; price: number | null; price_prev: number | null; first_seen_at: string; price_first?: number | null; price_history?: Array<{ at: string; price: number }> | null };
    // PAR PAGES DE 1 000 (constat Channing 02/10 : « deuxième relevé Louwman,
    // aucun véhicule disparu ») : PostgREST ne rend jamais plus de 1 000
    // lignes. Le relevé précédent lu tronqué → 2 904 véhicules connus pris
    // pour nouveaux, first_seen_at et historique des prix écrasés.
    const readPrev = async (cols: string): Promise<{ rows: Prev[]; error: string | null }> => {
      const rows: Prev[] = [];
      for (let from = 0; ; from += 1000) {
        const r = await sb.from('network_stock_vehicles').select(cols).eq('contact_id', contactId).order('external_id').range(from, from + 999);
        if (r.error) return { rows, error: r.error.message as string };
        const batch = (r.data ?? []) as Prev[];
        rows.push(...batch);
        if (batch.length < 1000 || rows.length >= 100_000) break;
      }
      return { rows, error: null };
    };
    let prevRows: Prev[] | null = null;
    {
      const full = await readPrev('external_id, price, price_prev, first_seen_at, price_first, price_history');
      if (full.error) prevRows = (await readPrev('external_id, price, price_prev, first_seen_at')).rows;
      else prevRows = full.rows;
    }
    const prev = new Map<string, Prev>(((prevRows ?? []) as Prev[]).map((r) => [r.external_id, r]));
    let newCount = 0, priceChanges = 0;
    // MÊMES CLÉS SUR TOUTES LES LIGNES (constat Channing 01/10 : « null value
    // in column first_seen_at »). Un upsert groupé prend l'union des clés du
    // lot : une clé absente sur une ligne y vaut null. Hier les lots étaient
    // homogènes (tout nouveau, puis tout connu) ; au premier lot MIXTE, les
    // véhicules connus recevaient first_seen_at = null. On pose donc
    // explicitement first_seen_at (gardée) et price_prev (gardée ou nouvelle).
    const rows = stock.vehicles.map((v) => {
      const p = prev.get(v.external_id);
      if (!p) newCount++;
      const before = p?.price ?? null;
      const changed = !!p && before != null && v.price != null && before !== v.price;
      if (changed) priceChanges++;
      // MOUVEMENTS DE PRIX (01/10, demande Channing : « enregistrer pour
      // chaque véhicule les baisses, pour voir à la vente s'ils ont dû
      // baisser »). price_first = premier prix vu ; price_history = chaque
      // prix daté, du premier au courant. Ligne sans historique (relevés
      // d'avant le SQL) : reconstruit depuis price_prev / price.
      const seeded: Array<{ at: string; price: number }> = p?.price_history?.length ? [...p.price_history]
        : p ? [
          ...(p.price_prev != null && p.price_prev > 0 ? [{ at: p.first_seen_at, price: p.price_prev }] : []),
          ...(p.price != null && p.price > 0 ? [{ at: p.first_seen_at, price: p.price }] : []),
        ] : [];
      const history = [...seeded];
      if (v.price != null && v.price > 0 && (history.length === 0 || history[history.length - 1].price !== v.price)) history.push({ at: startedAt, price: v.price });
      const priceFirst = p?.price_first ?? history[0]?.price ?? null;
      return {
        contact_id: contactId, external_id: v.external_id, url: v.url, title: v.title, brand: v.brand, model: v.model,
        price: v.price, price_prev: changed ? before : (p?.price_prev ?? null), km: v.km, year: v.year, fuel: v.fuel, gearbox: v.gearbox,
        plate: v.plate, vin: v.vin, body: v.body, image: v.image, listed_at: v.listed_at,
        first_seen_at: p?.first_seen_at ?? startedAt, last_seen_at: startedAt, gone_at: null, last_run_id: runId,
        status: v.status, price_first: priceFirst, price_history: history,
        // Devise du site (06/10) : prix gardés tels quels, conversion à l'affichage.
        currency: v.currency ?? 'EUR',
      };
    });
    // Colonnes récentes (status 01/10, price_first / price_history 01/10 soir) :
    // tant que leur SQL n'est pas collé, on écrit sans elles — le relevé
    // passe, la colonne attend la migration. La colonne absente est lue dans
    // le message PostgREST, retirée de toutes les lignes, et on réessaie.
    const dropped = new Set<string>();
    const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !dropped.has(k)));
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200) as Array<Record<string, unknown>>;
      let error: { message: string } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        ({ error } = await sb.from('network_stock_vehicles').upsert(chunk.map(strip), { onConflict: 'contact_id,external_id' }));
        const missing = error && /schema cache|does not exist/i.test(error.message) ? error.message.match(/'([a-z_]+)' column/)?.[1] ?? error.message.match(/column "?([a-z_]+)"? /)?.[1] : null;
        if (!missing || dropped.has(missing)) break;
        dropped.add(missing);
        stock.warnings.push(`colonne ${missing} absente (SQL du 01/10 à coller) : non enregistrée`);
      }
      if (error) throw new Error(`écriture des véhicules : ${error.message}`);
    }
    // Disparus : vus avant, absents de ce relevé, pas encore marqués.
    const { data: gone } = await sb.from('network_stock_vehicles').update({ gone_at: startedAt, gone_run_id: runId })
      .eq('contact_id', contactId).is('gone_at', null).lt('last_seen_at', startedAt).select('id');
    const goneCount = ((gone ?? []) as unknown[]).length;
    await sb.from('network_stock_runs').update({ status: 'done', provider: stock.provider, total: stock.vehicles.length, new_count: newCount, gone_count: goneCount, price_changes: priceChanges, pages: stock.pages, warnings: stock.warnings, finished_at: new Date().toISOString() }).eq('id', runId);
    await sb.from('network_contacts').update({ stock_total: stock.vehicles.length }).eq('id', contactId);
    // Un relevé réussi ferme seul les cas « vitrine inconnue » / « relevé vide » de cet hôte.
    const host = new URL(url).hostname;
    void resolveLearningCase('dealer_site_unknown', host, `relevé réussi (${stock.provider}, ${stock.vehicles.length} véhicules)`);
    void resolveLearningCase('dealer_scan_empty', host, `relevé réussi (${stock.provider}, ${stock.vehicles.length} véhicules)`);
    console.warn(`[DEALER_STOCK] ${url} : ${stock.provider}, ${stock.vehicles.length} véhicules (${newCount} nouveaux, ${goneCount} disparus, ${priceChanges} prix changés) — ${submittedBy}`);
    return { provider: stock.provider, total: stock.vehicles.length, newCount, goneCount, priceChanges, pages: stock.pages, warnings: stock.warnings, runId };
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (e instanceof DealerSiteBlockedError) {
      const saved = await recordLearningCase({
        kind: 'dealer_site_blocked', key: e.site.host, url: e.site.url, link: '/carte', actor: 'dev', contactId, submittedBy,
        title: `Vitrine protégée (${e.site.guard}) : ${e.site.host}`,
        detail: { guard: e.site.guard, hint: 'lecture directe refusée (403) ; Zyte n\'a pas rendu la page ou n\'est pas disponible' },
      });
      msg += saved ? ' — cas enregistré dans la boîte à apprendre' : '';
    }
    if (e instanceof UnknownDealerSiteError) {
      const saved = await recordLearningCase({
        kind: 'dealer_site_unknown', key: e.site.host, url: e.site.url, link: '/carte', actor: 'dev', contactId, submittedBy,
        title: `Vitrine non reconnue : ${e.site.host}`,
        detail: { pageTitle: e.site.title, hints: e.site.hints, providersKnown: PROVIDERS_KNOWN },
      });
      msg += saved ? ' — vitrine enregistrée dans la boîte à apprendre (Centre de vérité → À apprendre) pour la traiter ensemble' : ' — boîte à apprendre indisponible (SQL du 01/10 à coller)';
    }
    await sb.from('network_stock_runs').update({ status: 'failed', error: msg.slice(0, 500), finished_at: new Date().toISOString() }).eq('id', runId);
    console.warn(`[DEALER_STOCK] ${url} : échec — ${msg}`);
    throw new Error(msg);
  }
}


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
import { powerFromText } from '../src/lib/powerText';

export type DealerProvider = 'dvnl' | 'dvapi' | 'datamotive' | 'dmapi' | 'autodata' | 'listerpage' | 'cmsms' | 'cartelcaw' | 'dtcvm' | 'carcards' | 'autrado' | 'carzilla' | 'hexon' | 'kamux' | 'openflex' | 'autopolis' | 'webspark' | 'catalogpager' | 'flexicar' | 'interstrip' | 'shopware' | 'wpcarsync' | 'divivoertuig' | 'carwp' | 'regeljelease' | 'vgrf' | 'yooflex' | 'dutchvans' | 'vehiclelistapi' | 'rswusato' | 'eveho' | 'jetlisting' | 'gatsbyvehicles' | 'autopalace';
const PROVIDERS_KNOWN: DealerProvider[] = ['dvnl', 'dvapi', 'datamotive', 'dmapi', 'autodata', 'listerpage', 'cmsms', 'cartelcaw', 'dtcvm', 'carcards', 'autrado', 'carzilla', 'hexon', 'kamux', 'openflex', 'autopolis', 'webspark', 'catalogpager', 'flexicar', 'interstrip', 'shopware', 'wpcarsync', 'divivoertuig', 'carwp', 'regeljelease', 'vgrf', 'yooflex', 'dutchvans', 'vehiclelistapi', 'rswusato', 'eveho', 'jetlisting', 'gatsbyvehicles', 'autopalace'];

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
  /** Puissance en chevaux (02/11) : donnée structurée du site, sinon lue dans le titre à l'enregistrement. */
  power_ch?: number | null;
  /** Lieu / agence affiché sur la carte (05/11, VPN Autos : sert à filtrer une agence du réseau). */
  location?: string | null;
}

/** Prix > 0 sinon null — un 0 € de site est un prix absent, pas un prix. */
const priceOrNull = (v: unknown): number | null => { const n = num(v); return n != null && n > 0 ? n : null; };
/** Chemin d'une adresse (« https://www.vanmossel.nl/voorraad/3473-… » → « /voorraad/3473-… »). */
const pathOfUrl = (u: string): string => { try { return new URL(u).pathname; } catch { return u.replace(/^https?:\/\/[^/]+/, ''); } };
/**
 * PRIX DANS LA CHARGE NUXT (14/11, contrôle de la règle du 13/11) : la page Nuxt 3 embarque
 * <script id="__NUXT_DATA__"> (format « devalue » : un tableau plat où chaque objet renvoie à ses valeurs par
 * indice). Chaque voiture y est un objet { id: "19926744-1", slug: "audi-q2-…-2018", price: { purchase: {
 * formatted: "€ 14.500", original: { amount }, discount: { isDiscounted } } } } — le prix d'achat structuré, rattaché
 * à la voiture par son adresse (/voorraad/<id>-<slug>), sans dépendre de l'ordre des montants dans le HTML.
 * Rend « <id>-<slug> » → prix d'achat en euros (> 0). Vide si la page n'a pas de charge Nuxt.
 */
export function nuxtPurchasePrices(html: string): Map<string, number> {
  const out = new Map<string, number>();
  const raw = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return out;
  let a: unknown[];
  try { a = JSON.parse(raw) as unknown[]; } catch { return out; }
  // Valeur d'un indice, enveloppes Reactive / Ref suivies (["Reactive", 12] → a[12]).
  const at = (i: unknown): unknown => {
    let x: unknown = typeof i === 'number' && i >= 0 && i < a.length ? a[i] : undefined;
    for (let k = 0; k < 4 && Array.isArray(x) && typeof x[0] === 'string' && /Ref|Reactive/.test(x[0]); k++) x = a[x[1] as number];
    return x;
  };
  const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
  for (const x of a) {
    const o = obj(x);
    if (!o || !('id' in o) || !('slug' in o) || !('price' in o)) continue;
    const id = at(o.id), slug = at(o.slug);
    const formatted = at(obj(at(obj(at(o.price))?.purchase))?.formatted);
    const eur = typeof formatted === 'string' ? priceOrNull(formatted) : null;
    if (typeof id === 'string' && typeof slug === 'string' && eur != null) out.set(`${id}-${slug}`, eur);
  }
  return out;
}
/** Dernier segment d'une adresse de fiche (« https://www.vanmossel.nl/voorraad/19926744-1-audi-q2-… » → « 19926744-1-audi-q2-… »). */
export const lastSegment = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
/** Prix lu dans chaque CARTE d'une liste : la page est découpée au premier lien de chaque véhicule (« /voorraad/… »),
 *  le premier montant « € 24.740 » du segment est celui de la carte (13/11, Van Mossel : 22 cartes, 22 prix). Le montant
 *  de la REMISE (« Jouw korting: € 7.610 ») et l'ANCIEN prix barré (<span class="… line-through">€ 60.600</span>) sont
 *  ôtés d'abord (18/11 : ID.7 enregistrée à 7 610 € au lieu de 52 990 €, 5008 à 6 800 € au lieu de 47 940 €). */
export function cardPricesByHref(html: string): Map<string, number> {
  const firsts = new Map<string, number>();
  for (const m of html.matchAll(/href="(\/[a-z-]+\/\d{5,}[^"]*)"/g)) if (!firsts.has(m[1])) firsts.set(m[1], m.index ?? 0);
  const order = [...firsts.entries()].sort((a, b) => a[1] - b[1]);
  const out = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    const seg = html.slice(order[i][1], i + 1 < order.length ? order[i + 1][1] : order[i][1] + 12_000)
      .replace(/<(\w+)[^>]*\bline-through\b[^>]*>[^<]*<\/\1>/g, ' ')
      .replace(/(?:korting|voordeel|remise|rabatt|sconto|descuento|discount|you save)[^€<]{0,30}€\s?[\d.\s]+/gi, ' ');
    const m = seg.match(/€\s?(\d{1,3}(?:[.\s]\d{3})+|\d{4,6})(?![\d,.])/);
    if (m) out.set(order[i][0], Number(m[1].replace(/[.\s]/g, '')));
  }
  return out;
}

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

async function getText(url: string, init?: RequestInit, opts?: { noZyte?: boolean }): Promise<{ status: number; text: string; headers: Headers }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  let direct: { status: number; text: string; headers: Headers };
  try {
    const res = await fetch(url, { ...init, headers: { 'user-agent': UA, 'accept-language': 'nl,en;q=0.8,fr;q=0.6', ...(init?.headers as Record<string, string> | undefined) }, signal: ctrl.signal, redirect: 'follow' });
    direct = { status: res.status, text: await res.text(), headers: res.headers };
  } finally { clearTimeout(t); }
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' || opts?.noZyte || !isChallenge(direct.status, direct.headers, direct.text)) return direct;
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
  // dtcvm « next » (Kooijman Autogroep, 09/11) : même plateforme (plugin voorraad de Powerkraut), mais la page
  // /occasion-voorraad/ est rendue par Vue dans <div id="nextVoorraad"> sans initialHits ; ses filtres sont dans
  // window.dtcVm.seoListingFilters → le lecteur relit la page classique /voorraad/ avec ces filtres.
  if (/id="nextVoorraad"/.test(html) && /window\.dtcVm\.seoListingFilters\s*=/.test(html)) return 'dtcvm';
  // Cartes HTML à attributs data-* (raevhede.dk 06/10 : <a class="car-card"
  // data-make data-model data-year data-price data-km …>, tout le stock sur
  // une page, filtres côté client).
  if (/<a[^>]+class="[^"]*\bcar-card\b[^"]*"[^>]+data-price=/.test(html)) return 'carcards';
  // autrado (Autexx, 08/10) : cartes <article class="c-vehicle" data-id>, images img.autrado.de.
  if (/class="c-vehicles-list__item/.test(html) && /class="c-vehicle\b[^"]*"[^>]*data-id="\d+"/.test(html)) return 'autrado';
  // carzilla (Bierschneider, 11/10) : cartes « cc-vehicle », contrôleur Angular ResultsItemController, pages « ?cp=N ».
  if (/class="cc-vehicle card/.test(html) && /cc-link-vehicle-detail/.test(html)) return 'carzilla';
  // hexon (Oostendorp Automotive, 14/10) : cartes <div class="card-car-slider" data-voertuignrhexon="…">, 21 par page, « ?from=21 ».
  if (/data-voertuignrhexon="\d+"/.test(html) && /card_content__title/.test(html)) return 'hexon';
  // kamux (Kamux, Finlande / Suède / Allemagne, 02/11) : Next.js, liste servie par /api/search (JSON) ; la page porte « outletPhoneNumberMap ».
  if (/"outletPhoneNumberMap"/.test(html) && /kamux/i.test(html)) return 'kamux';
  // openflex (Vikings Auto, 04/11) : liste PHP « listeproduits », cartes <a href="/occasions/…-<id>.html"> avec
  // <span class="nom">, <span class="vehiculeinfos">2016 / 123844km / Essence</span>, <span class="prix">, pages « entrant=N ».
  if (/class="vehiculeinfos"/.test(html) && /class="nom"/.test(html) && /entrant=\d+|résultat\(s\)/.test(html)) return 'openflex';
  // autopolis (autopolis.sk, 04/11) : cartes <div class="car-item"> avec car-item__title et paires paramètre/valeur, « strana=N ».
  if (/class="car-item__title"/.test(html) && /car-item__parameter-info/.test(html)) return 'autopolis';
  // autopalace (Auto Palace Bratislava, 18/11) : CMS maison « locator version2 » (data-domain-code), cartes
  // <div class="cell slice-N item …"> avec tags registration / mileage / fuel / power / vin, pages « /page:N ».
  if (/data-domain-code="[^"]+"/.test(html) && /class="cell slice-\d+ item/.test(html) && /class="tag vin"/.test(html)) return 'autopalace';
  // webspark / dealerk (Cobredia, 04/11) : WordPress + plugin webspark, cartes « vcard » data-id, paires label/info, « page=N ».
  // 04/11 : variante compacte (Bony, Sofibrie, Edenauto, SIPA) — pas d'étiquettes, la ligne « 12/2025 - 10 Km - Hybride »
  // est dans vcard-consumption__title.
  if (/vcard-main-info__make-model/.test(html) && /vcard-submain-info__label|vcard-consumption__title|vcard-icons-info__item-label/.test(html)) return 'webspark';
  // flexicar (ES, 04/11) : Next.js, la liste vient de services.flexicar.es/api/v1/vehicles (12 par page).
  if (/__NEXT_DATA__/.test(html) && /"initialVehicles"/.test(html) && /flexicar\.(es|pt)/i.test(html)) return 'flexicar';
  // interstrip (DE, 04/11) : Next.js rendu serveur, grille « vehicle-grid », photos mobile.de (classistatic).
  if (/class="vehicle-grid/.test(html) && /img\.classistatic\.de/.test(html)) return 'interstrip';
  // shopware (Bleker, 04/11) : boutique Shopware, cartes « product-box box-vehicle », pages « p=N ».
  if (/product-box box-vehicle/.test(html) && /Fahrzeugnr\./.test(html)) return 'shopware';
  // wpcarsync (Voets, 04/11) : WordPress + plugin wpcarsync, cartes « voets_single_vehicle », pages « /page/N/ ».
  if (/voets_single_vehicle/.test(html) && /price_brutto/.test(html)) return 'wpcarsync';
  // divivoertuig (Van Dijk, 04/11) : WordPress Divi, cartes <article class="item"> avec « voertuig-prijs ».
  if (/class="voertuig-prijs"/.test(html) && /class="item-content"/.test(html)) return 'divivoertuig';
  // carwp (C.A.R, 04/11) : WordPress maison, une page par marque « /occasions/occasions-<marque>/ », cartes data-ref.
  if (/class="vo car-name"/.test(html) && /class="vo car-prix"/.test(html)) return 'carwp';
  // regeljelease (Van der Wal Vans, 04/11) : cartes « card-click » data-advertiser-id, pages « ?page=N ».
  if (/card-click/.test(html) && /data-advertiser-id="/.test(html)) return 'regeljelease';
  // vgrf (Škoda Nantes, 04/11) : Joomla VGRF, cartes « ListeNewVoiture », pages « start=N » par 12.
  if (/data-vgrf-module="VehiculesFilterNew"/.test(html) && /ListeNewVoiture/.test(html)) return 'vgrf';
  // yooflex (Groupe Hecquet, 04/11) : WordPress YOOtheme + flux openflex, cartes « result-item », pages « ?paged=N ».
  if (/class="result-item"/.test(html) && /filerender-api\.openflex\.eu/.test(html) && /id="veh-grid"/.test(html)) return 'yooflex';
  // dutchvans (NL, 04/11) : WordPress maison, cartes « item-summary » + « vehicle-specs », pages « ?pagina=N ».
  if (/item-summary/.test(html) && /class="vehicle-specs"/.test(html)) return 'dutchvans';
  // vehiclelistapi (Gruppo Bossoni, 04/11) : liste Vue rendue côté client, l'API du site « /api/filtered-vehicle-list »
  // livre tout (4 017 voitures par pages de 500) avec lien, version, prix, km, année, énergie, boîte, puissance, photo.
  if (/filteredVehicleListUrl\s*=\s*"\/api\/filtered-vehicle-list"/.test(html)) return 'vehiclelistapi';
  // rswusato (Gruppo Ghedini, 04/11) : WordPress thème rswstarter, cartes « card vehicle … usato » avec vehicle-brand /
  // vehicle-model / vehicle-version / vehicle-date / vehicle-km / vehicle-fuel / vehicle-gear / price, pages « /page/N/ ».
  if (/class="card vehicle[^"]*"/.test(html) && /class="vehicle-brand"/.test(html) && /class="[^"]*\bvehicle-km\b/.test(html)) return 'rswusato';
  // eveho (VPN Autos, 05/11) : Nuxt rendu serveur, cartes « component-single-vehicle » (marque/modèle, version, prix,
  // « filedKmYear » km et année, « otherFields » énergie et boîte, lieu), 23 par page « ?page=N », « N résultats ».
  if (/class="component-single-vehicle"/.test(html) && /filedKmYear/.test(html)) return 'eveho';
  // jetlisting (Regge Autogroep, 09/11) : WordPress + Elementor + JetEngine, cartes « jet-listing-grid__item » avec
  // data-url, titre <h3> (marque modèle), <p> version, champs dynamiques (km, année, énergie, boîte, prix), pages « /page/N/ ».
  if (/class="jet-listing-grid__item /.test(html) && /jet-engine-listing-overlay-wrap" data-url="/.test(html) && /jet-listing-dynamic-field__content/.test(html)) return 'jetlisting';
  // gatsbyvehicles (Autobedrijf Wijnne, 09/11) : site Gatsby « gatsby-theme-vehicles » (Strapi derrière) — la liste se
  // charge en GraphQL dans le navigateur, mais chaque fiche est générée à la construction du site : le plan de site
  // (sitemap-0.xml) donne les fiches, et /page-data/<fiche>/page-data.json contient la voiture entière. Sans clé.
  if (/id="___gatsby"/.test(html) && /gatsby-theme-vehicles/.test(html)) return 'gatsbyvehicles';
  // catalogpager (Groupe DMD, 04/11) : site Symfony maison, cartes <a class="fiche_vehicule">, pages chargées en POST
  // sur « /ajax/search?flag=html » avec filters[page]=N (liens « catalog-pager-link » data-page).
  if (/class="fiche_vehicule/.test(html) && /catalog-pager-link/.test(html) && /data-ajax-request-search="/.test(html)) return 'catalogpager';
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
    // Puissance (02/11) : attributs dvnl « vermogen_pk » / « vermogen » (pk) ou « vermogen_kw ».
    power_ch: num(a('vermogen_pk')) ?? num(a('vermogen')) ?? (num(a('vermogen_kw')) != null ? Math.round((num(a('vermogen_kw')) as number) * 1.35962) : null),
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
  // ORDRE STABLE (De Waal Autogroep 26/10, 1 547 annoncés) : sans tri, l'API sert ses pages dans un ordre
  // qui peut bouger entre deux appels — une voiture glisse d'une page à l'autre et manque au relevé.
  // Le tri de la page vitrine (?sort=price_asc) est repris ; sinon « created_at_asc » (le plus stable,
  // proposé par cette famille d'API). Un tri refusé (HTTP ≠ 200) est abandonné, la lecture continue.
  const pageSort = new URL(url).searchParams.get('sort');
  let sort: string | null = pageSort || 'created_at_asc';
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let page = 1;
  for (; page <= MAX_PAGES; page++) {
    api.searchParams.set('page', String(page));
    if (sort) api.searchParams.set('sort', sort); else api.searchParams.delete('sort');
    let res = await getText(api.toString(), { headers: { accept: 'application/json', referer: url } });
    if (res.status !== 200 && sort && page === 1) {
      warnings.push(`tri « ${sort} » refusé par l'API (HTTP ${res.status}) — lecture sans tri`);
      sort = null; api.searchParams.delete('sort');
      res = await getText(api.toString(), { headers: { accept: 'application/json', referer: url } });
    }
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
  // Pages servies INCOMPLÈTES (De Waal 26/10 : « count » 1 547, pages de 100 qui n'en livrent que 87 à 97,
  // 1 425 voitures au total — le site lui-même n'en montre pas plus : il filtre APRÈS avoir découpé les
  // pages). Dit tel quel dans le bilan, pour que l'écart ne passe pas pour un relevé tronqué.
  if (total != null && out.length < total) warnings.push(`${out.length} véhicule(s) servi(s) par le site pour ${total} annoncé(s) — ses pages sont incomplètes (il écarte des voitures après la pagination), rien de plus n'est visible`);
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
  // PRIX NON PUBLIÉS (13/11, Auto Smeeing : 339 voitures sur 1 054 sans prix — la fiche affiche « Op aanvraag » et son
  // JSON-LD « price »: "0.00") : absents sur le site, pas mal lus ; dit dans le bilan pour que l'écart ne passe pas pour une panne.
  const onRequest = out.filter((v) => v.price == null && v.status === 'price_on_request').length;
  if (onRequest) warnings.push(`${onRequest} voiture(s) sans prix publié par le site (« op aanvraag » : prix sur demande)`);
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
/** Année d'un Car JSON-LD : URL « -occasion-2023- » (BYMYCAR), sinon 1re immatriculation schema.org
 *  « dateVehicleFirstRegistered » (13/11, Jazzoni / Romana Auto : "2023-07-31" sur 53 / 53 voitures, ni modelDate ni
 *  année dans l'URL — année lue 0 %), sinon modelDate / productionDate (« 1970 » = bouche-trou, ignoré). */
export function ldCarYear(item: Record<string, unknown>, url: string): number | null {
  const yearFromUrl = num(url.match(/-(?:occasion|used|gebruikt)-((?:19|20)\d{2})-/)?.[1]);
  const firstReg = num(String(item.dateVehicleFirstRegistered ?? '').match(/\b((?:19|20)\d{2})\b/)?.[1]);
  const modelDate = num(String(item.modelDate ?? item.productionDate ?? item.vehicleModelDate ?? '').slice(0, 4));
  return yearFromUrl ?? (firstReg != null && firstReg > 1970 ? firstReg : null) ?? (modelDate != null && modelDate > 1980 ? modelDate : null);
}
/** Progression d'un relevé long (03/11) : pages lues et véhicules déjà lus, pour le bilan en cours. */
export type StockProgress = (pages: number, vehicles: number, pagesTotal: number | null) => void;
async function scrapeDatamotive(url: string, firstHtml: string, onProgress?: StockProgress): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  // API DATAMOTIVE (14/11, Century / Emil Frey : km, année, énergie, boîte à 0 %, Emil Frey lu à 153 / 4 582) : une
  // page Next.js Datamotive dit dans son flux RSC quelle liste elle affiche ; l'API la rend entière, attributs compris.
  // Les pages JSON-LD ci-dessous ne servent plus que de secours si l'API ne répond pas.
  const dm = datamotiveListConfig(firstHtml, url);
  if (dm) {
    const { complete, ...viaApi } = await scrapeDatamotiveApi(url, dm, 'datamotive', dmIdLikeJsonLd, onProgress);
    if (complete && viaApi.vehicles.length > 0) return viaApi;
    warnings.push(...viaApi.warnings, `API Datamotive incomplète (${viaApi.vehicles.length} / ${viaApi.declared ?? '?'}) : relevé par les pages JSON-LD`);
  }
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
  const readPage = async (page: number): Promise<{ parsed: ReturnType<typeof parseItemList>; status: number; html?: string }> => {
    let status = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(1500);
      const r = await getText(withPage(url, page));
      status = r.status;
      const parsed = r.status === 200 ? parseItemList(r.text) : null;
      if (parsed) return { parsed, status, html: r.text };
    }
    return { parsed: null, status };
  };
  // PAGES LUES PAR LOTS DE 4 EN PARALLÈLE (03/11, constat Channing : BYMYCAR « tourne depuis plusieurs
  // minutes » — 6 489 voitures = 541 pages de 12, à 3,5 s la page une par une : plus de 25 min). Les lots se
  // suivent dans l'ordre ; le premier trou (page vide, 404, échec) arrête la lecture comme avant.
  const PARALLEL = 4;
  let stop = false;
  const pagesTotal = total != null && perPage > 0 ? Math.min(pagesCap, Math.ceil(total / perPage)) : null;
  const handlePage = (page: number, got: { parsed: ReturnType<typeof parseItemList>; status: number; html?: string }): boolean => {
    const parsed = got.parsed;
    pages = page;
    // PRIX DE LA CARTE (13/11, Channing : Van Mossel « les prix de vente n'ont pas été enregistrés ») : le JSON-LD de
    // vanmossel.nl n'a pas d'offre, mais chaque carte affiche « Kopen € 24.740 » — lu à côté du lien du véhicule.
    const cardPrices = got.html ? cardPricesByHref(got.html) : new Map<string, number>();
    const nuxtPrices = got.html ? nuxtPurchasePrices(got.html) : new Map<string, number>();
    // 404 = au-delà de la dernière page (Century : page 101 sur 100), fin normale.
    if (!parsed) { if (got.status !== 404) warnings.push(`arrêt à la page ${page} : HTTP ${got.status} ou JSON-LD absent — relevé partiel`); return false; }
    if (parsed.items.length === 0) return false;
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
      const year = ldCarYear(item, u);
      out.push({
        external_id: id, url: u || null, title: name, brand: brand || splitTitle(name).brand, model: item.model ? String(item.model) : splitTitle(name).model,
        price: priceOrNull(offers.price) ?? (nuxtPrices.get(lastSegment(u)) ?? cardPrices.get(pathOfUrl(u))) ?? null, km, year, fuel: item.fuelType ? String(item.fuelType) : null,
        gearbox: item.vehicleTransmission ? String(item.vehicleTransmission) : null, plate: null,
        vin: item.vehicleIdentificationNumber ? String(item.vehicleIdentificationNumber) : null, body: item.bodyType ? String(item.bodyType) : null,
        image: Array.isArray(item.image) ? String(item.image[0] ?? '') || null : item.image ? String(item.image) : null, listed_at: null,
        // schema.org : InStock = en vente ; PreOrder = attendue ; SoldOut /
        // OutOfStock = vendue ; prix absent = sur demande.
        status: /preorder/i.test(String(offers.availability ?? '')) ? 'expected'
          : /soldout|outofstock|discontinued/i.test(String(offers.availability ?? '')) ? 'sold'
            : priceOrNull(offers.price) == null && (nuxtPrices.get(lastSegment(u)) ?? cardPrices.get(pathOfUrl(u))) == null ? 'price_on_request' : null,
      });
    }
    if (added === 0) { if (total != null && out.length < total) warnings.push(`page ${page} : aucun véhicule nouveau — arrêt à ${out.length} / ${total}`); return false; }
    if (total != null && out.length >= total) return false;
    return true;
  };
  if (!handlePage(1, { parsed: first, status: 200, html: firstHtml })) stop = true;
  first = null;
  onProgress?.(pages, out.length, pagesTotal);
  for (let page = 2; page <= pagesCap && !stop; page += PARALLEL) {
    const batch = Array.from({ length: Math.min(PARALLEL, pagesCap - page + 1) }, (_, k) => page + k);
    const results = await Promise.all(batch.map((pg) => readPage(pg)));
    for (let k = 0; k < batch.length; k++) {
      if (!handlePage(batch[k], results[k])) { stop = true; break; }
    }
    onProgress?.(pages, out.length, pagesTotal);
    if (!stop) await sleep(PAGE_DELAY_MS);
  }
  if (out.length > 0 && out.every((v) => v.km == null)) warnings.push('Ce fournisseur ne publie ni km ni année dans la liste (fiche détaillée seulement).');
  return { provider: 'datamotive', total: total ?? out.length, declared: total, vehicles: out, pages, warnings };
}

// ── Plateforme Datamotive : API publique de contenu (preuve 14/11) ──────────
// Les sites Datamotive (Century, Emil Frey : Next.js ; Pon Center : data-vehicle-overview) chargent leur liste par
// GET https://api.datamotive.nl/api/v1/content/vehicle-list/<liste>?filterId=…&page=N&pageSize=48 — sans clé
// (l'en-tête Authorization n'existe que pour un client connecté). Leur JS ajoute attributes[]=fuel&
// attributes[]=odometerReading&attributes[]=yearOfConstruction&attributes[]=transmission… : SANS ce paramètre l'API ne
// rend AUCUN attribut (d'où km, année, énergie, boîte à 0 % chez Century, Emil Frey et Pon). 48 par page au plus
// (pageSize=100 → HTTP 400) : Century 1 194 voitures = 25 pages au lieu de 100 pages JSON-LD de 12.
const DM_ATTRIBUTES = ['fuel', 'odometerReading', 'yearOfConstruction', 'transmission', 'licensePlate', 'vehicleNumber', 'vehicleState', 'stockStatus', 'bodyType'];
/** Libellés affichés par les sites (table « fuel.value » de la page Century : gasoline → Benzine…). */
const DM_FUEL: Record<string, string> = {
  gasoline: 'Benzine', petrol: 'Benzine', diesel: 'Diesel', electric: 'Elektrisch', hybrid: 'Hybride', hybrid_gasoline: 'Hybride benzine',
  hybrid_diesel: 'Hybride diesel', lpg: 'LPG', lpg_g3: 'LPG G3', lpg_g_3: 'LPG G3', cng: 'CNG', hydrogen: 'Waterstof', cryogenic: 'Cryogeen',
};
/** Boîte : manual = Handgeschakeld ; automatic, semi_automatic (robotisée), cvt = automatique ; unknown = inconnue. */
const DM_GEARBOX: Record<string, string | null> = { automatic: 'Automatique', semi_automatic: 'Automatique', cvt: 'Automatique', manual: 'Manuelle', unknown: null };
export interface DmApiItem {
  id?: number | string; brand?: string; model?: string; edition?: string; slug?: string; establishment?: string;
  attributes?: Record<string, unknown> | null; prices?: { purchase?: { value?: unknown; previousValue?: unknown } } | null;
  media?: Array<{ type?: string; url?: string }> | null;
}
/** Une voiture de l'API (ou d'« initialItems » de la page) → DealerVehicle ; `idOf` garde l'identifiant historique du lecteur. */
export function dmItemToVehicle(it: DmApiItem, origin: string, idOf: (it: DmApiItem) => string): DealerVehicle | null {
  const id = idOf(it).trim();
  if (!id) return null;
  const a = (it.attributes ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : null);
  const price = priceOrNull(it.prices?.purchase?.value);
  const title = [it.brand, it.model, it.edition].filter(Boolean).join(' ').trim();
  const guess = splitTitle(title);
  const fuel = str('fuel'), gear = str('transmission'), stock = str('stockStatus'), year = num(a.yearOfConstruction);
  return {
    external_id: id, url: it.slug ? `${origin}/p/${it.slug}` : null, title,
    brand: it.brand || guess.brand, model: it.model || guess.model, price,
    km: num(a.odometerReading), year: year != null && year > 1950 ? year : null,
    fuel: fuel && fuel !== 'other' ? DM_FUEL[fuel] ?? fuel : null,
    gearbox: gear ? (gear in DM_GEARBOX ? DM_GEARBOX[gear] : gear) : null,
    plate: str('licensePlate'), vin: null, body: str('bodyType'), image: it.media?.find((m) => m.type === 'image')?.url ?? null, listed_at: null,
    status: stock === 'expected' ? 'expected' : stock === 'reserved' ? 'reserved' : stock === 'sold' ? 'sold' : price == null ? 'price_on_request' : null,
  };
}
/** Identifiant historique du lecteur JSON-LD (sku = attributes.vehicleNumber, sinon l'id de l'adresse « …-58143613-161 »). */
export const dmIdLikeJsonLd = (it: DmApiItem) => String((it.attributes as { vehicleNumber?: unknown } | null)?.vehicleNumber ?? it.id ?? '');
/** Identifiant historique du lecteur dmapi (Pon) : l'id Datamotive. */
export const dmIdLikeDmApi = (it: DmApiItem) => String(it.id ?? '');
/** Texte du flux RSC d'une page Next.js (App Router) : chaînes des self.__next_f.push([1,"…"]) mises bout à bout. */
export function rscText(html: string): string {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try { const a = JSON.parse(m[1]) as unknown[]; if (typeof a[1] === 'string') out += a[1]; } catch { /* morceau suivant */ }
  }
  return out;
}
/** Valeur JSON (objet ou tableau) qui commence à `at` dans un texte plus long, bornée en suivant crochets et chaînes. */
export function jsonAt(s: string, at: number): unknown {
  if (s[at] !== '{' && s[at] !== '[') return null;
  let depth = 0, inStr = false;
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(at, i + 1)); } catch { return null; } } }
  }
  return null;
}
export interface DmListConfig { api: string; filterId: string | null; params: Array<[string, string]>; sort: string }
/** Filtres imbriqués → paires « clé[sous-clé]=valeur » (vehicleState: { used: '' } → vehicleState[used]=). */
const qsPairs = (v: unknown, prefix: string, out: Array<[string, string]>): Array<[string, string]> => {
  if (Array.isArray(v)) v.forEach((x) => qsPairs(x, `${prefix}[]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) qsPairs(x, prefix ? `${prefix}[${k}]` : k, out);
  else if (prefix) out.push([prefix, v == null ? '' : String(v)]);
  return out;
};
/** Liste Datamotive d'une page Next.js, lue dans le flux RSC : « "vehicleListId":275,"vehicleFilterId":40 », les filtres
 *  appliqués par la page (« "initialValues":{"vehicleState":{"used":""}} », Emil Frey), le tri et l'adresse de l'API
 *  (« "DATAMOTIVE_API_ENDPOINT":"https://api.datamotive.nl" »). null = pas une page Datamotive Next.js. */
export function datamotiveListConfig(html: string, pageUrl: string): DmListConfig | null {
  const rsc = rscText(html);
  const ids = rsc.match(/"vehicleListId":(\d+),"vehicleFilterId":(\d+|null)/);
  const base = rsc.match(/"DATAMOTIVE_API_ENDPOINT":"(https:\/\/[^"]+)"/)?.[1];
  if (!ids || ids.index == null || !base) return null;
  const tail = rsc.slice(ids.index);
  const iv = tail.indexOf('"initialValues":');
  const values = iv >= 0 ? jsonAt(tail, iv + '"initialValues":'.length) : null;
  const sort = new URL(pageUrl).searchParams.get('sorting') || tail.match(/"initialSorting":"([a-z_]+)"/)?.[1] || 'created_at_desc';
  return { api: `${base.replace(/\/+$/, '')}/api/v1/content/vehicle-list/${ids[1]}`, filterId: ids[2] === 'null' ? null : ids[2], params: qsPairs(values ?? {}, '', []), sort };
}
/** Voitures embarquées dans la page (« "initialItems":[…] » du flux RSC, 12 par page, attributs compris). */
export function datamotiveRscItems(html: string): DmApiItem[] {
  const rsc = rscText(html);
  const at = rsc.indexOf('"initialItems":');
  const v = at >= 0 ? jsonAt(rsc, at + '"initialItems":'.length) : null;
  return Array.isArray(v) ? (v as DmApiItem[]) : [];
}
/**
 * Tout le stock d'une liste Datamotive par l'API, 48 par page, une page à la fois ; total annoncé = « count ».
 * TRI INSTABLE (14/11) : les voitures importées ensemble partagent created_at (et bien des prix sont égaux) ; l'API
 * pagine sans départage, si bien qu'une lecture rend quelques voitures deux fois et en saute autant (Pon : 670
 * éléments, 666 voitures en created_at_desc ; Century 1 189 / 1 194 ; Emil Frey 4 577 / 4 582 — et en pages HTML de 12,
 * des pages entières de doublons : relevés Emil Frey coupés à 68, 153, 216, 341, 721 / ≈ 4 500). Une page sans voiture
 * nouvelle n'arrête donc PAS la lecture ; et s'il manque des voitures, une lecture dans un autre tri complète (union
 * des deux tris : Century 1 194 / 1 194, Pon 670 / 670).
 */
export async function scrapeDatamotiveApi(url: string, cfg: DmListConfig, provider: 'datamotive' | 'dmapi', idOf: (it: DmApiItem) => string, onProgress?: StockProgress): Promise<DealerStockResult & { complete: boolean }> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let declared: number | null = null, pages = 0, complete = true;
  for (const sort of [...new Set([cfg.sort, 'price_asc', 'created_at_desc'])]) {
    let pagesTotal: number | null = null, done = false;
    for (let page = 1; page <= 400; page++) {
      const api = new URL(cfg.api);
      if (cfg.filterId) api.searchParams.set('filterId', cfg.filterId);
      api.searchParams.set('page', String(page));
      api.searchParams.set('pageSize', '48');
      api.searchParams.set('sort', sort);
      for (const [k, v] of cfg.params) api.searchParams.append(k, v);
      for (const a of DM_ATTRIBUTES) api.searchParams.append('attributes[]', a);
      const init = { headers: { accept: 'application/json', 'accept-language': 'nl-NL', referer: url, origin } };
      let res = await getText(api.toString(), init);
      if (res.status !== 200) { await sleep(1500); res = await getText(api.toString(), init); }
      if (res.status !== 200) { warnings.push(`API Datamotive (${sort}), page ${page} : HTTP ${res.status}`); break; }
      let d: { count?: number; pages?: { total?: number }; items?: DmApiItem[] };
      try { d = JSON.parse(res.text); } catch { warnings.push(`API Datamotive (${sort}), page ${page} : réponse illisible`); break; }
      pages++;
      declared = num(d.count) ?? declared;
      pagesTotal = num(d.pages?.total) ?? pagesTotal;
      const items = d.items ?? [];
      for (const it of items) {
        const v = dmItemToVehicle(it, origin, idOf);
        if (!v || seen.has(v.external_id)) continue;
        seen.add(v.external_id); out.push(v);
      }
      onProgress?.(pages, out.length, pagesTotal);
      if (items.length === 0 || (pagesTotal != null && page >= pagesTotal)) { done = true; break; }
      await sleep(Math.max(PAGE_DELAY_MS, 350)); // politesse : 350 ms au moins entre deux pages d'un site
    }
    if (!done) { complete = false; break; } // lecture coupée (HTTP, réponse illisible) : pas de seconde lecture
    if (declared == null || out.length >= declared) break;
  }
  if (!complete) warnings.push(`API Datamotive : lecture coupée à ${out.length} / ${declared ?? '?'} — relevé partiel`);
  else if (declared != null && out.length < declared) warnings.push(`${out.length} voiture(s) lue(s) pour ${declared} annoncée(s) par l'API (tri instable du site, deux lectures)`);
  return { provider, total: declared ?? out.length, declared, vehicles: out, pages, warnings, complete };
}

// ── dmapi (Pon Center — API Datamotive, preuve 02/10 ; attributs 14/11) ─────
// La page porte data-vehicle-overview='{"dmUpdateUrl":"https://api.datamotive.nl/api/v1/content/vehicle-list/3188",
// "dmFilterSetId":302,…}' ; occasions seulement quand la page le demande (sources[]=Occasions ou chemin « occasion ») :
// vehicleState[used]=1. Même lecture que les pages Next.js Datamotive (scrapeDatamotiveApi), identifiant historique gardé.
export async function scrapeDmApi(url: string, firstHtml: string): Promise<DealerStockResult> {
  const raw = firstHtml.match(/data-vehicle-overview='([^']*)'/)?.[1] ?? firstHtml.match(/data-vehicle-overview="([^"]*)"/)?.[1];
  let cfg: { dmUpdateUrl?: string; dmFilterSetId?: number; sort?: string } = {};
  try { cfg = JSON.parse(decode(raw ?? '{}')); } catch { /* lu plus bas */ }
  if (!cfg.dmUpdateUrl) return { provider: 'dmapi', total: null, declared: null, vehicles: [], pages: 0, warnings: ['dmUpdateUrl introuvable dans data-vehicle-overview'] };
  const u = new URL(url);
  const usedOnly = /occasion/i.test(u.pathname) || [...u.searchParams.values()].some((v) => /occasion/i.test(v));
  const { complete: _complete, ...r } = await scrapeDatamotiveApi(url, {
    api: cfg.dmUpdateUrl, filterId: cfg.dmFilterSetId != null ? String(cfg.dmFilterSetId) : null,
    params: usedOnly ? [['vehicleState[used]', '1']] : [], sort: cfg.sort || 'created_at_desc',
  }, 'dmapi', dmIdLikeDmApi);
  return r;
}
/** Fiche détail Datamotive (secours pour DETAIL_READERS, si l'API ne répond plus) : paires « Transmissie | Handgeschakeld »
 *  — Century / Emil Frey : <span>Label</span><span class="…spec__value">…</span> ; Pon : <dt>Label</dt><dd>…</dd>. */
export function readDatamotiveDetail(html: string): { gearbox?: string | null; fuel?: string | null; km?: number | null; year?: number | null } {
  const spec = (label: string) => unesc(html.match(new RegExp(`>\\s*${label}\\s*</(?:span|dt)>\\s*<(?:span|dd)[^>]*>\\s*([^<]+?)\\s*<`, 'i'))?.[1] ?? '') || null;
  const g = spec('Transmissie');
  return {
    gearbox: !g ? null : /handgeschakeld|manu/i.test(g) ? 'Manuelle' : /automa|cvt/i.test(g) ? 'Automatique' : g,
    fuel: spec('Brandstof'), km: num(spec('Kilometerstand')?.replace(/\D/g, '')), year: num(spec('Bouwjaar')?.match(/\b(?:19|20)\d{2}\b/)?.[0]),
  };
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
function parseDtcVm(html: string): { total: number | null; from: number; size: number; orderby: string | null; hits: DtcHit[] } | null {
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
          const d = JSON.parse(html.slice(start, i + 1)) as { hits?: { total?: unknown; from?: unknown; size?: unknown; orderby?: unknown; hits?: unknown } };
          const h = d.hits ?? {};
          return { total: num(h.total), from: num(h.from) ?? 0, size: num(h.size) ?? 0, orderby: typeof h.orderby === 'string' ? h.orderby : null, hits: Array.isArray(h.hits) ? (h.hits as DtcHit[]) : [] };
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
/** Filtres de la page « next » (window.dtcVm.seoListingFilters, JSON dans une chaîne JS) → paramètres de /voorraad/. */
function dtcNextFilters(html: string): string | null {
  const m = html.match(/window\.dtcVm\.seoListingFilters\s*=\s*JSON\.parse\('([^']*)'\)/);
  if (!m) return null;
  try {
    const f = JSON.parse(m[1].replace(/\\'/g, "'")) as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(f)) {
      if (Array.isArray(v)) for (const x of v) parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(String(x))}`);
      else if (v != null && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.join('&');
  } catch { return null; }
}

async function scrapeDtcVm(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  // Page « next » sans initialHits (Kooijman, 09/11) : on relit la page classique /voorraad/ avec les mêmes filtres.
  if (!/window\.dtcVm\.initialHits\s*=/.test(firstHtml) && /id="nextVoorraad"/.test(firstHtml)) {
    const filters = dtcNextFilters(firstHtml);
    const classic = `${new URL(url).origin}/voorraad/${filters ? `?${filters}` : ''}`;
    const r = await getTextPatient(classic);
    if (r.status !== 200 || !/window\.dtcVm\.initialHits\s*=/.test(r.text)) return { provider: 'dtcvm', total: null, declared: null, vehicles: [], pages: 1, warnings: [`page classique ${classic} illisible (HTTP ${r.status})`] };
    warnings.push(`vitrine « next » : lue par la page classique ${classic}`);
    url = classic; firstHtml = r.text;
  }
  const first = parseDtcVm(firstHtml);
  if (!first) return { provider: 'dtcvm', total: null, declared: null, vehicles: [], pages: 1, warnings: ['bloc dtcVm.initialHits illisible'] };
  const total = first.total;
  const u = new URL(url);
  // TRI ALÉATOIRE (Bochane Groep 09/11 : « orderby=random », 60 lues sur 2 143 — chaque page remélange, les mêmes
  // voitures reviennent et la lecture s'arrête « aucun véhicule nouveau ») : on pagine sur un tri STABLE, la date
  // d'ajout (« created-desc », présent sur tous les sites dtcVm). La taille de page est celle du site (10 chez Bochane,
  // le paramètre size y est ignoré) : 215 pages, lues l'une après l'autre.
  const randomSort = /random/i.test(u.searchParams.get('orderby') ?? '') || /random/i.test(first.orderby ?? '');
  const size = first.size > 0 ? first.size : Number(u.searchParams.get('size') || 12);
  if (randomSort) warnings.push('tri « au hasard » de la vitrine remplacé par la date d\'ajout pour lire toutes les pages');
  // PAS de « from » du site : Bochane sert 10 voitures par page mais ses liens de pages avancent de 12, et le serveur
  // convertit « from » en page (arrondi au-dessus) × 10 — from=60 rendait la page 50 : doublons, arrêt à 60 / 2 143.
  // On avance donc du pas des liens de pagination de la vitrine (12 chez Bochane, = size ailleurs).
  const linkSteps = [...firstHtml.matchAll(/[?&;](?:amp;)?from=(\d+)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
  const step = linkSteps.length ? Math.min(...linkSteps) : size;
  const pagesCap = total != null && size > 0 ? Math.min(400, Math.ceil(total / size)) : MAX_PAGES;
  let pages = 0;
  let lastFrom = -1;
  for (let page = 1; page <= pagesCap; page++) {
    let parsed = page === 1 && !randomSort ? first : null;
    if (!parsed) {
      const pu = new URL(url);
      if (randomSort) pu.searchParams.set('orderby', 'created-desc');
      pu.searchParams.set('from', String((page - 1) * step));
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
    if (parsed!.from <= lastFrom && page > 1) { warnings.push(`page ${page} : le site renvoie encore la position ${parsed!.from} — arrêt à ${out.length} / ${total ?? '?'}`); break; }
    lastFrom = parsed!.from;
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
      power_ch: ps ? num(ps) : kw ? Math.round((num(kw) ?? 0) * 1.35962) || null : null,
    });
    void delivery;
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

// ── carzilla (Auto Bierschneider, www.bierschneider.de) ──────────────────────
// Constat 11/10 (boîte à apprendre « Vitrine non reconnue ») : plateforme
// carzilla — <div class="cc-vehicle card"> avec le titre dans
// <a class="cc-link-vehicle-detail" href="/fahrzeuge/…/detail/seat/ibiza/
// gebrauchtwagen/6231644/?of=SalePrice">, attributs à tooltip (Status,
// Getriebe, Kraftstoff, « EZ 04/2021 », « 92.025 km », « 66 kW / 90 PS »,
// carrosserie, couleur), prix « 10.140,‑ € », « MwSt. ausweisbar »,
// « ehem. UPE ». 20 par page, « 1 - 20 von 5973 Treffern », pages « ?cp=N »
// (299 pages : lecture directe, sans Zyte, ~4 min). Prix TTC allemands.
export function parseCarzillaCards(html: string, origin: string): DealerVehicle[] {
  const out: DealerVehicle[] = [];
  const text = (s: string) => unesc(s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  const parts = html.split(/<div class="cc-vehicle card/);
  for (let i = 1; i < parts.length; i++) {
    const card = parts[i];
    const link = card.match(/<a class="cc-link-vehicle-detail"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const href = unesc(link[1]);
    const id = href.match(/\/(\d{5,})\/?(?:\?|$)/)?.[1] ?? href.match(/vid=(\d+)/)?.[1];
    if (!id) continue;
    const title = text(link[2]);
    const url = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
    const tip = (label: string): string | null => {
      const m = card.match(new RegExp(`title="${label}"[^>]*>([\\s\\S]*?)<\\/span>`));
      return m ? text(m[1]) || null : null;
    };
    const t = text(card);
    const status = tip('Status');
    const gear = tip('Getriebe') ?? '';
    const fuel = tip('Kraftstoff');
    const ez = (tip('Erstzulassung') ?? '').match(/(\d{2})\/(\d{4})/);
    const km = num((tip('Kilometerstand') ?? '').replace(/\./g, ''));
    // Prix courant : « <strong>10.140,&#8209;&nbsp;&euro;</strong> » dans le span
    // cc-vehicle__price--current (l'« ehem. UPE » barré est un autre span).
    const cur = card.match(/cc-vehicle__price--current[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '';
    const price = priceOrNull(cur.match(/(\d{1,3}(?:\.\d{3})*)\s*,/)?.[1]?.replace(/\./g, ''));
    const { brand, model } = splitTitle(title);
    const vat = /MwSt\.?\s*ausweisbar/i.test(t) ? 'TVA récupérable' : /Differenzbesteuert|§ ?25a/i.test(t) ? 'TVA sur la marge' : '';
    out.push({
      external_id: id, url, title: vat ? `${title} · ${vat}` : title, brand, model,
      price, currency: 'EUR', km, year: ez ? Number(ez[2]) : null, fuel,
      gearbox: /schalt/i.test(gear) ? 'Manuelle' : /automat|dsg|s-?tronic|dct|cvt/i.test(gear) ? 'Automatique' : gear || null,
      plate: null, vin: null, body: tip('Karosserie') ?? status, image: card.match(/data-src="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') ?? null, listed_at: null,
      status: statusFromText(status) ?? (price == null ? 'price_on_request' : null),
    });
  }
  return out;
}
async function scrapeCarzilla(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const origin = new URL(url).origin;
  const declared = num(firstHtml.match(/von\s+([\d.]+)\s+Treffern/)?.[1]?.replace(/\./g, ''));
  const first = parseCarzillaCards(firstHtml, origin);
  const perPage = first.length;
  const pagesCap = declared != null && perPage > 0 ? Math.min(400, Math.ceil(declared / perPage)) : MAX_PAGES;
  let pages = 0;
  // TRI STABLE (16/10, relevé Bierschneider : 5 178 lus pour 6 050 annoncés).
  // L'adresse de la vitrine trie par prix (« of=SalePrice ») : des dizaines de
  // véhicules au même prix, l'ordre des ex æquo change d'une page à l'autre,
  // 15 % des cartes se répètent et autant ne paraissent jamais (mesuré :
  // 33 doublons sur 10 pages). Trié par date de création (« of=CreatedAt »,
  // quasi unique), 0 doublon sur les mêmes pages. On relit donc TOUTES les
  // pages (la première comprise) avec ce tri, quel que soit celui de l'URL.
  const stableUrl = new URL(url); stableUrl.searchParams.set('of', 'CreatedAt');
  const resort = stableUrl.searchParams.get('of') !== new URL(url).searchParams.get('of');
  for (let page = 1; page <= pagesCap; page++) {
    let cards: DealerVehicle[] | null = page === 1 && !resort ? first : null;
    if (cards == null) {
      const pu = new URL(stableUrl); pu.searchParams.set('cp', String(page));
      for (let attempt = 0; attempt < 2 && cards == null; attempt++) {
        if (attempt > 0) await sleep(1500);
        const r = await getText(pu.toString());
        if (r.status === 200) cards = parseCarzillaCards(r.text, origin);
      }
      if (cards == null) {
        if (page === 1) { cards = first; warnings.push('tri stable (CreatedAt) illisible : pagination avec le tri de l\'adresse (doublons possibles)'); }
        else { warnings.push(`arrêt à la page ${page} : page illisible — relevé partiel (${out.length} / ${declared ?? '?'})`); break; }
      }
    }
    pages = page;
    let added = 0;
    for (const v of cards) { if (seen.has(v.external_id)) continue; seen.add(v.external_id); out.push(v); added++; }
    if (cards.length === 0 || added === 0) break;
    if (declared != null && out.length >= declared) break;
    await sleep(PAGE_DELAY_MS);
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncés`);
  return { provider: 'carzilla', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

// ── hexon (Oostendorp Automotive, www.oostendorpautomotive.nl) ───────────────
// Constat 14/10 (boîte à apprendre, Channing : « apprends Ada à lire cette
// vitrine ») : site WMP/Hexon — <div class="card-car-slider"
// data-voertuignrhexon="52884673"> puis <a href="/auto/52884673-toyota-yaris-…">,
// <h3 class="card_content__title">Toyota Yaris</h3>, <span>1.5 Hybrid 115
// Dynamic MY25</span>, <span class="card_content__grey">10 km | 2026 | Hybride
// | Automaat</span>, prix courant dans « car-offer__price » (l'ancien prix,
// « car-offer__fromprice », est barré : jamais pris). 21 cartes par page,
// pagination par décalage « ?from=21 », total « 1164 auto's gevonden » dans
// #total-results-desktop. Prouvé : pages 1 et 2 lues, 21 cartes chacune.
export function parseHexonCards(html: string, origin: string): DealerVehicle[] {
  const out: DealerVehicle[] = [];
  const text = (s: string) => unesc(s.replace(/<svg[\s\S]*?<\/svg>|<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  const parts = html.split(/<div class="card-car-slider" data-voertuignrhexon="/);
  for (let i = 1; i < parts.length; i++) {
    const card = parts[i];
    const id = card.match(/^(\d+)"/)?.[1];
    if (!id) continue;
    const href = card.match(/<a[^>]+href="([^"]+)"/)?.[1] ?? '';
    const url = href ? (href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`) : null;
    const title = text(card.match(/card_content__title[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '');
    const variant = text(card.match(/<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
    // « 52.517 km | 2022 | Hybride | Automaat » — la première ligne grise sans icône.
    const grey = [...card.matchAll(/card_content__grey"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => text(m[1])).find((t) => /\|/.test(t)) ?? '';
    const [kmRaw, yearRaw, fuelRaw, gearRaw0] = grey.split('|').map((s) => s.trim());
    // BOÎTE MANUELLE DÉDUITE (13/11, Channing : « Oostendorp, on voit bien boîte mécanique sur le site ») : la carte
    // hexon n'affiche le 4e segment que pour les automatiques (« … | Hybride | Automaat ») ; une carte à trois
    // segments (« 105.225 km | 2017 | Benzine ») est une manuelle. Preuve Oostendorp 13/11 : filtre Automaat 911 /
    // Handgeschakeld 247, et 6 cartes sur 21 sans 4e segment sur la première page.
    const gearRaw = gearRaw0 ?? (kmRaw && yearRaw && fuelRaw ? 'handgeschakeld' : undefined);
    const cur = card.match(/car-offer__price[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '';
    const price = priceOrNull(text(cur).replace(/[^\d]/g, ''));
    const t = text(card);
    const { brand, model } = splitTitle(title);
    const img = card.match(/<img[^>]+(?:src|data-src)="([^"]+)"/)?.[1] ?? null;
    out.push({
      external_id: id, url, title: `${title} ${variant}`.trim(), brand, model,
      price, currency: 'EUR',
      km: num((kmRaw ?? '').replace(/\./g, '').replace(/\s*km$/i, '')),
      year: num(yearRaw) != null && Number(yearRaw) > 1900 ? Number(yearRaw) : null,
      fuel: fuelRaw || null,
      gearbox: /handgeschakeld|schakel/i.test(gearRaw ?? '') ? 'Manuelle' : /automaat|automat/i.test(gearRaw ?? '') ? 'Automatique' : gearRaw || null,
      plate: null, vin: null, body: null,
      image: img ? (img.startsWith('http') ? img : `${origin}${img.startsWith('/') ? '' : '/'}${img}`) : null, listed_at: null,
      status: statusFromText(t.match(/(op aanvraag|verkocht|gereserveerd|binnenkort verwacht|verwacht)/i)?.[1]) ?? (price == null ? 'price_on_request' : null),
    });
  }
  return out;
}
async function scrapeHexon(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const origin = new URL(url).origin;
  const declared = num(firstHtml.match(/id="total-results-desktop"[^>]*>\s*([\d.]+)/)?.[1]?.replace(/\./g, ''));
  const first = parseHexonCards(firstHtml, origin);
  const perPage = num(firstHtml.match(/numberOfItemsPerPage=(\d+)/)?.[1]) ?? first.length;
  const pagesCap = declared != null && perPage > 0 ? Math.min(MAX_PAGES, Math.ceil(declared / perPage)) : MAX_PAGES;
  let pages = 0;
  for (let page = 1; page <= pagesCap; page++) {
    let cards: DealerVehicle[] | null = page === 1 ? first : null;
    if (page > 1) {
      const pu = new URL(url); pu.searchParams.set('from', String((page - 1) * perPage)); pu.hash = '';
      for (let attempt = 0; attempt < 2 && cards == null; attempt++) {
        if (attempt > 0) await sleep(1500);
        const r = await getText(pu.toString());
        if (r.status === 200) cards = parseHexonCards(r.text, origin);
      }
      if (cards == null) { warnings.push(`arrêt à la page ${page} : page illisible — relevé partiel (${out.length} / ${declared ?? '?'})`); break; }
    }
    pages = page;
    let added = 0;
    for (const v of cards) { if (seen.has(v.external_id)) continue; seen.add(v.external_id); out.push(v); added++; }
    if (cards.length === 0 || added === 0) break;
    if (declared != null && out.length >= declared) break;
    await sleep(PAGE_DELAY_MS);
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncés`);
  return { provider: 'hexon', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
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
// index.php?mact=Occasions,cntnt01,ajaxDoAdvancedSearch,0&cntnt01returnid=N&pagina=P avec
// request=xmlhttp&data=<formulaire sérialisé>&pagina=P → { total, occasions_html }. 24 cartes par page ; chaque carte
// porte un div.favAuto (data-id / data-merk / data-model / data-uitvoering / data-prijs / data-kenteken / data-url /
// data-thumb) et la ligne « 2026 · Hybride · 7.793 km ». La boîte n'est PAS sur la carte (14/11 : boîte 0 % sur 3 873).
/** Options « Transmissie » du formulaire de recherche (Louwman 14/11 : A = Automaat 3 401, H = Handgeschakeld 510). */
export function cmsmsTransmissions(html: string): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (const m of html.matchAll(/(<input[^>]*name="transmission\[\]"[^>]*>)\s*([^<]*)/g)) {
    const value = m[1].match(/value="([^"]+)"/)?.[1];
    const label = decode(m[2]).trim();
    if (value && label && !out.some((o) => o.value === value)) out.push({ value, label });
  }
  return out;
}
/** Cartes d'une réponse cmsms (occasions_html). Les data-* vivent sur la balise favAuto UNIQUEMENT (le bloc « labels »
 *  porte aussi un data-id : « label_tao » — constat 02/10, collision d'identifiants). */
export function parseCmsmsCards(occasionsHtml: string): DealerVehicle[] {
  const out: DealerVehicle[] = [];
  for (const card of occasionsHtml.split(/(?=<div class="occasion grid")/)) {
    if (!card.includes('favAuto')) continue;
    const fav = card.match(/<div class="favAuto"[^>]*>/)?.[0] ?? '';
    const attr = (k: string) => decode(fav.match(new RegExp(`data-${k}="([^"]*)"`))?.[1] ?? '').trim();
    const id = attr('id') || attr('kenteken');
    if (!id) continue;
    const text = stripTags(card.match(/<div class="grid-info">([\s\S]*?)<div class="locatie">/)?.[1] ?? '');
    const labels = stripTags(card.match(/<div class="labels">([\s\S]*?)<\/div>/)?.[1] ?? '');
    const price = priceOrNull(attr('prijs'));
    const status: DealerVehicleStatus | null = statusFromText(labels) ?? (price == null ? 'price_on_request' : null);
    const brand = attr('merk') || null, model = attr('model') || null;
    out.push({
      external_id: id, url: attr('url') || null, title: [brand, model, attr('uitvoering')].filter(Boolean).join(' ').trim(),
      brand, model, price, km: num(text.match(/([\d.]+)\s*km/i)?.[1]), year: num(text.match(/\b(19|20)\d{2}\b/)?.[0]),
      fuel: text.match(/\b(Benzine|Diesel|Electra|Elektrisch|Hybride|LPG|CNG|Waterstof)\b/i)?.[1] ?? null, gearbox: null,
      plate: attr('kenteken') || null, vin: null, body: null, image: attr('thumb') || null, listed_at: null, status,
    });
  }
  return out;
}
/** Fiche détail cmsms (secours pour DETAIL_READERS) : blocs « <div class="titel">Transmissie</div>Automaat ». */
export function readCmsmsDetail(html: string): { gearbox?: string | null; fuel?: string | null; km?: number | null; year?: number | null; price?: number | null } {
  const spec = (label: string) => unesc(stripTags(html.match(new RegExp(`<div class="titel">${label}</div>([\\s\\S]*?)</div>`, 'i'))?.[1] ?? '')) || null;
  return {
    gearbox: gearboxOf(spec('Transmissie')), fuel: spec('Brandstof'), km: num(spec('KM-stand')),
    year: num(spec('Bouwjaar')?.match(/\b(19|20)\d{2}\b/)?.[0]), price: priceOrNull(html.match(/<title>[^<|]*\|\s*€\s*([\d.]+)/)?.[1]),
  };
}
export async function scrapeCmsms(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const returnid = firstHtml.match(/returnid" value="(\d+)"/)?.[1];
  if (!returnid) return { provider: 'cmsms', total: null, declared: null, vehicles: [], pages: 0, warnings: ['returnid introuvable dans la page'] };
  // Filtre repris du chemin de l'URL : /aanbod/filters/gebruikt/ → gebruikt ; /occasion/ → occasion ; sinon tout l'aanbod.
  const path = new URL(url).pathname.toLowerCase();
  const cond = /gebruikt/.test(path) ? 'gebruikt' : /occasion/.test(path) ? 'occasion' : /nieuw/.test(path) ? 'nieuw' : '';
  const byId = new Map<string, DealerVehicle>();
  let pages = 0;
  // 24 cartes par page : 3 911 véhicules = 163 pages, au-delà du plafond commun (150) — plafond propre à ce fournisseur.
  const CMSMS_MAX_PAGES = 250;
  // Une passe = une recherche lue page par page ; `gearbox` = boîte du filtre de la passe (null = sans filtre).
  // ok = passe allée à son terme (page vide ou sans carte nouvelle) ; false = erreur HTTP, réponse illisible ou plafond.
  const pass = async (filter: string, gearbox: string | null, label: string, maxPages = CMSMS_MAX_PAGES): Promise<{ total: number | null; ok: boolean }> => {
    const data = `${cond ? `new_or_occasion%5B%5D=${cond}&` : ''}${filter}orderby=default&sortorder=DESC`;
    const mine = new Set<string>();
    let total: number | null = null;
    for (let page = 1; page <= maxPages; page++) {
      const res = await getText(`${origin}/index.php?mact=Occasions,cntnt01,ajaxDoAdvancedSearch,0&cntnt01returnid=${returnid}&pagina=${page}${page > 1 ? '&type=scroll' : ''}`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', referer: url },
        body: `request=xmlhttp&data=${encodeURIComponent(data)}&pagina=${page}`,
      });
      if (res.status !== 200) { warnings.push(`${label}, page ${page} : HTTP ${res.status}`); return { total, ok: false }; }
      let d: { total?: number | string; occasions_html?: string };
      try { d = JSON.parse(res.text); } catch { warnings.push(`${label}, page ${page} : réponse illisible`); return { total, ok: false }; }
      pages++;
      total = num(d.total) ?? total;
      let added = 0;
      for (const v of parseCmsmsCards(d.occasions_html ?? '')) {
        if (mine.has(v.external_id)) continue; // le site répète quelques lignes (14/11 : 510 cartes « H » pour 505 voitures, quel que soit le tri)
        mine.add(v.external_id); added++;
        const known = byId.get(v.external_id);
        if (!known) byId.set(v.external_id, { ...v, gearbox });
        else if (gearbox && !known.gearbox) known.gearbox = gearbox;
      }
      if (added === 0 || (total != null && mine.size >= total)) return { total, ok: true };
      await sleep(Math.max(PAGE_DELAY_MS, 350)); // politesse : 350 ms au moins entre deux pages d'un site
    }
    return { total, ok: maxPages < CMSMS_MAX_PAGES };
  };
  // BOÎTE PAR PASSES FILTRÉES (14/11, Louwman : boîte 0 % sur 3 873, « nos comparaisons Suzuki en dépendent ») : la
  // carte ne porte pas la boîte, mais le formulaire filtre par « Transmissie » et ces filtres partagent tout le stock
  // (compteurs du site : 3 401 Automaat + 510 Handgeschakeld = 3 911 « gebruikt »). Chaque voiture prend la boîte de la
  // passe où elle est vue : autant de pages qu'une passe unique, aucune fiche détail. La page 1 sans filtre donne le
  // total ; la passe sans filtre n'est relue en entier que si une passe filtrée a échoué ou si les compteurs filtrés ne
  // couvrent pas le total (voitures sans boîte renseignée) — elle ajoute alors ces voitures, boîte inconnue.
  const gears = cmsmsTransmissions(firstHtml);
  const head = await pass('', null, 'stock', gears.length ? 1 : CMSMS_MAX_PAGES);
  let covered = 0, gearsOk = gears.length > 0;
  for (const g of gears) {
    const r = await pass(`transmission%5B%5D=${encodeURIComponent(g.value)}&`, gearboxOf(g.label), `boîte « ${g.label} »`);
    covered += r.total ?? 0;
    gearsOk = gearsOk && r.ok && r.total != null;
  }
  if (gears.length && (!gearsOk || head.total == null || covered < head.total)) await pass('', null, 'stock (reste)');
  const vehicles = [...byId.values()];
  const noGear = vehicles.filter((v) => !v.gearbox).length;
  if (gears.length && noGear) warnings.push(`${noGear} voiture(s) sans boîte : absentes des filtres « Transmissie » du site`);
  return { provider: 'cmsms', total: head.total ?? vehicles.length, declared: head.total, vehicles, pages, warnings };
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

// ── kamux (Kamux Oyj, 02/11 — www.kamux.fi/search, aussi kamux.se / kamux.de) ──────────────────
//    Preuve : GET /api/search?locale=fi → { resultCount, results[], facets{manufacturer:[{value,count}]} }.
//    « top » plafonné à 100. Particularité PROUVÉE (02/11) : skip ≥ top → la réponse livre TOUT le lot
//    filtré (sans filtre : 4 708 voitures = 92 Mo en une fois) ; skip < top → top − skip voitures.
//    Lecture par MARQUE (facette manufacturer, 628 Mercedes au plus = 12 Mo) avec top=100&skip=100 :
//    une réponse par marque, complète, comparée au compte de la facette. Chaque voiture porte
//    productId, regNo (plaque, = URL /cars/<regNo>), VIN, manufacturer/model/modelType, modelYear,
//    mileage, price, kamuxFuelType (code → libellé i18n du site), gearType, powerValueKw, photos,
//    purchaseDate (entrée en stock), firstRegistrationDate, isUpForAuction / isDeleted.
const KAMUX_FUEL: Record<number, string> = {
  1: 'Essence', 3: 'Diesel', 5: 'Fioul', 6: 'Électrique', 7: 'Gaz', 8: 'Pétrole', 10: 'E85', 11: 'Hybride essence', 12: 'Hybride diesel',
  13: 'Essence / gaz', 14: 'Diesel / gaz', 15: 'Hydrogène', 16: 'Hybride E85', 17: 'Hybride essence', 18: 'Hybride diesel',
  19: 'Hybride rechargeable essence', 20: 'Hybride rechargeable diesel', 21: 'Hybride E85', 22: 'Hybride rechargeable E85',
};
interface KamuxItem {
  productId?: number; id?: string; regNo?: string; manufacturer?: string; model?: string; manufacturerAndModel?: string; modelType?: string;
  modelYear?: number; mileage?: number; price?: number; kamuxFuelType?: number; fuelTypeCode?: string; plugIn?: boolean; gearType?: string;
  powerValueKw?: number; photos?: string[]; purchaseDate?: string; firstRegistrationDate?: string; vehicleIdentificationNumber?: string;
  vehicleType?: string; bodyType?: string; isUpForAuction?: boolean; isDeleted?: boolean; family?: string; akeneoChannel?: string; outlet?: string;
}
function kamuxItemToVehicle(it: KamuxItem, origin: string): DealerVehicle | null {
  const id = String(it.productId ?? it.id ?? '').trim();
  if (!id || it.isDeleted) return null;
  const reg = (it.regNo ?? '').trim();
  const price = priceOrNull(it.price);
  const fuelCode = num(it.kamuxFuelType);
  const fuel = fuelCode != null ? KAMUX_FUEL[fuelCode] ?? (it.plugIn ? 'Hybride rechargeable' : null) : null;
  return {
    external_id: id, url: reg ? `${origin}/cars/${encodeURIComponent(reg)}` : null,
    title: [it.manufacturerAndModel ?? [it.manufacturer, it.model].filter(Boolean).join(' '), it.modelType].filter(Boolean).join(' ').trim(),
    brand: it.manufacturer ?? null, model: it.model ?? null,
    price, km: num(it.mileage), year: num(it.modelYear), fuel,
    gearbox: it.gearType === 'automatic' ? 'Automatique' : it.gearType === 'manual' ? 'Manuelle' : it.gearType ?? null,
    plate: reg || null, vin: (it.vehicleIdentificationNumber ?? '').trim() || null,
    body: it.vehicleType ?? null, image: it.photos?.[0] ?? null,
    listed_at: it.purchaseDate ? new Date(it.purchaseDate).toISOString() : null,
    status: it.isUpForAuction ? 'reserved' : price == null ? 'price_on_request' : null,
    power_ch: num(it.powerValueKw) != null && (num(it.powerValueKw) as number) > 0 ? Math.round((num(it.powerValueKw) as number) * 1.35962) : null,
  };
}
async function scrapeKamux(url: string): Promise<DealerStockResult> {
  const u = new URL(url);
  const origin = u.origin;
  const locale = /kamux\.se$/i.test(u.hostname) ? 'sv' : /kamux\.de$/i.test(u.hostname) ? 'de' : 'fi';
  const warnings: string[] = [];
  const headers = { accept: 'application/json', referer: url };
  const first = await getText(`${origin}/api/search?top=1&locale=${locale}`, { headers });
  if (first.status !== 200) return { provider: 'kamux', total: null, declared: null, vehicles: [], pages: 0, warnings: [`/api/search : HTTP ${first.status}`] };
  let head: { resultCount?: number; facets?: { manufacturer?: Array<{ value?: string; count?: number }> } };
  try { head = JSON.parse(first.text); } catch { return { provider: 'kamux', total: null, declared: null, vehicles: [], pages: 0, warnings: ['/api/search : réponse illisible'] }; }
  const declared = num(head.resultCount);
  const brands = (head.facets?.manufacturer ?? []).map((f) => ({ name: String(f.value ?? '').trim(), count: num(f.count) })).filter((b) => b.name);
  if (brands.length === 0) return { provider: 'kamux', total: declared, declared, vehicles: [], pages: 1, warnings: ['facette marques vide'] };
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let pages = 1;
  for (const { name: brand, count } of brands) {
    pages++;
    const res = await getText(`${origin}/api/search?manufacturer=${encodeURIComponent(brand)}&top=100&skip=100&locale=${locale}`, { headers });
    if (res.status !== 200) { warnings.push(`marque ${brand} : HTTP ${res.status}`); continue; }
    let d: { results?: KamuxItem[] };
    try { d = JSON.parse(res.text); } catch { warnings.push(`marque ${brand} : réponse illisible`); continue; }
    let added = 0;
    for (const it of d.results ?? []) {
      const v = kamuxItemToVehicle(it, origin);
      if (!v || seen.has(v.external_id)) continue;
      seen.add(v.external_id); out.push(v); added++;
    }
    if (count != null && added < count) warnings.push(`marque ${brand} : ${added} lue(s) pour ${count} annoncée(s)`);
    await sleep(PAGE_DELAY_MS);
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s) par le site`);
  return { provider: 'kamux', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

/** Texte d'un fragment HTML : balises retirées, entités décodées, espaces repliés. */
const htmlText = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
/** GET avec reprise sur HTTP 429/503 (5 s, 10 s, 20 s, 40 s) : l'origine MotorK de Cobredia répond 429 pendant ~20 s
 *  après deux pages hors cache rapprochées (mesuré le 04/11 : 429 à t+11 s, 200 dès t+24 s). */
async function getTextPatient(url: string, init?: RequestInit): Promise<{ status: number; text: string; headers: Headers }> {
  let r = await getText(url, init);
  // 5 reprises (5 s → 80 s, 155 s en tout) : SIPA a tenu 41 pages puis 429 persistant pendant qu'une autre vitrine MotorK était lue.
  for (let i = 0; i < 5 && (r.status === 429 || r.status === 503); i++) { await sleep(5000 * 2 ** i); r = await getText(url, init); }
  return r;
}
/** Même URL avec un paramètre de requête changé. */
const withParam = (url: string, key: string, value: string) => { const u = new URL(url); u.searchParams.set(key, value); return u.toString(); };

/** Boîte des flux concession FRANÇAIS (18/11 : VGRF, Yooflex, DMD) : « Manuelle », « Automatique », « Séquentielle »,
 *  « Auto Séquent. », « Automate sequentiel », « A Var Continu » / « Automate à fonct. Continu » (variateur),
 *  « Rob double embray » / « Rob Simple Embray » (robotisée), « Boîte hybride multimode » (E-Tech) : sans pédale
 *  d'embrayage = Automatique. Libellé inconnu : rendu tel quel. */
export const gearboxFr = (t: string | null | undefined): string | null => {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/robot|\brob\b|embray|pilot|multimode|var(iateur|\.)?\s*continu|fonct\.?\s*continu|\bcvt\b/i.test(s)) return 'Automatique';
  if (/manu|\bbvm\d?\b/i.test(s)) return 'Manuelle';
  if (/auto|s[ée]quent|\bdsg\b|\bdct\b|\bedc\b|\beat\d?\b|\bbva\d?\b|s-?tronic|tiptronic|steptronic|powershift/i.test(s)) return 'Automatique';
  return s;
};
/** Jeton de carte qui est un libellé de boîte (vocabulaire de gearboxFr). */
const isGearFr = (x: string) => x.length <= 30 && /^(manuelle|automatique|s[ée]quentielle|auto s[ée]quent|a var continu|automate|rob |robotis|variat|bo[iî]te)/i.test(x);
/** Boîte lue dans une VERSION, en MOTS ENTIERS (18/11 : « Beats », « Creative » contiennent « eat » → manuelles lues
 *  automatiques ; « EDC », « CVT », « Powershift » n'étaient pas lus). */
export const gearboxOfVersion = (v: string | null | undefined): string | null =>
  /\b(BVA\d?|DSG\d?|EAT\d|DCT\d?|EDC\d?|e-?CVT|CVT|automatique|automatic|powershift|S-?tronic|steptronic|tiptronic)\b/i.test(v ?? '') ? 'Automatique' : /\bBVM\d?\b/i.test(v ?? '') ? 'Manuelle' : null;

/** JSON-LD des pages webspark (18/11) : chaque page de liste porte un ItemList Yoast de « Vehicle », un par carte
 *  (sku = data-id) avec boîte (vehicleTransmission), énergie, km, année, prix et VIN — y compris sur les cartes
 *  compactes (SIPA, Sofibrie, Edenauto, Bony) qui n'affichent pas la boîte. */
export interface WebsparkLd { gearbox: string | null; fuel: string | null; km: number | null; year: number | null; price: number | null; vin: string | null }
export function websparkLdById(html: string): Map<string, WebsparkLd> {
  const out = new Map<string, WebsparkLd>();
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let d: unknown;
    try { d = JSON.parse(m[1]); } catch { continue; }
    const nodes = ((d as { '@graph'?: unknown[] })['@graph'] ?? [d]) as Array<Record<string, unknown>>;
    for (const n of nodes) {
      if (n?.['@type'] !== 'ItemList' || !Array.isArray(n.itemListElement)) continue;
      for (const el of n.itemListElement as Array<{ item?: Record<string, unknown> }>) {
        const it = el?.item;
        const id = String(it?.sku ?? it?.productId ?? '');
        if (!it || !/^\d+$/.test(id)) continue;
        const offers = (Array.isArray(it.offers) ? it.offers[0] : it.offers) as { price?: unknown } | undefined;
        const vin = String(it.vehicleIdentificationNumber ?? '').trim().toUpperCase();
        const word = (x: unknown) => { const w = String(x ?? '').trim(); return w && !/^autres?$/i.test(w) ? w : null; }; // « autre » = inconnu
        out.set(id, {
          gearbox: gearboxOf(word(it.vehicleTransmission)),
          fuel: word(it.fuelType),
          km: num((it.mileageFromOdometer as { value?: unknown } | undefined)?.value),
          year: num(String(it.vehicleModelDate ?? '').match(/\b(?:19|20)\d{2}\b/)?.[0]),
          price: priceOrNull(offers?.price),
          vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null,
        });
      }
    }
  }
  return out;
}
/** Total annoncé par une liste webspark : « <strong>3193</strong> résultats trouvés ». */
export const websparkDeclared = (html: string): number | null => num(html.match(/results-counter[^>]*>\s*<strong>\s*([\d\s  .]+)<\/strong>\s*résultats? trouvés?/)?.[1]?.replace(/[\s  .]/g, ''));

/** « vehiculeinfos » d'une carte openflex lu par FORME (18/11, Vikings) : « 2016 / 123844km / Essence »,
 *  « 2026 / Essence » (neuve : pas de km), « / Diesel » (sans année), « 2020 / 102666km / Essence / Electrique »
 *  (hybride : les 145 voitures du filtre « Hybride » du site). Lu par position, la forme neuve donnait km = 0 lu dans
 *  « Essence » et aucune énergie, l'hybride « Essence » ou « Electrique ». */
export function openflexInfos(infos: string): { year: number | null; km: number | null; fuel: string | null } {
  const toks = infos.split('/').map((x) => x.trim()).filter(Boolean);
  const kmTok = toks.find((x) => /^\d[\d\s  .]*\s*km$/i.test(x));
  const rest = toks.filter((x) => !/^(19|20)\d{2}$/.test(x) && x !== kmTok);
  return {
    year: num(toks.find((x) => /^(19|20)\d{2}$/.test(x))),
    km: kmTok ? num(kmTok.replace(/km/i, '').replace(/[\s  .]/g, '')) : null,
    fuel: rest.length > 1 && rest.some((x) => /lectri/i.test(x)) ? `Hybride ${rest.join(' / ')}` : rest.join(' / ') || null,
  };
}

/** Total annoncé par une liste yooflex : « 278 résultats correspondants à la recherche ». */
export const yooflexDeclared = (html: string): number | null => num(html.replace(/<[^>]+>/g, ' ').match(/(\d[\d\s ]*)\s*résultats?\s+correspondant/)?.[1]?.replace(/[\s ]/g, ''));
/** LISTE EN ORDRE ALÉATOIRE (18/11, Hecquet : la page 1 change à chaque appel ; « ?paged=N » ne lit qu'un tirage —
 *  194 voitures sur 286 le 18/11, 72 « disparues » qui n'en sont pas). Une page qui contient TOUTE sa sélection est
 *  exacte quel que soit l'ordre : découpage par les filtres du site « price_min / price_max », puis « kilometer_min /
 *  kilometer_max » quand plus d'une page de voitures ont le même prix, jusqu'à ce que chaque tranche tienne sur une page.
 *  Bornes incluses et jointives (un doublon est dédoublonné par l'identifiant) ; une borne 0 est ignorée par le site. */
async function yooflexSlices(url: string, firstHtml: string, perPage: number, parse: (html: string) => number): Promise<{ requests: number; warnings: string[] }> {
  const warnings: string[] = [];
  const bound = (name: string, attr: 'min' | 'max', dflt: number) => {
    const v = num(firstHtml.match(new RegExp(`name="${name}"[^>]*\\b${attr}="([\\d.]+)"`))?.[1]);
    return v != null && v > 0 ? (attr === 'min' ? Math.floor(v) : Math.ceil(v)) : dflt;
  };
  const K: [number, number] = [bound('kilometer_min', 'min', 1), bound('kilometer_max', 'max', 2_000_000)];
  type Slice = { p: [number, number]; k: [number, number] | null };
  const stack: Slice[] = [{ p: [bound('price_min', 'min', 1), bound('price_max', 'max', 1_000_000)], k: null }];
  const split = ([lo, hi]: [number, number], n: number): Array<[number, number]> => {
    const step = Math.max(1, Math.ceil((hi - lo) / Math.min(8, Math.max(2, Math.ceil(n / perPage) + 1))));
    const parts: Array<[number, number]> = [];
    for (let a = lo; a < hi; a += step) parts.push([a, Math.min(hi, a + step)]);
    return parts.reverse();
  };
  let requests = 0;
  while (stack.length && requests < 600) {
    const s = stack.pop()!;
    await sleep(PAGE_DELAY_MS);
    let u = withParam(withParam(url, 'price_min', String(Math.max(1, s.p[0]))), 'price_max', String(s.p[1]));
    if (s.k) u = withParam(withParam(u, 'kilometer_min', String(Math.max(1, s.k[0]))), 'kilometer_max', String(s.k[1]));
    const r = await getTextPatient(u);
    requests++;
    if (r.status !== 200) { warnings.push(`tranche ${s.p.join('-')} € : HTTP ${r.status}`); continue; }
    const n = yooflexDeclared(r.text);
    if (n === 0) continue;
    if (n == null || n <= perPage) { parse(r.text); continue; }
    if (s.p[1] - s.p[0] > 1) { for (const p of split(s.p, n)) stack.push({ p, k: s.k }); continue; }
    const k = s.k ?? K;
    if (k[1] - k[0] > 1) { for (const kk of split(k, n)) stack.push({ p: s.p, k: kk }); continue; }
    parse(r.text);
    warnings.push(`tranche ${s.p.join('-')} € / ${k.join('-')} km : ${n} voitures, ${perPage} lues`);
  }
  if (stack.length) warnings.push(`plafond de 600 requêtes atteint, ${stack.length} tranche(s) non lue(s)`);
  return { requests, warnings };
}

// ── openflex (Vikings Auto, 04/11) : 1 823 voitures, 37 par page, « entrant=N », total « N résultat(s) ».
async function scrapeOpenflex(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const declared = num(firstHtml.match(/(\d[\d\s ]*)\s*résultat\(s\)/)?.[1]?.replace(/[\s ]/g, ''));
  // Modèle des pages : le premier lien « entrant=2 », sinon le paramètre posé sur l'URL de départ.
  const tpl = firstHtml.match(/href="([^"]*entrant=\d+[^"]*)"/)?.[1]?.replace(/&amp;/g, '&');
  const pageUrl = (p: number) => (tpl ? withParam(new URL(tpl, origin).toString(), 'entrant', String(p)) : withParam(url, 'entrant', String(p)));
  const parse = (html: string): number => {
    let added = 0;
    // Occasions ET véhicules neufs (« /vehicules-neufs/… ») : la vitrine liste les deux, 37 cartes par page.
    for (const m of html.matchAll(/<a[^>]+href="([^"]*-(\d{4,})\.html)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const [, href, id, inner] = m;
      if (!/class="vehiculeinfos"/.test(inner) || seen.has(id)) continue;
      const nom = htmlText(inner.match(/class="nom">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const info = htmlText(inner.match(/class="info">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const infos = htmlText(inner.match(/class="vehiculeinfos">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const prixRaw = htmlText(inner.match(/class="prix">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const inf = openflexInfos(infos); // année, km, énergie lus par forme (18/11)
      const brand = nom.split(/\s+/)[0] || null;
      const model = nom.split(/\s+/).slice(1).join(' ') || null;
      const price = priceOrNull(prixRaw.replace(/[^\d]/g, ''));
      seen.add(id); added++;
      out.push({
        external_id: id, url: href.startsWith('http') ? href : origin + href, title: [nom, info].filter(Boolean).join(' ').trim(), brand, model,
        price, km: inf.km ?? (/\/vehicules-neufs\//.test(href) ? 0 : null), year: inf.year, fuel: inf.fuel,
        gearbox: gearboxOfVersion(info), // sinon fiche détail (DETAIL_READERS.openflex)
        plate: null, vin: null, body: null, image: inner.match(/data-original="([^"]+)"/)?.[1] ?? null, listed_at: null,
        status: price == null ? (/vendu/i.test(inner) ? 'sold' : 'price_on_request') : null, currency: 'EUR',
      });
    }
    return added;
  };
  let pages = 1;
  let added = parse(firstHtml);
  const perPage = added;
  const cap = declared != null && perPage > 0 ? Math.min(MAX_PAGES, Math.ceil(declared / perPage) + 1) : MAX_PAGES;
  for (let p = 2; p <= cap && added > 0; p++) {
    await sleep(PAGE_DELAY_MS);
    const r = await getTextPatient(pageUrl(p));
    if (r.status !== 200) { warnings.push(`page ${p} : HTTP ${r.status}`); break; }
    added = parse(r.text); pages = p;
    if (declared != null && out.length >= declared) break;
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  return { provider: 'openflex', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

// ── autopolis (autopolis.sk, 04/11) : cartes « car-item », 100 par page avec « pocet-na-stranu=100 », « strana=N ».
async function scrapeAutopolis(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const pageUrl = (p: number) => withParam(withParam(url, 'pocet-na-stranu', '100'), 'strana', String(p));
  const parse = (html: string): number => {
    let added = 0;
    const parts = html.split(/<div class="car-item"/).slice(1);
    for (const part of parts) {
      const title = part.match(/<a\s+class="car-item__title"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!title) continue;
      const href = title[1];
      const id = href.replace(/\/+$/, '').split('/').pop() ?? href;
      if (seen.has(id)) continue;
      const name = htmlText(title[2].match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? '');
      const version = htmlText(title[2].match(/<span>([\s\S]*?)<\/span>/)?.[1] ?? '');
      const params = new Map<string, string>();
      for (const m of part.matchAll(/car-item__parameter-title">([\s\S]*?)<\/div>\s*<div class="car-item__parameter-info">([\s\S]*?)<\/div>/g)) params.set(htmlText(m[1]).toLowerCase(), htmlText(m[2]));
      const ttc = priceOrNull((part.match(/Cena s dph\s*<\/p>\s*<p>\s*([\d\s ]+)€/i)?.[1] ?? '').replace(/[\s ]/g, ''));
      const ht = priceOrNull((part.match(/priceWithoutTax"><b>([\d\s ]+)€/i)?.[1] ?? '').replace(/[\s ]/g, ''));
      const kw = num(params.get('objem a výkon motora')?.match(/(\d+)\s*kw/i)?.[1]);
      const gear = params.get('prevodovka') ?? '';
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title: [name, version].filter(Boolean).join(' ').trim(), brand: name.split(/\s+/)[0] || null, model: name.split(/\s+/).slice(1).join(' ') || null,
        price: ttc ?? ht, km: num(params.get('počet km')?.replace(/km/i, '').replace(/\s/g, '')), year: num(params.get('rok výroby')),
        fuel: params.get('palivo') ?? null, gearbox: /automat/i.test(gear) ? 'Automatique' : /manu/i.test(gear) ? 'Manuelle' : gear || null,
        plate: null, vin: null, body: null, image: part.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null,
        status: ttc == null && ht == null ? 'price_on_request' : null, currency: 'EUR', power_ch: kw != null ? Math.round(kw * 1.35962) : null,
      });
    }
    return added;
  };
  let pages = 1;
  let added = parse(firstHtml);
  if (added > 0 && !/pocet-na-stranu=100/.test(url)) { seen.clear(); out.length = 0; const r = await getTextPatient(pageUrl(1)); added = r.status === 200 ? parse(r.text) : 0; }
  for (let p = 2; p <= MAX_PAGES && added > 0; p++) {
    await sleep(PAGE_DELAY_MS);
    const r = await getTextPatient(pageUrl(p));
    if (r.status !== 200) { warnings.push(`page ${p} : HTTP ${r.status}`); break; }
    added = parse(r.text); if (added > 0) pages = p;
  }
  return { provider: 'autopolis', total: out.length, declared: null, vehicles: out, pages, warnings };
}

// ── webspark / dealerk (Cobredia, 04/11) : cartes « vcard » data-id, paires label/info, prix « vcard-price__price », « page=N ».
async function scrapeWebspark(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    const ld = websparkLdById(html); // boîte, énergie, km, année, prix, VIN de chaque carte (sku = data-id)
    const parts = html.split(/<div class="card [^"]*\bvcard\b[^"]*" data-id="/).slice(1);
    for (const part of parts) {
      const id = part.match(/^(\d+)"/)?.[1];
      if (!id || seen.has(id)) continue;
      const link = part.match(/<a href="([^"]+)" class="vcard--link">([\s\S]*?)<\/a>/);
      const makeModel = htmlText(link?.[2] ?? '');
      const version = htmlText(part.match(/vcard-main-info__version-heading">([\s\S]*?)<\/h3>/)?.[1] ?? '');
      const params = new Map<string, string>();
      for (const m of part.matchAll(/vcard-submain-info__label">([\s\S]*?)<\/span>\s*<span[^>]*vcard-submain-info__info">([\s\S]*?)<\/span>/g)) params.set(htmlText(m[1]).toLowerCase(), htmlText(m[2]));
      // Variante compacte (04/11) : « 12/2025 - 10 Km - Hybride » ou « 2026 - Essence » dans vcard-consumption__title.
      if (params.size === 0) {
        // Edenauto : titre vide, les mêmes données sont dans trois <… class="vcard-consumption__item"> (ville, 12/2023, 39 223 Km, Hybride).
        const line = htmlText(part.match(/<p class="vcard-consumption__title">([\s\S]*?)<\/p>/)?.[1] ?? ''); // Edenauto : le titre est un <div> qui englobe les items
        const items = [...part.matchAll(/vcard-consumption__item"[\s\S]*?<p>([\s\S]*?)<\/p>/g)].map((m) => htmlText(m[1]));
        // SIPA : troisième variante, trois « vcard-icons-info__item-label » (date, km, énergie).
        for (const m of part.matchAll(/vcard-icons-info__item-label[^>]*>([\s\S]*?)<\/(?:span|div|p)>/g)) items.push(htmlText(m[1]));
        for (const tok of (line ? line.split(/\s+-\s+/) : items).map((x) => x.trim()).filter(Boolean)) {
          if (/^(\d{2}\/)?\d{4}$/.test(tok)) params.set('mise en circulation', tok);
          else if (/^[\d\s ]+km$/i.test(tok)) params.set('kilométrage', tok);
          else params.set('energie', tok);
        }
      }
      const price = priceOrNull((part.match(/vcard-price__price[^"]*">\s*([\d\s ]+)€/)?.[1] ?? '').replace(/[\s ]/g, ''));
      const mec = params.get('mise en circulation') ?? '';
      const year = num(mec.match(/(\d{4})/)?.[1]);
      const gear = params.get('boîte de vitesses') ?? params.get('boite de vitesses') ?? '';
      const sold = /vcard--status-(sold|reserved)/.test(part.slice(0, 400));
      // Cartes compactes (SIPA, Sofibrie, Edenauto, Bony) sans boîte : JSON-LD de la page (18/11). Neuve (badge « Neuf »,
      // adresse « /voitures/neuves-… ») : ni la carte ni le JSON-LD ne donnent de km → 0.
      const d = ld.get(id);
      const isNew = /\bebadge--new\b/.test(part.slice(0, 1500)) || /\/voitures\/neuve/.test(link?.[1] ?? '');
      const priceAll = price ?? d?.price ?? null;
      seen.add(id); added++;
      out.push({
        external_id: id, url: link?.[1] ?? null, title: [makeModel, version].filter(Boolean).join(' ').trim(), brand: makeModel.split(/\s+/)[0] || null, model: makeModel.split(/\s+/).slice(1).join(' ') || null,
        price: priceAll, km: num(params.get('kilométrage')?.replace(/km/i, '').replace(/\s/g, '')) ?? d?.km ?? (isNew ? 0 : null), year: year ?? d?.year ?? null,
        fuel: params.get('energie') ?? params.get('énergie') ?? d?.fuel ?? null,
        gearbox: (/auto/i.test(gear) ? 'Automatique' : /manu/i.test(gear) ? 'Manuelle' : gear || null) ?? d?.gearbox ?? null,
        plate: null, vin: d?.vin ?? null, body: null, image: part.match(/<img src="([^"]+)"/)?.[1] ?? null,
        listed_at: mec && /^\d{2}\/\d{4}$/.test(mec) ? null : null,
        status: sold ? 'sold' : priceAll == null ? 'price_on_request' : null, currency: 'EUR',
      });
    }
    return added;
  };
  let pages = 1;
  let added = parse(firstHtml);
  const perPage = added;
  // Total annoncé et liens « &amp;page=99 » décodés (18/11 : Sofibrie ne voyait que « &page=2 » → 22 pages, 286 voitures
  // sur 1 316 ; Bony plafonnée à MAX_PAGES = 150 pages, 1 950 voitures sur 3 193).
  const declared = websparkDeclared(firstHtml);
  const lastLinked = Math.max(0, ...[...firstHtml.replace(/&amp;/g, '&').matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])));
  const cap = declared != null && perPage > 0 ? Math.min(400, Math.ceil(declared / perPage) + 1) : Math.min(MAX_PAGES, Math.max(lastLinked, 1) + 20);
  // Une page plus courte que la première est la dernière (au-delà, l'origine répond 429 et non 404).
  for (let p = 2; p <= cap && added >= perPage && added > 0; p++) {
    await sleep(10_000); // rythme toléré par l'origine : une page hors cache toutes les ~10 s
    const r = await getTextPatient(withParam(url, 'page', String(p)));
    if (r.status !== 200) { if (r.status !== 404) warnings.push(`page ${p} : HTTP ${r.status}`); break; }
    added = parse(r.text); if (added > 0) pages = p;
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  return { provider: 'webspark', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

// ── catalogpager (Groupe DMD, 04/11) : 1 143 voitures, 12 par page, 96 pages servies en POST « filters[page]=N ».
async function scrapeCatalogPager(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const endpoint = firstHtml.match(/data-ajax-request-search="([^"]+)"/)?.[1] ?? '/ajax/search';
  const declared = num(firstHtml.match(/<strong>\s*([\d\s ]+)\s*véhicules?\s*<\/strong>/i)?.[1]?.replace(/[\s ]/g, ''));
  const lastLinked = Math.max(1, ...[...firstHtml.matchAll(/data-page="(\d+)"/g)].map((m) => Number(m[1])));
  const parse = (html: string): number => {
    let added = 0;
    for (const m of html.matchAll(/<a href="([^"]+)" class="fiche_vehicule[^"]*">([\s\S]*?)<\/a>/g)) {
      const [, href, inner] = m;
      const id = inner.match(/\/media\/upload\/vo\/(\d+)\//)?.[1] ?? href;
      if (seen.has(id)) continue;
      const nom = htmlText(inner.match(/class="nom">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const version = htmlText(inner.match(/class="version">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const prix = htmlText(inner.match(/class="prix">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? '');
      const date = htmlText(inner.match(/icon-ui-calendrier"><span>([\s\S]*?)<\/span>/)?.[1] ?? '');
      const kmS = htmlText(inner.match(/icon-ui-kilometrage"><span>([\s\S]*?)<\/span>/)?.[1] ?? '');
      const fuel = htmlText(inner.match(/icon-ui-energie"><span>([\s\S]*?)<\/span>/)?.[1] ?? '');
      const price = priceOrNull((prix.match(/([\d\s ]+)€/)?.[1] ?? '').replace(/[\s ]/g, ''));
      // « Land-rover Range Rover Sport », « Mg-motor ZS » : le site soude la marque par un tiret ; on la déplie puis
      // splitTitle sépare marque (une ou deux mots) et modèle comme pour les autres vitrines.
      const nomClean = nom.replace(/^([A-Za-z]+)-([A-Za-z]+)\b/, '$1 $2');
      const { brand, model } = splitTitle(nomClean);
      seen.add(id); added++;
      out.push({
        external_id: id, url: href.startsWith('http') ? href : origin + href, title: [nomClean, version].filter(Boolean).join(' ').trim(),
        brand, model: model ? nomClean.split(/\s+/).slice((brand ?? '').split(' ').length).join(' ') || model : null,
        price, km: num(kmS.replace(/km/i, '').replace(/\s/g, '')), year: num(date.match(/(\d{4})/)?.[1]), fuel: fuel || null,
        gearbox: gearboxOfVersion(version), // sinon fiche détail (DETAIL_READERS.catalogpager)
        plate: null, vin: null, body: null, image: inner.match(/<img src="([^"]+)"/)?.[1] ?? null, listed_at: null,
        status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(version),
      });
    }
    return added;
  };
  let pages = 1;
  let added = parse(firstHtml);
  const cap = Math.min(MAX_PAGES, lastLinked + 5);
  for (let p = 2; p <= cap && added > 0; p++) {
    await sleep(PAGE_DELAY_MS);
    const r = await getText(origin + endpoint + '?flag=html', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
      body: `filters[page]=${p}`,
    });
    if (r.status !== 200) { warnings.push(`page ${p} : HTTP ${r.status}`); break; }
    let html = '';
    try { html = String((JSON.parse(r.text) as { html?: string }).html ?? ''); } catch { warnings.push(`page ${p} : réponse illisible`); break; }
    added = parse(html); if (added > 0) pages = p;
    if (declared != null && out.length >= declared) break;
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  return { provider: 'catalogpager', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

/** Texte d'un bloc HTML en jetons : balises → séparateurs, entités décodées, blancs repliés. */
const htmlTokens = (s: string): string[] => htmlText(s.replace(/<[^>]+>/g, ' | ')).split('|').map((x) => x.trim()).filter((x) => /[\p{L}\p{N}€]/u.test(x));
/** Paires « Étiquette | Valeur » lues dans une liste de jetons (Kilometerstand | 27514 km…). */
const pairsOf = (tokens: string[], labels: RegExp): Map<string, string> => {
  const m = new Map<string, string>();
  for (let i = 0; i + 1 < tokens.length; i++) if (labels.test(tokens[i]) && !m.has(tokens[i].toLowerCase())) m.set(tokens[i].toLowerCase().replace(/[:\s]+$/, ''), tokens[i + 1]);
  return m;
};
const gearboxOf = (t: string | null | undefined): string | null => (!t ? null : /auto|dsg|dct|eat|bva|cvt|steptronic|s-?tronic|tiptronic|powershift|séquentielle|sequentielle/i.test(t) ? 'Automatique' : /manu|schalt|bvm|handgeschakeld/i.test(t) ? 'Manuelle' : t);
const euro = (t: string | null | undefined): number | null => {
  // « 34.999,00 € », « 11 955€ », « € 64.990,- », « 17.500€ » → entier d'euros.
  const m = (t ?? '').match(/(\d{1,3}(?:[\s .]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:€|&euro;|,-)|(?:€|&euro;)\s*(\d{1,3}(?:[\s .]\d{3})+|\d+)/);
  const raw = m?.[1] ?? m?.[2];
  return raw ? priceOrNull(raw.replace(/[\s .]/g, '')) : null;
};
const kmOf = (t: string | null | undefined): number | null => { const m = (t ?? '').match(/(\d{1,3}(?:[\s .]\d{3})+|\d+)\s*km/i); return m ? num(m[1].replace(/[\s .]/g, '')) : null; };
const yearOf = (t: string | null | undefined): number | null => { const m = (t ?? '').match(/\b((?:19|20)\d{2})\b/); return m ? num(m[1]) : null; };
/** Pagination générique : lit page 1 (déjà chargée) puis `urlOf(p)` tant que des cartes nouvelles arrivent. */
// ── jetlisting (Regge Autogroep, 09/11) : la liste est paginée en AJAX signé (« /page/N/ » rend toujours les 6 mêmes
//    voitures, l'appel JetEngine refuse « Invalid query signature »). Lecture par l'API REST WordPress du site
//    (/wp-json/wp/v2/vehicle : 156 fiches, titre, lien, marque/modèle/énergie/boîte en classes) puis CHAQUE fiche
//    pour km, année, couleur et prix (champs dynamiques JetEngine, mêmes que sur les cartes).
async function scrapeJetListing(url: string, firstHtml: string): Promise<DealerStockResult> {
  const base = url.replace(/\/page\/\d+\/?$/, '').replace(/\/?$/, '/');
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/<div class="jet-listing-grid__item /).slice(1)) {
      const href = part.match(/data-url="([^"]+)"/)?.[1];
      if (!href) continue;
      const id = href.match(/\/(\d+)-[^/]*\/?$/)?.[1] ?? href;
      if (seen.has(id)) continue;
      const heads = [...part.matchAll(/<(?:h\d|p) class="elementor-heading-title[^"]*">([\s\S]*?)<\/(?:h\d|p)>/g)].map((m) => htmlText(m[1]));
      const fields = [...part.matchAll(/jet-listing-dynamic-field__content"\s*>([\s\S]*?)<\/div>/g)].map((m) => htmlText(m[1]));
      const title = heads[0] ?? '';
      const version = heads[1] ?? '';
      if (!title) continue;
      const kmText = fields.find((f) => /\bkm\b/i.test(f)) ?? null;
      const year = fields.map(yearOf).find((y) => y != null) ?? null;
      const fuel = fields.find((f) => /^(elektrisch|benzine|diesel|hybride|plug-?in|lpg|cng|waterstof|hybrid)/i.test(f)) ?? null;
      const gear = fields.find((f) => /^(automaat|handgeschakeld|automatisch|handmatig)/i.test(f)) ?? null;
      const priceText = fields.find((f) => /^€/.test(f) && !/p\/m|per maand/i.test(f)) ?? null;
      const price = euro(priceText);
      const { brand, model } = splitTitle(title);
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title: [title, version].filter(Boolean).join(' '), brand, model, price,
        km: kmOf(kmText), year, fuel, gearbox: gearboxOf(gear), plate: null, vin: null, body: null,
        image: part.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null,
        status: /verkocht|gereserveerd/i.test(part) ? 'sold' : price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(version),
      });
    }
    return added;
  };
  parse(firstHtml);
  const warnings: string[] = [];
  let pages = 1;
  let declared: number | null = null;
  // Liste complète par l'API REST du site, puis fiches pour les données chiffrées.
  type WpPost = { id: number; link: string; title?: { rendered?: string }; class_list?: string[] };
  const origin = new URL(base).origin;
  const slugOf = (cls: string[] | undefined, prefix: string) => (cls ?? []).find((c) => c.startsWith(prefix))?.slice(prefix.length).replace(/-/g, ' ') ?? null;
  const cap = (t: string | null) => (t ? t.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : null);
  try {
    for (let p = 1; p <= 40; p++) {
      const r = await getTextPatient(`${origin}/wp-json/wp/v2/vehicle?per_page=100&page=${p}&_fields=id,link,title,class_list`);
      if (r.status !== 200) { if (p > 1 && r.status === 400) break; warnings.push(`API REST du site : HTTP ${r.status} (page ${p})`); break; }
      if (p === 1) declared = num(r.headers.get('x-wp-total')) ?? null;
      const posts = JSON.parse(r.text) as WpPost[];
      if (!Array.isArray(posts) || posts.length === 0) break;
      pages = p;
      for (const post of posts) {
        const id = post.link.match(/\/(\d+)-[^/]*\/?$/)?.[1] ?? String(post.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const title = htmlText(post.title?.rendered ?? '');
        await sleep(150);
        const d = await getTextPatient(post.link);
        const fields = d.status === 200 ? [...d.text.matchAll(/jet-listing-dynamic-field__content"\s*>([\s\S]*?)<\/div>/g)].map((m) => htmlText(m[1])) : [];
        if (d.status !== 200) warnings.push(`fiche ${id} : HTTP ${d.status}`);
        const kmText = fields.find((f) => /\bkm\b/i.test(f)) ?? null;
        const year = fields.map(yearOf).find((y) => y != null) ?? null;
        const priceText = fields.find((f) => /^€/.test(f) && !/p\/m|per maand/i.test(f)) ?? null;
        const price = euro(priceText);
        const sp = splitTitle(title);
        const brand = cap(slugOf(post.class_list, 'merk-')) ?? sp.brand;
        const model = cap(slugOf(post.class_list, 'model-')) ?? sp.model;
        const fuel = cap(slugOf(post.class_list, 'brandstof-')) ?? fields.find((f) => /^(elektrisch|benzine|diesel|hybride|plug-?in|lpg|cng|waterstof|hybrid)/i.test(f)) ?? null;
        const gear = cap(slugOf(post.class_list, 'transmissie-')) ?? fields.find((f) => /^(automaat|handgeschakeld)/i.test(f)) ?? null;
        out.push({
          external_id: id, url: post.link, title, brand, model, price, km: kmOf(kmText), year, fuel, gearbox: gearboxOf(gear),
          plate: null, vin: null, body: cap(slugOf(post.class_list, 'carrosserie-')), image: d.status === 200 ? d.text.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null : null,
          listed_at: null, status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(title),
        });
      }
      if (posts.length < 100) break;
      await sleep(PAGE_DELAY_MS);
    }
  } catch (e) {
    warnings.push(`API REST du site illisible : ${e instanceof Error ? e.message : String(e)}`);
  }
  // Les cartes de la première page ont été lues d'abord (seen) : pour elles, pas de fiche relue → on les garde telles quelles.
  if (warnings.length > 12) { warnings.length = 12; warnings.push('…'); }
  return { provider: 'jetlisting', total: out.length, declared, vehicles: out, pages, warnings };
}

// ── gatsbyvehicles (Autobedrijf Wijnne, 09/11) : plan de site → fiches /page-data/…/page-data.json (105 voitures).
async function scrapeGatsbyVehicles(url: string): Promise<DealerStockResult> {
  const u = new URL(url);
  const prefix = u.pathname.replace(/\/?$/, '/');
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  // Plan de site : sitemap-0.xml directement, sinon l'index.
  const smUrls = [`${u.origin}/sitemap-0.xml`, `${u.origin}/sitemap-index.xml`];
  let locs: string[] = [];
  for (const sm of smUrls) {
    const r = await getTextPatient(sm);
    if (r.status !== 200) continue;
    const found = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    const pages = found.filter((l) => l.includes(prefix) && /\/\d+\/?$/.test(l) && !/\/aanvraag\//.test(l));
    if (pages.length) { locs = pages; break; }
    // Index : les sous-plans
    for (const sub of found.filter((l) => /sitemap[^/]*\.xml$/.test(l))) {
      const rs = await getTextPatient(sub);
      if (rs.status !== 200) continue;
      locs.push(...[...rs.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter((l) => l.includes(prefix) && /\/\d+\/?$/.test(l) && !/\/aanvraag\//.test(l)));
    }
    if (locs.length) break;
  }
  if (locs.length === 0) return { provider: 'gatsbyvehicles', total: null, declared: null, vehicles: [], pages: 1, warnings: ['plan de site sans fiche de véhicule (sitemap-0.xml)'] };
  type GV = { make?: string; model?: string; type?: string; name?: string; lowestPrice?: number | null; regularPrice?: number | null; salePrice?: number | null; odometer?: number | null; odometerUnit?: string | null; buildyear?: number | null; fuel?: string | null; transmission?: string | null; powerHp?: number | null; licensePlate?: string | null; vin?: string | null; baseColor?: string | null; color?: string | null; body?: string | null; isNewVehicle?: boolean | null; image?: { url?: string } | null; slug?: string | null };
  const seen = new Set<string>();
  let read = 0;
  for (const loc of [...new Set(locs)]) {
    const path = new URL(loc).pathname.replace(/\/?$/, '/');
    const id = path.match(/\/(\d+)\/$/)?.[1] ?? path;
    if (seen.has(id)) continue;
    seen.add(id);
    await sleep(120);
    const r = await getTextPatient(`${u.origin}/page-data${path}page-data.json`);
    if (r.status !== 200) { warnings.push(`fiche ${id} : HTTP ${r.status}`); continue; }
    let v: GV | undefined;
    try { v = (JSON.parse(r.text) as { result?: { data?: { vehicle?: GV } } }).result?.data?.vehicle; } catch { /* JSON cassé */ }
    if (!v) { warnings.push(`fiche ${id} : pas de véhicule dans page-data`); continue; }
    read++;
    const price = v.lowestPrice ?? v.salePrice ?? v.regularPrice ?? null;
    const title = [v.make, v.model, v.type].filter(Boolean).join(' ') || (v.name ?? '').split(' - ')[0];
    const kmRaw = v.odometer ?? null;
    out.push({
      external_id: id, url: loc, title, brand: v.make ?? null, model: v.model ?? null, price: price != null && price > 0 ? Math.round(price) : null,
      km: kmRaw != null ? Math.round(/mile/i.test(v.odometerUnit ?? '') ? kmRaw * 1.609 : kmRaw) : null, year: v.buildyear ?? null,
      fuel: v.fuel ?? null, gearbox: gearboxOf(v.transmission ?? null), plate: v.licensePlate ?? null, vin: v.vin ?? null, body: v.body ?? null,
      image: v.image?.url ?? null, listed_at: null, status: price == null || price <= 0 ? 'price_on_request' : null, currency: 'EUR', power_ch: v.powerHp ?? null,
    });
  }
  if (warnings.length > 12) { warnings.length = 12; warnings.push('…'); }
  return { provider: 'gatsbyvehicles', total: out.length, declared: locs.length, vehicles: out, pages: Math.max(1, read), warnings };
}

async function paginate(firstHtml: string, parse: (html: string) => number, urlOf: (p: number) => string, opts: { cap?: number; delay?: number; stopWhenShort?: boolean } = {}): Promise<{ pages: number; warnings: string[] }> {
  const warnings: string[] = [];
  let pages = 1;
  let added = parse(firstHtml);
  const perPage = added;
  const cap = opts.cap ?? MAX_PAGES;
  for (let p = 2; p <= cap && added > 0 && !(opts.stopWhenShort && added < perPage); p++) {
    await sleep(opts.delay ?? PAGE_DELAY_MS);
    const r = await getTextPatient(urlOf(p));
    if (r.status !== 200) { if (r.status !== 404) warnings.push(`page ${p} : HTTP ${r.status}`); break; }
    added = parse(r.text); if (added > 0) pages = p;
  }
  return { pages, warnings };
}

// ── flexicar (ES, 04/11) : API publique du site, 12 par page. L'URL de la fiche choisit le périmètre :
//    « /concesionario-<slug>/ » ou « /delegaciones-flexicar/<slug>/ » = une concession, « /coches-<province>/segunda-mano/ »
//    = une province, sinon tout le réseau (23 000 voitures, ~1 900 pages).
async function scrapeFlexicar(url: string): Promise<DealerStockResult> {
  const u = new URL(url);
  const dealer = u.pathname.match(/\/(?:concesionario|delegaciones-flexicar)[-/]([a-z0-9-]+)\//)?.[1] ?? null;
  const province = dealer ? null : u.pathname.match(/\/coches-([a-z0-9-]+)\/segunda-mano\//)?.[1] ?? null;
  const api = u.hostname.endsWith('.pt') ? 'https://services.flexicar.pt/api/v1/vehicles' : 'https://services.flexicar.es/api/v1/vehicles';
  const scope = dealer ? `carDealership=${encodeURIComponent(dealer)}` : province ? `province=${encodeURIComponent(province)}` : '';
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let declared: number | null = null;
  let pages = 0;
  type Fx = { id: number | string; brand?: string; model?: string; version?: string; fuel?: string; km?: number; price?: number; cashPrice?: number; year?: number; transmission?: string; image?: string; slug?: string; reserved?: boolean; carDealership?: string };
  for (let p = 1; p <= 2000; p++) {
    if (p > 1) await sleep(PAGE_DELAY_MS);
    const r = await getTextPatient(`${api}?${scope ? scope + '&' : ''}page=${p}&limit=100`);
    if (r.status !== 200) { warnings.push(`page ${p} : HTTP ${r.status}`); break; }
    let d: { hasNext?: boolean; total?: number; results?: Fx[] };
    try { d = JSON.parse(r.text); } catch { warnings.push(`page ${p} : réponse illisible`); break; }
    declared = declared ?? (typeof d.total === 'number' ? d.total : null);
    pages = p;
    let added = 0;
    for (const v of d.results ?? []) {
      const id = String(v.id);
      if (seen.has(id)) continue;
      seen.add(id); added++;
      const price = v.cashPrice ?? v.price ?? null;
      out.push({
        external_id: id, url: v.slug ? `https://${u.hostname}/coches-ocasion/${v.slug}/` : null, title: [v.brand, v.model, v.version].filter(Boolean).join(' '),
        brand: v.brand ?? null, model: v.model ?? null, price: price != null && price > 0 ? Math.round(price) : null, km: v.km ?? null, year: v.year ?? null, fuel: v.fuel ?? null,
        gearbox: gearboxOf(v.transmission), plate: null, vin: null, body: null, image: v.image ?? null, listed_at: null,
        status: v.reserved ? 'reserved' : price == null || price <= 0 ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(v.version),
      });
    }
    if (!d.hasNext || added === 0) break;
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  if (!scope) warnings.push('périmètre : tout le réseau Flexicar (aucune concession dans l\'URL)');
  return { provider: 'flexicar', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

// ── interstrip (DE, 04/11) : une page, 12 voitures, texte de la carte « BMW | X5 | version | 10 / 2025 | 17.800 km | Automatik | Hybrid | 64.990 € ».
async function scrapeInterstrip(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const grid = firstHtml.slice(firstHtml.indexOf('class="vehicle-grid'));
  for (const m of grid.matchAll(/<a class="group block" href="([^"]+)">([\s\S]*?)<\/article>/g)) {
    const [, href, inner] = m;
    const id = href.match(/-(\d{8,})$/)?.[1] ?? href;
    if (seen.has(id)) continue;
    const t = htmlTokens(inner.replace(/<svg[\s\S]*?<\/svg>/g, ''));
    const brand = htmlText(inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '').replace(/<!--.*?-->/g, '');
    const [bk, ...rest] = brand.split(/\s+/);
    const version = inner.match(/<p[^>]*title="([^"]*)"/)?.[1] ?? null;
    const txt = t.join(' ');
    const date = t.find((x) => /^(?:19|20)\d{2}$/.test(x)) ?? null;
    const price = euro(txt.match(/[\d.]+\s*€/)?.[0]);
    seen.add(id);
    out.push({
      external_id: id, url: origin + href, title: [brand, version].filter(Boolean).join(' '), brand: bk || null, model: rest.join(' ') || null,
      price, km: kmOf(txt), year: yearOf(date), fuel: t.find((x) => /benzin|diesel|hybrid|elektro|lpg|cng/i.test(x)) ?? null,
      gearbox: gearboxOf(t.find((x) => /^(automatik|schaltgetriebe|halbautomatik)$/i.test(x))), plate: null, vin: null, body: null,
      image: decodeURIComponent(inner.match(/url=([^&"]+)/)?.[1] ?? '') || null, listed_at: null, status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(version),
    });
  }
  return { provider: 'interstrip', total: out.length, declared: null, vehicles: out, pages: 1, warnings: [] };
}

// ── shopware (Bleker, 04/11) : cartes « product-box box-vehicle », paires Fahrzeugnr./Kraftstoff/Kilometerstand/Getriebe/Leistung/Erstzulassung, pages « ?p=N ».
async function scrapeShopware(url: string, firstHtml: string): Promise<DealerStockResult> {
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/product-box box-vehicle"/).slice(1)) {
      const link = part.match(/href="(https?:\/\/[^"]+\/(\d{4,}))"[^>]*\stitle="([^"]*)"/);
      if (!link) continue;
      const [, href, id, title] = link;
      if (seen.has(id)) continue;
      const brand = part.match(/itemprop="brand"\s+content="([^"]*)"/)?.[1] ?? null;
      const t = htmlTokens(part.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ''));
      const pr = pairsOf(t, /^(Fahrzeugnr\.|Zustand|Kraftstoff|Kilometerstand|Getriebe|Leistung|Erstzulassung|Barpreis)$/i);
      const price = euro(pr.get('barpreis') ?? t.find((x) => /€/.test(x)));
      const kw = num(pr.get('leistung')?.match(/(\d+)\s*kw/i)?.[1]);
      const model = brand && title.toLowerCase().startsWith(brand.toLowerCase()) ? title.slice(brand.length).trim().split(/\s+/)[0] ?? null : splitTitle(title).model;
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title: htmlText(title), brand, model, price, km: kmOf(pr.get('kilometerstand')), year: yearOf(pr.get('erstzulassung')),
        fuel: pr.get('kraftstoff') ?? null, gearbox: gearboxOf(pr.get('getriebe')), plate: null, vin: null, body: null,
        image: part.match(/<img[^>]+(?:data-src|src)="([^"]+)"/)?.[1] ?? null, listed_at: null, status: price == null ? 'price_on_request' : null, currency: 'EUR',
        power_ch: kw != null ? Math.round(kw * 1.35962) : powerFromText(pr.get('leistung')),
      });
    }
    return added;
  };
  const { pages, warnings } = await paginate(firstHtml, parse, (p) => withParam(url, 'p', String(p)), { cap: 400 }); // Bleker : ~2 600 voitures, 12 par page
  return { provider: 'shopware', total: out.length, declared: null, vehicles: out, pages, warnings };
}

// ── wpcarsync (Voets, 04/11) : cartes « voets_single_vehicle », make/model/model_description, paires Erstzulassung/Leistung/Getriebe/Kilometerstand, pages « /page/N/ ».
async function scrapeWpcarsync(url: string, firstHtml: string): Promise<DealerStockResult> {
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/voets_single_vehicle"/).slice(1)) {
      const href = part.match(/<a[^>]+href="([^"]+)"/)?.[1];
      if (!href) continue;
      const id = href.match(/-([0-9a-f]{16,})\/?$/)?.[1] ?? href;
      if (seen.has(id)) continue;
      const make = htmlText(part.match(/class="make">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const model = htmlText(part.match(/class="model">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const desc = htmlText(part.match(/class="model_description">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const t = htmlTokens(part.replace(/<svg[\s\S]*?<\/svg>/g, ''));
      const pr = pairsOf(t, /^(Erstzulassung|Leistung|Getriebe|Kilometerstand|Kraftstoff|Antrieb|Farbe)$/i);
      const price = euro(part.match(/price_brutto[^>]*>([\s\S]*?)<\/span>/)?.[1]);
      const kw = num(pr.get('leistung')?.match(/(\d+)\s*kw/i)?.[1]);
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title: [make, model, desc].filter(Boolean).join(' '), brand: make || null, model: model || null, price,
        km: kmOf(pr.get('kilometerstand')), year: yearOf(pr.get('erstzulassung')), fuel: pr.get('kraftstoff') ?? null, gearbox: gearboxOf(pr.get('getriebe')),
        plate: null, vin: null, body: null, image: part.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null,
        status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: kw != null ? Math.round(kw * 1.35962) : null,
      });
    }
    return added;
  };
  // « /page/N/ » renvoie la vitrine des modèles, pas le stock : la vraie pagination est « ?wpcs_paged=N » (prouvé 04/11).
  const { pages, warnings } = await paginate(firstHtml, parse, (p) => withParam(url, 'wpcs_paged', String(p)), { cap: 250 });
  if (pages === 1 && /Mehr als [\d.]+ Fahrzeuge/i.test(firstHtml)) warnings.push('seule la première page est lisible : la pagination du site se fait en JavaScript (toutes les variantes d\'URL testées le 04/11 renvoient la même page)');
  return { provider: 'wpcarsync', total: out.length, declared: null, vehicles: out, pages, warnings };
}

// ── divivoertuig (Van Dijk Automotive, 04/11) : <article class="item">, prix « voertuig-prijs », liste Bouwjaar/Km.stand/Transm/Brandstof, pages « /page/N/ ».
async function scrapeDiviVoertuig(url: string, firstHtml: string): Promise<DealerStockResult> {
  const base = url.replace(/#.*$/, '').replace(/\/page\/\d+\/?$/, '').replace(/\/?$/, '/');
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/class="item">/).slice(1)) {
      const href = part.match(/<a href="([^"]+\/voertuig\/[^"]+)"/)?.[1];
      if (!href) continue;
      const id = href.match(/\/voertuig\/(\d+)/)?.[1] ?? href;
      if (seen.has(id)) continue;
      const title = htmlText(part.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? '');
      const li = new Map<string, string>();
      for (const m of part.matchAll(/<li>([^:<]+):\s*([^<]*)<\/li>/g)) li.set(m[1].trim().toLowerCase(), htmlText(m[2]));
      const price = euro(part.match(/voertuig-prijs">([\s\S]*?)<\/div>/)?.[1]);
      const { brand, model } = splitTitle(title);
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title, brand, model, price, km: kmOf((li.get('km.stand') ?? '') + ' km'), year: yearOf(li.get('bouwjaar')),
        fuel: li.get('brandstof') ?? null, gearbox: gearboxOf(li.get('transm')), plate: null, vin: null, body: li.get('carrosserie') ?? null,
        image: part.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null, status: price == null ? 'price_on_request' : null, currency: 'EUR',
      });
    }
    return added;
  };
  const { pages, warnings } = await paginate(firstHtml, parse, (p) => `${base}page/${p}/`);
  return { provider: 'divivoertuig', total: out.length, declared: null, vehicles: out, pages, warnings };
}

// ── carwp (C.A.R, 04/11) : une page par marque (liens « /occasions/occasions-<marque>/ » du menu), cartes data-ref, h2.car-name, h3.car-prix.
async function scrapeCarWp(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/<article[^>]*data-ref="/).slice(1)) {
      const id = part.match(/^(\d+)"/)?.[1];
      if (!id || seen.has(id)) continue;
      const name = htmlText(part.match(/car-name"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
      const href = part.match(/car-name"[^>]*>\s*<a href="([^"]+)"/)?.[1] ?? null;
      const price = euro(part.match(/car-prix"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1]);
      const desc = htmlText(part.match(/car-shortdesc"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '');
      const { brand, model } = splitTitle(name);
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title: name, brand, model, price, km: kmOf(desc), year: yearOf(desc),
        fuel: desc.match(/diesel|essence|hybride|électrique|electrique|gpl/i)?.[0] ?? null, gearbox: gearboxOf(name + ' ' + desc) === 'Automatique' ? 'Automatique' : /BVM/i.test(name + ' ' + desc) ? 'Manuelle' : null,
        plate: null, vin: null, body: null, image: part.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null, status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(name),
      });
    }
    return added;
  };
  parse(firstHtml);
  const brandPages = [...new Set([...firstHtml.matchAll(/href="((?:https?:\/\/[^/"]+)?\/occasions\/occasions-[a-z0-9-]+\/)"/g)].map((m) => (m[1].startsWith('http') ? m[1] : origin + m[1])))].filter((u) => u !== url);
  let pages = 1;
  for (const bp of brandPages) {
    await sleep(PAGE_DELAY_MS);
    const r = await getTextPatient(bp);
    if (r.status !== 200) { warnings.push(`${bp.replace(origin, '')} : HTTP ${r.status}`); continue; }
    parse(r.text); pages++;
  }
  return { provider: 'carwp', total: out.length, declared: null, vehicles: out, pages, warnings };
}

// ── regeljelease (Van der Wal Vans, 04/11) : cartes « card-click » (titre | année | carburant | km | boîte | … | prix), pages « ?page=N ».
async function scrapeRegeljelease(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    for (const m of html.matchAll(/<a class="card[^"]*card-click[^"]*"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const [, href, inner] = m;
      const id = href.match(/-(\d{6,})(?:\?|$)/)?.[1] ?? href;
      if (seen.has(id)) continue;
      const t = htmlTokens(inner.replace(/<picture>[\s\S]*?<\/picture>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/data-gallery="[^"]*"/g, ''));
      const title = t[0] ?? '';
      const prices = t.filter((x) => /(€|&euro;)\s*[\d.]+,\d{2}$/.test(x) && !/p\/m/i.test(x));
      const price = euro(prices[prices.length - 1]);
      const { brand, model } = splitTitle(title);
      seen.add(id); added++;
      out.push({
        external_id: id, url: href.startsWith('http') ? href : origin + href, title, brand, model, price,
        km: kmOf(t.find((x) => /km$/i.test(x))), year: num(t.find((x) => /^(19|20)\d{2}$/.test(x))), fuel: t.find((x) => /^(diesel|benzine|elektrisch|hybride|lpg|cng|waterstof)/i.test(x)) ?? null,
        gearbox: gearboxOf(t.find((x) => /^(automaat|handgeschakeld)$/i.test(x))), plate: null, vin: null, body: null,
        image: inner.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null, status: /data-is-sold="true"/.test(inner) ? 'sold' : price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(title),
      });
    }
    return added;
  };
  const last = Math.max(1, ...[...firstHtml.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])));
  const { pages, warnings } = await paginate(firstHtml, parse, (p) => withParam(url, 'page', String(p)), { cap: Math.min(MAX_PAGES, last + 3) });
  return { provider: 'regeljelease', total: out.length, declared: null, vehicles: out, pages, warnings };
}

// ── vgrf (Škoda Nantes / VGRF, 04/11) : cartes « ListeNewVoiture » data-vehicule-id, 12 par page « ?start=N », total « data-vehicules-listing-total ».
async function scrapeVgrf(url: string, firstHtml: string): Promise<DealerStockResult> {
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const declared = num(firstHtml.match(/data-vehicules-listing-total="(\d+)"/)?.[1]);
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/class="ListeNewVoiture/).slice(1)) {
      const id = part.match(/data-vehicule-id="([^"]+)"/)?.[1];
      if (!id || seen.has(id)) continue;
      const href = part.match(/href="(https?:\/\/[^"]+\/occasion\/[^"]+)"/)?.[1] ?? null;
      const alt = part.match(/alt="Voitures occasions ([^"]+)"/)?.[1] ?? '';
      const t = htmlTokens(part.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ''));
      const iPrix = t.findIndex((x) => /^Prix TTC/i.test(x));
      const price = euro(iPrix >= 0 ? t[iPrix + 1] : t.find((x) => /\d\s*€$/.test(x)));
      const year = num(t.find((x) => /^(19|20)\d{2}$/.test(x)));
      const km = kmOf(t.find((x) => /km$/i.test(x)));
      // « … | 44700 Orvault | Essence | Rob double embray | 2024 | 125 156 Km » : la boîte est le jeton qui suit l'énergie
      // (18/11 : 82 « Rob double embray » sur 120 n'étaient pas lues).
      const iFuel = t.findIndex((x) => /^(essence|diesel|hybride|électrique|electrique|gpl|ethanol|gnv)/i.test(x));
      const fuel = iFuel >= 0 ? t[iFuel] : null;
      const next = iFuel >= 0 ? t[iFuel + 1] : undefined;
      const gear = next && !/^(19|20)\d{2}$|km$/i.test(next) ? next : t.find(isGearFr) ?? null;
      const { brand, model } = splitTitle(alt);
      const version = brand && model ? alt.replace(new RegExp(`^${brand}\\s+${model}\\s*`, 'i'), '') : alt;
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title: alt, brand, model, price, km, year, fuel, gearbox: gearboxFr(gear), plate: null, vin: null, body: null,
        image: part.match(/data-src="([^"]+)"/)?.[1] ?? null, listed_at: null, status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(version),
      });
    }
    return added;
  };
  let pages = 1;
  let added = parse(firstHtml);
  const perPage = Math.max(added, 12);
  const warnings: string[] = [];
  for (let start = perPage; added > 0 && (declared == null ? start < perPage * MAX_PAGES : start < declared); start += perPage) {
    await sleep(PAGE_DELAY_MS);
    const r = await getTextPatient(withParam(url, 'start', String(start)));
    if (r.status !== 200) { warnings.push(`start=${start} : HTTP ${r.status}`); break; }
    added = parse(r.text); if (added > 0) pages++;
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  return { provider: 'vgrf', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

// ── yooflex (Groupe Hecquet, 04/11) : cartes « result-item » (titre | puissance ｜ année | boîte | km | énergie | ville | prix), « N résultats », pages « ?paged=N ».
async function scrapeYooflex(url: string, firstHtml: string): Promise<DealerStockResult> {
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const declared = num(firstHtml.match(/(\d[\d\s ]*)\s*résultats?/)?.[1]?.replace(/[\s ]/g, ''));
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/class="result-item"/).slice(1)) {
      const href = part.match(/href="([^"]+\/vehicule\/(\d+))"/);
      if (!href || seen.has(href[2])) continue;
      const t = htmlTokens(part.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<ul class="uk-slider-items[\s\S]*?<\/ul>/g, ''));
      const title = t[0] ?? '';
      const { brand, model } = splitTitle(title);
      const price = euro(t.find((x) => /\d\s*€$/.test(x)));
      // « titre | 95cv ｜ 2023 | Automate à fonct. Continu | 65243 km | Essence | ville | prix » : la boîte suit « …cv ｜ année »
      // (18/11 : « Automate à fonct. Continu », « Boîte hybride multimode » n'étaient pas lues).
      const iPow = t.findIndex((x) => /\bcv\b.*\b(19|20)\d{2}\b/i.test(x));
      const gearTok = iPow >= 0 && t[iPow + 1] && !/km$|€$/i.test(t[iPow + 1]) ? t[iPow + 1] : t.find(isGearFr);
      seen.add(href[2]); added++;
      out.push({
        external_id: href[2], url: href[1], title, brand, model, price, km: kmOf(t.find((x) => /km$/i.test(x))), year: num(t.map((x) => x.match(/\b((?:19|20)\d{2})\b/)?.[1]).find(Boolean)),
        fuel: t.find((x) => /^(essence|diesel|hybride|électrique|electrique|gpl)/i.test(x)) ?? null, gearbox: gearboxFr(gearTok),
        plate: null, vin: null, body: null, image: part.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null, status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(title + ' ' + (t[1] ?? '')),
      });
    }
    return added;
  };
  // Ordre ALÉATOIRE à chaque requête (18/11) : lecture par tranches de prix / km tenant chacune sur une page.
  const perPage = parse(firstHtml);
  const { requests, warnings } = await yooflexSlices(url, firstHtml, Math.max(perPage, 1), parse);
  const pages = 1 + requests;
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  return { provider: 'yooflex', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

/** Énergie de chaque véhicule d'une page de liste, lue dans son JSON-LD ItemList (13/11, DUTCH Vans : la carte HTML n'a
 *  pas l'énergie, le bloc ld+json de la même page porte « fuelType »: "Diesel" / "Elektrisch" / "Benzine" pour chaque
 *  voiture, avec son url — 362 / 362 sur 16 pages). Clé = url sans « / » final. */
export function ldFuelByUrl(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of parseItemList(html)?.items ?? []) {
    const item = (el.item ?? {}) as Record<string, unknown>;
    const u = String(el.url ?? item.url ?? '').replace(/\/$/, '');
    if (u && item.fuelType) out.set(u, String(item.fuelType));
  }
  return out;
}
// ── dutchvans (NL, 04/11) : cartes « item-summary » (titre | km | année | boîte | Euro | Kopen | prix | Excl. btw), pages « ?pagina=N ».
async function scrapeDutchvans(url: string, firstHtml: string): Promise<DealerStockResult> {
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const parse = (html: string): number => {
    let added = 0;
    const fuels = ldFuelByUrl(html);
    for (const part of html.split(/item-summary"/).slice(1)) {
      const href = part.match(/href="(https?:\/\/[^"]+\/bedrijfswagen\/[^"]+)"/)?.[1];
      if (!href) continue;
      const id = part.match(/cdn\.dutchvans\.com\/([A-Z0-9]{10,})\//)?.[1] ?? href;
      if (seen.has(id)) continue;
      const t = htmlTokens(part.replace(/<svg[\s\S]*?<\/svg>/g, ''));
      const start = t.findIndex((x) => /bekeken$/i.test(x));
      const title = t[start + 1] ?? t[0] ?? '';
      const iKopen = t.findIndex((x) => /^kopen$/i.test(x));
      const price = euro(iKopen >= 0 ? t[iKopen + 1] : t.find((x) => /^€/.test(x)));
      const { brand, model } = splitTitle(title);
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title, brand, model, price, km: kmOf(t.find((x) => /km$/i.test(x))), year: num(t.find((x) => /^(19|20)\d{2}$/.test(x))),
        fuel: fuels.get(href.replace(/\/$/, '')) ?? null, gearbox: gearboxOf(t.find((x) => /^(automaat|handgeschakeld)$/i.test(x))), plate: null, vin: /^[A-Z0-9]{17}$/.test(id) ? id : null, body: null,
        image: part.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null, listed_at: null, status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(title),
      });
    }
    return added;
  };
  const { pages, warnings } = await paginate(firstHtml, parse, (p) => withParam(url, 'pagina', String(p)));
  return { provider: 'dutchvans', total: out.length, declared: null, vehicles: out, pages, warnings };
}

export type VehicleListRow = {
  id: string | number; urlName?: string | null; brand?: string | null; model?: string | null; version?: string | null; frameType?: string | null;
  archive?: string | null; finalPrice?: number | null; listPrice?: number | null; fuel?: string | null; km?: number | null; gearType?: string | null;
  powerHp?: number | null; image?: string | null; registrationDate?: string | null; registrationYear?: number | null; isBooked?: boolean | null; vehicleStatus?: string | null;
};
/** Une ligne de « /api/filtered-vehicle-list » → véhicule ADA (13/11). Les NEUVES (archive « nuovo ») n'ont ni km ni
 *  immatriculation : le site lui-même les masque (carte : v-if="vehicle.km && vehicle.archive != 'nuovo'") et la fiche
 *  dit « AUTOVETTURA NUOVA, PRONTA CONSEGNA ANCORA DA IMMATRICOLARE ». vehicleStatus ≠ « stock » (« assigned ») est
 *  affiché « Veicolo in arrivo » par le site = attendue. */
export function vehicleListRowToVehicle(v: VehicleListRow, origin: string): DealerVehicle {
  const price = v.finalPrice ?? v.listPrice ?? null;
  const year = v.registrationYear ?? num(v.registrationDate?.match(/(\d{4})/)?.[1]);
  return {
    external_id: String(v.id), url: v.urlName ? origin + v.urlName : null, title: [v.brand, v.model, v.version].filter(Boolean).join(' '),
    brand: v.brand ?? null, model: v.model ?? null, price: price != null && price > 0 ? Math.round(price) : null, km: v.km ?? null, year,
    fuel: v.fuel || null, gearbox: gearboxOf(v.gearType), plate: null, vin: null, body: v.frameType || null, image: v.image ?? null, listed_at: null,
    status: v.isBooked ? 'reserved' : v.vehicleStatus && v.vehicleStatus !== 'stock' ? 'expected' : price == null || price <= 0 ? 'price_on_request' : null,
    currency: 'EUR', power_ch: v.powerHp ?? null,
  };
}
/** Ce que le site ne publie pas, dit avec la raison dans le bilan (et non pris pour une lecture ratée). */
export function vehicleListGaps(rows: VehicleListRow[]): string[] {
  const nuovo = rows.filter((r) => r.archive === 'nuovo').length;
  const km0NoKm = rows.filter((r) => r.archive === 'km0' && r.km == null).length;
  const other = rows.filter((r) => r.archive !== 'nuovo' && r.archive !== 'km0' && (r.km == null || !r.registrationDate)).length;
  return [
    ...(nuovo ? [`${nuovo} voiture(s) neuve(s) (« nuovo », pas encore immatriculées) : le site ne publie ni km ni année pour elles`] : []),
    ...(km0NoKm ? [`${km0NoKm} « km 0 » sans kilométrage publié par le site (année lue)`] : []),
    ...(other ? [`${other} occasion(s) sans km ou sans année sur le site`] : []),
  ];
}
// ── vehiclelistapi (Gruppo Bossoni, 04/11) : « /api/filtered-vehicle-list?<filtres de l'URL>&pag=N&pageSize=500 ».
async function scrapeVehicleListApi(url: string): Promise<DealerStockResult> {
  const u = new URL(url);
  const origin = u.origin;
  const params = new URLSearchParams(u.search);
  params.delete('pag'); params.delete('pageSize');
  if (!params.has('groupTypes') && !params.has('groupType')) params.set('groupTypes', 'auto');
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  type Row = VehicleListRow;
  const rows: Row[] = [];
  let declared: number | null = null;
  let pages = 0;
  for (let p = 1; p <= 100; p++) {
    if (p > 1) await sleep(PAGE_DELAY_MS);
    const r = await getTextPatient(`${origin}/api/filtered-vehicle-list?${params.toString()}&pag=${p}&pageSize=500`, { headers: { Accept: 'application/json' } });
    if (r.status !== 200) { warnings.push(`page ${p} : HTTP ${r.status}`); break; }
    let d: { pagesCount?: number; totalItems?: number; vehicleList?: Row[] };
    try { d = JSON.parse(r.text); } catch { warnings.push(`page ${p} : réponse illisible`); break; }
    declared = declared ?? (typeof d.totalItems === 'number' ? d.totalItems : null);
    pages = p;
    let added = 0;
    for (const v of d.vehicleList ?? []) {
      const id = String(v.id);
      if (seen.has(id)) continue;
      seen.add(id); added++;
      rows.push(v);
      out.push(vehicleListRowToVehicle(v, origin));
    }
    if (added === 0 || (d.pagesCount != null && p >= d.pagesCount)) break;
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  warnings.push(...vehicleListGaps(rows));
  return { provider: 'vehiclelistapi', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

/** Km d'une carte rswusato : « 92.535 km », ou « Km Zero » (13/11, Gruppo Ghedini : les voitures km 0 portent le mot à
 *  la place du nombre, 88 cartes sur 230 — km lu 62 %) → 0. */
export const rswKm = (t: string): number | null => (/^km\s*(?:zero|0)$/i.test(t.trim()) ? 0 : kmOf(t));
/** Identifiant rswusato : numéro final de l'adresse (« …-usato-86340/ »), sinon l'adresse (« …-km0-n218189/ »). */
const rswId = (href: string): string => href.match(/-(\d+)\/?$/)?.[1] ?? href;
/** Fiche rswusato (13/11, Gruppo Ghedini) : paires « feature-label / feature-value » (Immatricolazione 01/2024,
 *  Alimentazione, Chilometraggio « 26.027 km » ou « Km Zero », Cambio « Automatico sequenziale a 6 marce ») et prix
 *  « <span class="price">23.000<span class="currency">€ » (le premier de la page : celui de la voiture). */
export function readRswDetail(html: string): DetailFields {
  const pair = (label: string) => htmlText(html.match(new RegExp(`<span class="feature-label">\\s*${label}\\s*<\\/span>\\s*<span class="feature-value"[^>]*>([^<]*)<\\/span>`, 'i'))?.[1] ?? '');
  const kmTxt = pair('Chilometraggio');
  return {
    year: yearOf(pair('Immatricolazione')), fuel: pair('Alimentazione') || null, km: kmTxt ? rswKm(kmTxt) : null,
    gearbox: gearboxOf(pair('Cambio') || null), price: euro(`${html.match(/<span class="price">([\d.]+)<span class="currency">/)?.[1] ?? ''} €`),
  };
}
// ── rswusato (Gruppo Ghedini, 04/11) : 16 cartes par page, « /usato/veicoli/page/N/ ».
async function scrapeRswUsato(url: string, firstHtml: string): Promise<DealerStockResult> {
  const base = url.replace(/\/page\/\d+\/?$/, '').replace(/\/?$/, '/');
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const span = (part: string, cls: string) => htmlText(part.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/span>`))?.[1] ?? '');
  // Les détails (date, km, énergie, boîte) contiennent d'abord un <span class="icon"> : le texte vient après lui.
  const detail = (part: string, cls: string) => htmlText(part.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>\\s*<span class="icon">[\\s\\S]*?<\\/span>([^<]*)<`))?.[1] ?? '');
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/<div class="card vehicle[^"]*">/).slice(1)) {
      const href = part.match(/<a href="([^"]+)"/)?.[1];
      if (!href) continue;
      const id = rswId(href);
      if (seen.has(id)) continue;
      const brand = span(part, 'vehicle-brand'), model = span(part, 'vehicle-model'), version = span(part, 'vehicle-version');
      const price = euro(part.match(/class="price">([\s\S]*?)<\/span>\s*<\/span>/)?.[1]?.replace(/<[^>]+>/g, '') ?? part.match(/class="price">([^<]*)/)?.[1] + ' €');
      const date = detail(part, 'vehicle-date');
      seen.add(id); added++;
      out.push({
        external_id: id, url: href, title: [brand, model, version].filter(Boolean).join(' '), brand: brand || null, model: model || null, price,
        km: rswKm(detail(part, 'vehicle-km')), year: yearOf(date), fuel: detail(part, 'vehicle-fuel') || null, gearbox: gearboxOf(detail(part, 'vehicle-gear') || null),
        plate: null, vin: null, body: null, image: part.match(/<img src="([^"]+)"/)?.[1] ?? null, listed_at: null,
        status: /label-venduto|Venduto/i.test(part) ? 'sold' : price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(version),
      });
    }
    return added;
  };
  const last = Math.max(1, ...[...firstHtml.matchAll(/\/page\/(\d+)\//g)].map((m) => Number(m[1])));
  const { pages, warnings } = await paginate(firstHtml, parse, (p) => `${base}page/${p}/`, { cap: Math.min(MAX_PAGES, last + 3) });
  // LISTE COMPLÉTÉE PAR L'API WORDPRESS DU SITE (13/11, Gruppo Ghedini : 230 annoncées, 226 lues — les pages sont triées
  // par prix sans départage, les 4 MÊMES voitures n'apparaissent sur aucune page à chaque lecture, 4 autres sur deux ;
  // « orderby » est ignoré). /wp-json/wp/v2/veicoli (publique, sans clé, tri par id stable) donne toutes les fiches ;
  // celles que les pages n'ont pas montrées sont lues une à une sur leur fiche.
  let declared: number | null = null;
  const api = firstHtml.match(/<link rel="https:\/\/api\.w\.org\/" href="([^"]+)"/)?.[1];
  if (api) {
    const missing: Array<{ link: string; title: string }> = [];
    let listed = 0;
    for (let p = 1; p <= 30; p++) {
      const r = await getTextPatient(`${api}wp/v2/veicoli?per_page=100&page=${p}&orderby=id&order=asc&_fields=link,title`, { headers: { accept: 'application/json' } });
      if (r.status !== 200) { if (p === 1) warnings.push(`API WordPress des fiches : HTTP ${r.status} — liste non vérifiée`); break; }
      let arr: Array<{ link?: string; title?: { rendered?: string } }>;
      try { arr = JSON.parse(r.text); } catch { warnings.push('API WordPress des fiches : réponse illisible'); break; }
      if (!Array.isArray(arr) || arr.length === 0) break;
      listed += arr.length;
      for (const x of arr) if (x.link && !seen.has(rswId(x.link))) missing.push({ link: x.link, title: htmlText(unesc(x.title?.rendered ?? '')) });
      if (arr.length < 100) break;
      await sleep(PAGE_DELAY_MS);
    }
    if (listed > 0) declared = listed;
    for (const m of missing.slice(0, 60)) {
      await sleep(DETAIL_DELAY_MS);
      const r = await getTextPatient(m.link);
      if (r.status !== 200) continue;
      const d = readRswDetail(r.text);
      // Titre de l'API : « ALFA ROMEO Tonale 1.6 ti 130cv tct6 Diesel usato » → sans l'état ni l'énergie finale.
      let title = m.title.replace(/\s+(?:usato|km0|nuovo|aziendale)$/i, '');
      if (d.fuel && title.toLowerCase().endsWith(` ${d.fuel.toLowerCase()}`)) title = title.slice(0, -d.fuel.length - 1);
      const { brand, model } = splitTitle(title);
      seen.add(rswId(m.link));
      out.push({
        external_id: rswId(m.link), url: m.link, title, brand, model, price: d.price ?? null, km: d.km ?? null, year: d.year ?? null,
        fuel: d.fuel ?? null, gearbox: d.gearbox ?? null, plate: null, vin: null, body: null, image: null, listed_at: null,
        status: d.price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(title),
      });
    }
    if (missing.length) warnings.push(`${missing.length} voiture(s) absente(s) des pages de liste (tri instable du site) : lue(s) sur leur fiche${missing.length > 60 ? ' (60 au plus par relevé)' : ''}`);
  }
  return { provider: 'rswusato', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

// ── eveho (VPN Autos, 05/11) : 1 461 voitures, 23 par page, « ?page=N ».
async function scrapeEveho(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const declared = num(firstHtml.match(/(\d[\d\s ]*)\s*résultats?/)?.[1]?.replace(/[\s ]/g, ''));
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/class="component-single-vehicle"/).slice(1)) {
      const href = part.match(/<a href="([^"]+)" class="single-vehicle/)?.[1] ?? part.match(/<a href="(\/voiture-[^"]+)"/)?.[1];
      if (!href) continue;
      const id = href.split('-').pop()?.replace(/\W/g, '') || href;
      added++; // cartes vues (pas seulement nouvelles) : une 2e lecture dans un autre tri ne doit pas s'arrêter sur une page déjà connue
      if (seen.has(id)) continue;
      const brandBlock = part.match(/class="brand[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
      const model = htmlText(brandBlock.match(/class="model[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
      const brand = htmlText(brandBlock.replace(/<span[\s\S]*?<\/span>/, ''));
      const version = htmlText(part.match(/class="version[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '');
      const price = euro(htmlText(part.match(/class="price[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''));
      const kmYear = [...part.matchAll(/filedKmYear[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => htmlText(m[1]));
      const other = [...part.matchAll(/otherFields[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => htmlText(m[1]).replace(/\s*-\s*$/, ''));
      const fuel = other.find((x) => /essence|diesel|hybride|électrique|electrique|gpl|gnv/i.test(x)) ?? null;
      const gear = other.find((x) => /manuelle|automatique|auto\b|séquentielle/i.test(x)) ?? null;
      seen.add(id);
      out.push({
        external_id: id, url: href.startsWith('http') ? href : origin + href, title: [brand, model, version].filter(Boolean).join(' '),
        brand: brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : null, model: model || null, price,
        km: kmOf(kmYear.find((x) => /km/i.test(x))), year: num(kmYear.map((x) => x.match(/\b((?:19|20)\d{2})\b/)?.[1]).find(Boolean)),
        fuel, gearbox: gearboxOf(gear), plate: null, vin: null, body: null,
        image: (part.match(/<img src="([^"]+)"/)?.[1] ?? '').replace(/^\/_ipx\/[^/]+\//, '') || null, listed_at: null,
        status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: powerFromText(version),
        location: htmlText(part.match(/class="location[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '') || null,
      });
    }
    return added;
  };
  const last = Math.max(1, ...[...firstHtml.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])));
  // Tri par date de publication imposé : le tri par prix de l'URL n'est pas stable d'une page à l'autre
  // (1 393 lues sur 1 461 le 05/11, doublons entre pages) ; par date : 1 461 / 1 461.
  // Le paramètre « page » doit être LE DERNIER de l'adresse (fiche VPN Angers 05/11 : « ?page=2&pdv_name=… » rendait
  // la page 1, « ?pdv_name=…&page=2 » la bonne) : on le retire puis on le rajoute en fin.
  // AUCUN TRI N'EST STABLE SEUL (05/11) : par prix, les ex æquo changent de page ; par date, pareil sur une agence
  // (194 lues sur 294). La RÉUNION de deux lectures (prix croissant puis prix décroissant) donne le compte juste
  // (294 / 294 sur Angers, 1 461 / 1 461 sur le réseau) ; par date en troisième lecture s'il en manque encore.
  // Le paramètre « page » doit être LE DERNIER de l'adresse (« ?page=2&pdv_name=… » rendait la page 1).
  const u = new URL(url); u.searchParams.delete('page');
  const pageUrl = (sort: string, p: number) => { const x = new URL(u.toString()); x.searchParams.set('sort', sort); x.searchParams.append('page', String(p)); return x.toString(); };
  const allPages = Math.max(last, 1);
  seen.clear(); out.length = 0;
  let pages = 0;
  const warnings: string[] = [];
  for (const sort of ['order_asc=price', 'order_desc=price', 'order_desc=date_publication']) {
    if (sort === 'order_desc=date_publication' && (declared == null || out.length >= declared)) break;
    const first = await getTextPatient(pageUrl(sort, 1));
    if (first.status !== 200) { warnings.push(`tri ${sort} : HTTP ${first.status}`); continue; }
    const cap = Math.min(MAX_PAGES, Math.max(allPages, ...[...first.text.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]))) + 3);
    const r = await paginate(first.text, parse, (p) => pageUrl(sort, p), { cap });
    pages += r.pages; warnings.push(...r.warnings);
    if (declared != null && out.length >= declared) break;
  }
  if (declared != null && out.length < declared) warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  return { provider: 'eveho', total: declared ?? out.length, declared, vehicles: out, pages, warnings };
}

// ── autopalace (Auto Palace Bratislava, 18/11, Channing : « apprends cette vitrine dans la carte avec la pagination »)
//    CMS maison « locator version2 » : cartes <div class="cell slice-N item …">, lien /ponuka-vozidiel/<slug>-<vin>-<id>,
//    prix « Zvýhodnená cena » (sinon « Cenníková cena »), tags registration (« 12/2025 » ou « nové vozidlo »),
//    mileage, fuel, power (« 285 kW (388 PS) »), vin ; « Počet záznamov: N », 15 par page, pages « /page:N » ; un
//    « dataLayer_<id> » par carte donne marque et modèle (« BMW radu 3 » = Série 3). La boîte n'est que sur la fiche
//    (« Prevodovka: Automatická »), lue par DETAIL_READERS. La liste « jazdené » du site mêle neufs, démos et occasions.
async function scrapeAutopalace(url: string, firstHtml: string): Promise<DealerStockResult> {
  const origin = new URL(url).origin;
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  const declared = num(firstHtml.match(/Po[čc]et z[áa]znamov:\s*<span>(\d+)/)?.[1]);
  const base = url.replace(/\/page:\d+/, '').replace(/\/+$/, '');
  const pageUrl = (p: number) => (p <= 1 ? base : `${base}/page:${p}`);
  const tagOf = (part: string, k: string) => htmlText(part.match(new RegExp(`class="tag ${k}">([\\s\\S]*?)(?=<div class="tag |</div>\\s*</div>)`))?.[1] ?? '');
  const parse = (html: string): number => {
    let added = 0;
    for (const part of html.split(/<div class="cell slice-\d+ item/).slice(1)) {
      const href = part.match(/<a href="(\/ponuka-vozidiel\/[^"]+)"/)?.[1];
      if (!href) continue;
      const id = href.split('-').pop() ?? href;
      added++;
      if (seen.has(id)) continue;
      const title = htmlText(part.match(/<h2>\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
      const layer = html.match(new RegExp(`const dataLayer_${id} = \\{([\\s\\S]*?)\\};`))?.[1] ?? '';
      const layerOf = (k: string) => layer.match(new RegExp(`${k}: '([^']*)'`))?.[1]?.trim() ?? '';
      // dataLayer absent (neufs) ou marque « unknown » (MINI, VW) : le titre fait foi.
      const layerBrand = layerOf('item_brand');
      const brand = (layerBrand && !/unknown/i.test(layerBrand) ? layerBrand : title.split(/\s+/)[0]) || null;
      const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let model = layerOf('item_category').replace(new RegExp(`^${esc(brand ?? '')}\\s+`, 'i'), '').trim();
      if (!model || /unknown/i.test(model)) model = title.replace(new RegExp(`^${esc(brand ?? '')}\\s+`, 'i'), '').split(/\s+/)[0] ?? '';
      // « radu 3 » (slovaque) = Série 3 ; un code BMW « 218d », « 530e », « M135i » dit sa Série ; « M3 », « X3 », « iX » restent.
      model = model.replace(/^radu\s+(\d)$/i, 'Série $1').replace(/^M?([1-8])\d{2}[a-z]{0,3}$/i, 'Série $1');
      const price = euro(part.match(/class="row action">[\s\S]*?class="cell large value">([^<]+)</)?.[1] ?? '')
        ?? euro(part.match(/class="row price[^"]*">[\s\S]*?class="cell value">([^<]+)</)?.[1] ?? '');
      const reg = tagOf(part, 'registration');
      const year = num(reg.match(/\b((?:19|20)\d{2})\b/)?.[1]);
      const power = tagOf(part, 'power');
      const ps = num(power.match(/\((\d{2,3})\s*PS\)/i)?.[1]) ?? (num(power.match(/(\d{2,3})\s*kW/i)?.[1]) != null ? Math.round(Number(power.match(/(\d{2,3})\s*kW/i)![1]) * 1.35962) : null);
      const vin = tagOf(part, 'vin').replace(/[^A-Z0-9]/gi, '').toUpperCase() || null;
      seen.add(id);
      out.push({
        external_id: id, url: origin + href, title, brand, model: model || null, price,
        km: kmOf(tagOf(part, 'mileage')), year, fuel: tagOf(part, 'fuel') || null, gearbox: null,
        plate: null, vin: vin && vin.length === 17 ? vin : null, body: null,
        image: (() => { const i = part.match(/<img src="([^"]+)"/)?.[1]; return i ? (i.startsWith('http') ? i : origin + i) : null; })(), listed_at: null,
        status: price == null ? 'price_on_request' : null, currency: 'EUR', power_ch: ps, location: 'Bratislava',
      });
    }
    return added;
  };
  const last = Math.max(1, ...[...firstHtml.matchAll(/\/page:(\d+)"/g)].map((m) => Number(m[1])));
  const r = await paginate(firstHtml, parse, pageUrl, { cap: Math.min(MAX_PAGES, last + 2) });
  if (declared != null && out.length < declared) r.warnings.push(`${out.length} véhicule(s) lu(s) pour ${declared} annoncé(s)`);
  // DATE DE MISE EN LIGNE (18/11, Channing : « on n'a pas les dates de mise en ligne ? ») : ni la carte ni la fiche ne
  // la donnent, mais le plan du site porte un <lastmod> PAR FICHE véhicule (de septembre à aujourd'hui, pas une
  // régénération uniforme). C'est une date de dernière modification : la voiture est en ligne AU MOINS depuis —
  // prise comme mise en ligne quand elle est dans le passé (l'âge n'est jamais surestimé), sinon première vue par ADA.
  try {
    const sm = await getTextPatient(`${origin}/sitemap.xml`);
    if (sm.status === 200) {
      const byId = new Map<string, string>();
      for (const m of sm.text.matchAll(/<loc>[^<]*\/ponuka-vozidiel\/[^<]*-(\d+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})/g)) byId.set(m[1], m[2]);
      const today = new Date().toISOString().slice(0, 10);
      let dated = 0;
      for (const v of out) { const d = byId.get(v.external_id); if (d && d < today) { v.listed_at = `${d}T00:00:00Z`; dated++; } }
      if (dated) r.warnings.push(`date de mise en ligne : ${dated} fiche(s) datée(s) par le plan du site (dernière modification = en ligne au moins depuis)`);
    }
  } catch { /* plan du site indisponible : première vue par ADA */ }
  return { provider: 'autopalace', total: declared ?? out.length, declared, vehicles: out, pages: r.pages, warnings: r.warnings };
}

export async function fetchDealerStock(url: string, onProgress?: StockProgress): Promise<DealerStockResult> {
  const first = await getTextPatient(url); // 04/11 : MotorK (Sofibrie, SIPA) répond 429 dès la première page après une rafale
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
  if (provider === 'kamux') return scrapeKamux(url);
  if (provider === 'openflex') return scrapeOpenflex(url, first.text);
  if (provider === 'autopolis') return scrapeAutopolis(url, first.text);
  if (provider === 'webspark') return scrapeWebspark(url, first.text);
  if (provider === 'catalogpager') return scrapeCatalogPager(url, first.text);
  if (provider === 'flexicar') return scrapeFlexicar(url);
  if (provider === 'interstrip') return scrapeInterstrip(url, first.text);
  if (provider === 'shopware') return scrapeShopware(url, first.text);
  if (provider === 'wpcarsync') return scrapeWpcarsync(url, first.text);
  if (provider === 'divivoertuig') return scrapeDiviVoertuig(url, first.text);
  if (provider === 'carwp') return scrapeCarWp(url, first.text);
  if (provider === 'regeljelease') return scrapeRegeljelease(url, first.text);
  if (provider === 'vgrf') return scrapeVgrf(url, first.text);
  if (provider === 'yooflex') return scrapeYooflex(url, first.text);
  if (provider === 'dutchvans') return scrapeDutchvans(url, first.text);
  if (provider === 'vehiclelistapi') return scrapeVehicleListApi(url);
  if (provider === 'rswusato') return scrapeRswUsato(url, first.text);
  if (provider === 'eveho') return scrapeEveho(url, first.text);
  if (provider === 'autopalace') return scrapeAutopalace(url, first.text);
  if (provider === 'jetlisting') return scrapeJetListing(url, first.text);
  if (provider === 'gatsbyvehicles') return scrapeGatsbyVehicles(url);
  if (provider === 'dvnl') return scrapeDv(url, first.text);
  if (provider === 'dvapi') return scrapeDvApi(url, first.text);
  if (provider === 'datamotive') return scrapeDatamotive(url, first.text, onProgress);
  if (provider === 'dtcvm') return scrapeDtcVm(url, first.text);
  if (provider === 'carcards') return scrapeCarCards(url, first.text);
  if (provider === 'autrado') return scrapeAutrado(url, first.text);
  if (provider === 'carzilla') return scrapeCarzilla(url, first.text);
  if (provider === 'hexon') return scrapeHexon(url, first.text);
  if (provider === 'listerpage') return scrapeListerpage(url, first.text);
  if (provider === 'cmsms') return scrapeCmsms(url, first.text);
  if (provider === 'dmapi') return scrapeDmApi(url, first.text);
  if (provider === 'cartelcaw') return scrapeCartelCaw(url, first.text);
  return scrapeAutodata(url, first.text, first.headers);
}

/** RELEVÉS LAISSÉS « EN COURS » (03/11) : un redémarrage du worker (déploiement) tue la lecture en vol et la
 *  ligne restait « running » pour toujours (BYMYCAR 16/10). Au démarrage, toute ligne en cours depuis plus de
 *  2 h est marquée échouée, en le disant. */
export async function failStaleStockRuns(): Promise<void> {
  const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const cutoff = new Date(Date.now() - 2 * 3600_000).toISOString();
  const { data, error } = await sb.from('network_stock_runs').update({ status: 'failed', error: 'interrompu : le worker a redémarré pendant le relevé (déploiement) — relance-le', finished_at: new Date().toISOString() })
    .eq('status', 'running').lt('started_at', cutoff).select('id');
  if (error) console.warn('[DEALER_STOCK] relevés interrompus : lecture impossible —', error.message);
  else if ((data ?? []).length) console.warn(`[DEALER_STOCK] ${(data ?? []).length} relevé(s) laissé(s) « en cours » par un redémarrage marqué(s) interrompu(s)`);
}

export interface DealerStockSummary {
  provider: DealerProvider; total: number; newCount: number; goneCount: number; priceChanges: number; pages: number; warnings: string[]; runId: string | null;
}

/** VITRINE PARTAGÉE (03/11, Channing : « partage le relevé entre les fiches avec la même vitrine ») : même hôte
 *  (sans www), même chemin, mêmes paramètres = même stock. BYMYCAR : quatre fiches (Villeneuve-Loubet, Noisy,
 *  Paris, Toulon), un seul site du groupe. */
export function showcaseKey(url: string | null | undefined): string | null {
  try {
    const u = new URL(String(url ?? '').trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '').toLowerCase()}${u.search}`;
  } catch { return null; }
}
/** Les autres fiches de la carte qui pointent sur la même vitrine. */
export async function showcaseSiblings(contactId: string, url: string): Promise<Array<{ id: string; name: string }>> {
  const key = showcaseKey(url);
  if (!key) return [];
  const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const host = key.split('/')[0];
  const { data } = await sb.from('network_contacts').select('id,name,website').ilike('website', `%${host}%`).limit(500);
  return ((data ?? []) as Array<{ id: string; name: string; website: string | null }>)
    .filter((c) => c.id !== contactId && showcaseKey(c.website) === key)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Ce qu'une fiche détail rend : un champ absent ou null = inconnu (jamais un écrasement d'une valeur connue). */
export interface DetailFields { gearbox?: string | null; fuel?: string | null; km?: number | null; year?: number | null; price?: number | null }
export type DetailField = keyof DetailFields;
/** Un lecteur de fiche : les champs qu'il sait rendre (un véhicule n'est relu que si l'un d'eux manque), et la lecture. */
export interface DetailReader { fields: DetailField[]; read: (html: string) => DetailFields }
/** Un prix inférieur à ce ratio du nouveau prix lu était une lecture fausse (remise, mensualité), pas un prix (18/11). */
export const MISREAD_PRICE_RATIO = 0.35;
/** Relevé partiel (18/11) : moins de 95 % du total que le site annonce — aucune voiture n'est alors marquée disparue. */
export const isPartialRead = (read: number, declared: number | null): boolean => declared != null && declared > 0 && read < declared * 0.95;
/** Fiches lues au plus par relevé (le reste au relevé suivant, nouveaux d'abord) et pause entre deux fiches d'un site. */
export const DETAIL_MAX_PER_RUN = 200;
const DETAIL_DELAY_MS = 350;
/** Boîte de la fiche DMD (13/11) : « Boîte de vitesse : Manuelle / Auto Séquent. / Rob Double Embray ». */
export function readDmdDetail(html: string): DetailFields {
  const v = unesc(html.match(/Bo[iî]te de vitesses?<\/span>\s*<span>([^<]+)<\/span>/i)?.[1] ?? '').trim();
  // « Rob Double Embray » (robotisée à double embrayage, DMD 13/11) = automatique.
  return { gearbox: gearboxFr(v) }; // « A Var Continu » (variateur) = Automatique, comme Rob Double / Simple Embray
}
/**
 * ENRICHISSEMENT PAR FICHE DÉTAIL (14/11, mission « 100 % des vitrines lues, et lues en entier ») — généralise la
 * boîte lue sur la fiche DMD du 13/11 : pour un lecteur dont la liste ne donne pas tout, la fiche de chaque véhicule
 * rend ce qui manque (boîte, énergie, km, année, prix). Nouveaux véhicules d'abord, DETAIL_MAX_PER_RUN fiches par
 * relevé, une à la fois avec une pause, jamais par Zyte ; une valeur lue n'écrase jamais une valeur de la liste.
 */
/** Boîte de la fiche Auto Palace (18/11) : « Prevodovka: » / « Automatická » ou « Manuálna ». */
export function readAutopalaceDetail(html: string): DetailFields {
  const v = htmlText(html.match(/Prevodovka:<\/div>\s*<div class="cell">([^<]+)</i)?.[1] ?? '');
  return { gearbox: /manu/i.test(v) ? 'Manuelle' : /auto/i.test(v) ? 'Automatique' : v || null };
}
/** Fiche autodata « /occasions-kopen/<id>-<titre> » (13/11, Krimpenerwaard : la carte de la liste n'a que titre, prix,
 *  « 69.968 km - 2019 ») : « <li>Brandstof<strong>Benzine</strong></li> », Transmissie, Tellerstand, Bouwjaar ; repli sur
 *  le bandeau « <h6>Brandstof</h6><h5>Benzine</h5> » (kmstand, « Transmissie: ») ; prix « <em>€ </em>16.945,- ». */
export function readAutodataDetail(html: string): DetailFields {
  const li = (label: string) => htmlText(html.match(new RegExp(`<li>\\s*${label}\\s*<strong>([\\s\\S]*?)<\\/strong>`, 'i'))?.[1] ?? '');
  const head = (label: string) => htmlText(html.match(new RegExp(`<h6>\\s*${label}:?\\s*<\\/h6>\\s*<h5>([\\s\\S]*?)<\\/h5>`, 'i'))?.[1] ?? '');
  const kmTxt = li('Tellerstand') || head('kmstand');
  return {
    fuel: li('Brandstof') || head('Brandstof') || null,
    gearbox: gearboxOf(li('Transmissie') || head('Transmissie') || null),
    km: /\d/.test(kmTxt) ? num(kmTxt.replace(/[^\d]/g, '')) : null,
    year: yearOf(li('Bouwjaar') || head('Bouwjaar')),
    price: euro(htmlText(html.match(/class="aanbod-product-price">\s*<h3>([\s\S]*?)<\/h3>/)?.[1] ?? '')),
  };
}
/** Fiche openflex (18/11, Vikings) : <ul class="grille-3 caracteristiques"> avec <li class="km">102666 km</li>,
 *  <li class="boite">Boîte automatique</li>, <li class="carburant">Essence / Courant Electrique</li>,
 *  <li class="date">30-09-2020</li> ; prix <span class="prixspan">22 990€</span>. */
export function readOpenflexDetail(html: string): DetailFields {
  const ul = html.match(/<ul class="grille-3 caracteristiques">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const li = (c: string) => htmlText(ul.match(new RegExp(`<li class="${c}">([\\s\\S]*?)<\\/li>`))?.[1] ?? '') || null;
  const boite = li('boite'), fuel = li('carburant');
  return {
    gearbox: !boite ? null : /automati/i.test(boite) ? 'Automatique' : /manuel/i.test(boite) ? 'Manuelle' : boite,
    fuel: fuel && /\/.*lectri/i.test(fuel) ? `Hybride ${fuel}` : fuel,
    km: num(li('km')?.replace(/km/i, '').replace(/[\s .]/g, '')),
    year: num(li('date')?.match(/\b((?:19|20)\d{2})\b/)?.[1]),
    price: priceOrNull((html.match(/<span class="prixspan">([^<]*)<\/span>/)?.[1] ?? '').replace(/[^\d]/g, '')),
  };
}
export const DETAIL_READERS: Partial<Record<DealerProvider, DetailReader>> = {
  catalogpager: { fields: ['gearbox'], read: readDmdDetail },
  openflex: { fields: ['gearbox', 'fuel'], read: readOpenflexDetail },
  // autodata : la liste donne prix, km, année ; la fiche donne l'énergie et la boîte (km / année en secours).
  autodata: { fields: ['fuel', 'gearbox', 'km', 'year'], read: readAutodataDetail },
  // cmsms (Louwman) : secours seulement — la boîte vient des passes filtrées « Transmissie » de la liste.
  cmsms: { fields: ['gearbox'], read: readCmsmsDetail },
  // dmapi (Pon) : secours seulement — l'API Datamotive rend énergie, km, année, boîte.
  dmapi: { fields: ['gearbox', 'fuel', 'km', 'year'], read: readDatamotiveDetail },
  autopalace: { fields: ['gearbox'], read: readAutopalaceDetail },
};

/** Relève le stock d'une concession de la carte et le compare au relevé précédent. Avec `prefetched` (vitrine
 *  partagée), la lecture du site est réutilisée : seul l'enregistrement et le diff sont faits pour cette fiche. */
export async function runDealerStock(contactId: string, url: string, submittedBy: string, prefetched?: DealerStockResult): Promise<DealerStockSummary> {
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
    // PROGRESSION dans la ligne du relevé (03/11) : pages et véhicules lus, au plus toutes les 5 s — la fenêtre
    // de la carte les affiche pendant un relevé long, et un relevé sans progression depuis longtemps se voit.
    let lastProgressAt = 0;
    const onProgress: StockProgress = (pages, vehicles) => {
      if (Date.now() - lastProgressAt < 5000) return;
      lastProgressAt = Date.now();
      void sb.from('network_stock_runs').update({ pages, total: vehicles }).eq('id', runId);
    };
    const stock: DealerStockResult = prefetched ? { ...prefetched, warnings: [...prefetched.warnings] } : await fetchDealerStock(url, onProgress);
    // SECONDE VITRINE (12/11, Channing : « les concessions ont plusieurs vitrines, ici des utilitaires ») : lue
    // après la première, ses véhicules cumulés dans le même stock (un identifiant déjà pris est préfixé par son
    // hôte). Si elle ne se lit pas, ses véhicules du relevé précédent ne sont PAS marqués disparus.
    const keepHosts: string[] = [];
    const providerOf = new Map<string, DealerProvider>(); // véhicules de la vitrine 2 → leur lecteur
    if (!prefetched) {
      const { data: c2 } = await sb.from('network_contacts').select('website2').eq('id', contactId).maybeSingle();
      const url2 = String((c2 as { website2?: string | null } | null)?.website2 ?? '').trim();
      if (/^https?:\/\//i.test(url2) && showcaseKey(url2) !== showcaseKey(url)) {
        const host2 = (() => { try { return new URL(url2).hostname; } catch { return url2; } })();
        try {
          const s2 = await fetchDealerStock(url2, onProgress);
          const ids = new Set(stock.vehicles.map((v) => v.external_id));
          for (const v of s2.vehicles) {
            const v2 = ids.has(v.external_id) ? { ...v, external_id: `${host2}:${v.external_id}` } : v;
            stock.vehicles.push(v2);
            providerOf.set(v2.external_id, s2.provider);
          }
          stock.pages += s2.pages;
          if (stock.declared != null && s2.declared != null) stock.declared += s2.declared;
          stock.warnings.push(`vitrine 2 (${host2}) : ${s2.vehicles.length} véhicules lus (${s2.provider})`, ...s2.warnings.map((w) => `vitrine 2 : ${w}`));
        } catch (e) {
          keepHosts.push(host2);
          stock.warnings.push(`vitrine 2 non lue (${url2}) : ${e instanceof Error ? e.message : String(e)} — ses véhicules du relevé précédent sont gardés`);
        }
      }
    }
    const currencies = prefetched ? [] : [...new Set(stock.vehicles.map((v) => (v.currency ?? 'EUR').toUpperCase()).filter((c) => c !== 'EUR'))];
    if (currencies.length > 0) {
      const fx = await getFxRates();
      for (const c of currencies) {
        const r = fx.rates[c];
        stock.warnings.push(r
          ? `Prix en ${c} sur le site — affichés convertis en € au taux BCE du ${fx.date} (1 € = ${r.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ${c})${fx.source === 'fallback' ? ' — taux de repli, BCE injoignable' : ''}`
          : `Prix en ${c} sur le site — devise sans taux connu, affichés tels quels`);
      }
    }
    if (!prefetched && zyteCallsThisRun > 0) stock.warnings.push(`${zyteCallsThisRun} page(s) lue(s) via Zyte (site protégé par Cloudflare) — relevé payant`);
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
    type Prev = { external_id: string; gearbox?: string | null; fuel?: string | null; km?: number | null; year?: number | null; price: number | null; price_prev: number | null; first_seen_at: string; listed_at?: string | null; price_first?: number | null; price_history?: Array<{ at: string; price: number }> | null };
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
      const full = await readPrev('external_id, gearbox, fuel, km, year, price, price_prev, first_seen_at, listed_at, price_first, price_history');
      if (full.error) prevRows = (await readPrev('external_id, gearbox, fuel, km, year, price, price_prev, first_seen_at, listed_at')).rows;
      else prevRows = full.rows;
    }
    const prev = new Map<string, Prev>(((prevRows ?? []) as Prev[]).map((r) => [r.external_id, r]));
    // FICHES DÉTAIL (14/11) : les véhicules dont un champ que la fiche sait rendre manque à la fois dans la liste et en
    // base, nouveaux d'abord ; chaque véhicule avec le lecteur de sa vitrine (vitrine 2 comprise).
    {
      const missing = (v: DealerVehicle, r: DetailReader) => { const p = prev.get(v.external_id); return r.fields.some((f) => v[f] == null && (p?.[f] ?? null) == null); };
      const queue = stock.vehicles
        .map((v) => ({ v, r: DETAIL_READERS[providerOf.get(v.external_id) ?? stock.provider] }))
        .filter((x): x is { v: DealerVehicle; r: DetailReader } => !!x.r && !!x.v.url && missing(x.v, x.r))
        .sort((a, b) => Number(prev.has(a.v.external_id)) - Number(prev.has(b.v.external_id)));
      const batch = queue.slice(0, DETAIL_MAX_PER_RUN);
      let read = 0, filled = 0;
      for (const { v, r } of batch) {
        try {
          const page = await getText(v.url!, undefined, { noZyte: true });
          if (page.status === 200) {
            read++;
            const got = r.read(page.text);
            for (const f of r.fields) {
              if (v[f] != null || got[f] == null) continue;
              (v as unknown as Record<DetailField, unknown>)[f] = got[f];
              filled++;
            }
          }
        } catch { /* fiche illisible : ses champs restent inconnus, le relevé continue */ }
        await sleep(DETAIL_DELAY_MS);
      }
      if (batch.length) {
        const fields = [...new Set(batch.flatMap((x) => x.r.fields))].join(', ');
        const rest = queue.length - batch.length;
        console.warn(`[DEALER_STOCK] fiches détail : ${read} lue(s) sur ${batch.length}, ${filled} valeur(s) complétée(s) (${fields}) — ${stock.provider}${rest ? ` ; ${rest} au prochain relevé` : ''}`);
        if (rest > 0) stock.warnings.push(`Fiches détail : ${read} lues ce relevé (${fields}) ; ${rest} véhicule(s) à compléter aux prochains relevés.`);
        if (read < batch.length) stock.warnings.push(`Fiches détail : ${batch.length - read} fiche(s) illisible(s) sur ${batch.length} — champs laissés inconnus.`);
      }
    }
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
      // PRIX MAL LU CORRIGÉ (18/11, Van Mossel : la règle de carte du 13/11 prenait la REMISE « Jouw korting: € 6.565 »
      // pour le prix — 171 voitures de 2022 et plus à moins de 10 000 €). Un prix qui fait plus que tripler d'un relevé à
      // l'autre n'est pas une hausse : c'était l'ancien qui était faux (remise, mensualité de leasing…). Il sort de
      // l'historique (premier prix compris) et ne compte pas comme un changement de prix.
      const misread = !!p && before != null && before > 0 && v.price != null && before < v.price * MISREAD_PRICE_RATIO;
      const changed = !!p && before != null && v.price != null && before !== v.price && !misread;
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
      const history = misread ? seeded.filter((x) => x.price >= v.price! * MISREAD_PRICE_RATIO) : [...seeded];
      if (v.price != null && v.price > 0 && (history.length === 0 || history[history.length - 1].price !== v.price)) history.push({ at: startedAt, price: v.price });
      const priceFirst = misread ? history[0]?.price ?? null : p?.price_first ?? history[0]?.price ?? null;
      return {
        contact_id: contactId, external_id: v.external_id, url: v.url, title: v.title, brand: v.brand, model: v.model,
        // Une liste qui ne donne pas un champ n'efface jamais la valeur connue (14/11) ; un prix absent parce que le
        // site le dit (« sur demande », « bientôt ») reste absent.
        price: v.price ?? (v.status === 'price_on_request' || v.status === 'expected' ? null : p?.price ?? null),
        price_prev: changed ? before : misread ? null : (p?.price_prev ?? null),
        km: v.km ?? p?.km ?? null, year: v.year ?? p?.year ?? null, fuel: v.fuel ?? p?.fuel ?? null, gearbox: v.gearbox ?? p?.gearbox ?? null,
        // Date de mise en ligne : la plus ANCIENNE connue (18/11, Auto Palace : le plan du site date une fiche jusqu'à sa
        // prochaine modification, puis plus rien — une date lue un jour ne s'efface pas, et une date plus ancienne gagne).
        plate: v.plate, vin: v.vin, body: v.body, image: v.image, listed_at: [v.listed_at, p?.listed_at].filter((d): d is string => !!d).sort()[0] ?? null,
        first_seen_at: p?.first_seen_at ?? startedAt, last_seen_at: startedAt, gone_at: null, last_run_id: runId,
        status: v.status, price_first: priceFirst, price_history: history,
        // Devise du site (06/10) : prix gardés tels quels, conversion à l'affichage.
        currency: v.currency ?? 'EUR',
        // Puissance (02/11) : structurée par l'adaptateur, sinon lue dans le titre. Colonne absente = retirée (strip).
        power_ch: v.power_ch ?? powerFromText(v.title),
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
        stock.warnings.push(`colonne ${missing} absente (SQL ${missing === 'power_ch' ? 'du 02/11 (stock_puissance)' : 'du 01/10'} à coller) : non enregistrée`);
      }
      if (error) throw new Error(`écriture des véhicules : ${error.message}`);
    }
    // Disparus : vus avant, absents de ce relevé, pas encore marqués.
    // RELEVÉ PARTIEL (18/11, Emil Frey lu à 153, 541 puis 1 562 voitures sur ≈ 4 500 annoncées : des milliers de faux
    // « disparus », que les palmarès de vente prenaient pour des ventes ; Hecquet 194 / 286 : 72) : quand le relevé a lu
    // moins de 95 % du stock que le site annonce lui-même, rien n'est marqué disparu — les voitures non revues gardent
    // leur état jusqu'au prochain relevé complet.
    const partial = isPartialRead(stock.vehicles.length, stock.declared);
    let goneCount = 0;
    if (partial) {
      stock.warnings.push(`Relevé partiel : ${stock.vehicles.length} voitures lues pour ${stock.declared} annoncées par le site — aucune voiture marquée disparue.`);
    } else {
      let goneQuery = sb.from('network_stock_vehicles').update({ gone_at: startedAt, gone_run_id: runId })
        .eq('contact_id', contactId).is('gone_at', null).lt('last_seen_at', startedAt);
      for (const h of keepHosts) goneQuery = goneQuery.not('url', 'ilike', `%${h}%`);
      const { data: gone } = await goneQuery.select('id');
      goneCount = ((gone ?? []) as unknown[]).length;
    }
    await sb.from('network_stock_runs').update({ status: 'done', provider: stock.provider, total: stock.vehicles.length, new_count: newCount, gone_count: goneCount, price_changes: priceChanges, pages: stock.pages, warnings: stock.warnings, finished_at: new Date().toISOString() }).eq('id', runId);
    await sb.from('network_contacts').update({ stock_total: stock.vehicles.length }).eq('id', contactId);
    // Un relevé réussi ferme seul les cas « vitrine inconnue » / « relevé vide » de cet hôte.
    const host = new URL(url).hostname;
    void resolveLearningCase('dealer_site_unknown', host, `relevé réussi (${stock.provider}, ${stock.vehicles.length} véhicules)`);
    void resolveLearningCase('dealer_scan_empty', host, `relevé réussi (${stock.provider}, ${stock.vehicles.length} véhicules)`);
    console.warn(`[DEALER_STOCK] ${url} : ${stock.provider}, ${stock.vehicles.length} véhicules (${newCount} nouveaux, ${goneCount} disparus, ${priceChanges} prix changés) — ${submittedBy}`);
    // VITRINE PARTAGÉE (03/11) : les autres fiches sur le même site reçoivent le MÊME relevé (enregistrement et
    // diff par fiche, une seule lecture du site). Un échec sur une fiche sœur ne défait pas celui-ci.
    if (!prefetched) {
      const siblings = await showcaseSiblings(contactId, url).catch(() => []);
      for (const sib of siblings) {
        try {
          const shared: DealerStockResult = { ...stock, warnings: [...stock.warnings, `relevé partagé : même vitrine, lue une fois (${siblings.length + 1} fiches)`] };
          await runDealerStock(sib.id, url, `${submittedBy} · vitrine partagée`, shared);
        } catch (e) { console.warn(`[DEALER_STOCK] vitrine partagée → ${sib.name} : ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (siblings.length) stock.warnings.push(`relevé partagé avec ${siblings.length} autre(s) fiche(s) sur la même vitrine : ${siblings.map((x) => x.name).join(', ')}`);
    }
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


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

export type DealerProvider = 'dvnl' | 'datamotive' | 'autodata' | 'listerpage';

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

export interface DealerStockResult { provider: DealerProvider; total: number | null; vehicles: DealerVehicle[]; pages: number; warnings: string[] }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAX_PAGES = 150;
const PAGE_DELAY_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getText(url: string, init?: RequestInit): Promise<{ status: number; text: string; headers: Headers }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, { ...init, headers: { 'user-agent': UA, 'accept-language': 'nl,en;q=0.8,fr;q=0.6', ...(init?.headers as Record<string, string> | undefined) }, signal: ctrl.signal, redirect: 'follow' });
    return { status: res.status, text: await res.text(), headers: res.headers };
  } finally { clearTimeout(t); }
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const decode = (s: string) => s.replace(/&euro;/g, '€').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const withPage = (url: string, page: number): string => {
  const u = new URL(url);
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
  if (/"@type":\s*"ItemList"/.test(html) && /"Car"/.test(html)) return 'datamotive';
  if (/"listerpage":\s*\{[^}]*"ajax_url"/.test(html)) return 'listerpage';
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
      const a = (k: string) => it.attributes?.[k]?.value;
      const id = String(a('voertuignr') ?? it.id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      // Statut : « gereserveerd » (attribut), sticker autre que « Beschikbaar »
      // (Gereserveerd / Verkocht / Binnenkort verwacht), sinon prix absent =
      // « op aanvraag » (preuve 01/10 : Audi A1 price 0, page « Op aanvraag »).
      const price = priceOrNull(it.price);
      const sticker = it.enrichedValues?.sticker?.name;
      const status: DealerVehicleStatus | null = a('gereserveerd') === true || it.enrichedValues?.reserved === true ? 'reserved'
        : (statusFromText(sticker) ?? (price == null ? 'price_on_request' : null));
      out.push({
        external_id: id, url: it.url ? (it.url.startsWith('http') ? it.url : origin + it.url) : null,
        title: [it.brand, it.model, it.type].filter(Boolean).join(' ').trim(), brand: it.brand ?? null, model: it.model ?? null,
        price, km: num(a('tellerstand')), year: num(a('bouwjaar')), fuel: a('brandstof') ? String(a('brandstof')) : null,
        gearbox: a('transmissie') ? String(a('transmissie')) : null, plate: a('kenteken') ? String(a('kenteken')) : null,
        vin: a('vin') ? String(a('vin')) : null, body: a('carrosserie') ? String(a('carrosserie')) : null,
        image: it.images?.[0]?.path ?? null, listed_at: it.createdAt ? new Date(it.createdAt).toISOString() : null,
        status,
      });
    }
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'dvnl', total: total ?? out.length, vehicles: out, pages: pagesTotal, warnings };
}

// ── datamotive (Century) ────────────────────────────────────────────────────
function parseItemList(html: string): { items: Array<Record<string, unknown>>; total: number | null } | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]) as { '@type'?: string; numberOfItems?: number; itemListElement?: Array<Record<string, unknown>> };
      if (d['@type'] === 'ItemList' && Array.isArray(d.itemListElement)) return { items: d.itemListElement, total: typeof d.numberOfItems === 'number' ? d.numberOfItems : null };
    } catch { /* bloc suivant */ }
  }
  return null;
}
async function scrapeDatamotive(url: string, firstHtml: string): Promise<DealerStockResult> {
  const warnings: string[] = [];
  const out: DealerVehicle[] = [];
  const seen = new Set<string>();
  let first: ReturnType<typeof parseItemList> = parseItemList(firstHtml);
  const total = first?.total ?? null;
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const parsed = page === 1 ? first : parseItemList((await getText(withPage(url, page))).text);
    first = null;
    pages = page;
    if (!parsed || parsed.items.length === 0) break;
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
      const name = String(item.name ?? '').split('|')[0].trim();
      out.push({
        external_id: id, url: u || null, title: name, brand: brand || splitTitle(name).brand, model: item.model ? String(item.model) : splitTitle(name).model,
        price: priceOrNull(offers.price), km: null, year: null, fuel: null, gearbox: null, plate: null, vin: null, body: null,
        image: Array.isArray(item.image) ? String(item.image[0] ?? '') || null : item.image ? String(item.image) : null, listed_at: null,
        // schema.org : InStock = en vente ; PreOrder = attendue ; SoldOut /
        // OutOfStock = vendue ; prix absent = sur demande.
        status: /preorder/i.test(String(offers.availability ?? '')) ? 'expected'
          : /soldout|outofstock|discontinued/i.test(String(offers.availability ?? '')) ? 'sold'
            : priceOrNull(offers.price) == null ? 'price_on_request' : null,
      });
    }
    if (added === 0) break;
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  if (out.length > 0 && out.every((v) => v.km == null)) warnings.push('Ce fournisseur ne publie ni km ni année dans la liste (fiche détaillée seulement).');
  return { provider: 'datamotive', total: total ?? out.length, vehicles: out, pages, warnings };
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
  return { provider: 'autodata', total: total ?? out.length, vehicles: out, pages: page, warnings };
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
  return { provider: 'listerpage', total: total ?? out.length, vehicles: out, pages: page, warnings };
}

export async function fetchDealerStock(url: string): Promise<DealerStockResult> {
  const first = await getText(url);
  if (first.status !== 200) throw new Error(`page du stock : HTTP ${first.status}`);
  const provider = detectDealerProvider(first.text);
  if (!provider) throw new Error('site vitrine non reconnu (ni dvnl, ni datamotive, ni autodata, ni listerpage) — à reconnaître avant de l\'ajouter');
  if (provider === 'dvnl') return scrapeDv(url, first.text);
  if (provider === 'datamotive') return scrapeDatamotive(url, first.text);
  if (provider === 'listerpage') return scrapeListerpage(url, first.text);
  return scrapeAutodata(url, first.text, first.headers);
}

export interface DealerStockSummary {
  provider: DealerProvider; total: number; newCount: number; goneCount: number; priceChanges: number; pages: number; warnings: string[]; runId: string | null;
}

/** Relève le stock d'une concession de la carte et le compare au relevé précédent. */
export async function runDealerStock(contactId: string, url: string, submittedBy: string): Promise<DealerStockSummary> {
  const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const startedAt = new Date().toISOString();
  const { data: run, error: runErr } = await sb.from('network_stock_runs').insert({ contact_id: contactId, url, status: 'running', submitted_by: submittedBy }).select('id').single();
  if (runErr) throw new Error(/does not exist|schema cache/i.test(runErr.message) ? 'SQL du 30/09 (network_stock_*) à coller.' : runErr.message);
  const runId = (run as { id: string }).id;
  try {
    const stock = await fetchDealerStock(url);
    // Prix précédents : pour compter les changements et garder price_prev.
    // Historique des prix (SQL du 01/10 soir) : lu s'il existe, sinon reconstruit
    // depuis price_prev / price — la lecture ne doit jamais bloquer le relevé.
    type Prev = { external_id: string; price: number | null; price_prev: number | null; first_seen_at: string; price_first?: number | null; price_history?: Array<{ at: string; price: number }> | null };
    let prevRows: Prev[] | null = null;
    {
      const full = await sb.from('network_stock_vehicles').select('external_id, price, price_prev, first_seen_at, price_first, price_history').eq('contact_id', contactId);
      if (full.error) {
        const lite = await sb.from('network_stock_vehicles').select('external_id, price, price_prev, first_seen_at').eq('contact_id', contactId);
        prevRows = (lite.data ?? null) as Prev[] | null;
      } else prevRows = (full.data ?? null) as Prev[] | null;
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
    console.warn(`[DEALER_STOCK] ${url} : ${stock.provider}, ${stock.vehicles.length} véhicules (${newCount} nouveaux, ${goneCount} disparus, ${priceChanges} prix changés) — ${submittedBy}`);
    return { provider: stock.provider, total: stock.vehicles.length, newCount, goneCount, priceChanges, pages: stock.pages, warnings: stock.warnings, runId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('network_stock_runs').update({ status: 'failed', error: msg.slice(0, 500), finished_at: new Date().toISOString() }).eq('id', runId);
    console.warn(`[DEALER_STOCK] ${url} : échec — ${msg}`);
    throw e;
  }
}

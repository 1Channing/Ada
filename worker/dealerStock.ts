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

export type DealerProvider = 'dvnl' | 'datamotive' | 'autodata';

export interface DealerVehicle {
  external_id: string; url: string | null; title: string; brand: string | null; model: string | null;
  price: number | null; km: number | null; year: number | null; fuel: string | null; gearbox: string | null;
  plate: string | null; vin: string | null; body: string | null; image: string | null; listed_at: string | null;
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
  return null;
}

// ── dvnl (Auto Smeeing) ─────────────────────────────────────────────────────
interface DvItem {
  id: string; brand?: string; model?: string; type?: string; price?: number; url?: string; createdAt?: string;
  images?: Array<{ path?: string }>; attributes?: Record<string, { value?: unknown }>;
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
      out.push({
        external_id: id, url: it.url ? (it.url.startsWith('http') ? it.url : origin + it.url) : null,
        title: [it.brand, it.model, it.type].filter(Boolean).join(' ').trim(), brand: it.brand ?? null, model: it.model ?? null,
        price: num(it.price), km: num(a('tellerstand')), year: num(a('bouwjaar')), fuel: a('brandstof') ? String(a('brandstof')) : null,
        gearbox: a('transmissie') ? String(a('transmissie')) : null, plate: a('kenteken') ? String(a('kenteken')) : null,
        vin: a('vin') ? String(a('vin')) : null, body: a('carrosserie') ? String(a('carrosserie')) : null,
        image: it.images?.[0]?.path ?? null, listed_at: it.createdAt ? new Date(it.createdAt).toISOString() : null,
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
        price: num(offers.price), km: null, year: null, fuel: null, gearbox: null, plate: null, vin: null, body: null,
        image: Array.isArray(item.image) ? String(item.image[0] ?? '') || null : item.image ? String(item.image) : null, listed_at: null,
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
      out.push({ external_id: id, url: href ? (href.startsWith('http') ? href : origin + href) : null, title, brand, model, price, km, year, fuel: null, gearbox: null, plate: null, vin: null, body: null, image, listed_at: null });
    }
    if (added === 0) break;
    if (total != null && out.length >= total) break;
    await sleep(PAGE_DELAY_MS);
  }
  return { provider: 'autodata', total: total ?? out.length, vehicles: out, pages: page, warnings };
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
export async function fetchDealerStock(url: string): Promise<DealerStockResult> {
  const first = await getText(url);
  if (first.status !== 200) throw new Error(`page du stock : HTTP ${first.status}`);
  const provider = detectDealerProvider(first.text);
  if (!provider) throw new Error('site vitrine non reconnu (ni dvnl, ni datamotive, ni autodata) — à reconnaître avant de l\'ajouter');
  if (provider === 'dvnl') return scrapeDv(url, first.text);
  if (provider === 'datamotive') return scrapeDatamotive(url, first.text);
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
    const { data: prevRows } = await sb.from('network_stock_vehicles').select('external_id, price').eq('contact_id', contactId);
    const prev = new Map<string, number | null>(((prevRows ?? []) as Array<{ external_id: string; price: number | null }>).map((r) => [r.external_id, r.price]));
    let newCount = 0, priceChanges = 0;
    const rows = stock.vehicles.map((v) => {
      const had = prev.has(v.external_id);
      if (!had) newCount++;
      const before = prev.get(v.external_id) ?? null;
      const changed = had && before != null && v.price != null && before !== v.price;
      if (changed) priceChanges++;
      return {
        contact_id: contactId, external_id: v.external_id, url: v.url, title: v.title, brand: v.brand, model: v.model,
        price: v.price, ...(changed ? { price_prev: before } : {}), km: v.km, year: v.year, fuel: v.fuel, gearbox: v.gearbox,
        plate: v.plate, vin: v.vin, body: v.body, image: v.image, listed_at: v.listed_at,
        last_seen_at: startedAt, gone_at: null, last_run_id: runId, ...(had ? {} : { first_seen_at: startedAt }),
      };
    });
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from('network_stock_vehicles').upsert(rows.slice(i, i + 200), { onConflict: 'contact_id,external_id' });
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

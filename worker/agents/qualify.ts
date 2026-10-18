/**
 * ADA QUALIFIE UN GARAGE (17/10, phase 2.2). Pour chaque garage de l'annuaire
 * — avec toutes ses fiches, quand il est vu sur plusieurs sites :
 * 1. Sa fiche AutoScout24 s'il en a une (site web, Impressum, vendeurs, type
 *    de concession, succursales) — lecture directe, Zyte si la page résiste.
 * 2. Son site : celui de la fiche, celui déclaré par un autre site
 *    (Marktplaats…), ou celui où mène son lien Gaspedaal ; l'accueil et deux
 *    pages « contact / équipe / mentions » ; les e-mails publiés sont relevés
 *    sans IA. Sans site ni e-mail (garage vu seulement sur Leboncoin,
 *    coches.net…), Haiku cherche sur le web (point 4).
 * 3. Le score d'adéquation (pays, marques, utilitaires, « plus cher que
 *    nous », taille, joignable) — sans IA.
 * 4. Haiku 5.5 lit ce matériel et rend une fiche (type, groupe, bonne
 *    personne, langue, ajustement du score, résumé). Recherche web
 *    seulement si ni site ni e-mail n'ont été trouvés.
 * 5. Contrôle : un e-mail n'est gardé que s'il est écrit dans une page lue,
 *    et son domaine doit recevoir du courrier (MX).
 * 6. Au-delà du seuil des Réglages, le garage entre sur la carte du réseau
 *    avec le badge « IA · Ada » (coordonnées GPS par OpenStreetMap).
 * Dana (17/10) : le même chemin pour un FOURNISSEUR — ses lots de véhicules
 * identiques (agents_dealer_lots) font le score, la consigne cherche qui
 * vend (VO, négoce, remarketing) ; carte : « vendeur ».
 * Grand compte (groupe, loueur, leasing, flotte) : recherche web de la
 * personne qui décide pour le groupe et de son profil LinkedIn (gardé
 * seulement s'il apparaît dans un résultat lu) ; ses envois sont préparés
 * pour Channing, qui les fait lui-même.
 * Étape 2 (17/10) : le même chemin pour une entreprise trouvée par une
 * recherche web (./research.ts) — son site, la personne qui décide selon
 * son type de compte, un score de compte (type, taille, pays, joignable).
 * Rien n'est envoyé à qui que ce soit : les mails restent à l'étape 2.3, et
 * passent par la validation.
 */
import { live } from './live';
import { aiProblemOf } from '../../src/lib/agents/aiErrors';
import { promises as dns } from 'node:dns';
import { fetchHtmlWithZyte } from '../scraper';
import { parseDealerInfoPage, extractEmails, mailtoEmails, extractPeople, contactLinks, pageText, type DealerPageInfo } from '../../src/lib/agents/dealerPage';
import {
  fitScore, qualifyPrompt, QUALIFY_SYSTEM, DANA_QUALIFY_SYSTEM, qualifySchema, acceptedEmails, acceptedLinkedin, finalScore, normalizeTargets, buyerCountries, HOME_COUNTRY,
  type QualifyOutput, type AgentTargets, type QualifyRole, type Fit,
} from '../../src/lib/agents/qualification';
import {
  danaFitScore, lotFactOf, lotsFromListings, lotLine, normalizeDanaTargets, isKeyAccount, looksLikeGroup, type LotFact, type DanaTargets,
} from '../../src/lib/agents/sourcing';
import { accountFitScore, segmentOf } from '../../src/lib/agents/research';
import { opportunities, brandKey, type OfferLite, type DealerListingLite } from '../../src/lib/agents/opportunity';
import { sameDealer, isoOfCountry, nameKey, phoneKey9 } from '../../src/lib/agents/keys';
import { SITE_LABEL } from '../../src/services/dealerDirectory';
import { countryVat } from '../../src/lib/offers/vat';
import { HAIKU } from '../../src/lib/agents/aiCost';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { sb, journal, type AgentRow } from './store';

export interface AiSettings {
  targets: Partial<AgentTargets> | null; daily_budget_usd: number | string; auto_discovery: boolean; auto_qualify_per_day: number; map_auto_add: boolean; map_min_score: number;
  // Phase 2.3 (SQL agents_premiers_mails) : consignes de Channing, premiers mails rédigés d'office par jour.
  instructions?: string; auto_draft_per_day?: number;
  // Étape 2 (SQL agents_recherche) : recherches de comptes lancées d'office par jour.
  auto_research_per_day?: number;
}
export type AiAgent = AgentRow & AiSettings;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

async function fetchDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'fr,en;q=0.8,nl;q=0.7,de;q=0.7' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !/html|xml|text/i.test(type)) return null;
    const html = await res.text();
    return html.length > 3_000_000 ? html.slice(0, 3_000_000) : html;
  } catch { return null; }
}

const looksBlocked = (html: string | null) => !html || html.length < 800 || /captcha|cf-chl|access denied|just a moment/i.test(html.slice(0, 6000));

/** Une page : lecture directe, puis Zyte si elle résiste (`zyte`). */
export async function fetchPage(url: string, zyte: boolean): Promise<string | null> {
  const direct = await fetchDirect(url);
  if (!looksBlocked(direct) || !zyte) return direct;
  const z = await fetchHtmlWithZyte(url, 1).catch(() => null);
  return z?.html ?? direct;
}

const mxCache = new Map<string, boolean>();
/** Le domaine reçoit-il du courrier ? (enregistrement MX) */
export async function hasMx(domain: string): Promise<boolean> {
  const d = domain.toLowerCase();
  if (mxCache.has(d)) return mxCache.get(d)!;
  let ok = false;
  try {
    const r = await Promise.race([dns.resolveMx(d), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('délai')), 6000))]);
    ok = Array.isArray(r) && r.length > 0;
  } catch { ok = false; }
  mxCache.set(d, ok);
  return ok;
}

/** Coordonnées d'une adresse (OpenStreetMap), une requête à la fois. */
async function geocode(country: string | null, zip: string | null, city: string | null): Promise<{ lat: number; lng: number } | null> {
  if (!country || (!zip && !city)) return null;
  try {
    const q = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: country.toLowerCase() });
    if (zip) q.set('postalcode', zip.replace(/\s+[A-Z]{2}$/i, '').trim());
    if (city) q.set('city', city);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
      headers: { 'user-agent': 'ADA-MC-Export/1.0 (+https://mc-export.com)', 'accept-language': 'fr' }, signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as Array<{ lat: string; lon: string }>;
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  } catch { return null; }
}

// --- Contexte partagé d'une série (cibles, offres) ---------------------------------------

let offersCache: { at: number; rows: OfferLite[] } | null = null;
/** Nos offres du moment (vitrine des bonnes affaires), prix MC Export HT. */
export async function loadOffers(): Promise<OfferLite[]> {
  if (offersCache && Date.now() - offersCache.at < 30 * 60_000) return offersCache.rows;
  const { data } = await sb.from('intra_showcase').select('id, vehicle, price_ht, title').limit(500);
  const rows = ((data ?? []) as Array<{ id: string; vehicle: { brand?: string; model?: string; year?: number | null; km?: number | null } | null; price_ht: number | null; title: string | null }>)
    .map((r) => ({ id: r.id, brand: r.vehicle?.brand ?? '', model: r.vehicle?.model ?? '', year: r.vehicle?.year ?? null, km: r.vehicle?.km ?? null, priceHt: r.price_ht, title: (r.title ?? '').trim() || `${r.vehicle?.brand ?? ''} ${r.vehicle?.model ?? ''}`.trim() }));
  offersCache = { at: Date.now(), rows };
  return rows;
}

let countriesCache: { at: number; rows: string[] } | null = null;
/** Les pays de nos ventes (fiches des acheteurs du Workflow), du plus fréquent au moins fréquent. */
export async function salesCountries(): Promise<string[]> {
  if (countriesCache && Date.now() - countriesCache.at < 60 * 60_000) return countriesCache.rows;
  const { data: tx } = await sb.from('transactions_admin').select('buyer_contact_id').not('buyer_contact_id', 'is', null).limit(5000);
  const ids = [...new Set(((tx ?? []) as Array<{ buyer_contact_id: string }>).map((t) => t.buyer_contact_id))];
  const count = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('contacts').select('id, country, company_name').in('id', ids.slice(i, i + 200));
    for (const c of (data ?? []) as Array<{ country: string | null; company_name: string | null }>) {
      if (/mc[ -]?export/i.test(c.company_name ?? '')) continue;
      const iso = isoOfCountry(c.country);
      if (iso) count.set(iso, (count.get(iso) ?? 0) + 1);
    }
  }
  const rows = [...count].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  countriesCache = { at: Date.now(), rows };
  return rows;
}

export interface SeriesContext {
  agent: AiAgent; taskId: string | null; role: QualifyRole;
  targets: AgentTargets; targetCountries: string[]; offers: OfferLite[];
  /** Dana : taille d'un lot et nos pays de vente (pour les écarts). */
  dana: DanaTargets;
}

export async function seriesContext(agent: AiAgent, taskId: string | null): Promise<SeriesContext> {
  const role: QualifyRole = agent.agent === 'dana' ? 'dana' : 'ada';
  const targets = normalizeTargets(role === 'ada' ? agent.targets : null);
  const dana = normalizeDanaTargets(role === 'dana' ? agent.targets : null);
  // Ada vend à l'export : jamais la France (pays d'achat), même si nos ventes en comptent.
  const targetCountries = role === 'ada' ? buyerCountries(targets.countries.length ? targets.countries : await salesCountries()) : [];
  return { agent, taskId, role, targets, targetCountries, offers: role === 'ada' ? await loadOffers() : [], dana };
}

/** Les lots d'un garage (sa fiche principale et toutes ses fiches), avec leurs écarts face à nos pays de vente ; repli sans la base. */
export async function lotsOfDealer(rootId: string, listings: Array<DealerListingLite>, dana: DanaTargets): Promise<LotFact[]> {
  const { data, error } = await sb.rpc('agents_dealer_lots', { p_dealer: rootId, p_markets: dana.markets, p_min: dana.minLot, p_limit: 20 });
  if (!error && Array.isArray(data)) return (data as Array<Parameters<typeof lotFactOf>[0]>).map(lotFactOf);
  return lotsFromListings(listings, dana.minLot);
}

// --- Un garage --------------------------------------------------------------------------------

interface DealerDb {
  id: string; name: string; country: string | null; city: string | null; zip: string | null; street: string | null; phone: string | null; contact_name: string | null;
  site_url: string | null; imprint_url: string | null; website: string | null;
  // SQL agents_tous_sites (17/10) ; absents avant : une fiche seule, AutoScout24.
  site?: string | null; parent_id?: string | null; lat?: number | null; lng?: number | null; legal_id?: string | null;
}
export interface QualifyOutcome { status: 'qualifie' | 'ecarte' | 'echec'; name: string; score: number | null; cost: number; detail: string; addedToMap: boolean }

const IS_VAN = /(van|utilit|transport|bestel|kasten|furg|camion)/i;

const BASE_COLS = 'id, name, country, city, zip, street, phone, contact_name, site_url, imprint_url, website, site';
const GROUP_COLS = `${BASE_COLS}, parent_id, lat, lng, legal_id`;

/** Un garage et toutes ses fiches (le même garage vu sur d'autres sites), la fiche principale d'abord. */
async function loadDealerGroup(dealerId: string): Promise<DealerDb[]> {
  const first = await sb.from('market_dealers').select(GROUP_COLS).eq('id', dealerId).maybeSingle();
  if (first.error) {
    // SQL « tous sites » pas encore collé : une fiche seule, comme avant.
    const { data } = await sb.from('market_dealers').select(BASE_COLS).eq('id', dealerId).maybeSingle();
    return data ? [data as DealerDb] : [];
  }
  let root = first.data as DealerDb | null;
  if (!root) return [];
  if (root.parent_id) {
    const { data } = await sb.from('market_dealers').select(GROUP_COLS).eq('id', root.parent_id).maybeSingle();
    if (data) root = data as DealerDb;
  }
  const { data: kids } = await sb.from('market_dealers').select(GROUP_COLS).eq('parent_id', root.id).limit(50);
  return [root, ...((kids ?? []) as DealerDb[]).filter((k) => k.id !== root?.id)];
}

/** Les identifiants de toutes les fiches d'un garage (lui seul tant que le SQL « tous sites » n'est pas collé). */
export async function dealerGroupIds(dealerId: string): Promise<string[]> {
  const ids = (await loadDealerGroup(dealerId)).map((m) => m.id);
  return ids.length ? ids : [dealerId];
}

const MARKET_HOST = /(^|\.)(gaspedaal|autoscout24|marktplaats|autotrack|autotelegraaf|viabovag|2dehands|2ememain|mobile|leboncoin|lacentrale|kleinanzeigen|facebook|google)\./i;

/**
 * Le site d'un garage vu sur Gaspedaal : son lien « dealer » (api.gaspedaal.nl/
 * redirect/…) mène à l'annonce chez lui (preuve 07/09 : → tesselaarbv.nl/
 * occasions/…). On lit seulement l'adresse de la redirection ; une page qui
 * refuse (403) n'est pas forcée — la recherche web prend le relais.
 */
async function siteFromRedirect(url: string): Promise<string | null> {
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(current, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const loc = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !loc) break;
      current = new URL(loc, current).toString();
    }
    if (current === url) return null;
    const u = new URL(current);
    return MARKET_HOST.test(u.hostname) ? null : `${u.origin}/`;
  } catch { return null; }
}

const firstOf = <T>(xs: Array<T | null | undefined>): T | null => xs.find((x): x is T => x != null && x !== '') ?? null;

/** La fiche d'avant (pour ne pas ramener une étape en arrière, ni perdre une recherche approfondie). */
interface PrevProspect {
  id: string; stage: string; network_contact_id: string | null; dealer_id: string;
  people?: Array<{ nom: string; fonction: string; email: string | null; source: string; linkedin?: string | null; via?: string }> | null;
  emails?: Array<{ email: string; nature: string; source: string; mx: boolean; via?: string }> | null;
  evidence?: Array<{ url: string; note: string; via?: string }> | null;
  best_contact?: { nom: string | null; fonction: string | null; email: string | null; linkedin?: string | null; pourquoi: string; telephone?: string | null } | null;
}

/**
 * Ce qu'une recherche approfondie avait trouvé (via « approfondie ») revient
 * dans la fiche refaite : ses personnes, ses e-mails vérifiés, ses pistes et
 * ses sources ; et son meilleur contact, si la fiche refaite n'en nomme pas.
 * Les listes sont complétées sur place.
 */
export function keepDeep(
  prev: PrevProspect | null,
  contacts: Array<{ nom: string; fonction: string; email: string | null; source: string; linkedin: string | null }>,
  emails: Array<{ email: string; nature: string; source: string; mx: boolean }>,
  evidence: Array<{ url: string; note: string }>,
  best: { nom: string | null; fonction: string | null; email: string | null; linkedin: string | null; pourquoi: string },
): { hasEmail: boolean; keyAccount: boolean } {
  if (!prev) return { hasEmail: false, keyAccount: false };
  const deepPeople = (prev.people ?? []).filter((x) => x.via === 'approfondie');
  for (const x of deepPeople) if (!contacts.some((c) => c.nom.toLowerCase() === x.nom.toLowerCase())) contacts.push({ ...x, linkedin: x.linkedin ?? null });
  const deepEmails = (prev.emails ?? []).filter((e) => e.via === 'approfondie');
  for (const e of deepEmails) if (!emails.some((x) => x.email === e.email)) emails.push(e);
  for (const e of (prev.evidence ?? []).filter((x) => x.via === 'approfondie')) if (!evidence.some((x) => x.url && x.url === e.url && x.note === e.note)) evidence.push(e);
  const pb = prev.best_contact;
  if (!best.nom && pb?.nom && deepPeople.some((x) => x.nom.toLowerCase() === pb.nom?.toLowerCase())) Object.assign(best, pb);
  return { hasEmail: deepEmails.some((e) => e.mx), keyAccount: (prev.evidence ?? []).some((x) => x.via === 'approfondie' && /^groupe /.test(x.note)) };
}

export async function qualifyDealer(dealerId: string, ctx: SeriesContext): Promise<QualifyOutcome> {
  const group = await loadDealerGroup(dealerId);
  const root = group[0] as DealerDb | undefined;
  if (!root) return { status: 'echec', name: dealerId, score: null, cost: 0, detail: 'garage introuvable dans l\'annuaire', addedToMap: false };
  // La fiche principale, complétée par ses autres fiches (ville, code postal, rue, position).
  const placed = group.find((m) => m.lat != null && m.lng != null);
  const d: DealerDb = {
    ...root, city: root.city ?? firstOf(group.map((m) => m.city)), zip: root.zip ?? firstOf(group.map((m) => m.zip)),
    street: root.street ?? firstOf(group.map((m) => m.street)), lat: placed?.lat ?? null, lng: placed?.lng ?? null,
  };
  // Un garage en France : MC Export y achète — un fournisseur possible pour Dana, pas un acheteur d'Ada.
  if (ctx.role === 'ada' && (d.country ?? '').toUpperCase() === HOME_COUNTRY) {
    return { status: 'ecarte', name: d.name, score: null, cost: 0, detail: 'garage en France : fournisseur possible (Dana), pas un acheteur', addedToMap: false };
  }
  const ids = group.map((m) => m.id);
  const siteOfRow = (m: DealerDb) => m.site ?? 'autoscout24';
  const sources = [...new Set(group.map((m) => SITE_LABEL[siteOfRow(m)] ?? siteOfRow(m)))];
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: lRows } = await sb.from('market_dealer_listings').select('listing_url, brand, model, title, year, mileage, price_eur, vehicle_type').in('dealer_id', ids).gte('last_seen_at', since).limit(1000);
  const listings = (lRows ?? []) as Array<DealerListingLite & { vehicle_type: string | null }>;
  const phone = firstOf(group.map((m) => m.phone));
  const contactName = firstOf(group.map((m) => m.contact_name));

  // 1. La fiche AutoScout24 (s'il en a une)
  const evidence: Array<{ url: string; note: string }> = [];
  let page: DealerPageInfo | null = null;
  for (const m of group.filter((x) => siteOfRow(x) === 'autoscout24')) {
    for (const u of [m.imprint_url, m.site_url].filter((x): x is string => !!x)) {
      const html = await fetchPage(u, true);
      page = html ? parseDealerInfoPage(html) : null;
      if (page) { evidence.push({ url: u, note: 'fiche AutoScout24' }); break; }
    }
    if (page) break;
  }

  // 2. Le site du garage : sa fiche AutoScout24, un site déclaré ailleurs, ou son lien Gaspedaal
  let website = page?.website ?? firstOf(group.map((m) => m.website));
  if (!website) {
    for (const m of group.filter((x) => siteOfRow(x) === 'gaspedaal' && x.site_url)) {
      website = await siteFromRedirect(m.site_url as string);
      if (website) { evidence.push({ url: m.site_url as string, note: 'lien Gaspedaal vers le site du garage' }); break; }
    }
  }
  return qualifySubject({ d, dealerIds: ids, account: null, sources, listings, phone, contactName, legalId: firstOf(group.map((m) => m.legal_id)), page, website, evidence }, ctx);
}

/** Une entreprise trouvée par une recherche web (étape 2). */
interface AccountRow {
  id: string; agent: string; segment: string; country: string | null; name: string; website: string; city: string | null;
  size_hint: string | null; why: string | null; sources: string[] | null; status: string; prospect_id: string | null;
}

/** Qualifier une entreprise trouvée par recherche web : son site, la personne qui décide selon son type, un score de compte. */
export async function qualifyAccount(accountId: string, ctx: SeriesContext): Promise<QualifyOutcome> {
  const { data } = await sb.from('agent_accounts').select('*').eq('id', accountId).maybeSingle();
  const a = data as AccountRow | null;
  if (!a) return { status: 'echec', name: accountId, score: null, cost: 0, detail: 'compte introuvable', addedToMap: false };
  if (a.agent !== ctx.agent.agent) return { status: 'echec', name: a.name, score: null, cost: 0, detail: `compte trouvé par ${a.agent === 'dana' ? 'Dana' : 'Ada'}`, addedToMap: false };
  if (ctx.role === 'ada' && (a.country ?? '').toUpperCase() === HOME_COUNTRY) {
    return { status: 'ecarte', name: a.name, score: null, cost: 0, detail: 'entreprise en France : pas un acheteur (Ada vend à l\'export)', addedToMap: false };
  }
  const d: DealerDb = {
    id: a.id, name: a.name, country: a.country, city: a.city, zip: null, street: null, phone: null, contact_name: null,
    site_url: null, imprint_url: null, website: a.website, lat: null, lng: null,
  };
  const evidence = (a.sources ?? []).slice(0, 5).map((url) => ({ url, note: 'vue par la recherche web' }));
  return qualifySubject({ d, dealerIds: [], account: a, sources: ['Recherche web'], listings: [], phone: null, contactName: null, legalId: null, page: null, website: a.website, evidence }, ctx);
}

/** Ce qu'on qualifie : un garage de l'annuaire (ses fiches réunies) ou une entreprise trouvée par recherche web. */
interface Subject {
  d: DealerDb; dealerIds: string[]; account: AccountRow | null; sources: string[];
  listings: Array<DealerListingLite & { vehicle_type: string | null }>;
  phone: string | null; contactName: string | null; legalId: string | null;
  page: DealerPageInfo | null; website: string | null; evidence: Array<{ url: string; note: string }>;
}

async function qualifySubject(s: Subject, ctx: SeriesContext): Promise<QualifyOutcome> {
  const { d, listings, phone, contactName, page, website, evidence, sources } = s;
  const named = `${d.name}${d.country ? ` (${d.country})` : ''}`;
  live(ctx.taskId, website ? `${named} : lecture de son site` : `${named} : pas de site connu`);
  const opps = opportunities(listings, ctx.offers, countryVat(d.country ?? 'FR'));
  const found = new Map<string, string>();
  for (const e of extractEmails(page?.imprint ?? '')) found.set(e, 'Impressum AutoScout24');
  const pages: Array<{ url: string; text: string }> = [];
  const note = (html: string, source: string) => { for (const e of [...mailtoEmails(html), ...extractEmails(pageText(html, 80_000))]) if (!found.has(e)) found.set(e, source); };
  if (website) {
    const home = await fetchPage(website, true);
    if (home) {
      note(home, website);
      pages.push({ url: website, text: pageText(home, 2500) });
      evidence.push({ url: website, note: s.account ? 'site de l\'entreprise' : 'site du garage' });
      for (const link of contactLinks(home, website, 2)) {
        const h = await fetchPage(link, false);
        if (!h) continue;
        note(h, link);
        pages.push({ url: link, text: pageText(h, 4500) });
        evidence.push({ url: link, note: 'page contact' });
      }
    }
  }
  const emailsFound = [...found].map(([email, source]) => ({ email, source })).slice(0, 30);
  const people = [...(page?.contactPersons ?? []).map((p) => ({ nom: p.name, fonction: p.position ?? 'vente', email: null as string | null, source: 'fiche AutoScout24' })),
    ...extractPeople(page?.imprint ?? '').map((p) => ({ nom: p.name, fonction: p.role, email: null as string | null, source: 'Impressum AutoScout24' }))];
  const brandsSeen = [...new Set(listings.map((l) => l.brand).filter((b): b is string => !!b))];
  // Dana : ses lots de véhicules identiques (avec les écarts face à nos pays de vente) font le score.
  const lots = ctx.role === 'dana' && s.dealerIds.length ? await lotsOfDealer(d.id, listings, ctx.dana) : [];
  // Une entreprise trouvée par recherche : le score d'un compte (type, pays, taille, joignable).
  const segment = s.account ? segmentOf(ctx.role, s.account.segment) : null;
  const fitIn = { country: d.country, targetCountries: ctx.targetCountries, targets: ctx.targets, listings, opportunities: opps.length, nbBrands: brandsSeen.length };
  const fitOf = (hasEmail: boolean, hasNamedContact: boolean, hasLinkedin = false): Fit => (s.account
    ? accountFitScore({ role: ctx.role, segment, country: d.country, targetCountries: ctx.targetCountries, size: s.account.size_hint, hasEmail, hasNamedContact, hasLinkedin })
    : ctx.role === 'dana'
      ? danaFitScore({ lots, listings: listings.length, hasEmail, hasNamedContact })
      : fitScore({ ...fitIn, hasEmail, hasNamedContact }));
  const fit = fitOf(emailsFound.length > 0, people.length > 0);
  const webSearch = !website && emailsFound.length === 0;
  // Grand compte probable (groupe, plusieurs sites) ou entreprise trouvée par recherche : on cherche la personne qui décide.
  const decisionSearch = !webSearch && (!!s.account || looksLikeGroup(d.name) || (page?.branches.length ?? 0) >= 2);
  const prompt = qualifyPrompt({
    role: ctx.role, lots: lots.slice(0, 6).map((l) => lotLine(l, true)), decisionSearch,
    account: s.account ? { segment: segment?.label ?? s.account.segment, roles: segment?.roles ?? 'la direction', size: s.account.size_hint, why: s.account.why } : undefined,
    dealer: { name: d.name, country: d.country, city: d.city, zip: d.zip, street: d.street, phone, contactName, sources, legalId: s.legalId },
    fit,
    stock: {
      listings: listings.length, brands: brandsSeen.slice(0, 12), vans: listings.filter((l) => IS_VAN.test(l.vehicle_type ?? '')).length,
      medianPrice: median(listings.map((l) => l.price_eur).filter((p): p is number => !!p)),
      opportunities: opps.slice(0, 5).map((o) => `${o.listing.brand ?? ''} ${o.listing.model ?? ''} ${o.listing.year ?? ''} à ${o.listing.price_eur} € TTC contre ${o.ourTtc} € pour notre ${o.offer.title}`),
    },
    page, emailsFound, pages, webSearch,
  });

  // 3. Haiku 5.5
  // Déjà qualifié par une de ses fiches (avant le rapprochement des sites) : c'est la même fiche prospect.
  const PREV_COLS = 'id, stage, network_contact_id, dealer_id, people, emails, evidence, best_contact';
  const { data: existing } = s.account
    ? await sb.from('agent_prospects').select(PREV_COLS).eq('agent', ctx.agent.agent).eq('account_id', s.account.id).limit(1)
    : await sb.from('agent_prospects').select(PREV_COLS).eq('agent', ctx.agent.agent).in('dealer_id', s.dealerIds).limit(1);
  const prev = (((existing ?? []) as PrevProspect[])[0]) ?? null;
  let ai: QualifyOutput;
  let cost = 0;
  let seenUrls: string[] = [];
  const searched = webSearch || decisionSearch;
  live(ctx.taskId, webSearch ? `${named} : recherche de son site et de ses contacts sur le web (IA)` : decisionSearch ? `${named} : recherche de la personne qui décide (IA, web)` : `${named} : analyse par l'IA`);
  try {
    const budget = Number(ctx.agent.daily_budget_usd);
    const r = await callClaude<QualifyOutput>({
      // Un budget illisible vaut 0 (pas d'appel), jamais « sans limite ».
      agent: ctx.agent.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'qualification', model: HAIKU,
      system: ctx.role === 'dana' ? DANA_QUALIFY_SYSTEM : QUALIFY_SYSTEM, user: prompt, schema: qualifySchema(ctx.role) as unknown as Record<string, unknown>,
      tools: searched ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 }] : undefined,
      maxTokens: 6000, effort: 'low', prospectId: prev?.id ?? null, taskId: ctx.taskId,
    });
    ai = r.data as QualifyOutput;
    cost = r.costUsd;
    seenUrls = r.seenUrls ?? [];
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { status: 'echec', name: d.name, score: null, cost: 0, detail: e instanceof Error ? e.message : String(e), addedToMap: false };
  }

  // 4. Contrôle des e-mails : écrits dans une page lue, domaine qui reçoit du courrier
  live(ctx.taskId, `${named} : contrôle des e-mails (publiés, domaine qui reçoit du courrier) et du profil LinkedIn`);
  const confirmed = new Set<string>();
  if (searched) {
    for (const e of ai.emails ?? []) {
      const email = String(e.email ?? '').toLowerCase();
      if (!email || !/^https?:\/\//i.test(e.source ?? '')) continue;
      const h = await fetchPage(e.source, false);
      if (h && [...mailtoEmails(h), ...extractEmails(pageText(h, 200_000))].includes(email)) {
        confirmed.add(email);
        if (!evidence.some((x) => x.url === e.source)) evidence.push({ url: e.source, note: 'page trouvée par recherche web' });
      }
    }
  }
  const emails = await Promise.all(acceptedEmails(ai.emails, emailsFound, prompt, confirmed).map(async (e) => ({ ...e, mx: await hasMx(e.email.split('@')[1] ?? '') })));
  const okEmails = new Set(emails.filter((e) => e.mx).map((e) => e.email));
  // Un profil LinkedIn n'est gardé que s'il a été vu dans un résultat lu (ou dans le matériel) et porte le nom de la personne.
  const li = (url: string | null | undefined, name: string | null | undefined) => acceptedLinkedin(url, name, seenUrls, prompt);
  const best = {
    ...ai.meilleur_contact,
    email: ai.meilleur_contact?.email && okEmails.has(ai.meilleur_contact.email.toLowerCase()) ? ai.meilleur_contact.email.toLowerCase() : null,
    linkedin: li(ai.meilleur_contact?.linkedin, ai.meilleur_contact?.nom),
  };
  if (!best.email) best.email = emails.find((e) => e.mx && /^(vo|occasion|gebraucht|used|verkoop|vente|sales|verkauf|achat|inkoop|einkauf)/.test(e.email))?.email ?? emails.find((e) => e.mx)?.email ?? null;
  const contacts = [...people.map((p) => ({ ...p, linkedin: null as string | null })), ...(ai.contacts ?? []).filter((c) => c.nom && !people.some((p) => p.nom.toLowerCase() === c.nom.toLowerCase()))]
    .map((c) => ({ ...c, email: c.email && okEmails.has(c.email.toLowerCase()) ? c.email.toLowerCase() : null, linkedin: li(c.linkedin, c.nom) })).slice(0, 12);
  // Refaire la fiche ne perd pas une recherche approfondie (18/10) : ses personnes, e-mails, pistes et sources sont gardés.
  const kept = keepDeep(prev, contacts, emails, evidence, best);
  const keyAccount = !ai.exclure && (isKeyAccount(ai.grand_compte, ai.type, ai.nb_sites ?? (page?.branches.length || null)) || segment?.keyAccount === true || kept.keyAccount);
  const fit2 = fitOf(okEmails.size > 0 || kept.hasEmail, contacts.length > 0, !!best.linkedin || contacts.some((c) => !!c.linkedin));
  const score = finalScore(fit2.score, ai);
  const site = website ?? (ai.site_web && /^https?:\/\//i.test(ai.site_web) ? ai.site_web : null);

  // 5. La fiche du prospect (une étape avancée par l'équipe n'est jamais ramenée en arrière)
  const now = new Date().toISOString();
  const stage = ai.exclure ? 'ecarte' : 'qualifie';
  const row: Record<string, unknown> = {
    agent: ctx.agent.agent, dealer_id: s.account ? null : prev?.dealer_id ?? d.id, name: d.name, country: d.country, city: d.city, zip: d.zip, street: d.street,
    phone: phone ?? page?.phones[0] ?? null, website: site, legal_name: ai.raison_sociale, group_name: ai.groupe,
    sites: ai.nb_sites ?? (page?.branches.length || null), kind: ai.type, brands_official: (ai.marques_officielles ?? []).slice(0, 12),
    emails, people: contacts, best_contact: best, language: ai.langue, fit_score: fit2.score, fit_parts: fit2.parts, score,
    summary: ai.resume, exclusion_reason: ai.exclure ? ai.motif_exclusion : null, evidence, qualified_at: now,
    qualify_cost_usd: Math.round(cost * 10_000) / 10_000, updated_at: now,
    // SQL agents_comptes (17/10) : grand compte, nature du compte, lots vus par Dana.
    key_account: keyAccount, account_kind: ai.type ?? segment?.kind ?? null, lots: lots.slice(0, 6),
  };
  // SQL agents_recherche (17/10) : la fiche d'une entreprise trouvée par recherche web.
  if (s.account) row.account_id = s.account.id;
  if (!prev || ['qualifie', 'ecarte'].includes(prev.stage)) row.stage = stage;
  let { data: saved, error } = prev
    ? await sb.from('agent_prospects').update(row).eq('id', prev.id).select('id')
    : await sb.from('agent_prospects').insert(row).select('id');
  if (error && /key_account|account_kind|lots/.test(error.message)) {
    // SQL agents_comptes pas encore collé : la fiche d'avant, sans ces trois colonnes.
    const { key_account: _k, account_kind: _a, lots: _l, ...legacy } = row;
    void _k; void _a; void _l;
    ({ data: saved, error } = prev
      ? await sb.from('agent_prospects').update(legacy).eq('id', prev.id).select('id')
      : await sb.from('agent_prospects').insert(legacy).select('id'));
  }
  if (error) return { status: 'echec', name: d.name, score, cost, detail: `fiche non enregistrée : ${error.message}`, addedToMap: false };
  const prospectId = ((saved ?? []) as Array<{ id: string }>)[0]?.id ?? prev?.id ?? null;
  if (s.account) await sb.from('agent_accounts').update({ status: ai.exclure ? 'ecarte' : 'qualifie', prospect_id: prospectId, updated_at: now }).eq('id', s.account.id);
  else if (site && site !== d.website) await sb.from('market_dealers').update({ website: site }).eq('id', d.id);

  // 6. La carte du réseau
  let addedToMap = false;
  const reachable = okEmails.size > 0 || !!(phone ?? page?.phones[0]);
  if (prospectId && !prev?.network_contact_id && !ai.exclure && ctx.agent.map_auto_add && score >= ctx.agent.map_min_score && reachable) {
    const at = d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null;
    addedToMap = await addToMap(ctx.agent.agent, prospectId, d, {
      score, summary: ai.resume, best, contacts, site, brands: brandsSeen, phone: phone ?? page?.phones[0] ?? null, at,
      role: ctx.role === 'dana' ? 'vendeur' : 'acheteur', kind: ai.type, lotNote: lots[0] ? lotLine(lots[0], false) : null,
    });
  }

  const who = best.nom ? `${best.nom}${best.fonction ? ` (${best.fonction})` : ''}` : best.email ?? 'pas encore d\'interlocuteur';
  const label = `${d.name} (${d.country ?? '?'}${segment ? ` · ${segment.label.toLowerCase()}` : ''})`;
  await journal({
    agent: ctx.agent.agent, actor: ctx.agent.agent, kind: ai.exclure ? 'qualification_ecarte' : 'qualification',
    summary: ai.exclure
      ? `${label} écarté : ${ai.motif_exclusion ?? 'hors cible'}`
      : `${label} : fiche prête, ${score}/100 — ${who}${lots[0] ? ` · lot : ${lotLine(lots[0], false)}` : ''}${keyAccount ? ' · grand compte' : ''}${addedToMap ? ' · ajouté à la carte' : ''}`,
    details: { dealer_id: s.account ? null : d.id, account_id: s.account?.id ?? null, prospect_id: prospectId, score, fit: fit2.score, cost_usd: Math.round(cost * 10_000) / 10_000, web_search: webSearch, decision_search: decisionSearch, key_account: keyAccount, lots: lots.length, sources },
  });
  return { status: ai.exclure ? 'ecarte' : 'qualifie', name: d.name, score, cost, detail: who, addedToMap };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
}

/** La nature d'un compte → le type d'un contact de la carte (concession, loueur, trader, autre). */
export function mapKind(type: string | null | undefined): 'concession' | 'loueur' | 'trader' | 'autre' {
  if (type === 'loueur_ou_leasing') return 'loueur';
  if (type === 'negociant_vo' || type === 'exportateur_concurrent') return 'trader';
  if (type === 'flotte_entreprise') return 'autre';
  return 'concession';
}

async function addToMap(agent: string, prospectId: string, d: DealerDb, q: {
  score: number; summary: string; best: { nom: string | null; fonction: string | null; email: string | null }; contacts: Array<{ nom: string; fonction: string; email: string | null }>;
  site: string | null; brands: string[]; phone: string | null;
  /** Position donnée par l'annonce (Marktplaats, Blocket, Leboncoin…) ; sinon OpenStreetMap. */
  at?: { lat: number; lng: number } | null;
  /** Ada trouve des acheteurs, Dana des vendeurs ; la nature du compte (groupe, loueur…) ; le plus gros lot vu par Dana. */
  role?: 'acheteur' | 'vendeur'; kind?: string | null; lotNote?: string | null;
}): Promise<boolean> {
  // Déjà sur la carte sous un autre nom ou le même téléphone : on relie, on n'ajoute pas.
  const { data: near } = await sb.from('network_contacts').select('id, name, phone, role, source').eq('country', (d.country ?? 'FR').toUpperCase()).limit(2000);
  const twin = ((near ?? []) as Array<{ id: string; name: string; phone: string | null; role?: string; source?: string }>).find((n) => sameDealer(n, { name: d.name, phone: q.phone }));
  if (twin) {
    // Ajouté par l'autre agente (Ada : acheteur, Dana : vendeur) : il devient « acheteur & vendeur ». Un contact saisi par l'équipe n'est pas touché.
    if ((twin.source === 'ada' || twin.source === 'dana') && q.role && twin.role && twin.role !== q.role && twin.role !== 'les_deux') {
      await sb.from('network_contacts').update({ role: 'les_deux' }).eq('id', twin.id);
    }
    await sb.from('agent_prospects').update({ network_contact_id: twin.id }).eq('id', prospectId);
    return false;
  }
  const at = q.at ?? await geocode(d.country, d.zip, d.city);
  const label = agent === 'dana' ? 'Dana' : 'Ada';
  const { data, error } = await sb.from('network_contacts').insert({
    name: d.name, kind: mapKind(q.kind), role: q.role ?? 'acheteur', country: (d.country ?? 'FR').toUpperCase(), city: d.city,
    lat: at?.lat ?? null, lng: at?.lng ?? null, contact_name: q.best.nom, phone: q.phone, email: q.best.email, website: q.site,
    relation: 'nouveau', vehicle_types: q.brands.slice(0, 6).map((b) => b.charAt(0) + b.slice(1).toLowerCase()).join(', '),
    comment: `Ajouté par ${label} (IA), score ${q.score}/100 : ${q.summary}${q.lotNote ? ` Lot vu : ${q.lotNote}.` : ''}`.slice(0, 1000),
    people: q.contacts.slice(0, 6).map((c) => ({ name: c.nom, role: c.fonction ?? '', phone: '', email: c.email ?? '' })),
    source: agent, ai_added_at: new Date().toISOString(),
  }).select('id');
  if (error) { console.warn(`[AGENTS] ${d.name} non ajouté à la carte : ${error.message}`); return false; }
  const id = ((data ?? []) as Array<{ id: string }>)[0]?.id;
  if (id) await sb.from('agent_prospects').update({ network_contact_id: id }).eq('id', prospectId);
  return !!id;
}

/**
 * Les prochains garages à qualifier d'office (pays et marques cibles, pas encore
 * vus par Ada). Un garage déjà confié à Ada ces 3 derniers jours sans fiche (échec)
 * attend : il n'est pas repris à chaque cycle.
 */
export async function nextCandidates(ctx: SeriesContext, limit: number): Promise<string[]> {
  const { data, error } = await sb.rpc('agents_qualify_candidates', {
    p_countries: ctx.targetCountries, p_brand_keys: ctx.targets.brands.map(brandKey), p_van_keys: ctx.targets.vanBrands.map(brandKey), p_limit: 50,
  });
  if (error) { if (!/does not exist|schema cache/i.test(error.message)) console.warn(`[AGENTS] candidats illisibles : ${error.message}`); return []; }
  const tried = await recentlyTried(ctx.agent.agent);
  return ((data ?? []) as Array<{ dealer_id: string }>).map((r) => r.dealer_id).filter((id) => !tried.has(id)).slice(0, limit);
}

export interface QualificationTaskRow {
  params: { dealer_ids?: string[]; account_ids?: string[] } | null;
  status?: string;
  result?: { echecs_ids?: string[]; arret?: string | null; details?: string[] } | null;
}

/**
 * Ce qu'une série de fiches retient (18/10) : ce qu'elle a confié tant qu'elle
 * tourne, puis seulement ce qui a vraiment échoué. Une panne de l'IA (clé,
 * crédits, espace de travail), un budget atteint ou un redémarrage ne retient
 * rien : l'agente reprend tout de suite. Ce qui a sa fiche n'est plus candidat
 * de toute façon. Les séries d'avant la liste des échecs : une panne ou un
 * arrêt libère toute la série.
 */
export function heldBackIds(t: QualificationTaskRow): string[] {
  const all = [...(t.params?.dealer_ids ?? []), ...(t.params?.account_ids ?? [])];
  if (t.status === 'echec' || t.status === 'annulee') return [];
  if (t.status !== 'terminee') return all;
  const r = t.result ?? {};
  if (Array.isArray(r.echecs_ids)) return r.echecs_ids.map(String);
  const details = r.details ?? [];
  return r.arret || (details.length > 0 && details.every((d) => !!aiProblemOf(d))) ? [] : all;
}

/** Les garages et les comptes confiés à cette agente ces 3 derniers jours, sans fiche faute d'y être arrivée : pas repris à chaque cycle. */
async function recentlyTried(agent: string): Promise<Set<string>> {
  const { data } = await sb.from('agent_tasks').select('params, status, result').eq('agent', agent).eq('kind', 'qualification').gte('created_at', new Date(Date.now() - 3 * 86_400_000).toISOString()).limit(500);
  return new Set(((data ?? []) as QualificationTaskRow[]).flatMap(heldBackIds));
}

/** Les entreprises trouvées par recherche, pas encore qualifiées : elles passent avant l'annuaire (des comptes choisis). */
export async function nextAccountCandidates(ctx: SeriesContext, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const { data, error } = await sb.from('agent_accounts').select('id').eq('agent', ctx.agent.agent).eq('status', 'nouveau').order('found_at', { ascending: true }).limit(100);
  if (error) return []; // SQL agents_recherche pas encore collé
  const tried = await recentlyTried(ctx.agent.agent);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter((id) => !tried.has(id)).slice(0, limit);
}

const knownCache = new Map<string, { at: number; names: Set<string>; phones: Set<string> }>();
/**
 * Ceux que l'équipe connaît déjà : la carte du réseau, et les fournisseurs et
 * vendeurs du Workflow (Dana) ou ses clients (Ada) — une agente ne leur
 * écrit pas à froid.
 */
export async function knownCounterparts(side: 'fournisseurs' | 'clients' = 'fournisseurs'): Promise<{ names: Set<string>; phones: Set<string> }> {
  const cached = knownCache.get(side);
  if (cached && Date.now() - cached.at < 60 * 60_000) return cached;
  const names = new Set<string>();
  const phones = new Set<string>();
  const add = (name: string | null, phone: string | null) => {
    const n = nameKey(name);
    const p = phoneKey9(phone);
    if (n) names.add(n);
    if (p.length === 9) phones.add(p);
  };
  const { data: net } = await sb.from('network_contacts').select('name, phone').limit(5000);
  for (const c of (net ?? []) as Array<{ name: string | null; phone: string | null }>) add(c.name, c.phone);
  const cols = side === 'clients' ? ['buyer_contact_id', 'buyer_contact_id_2'] : ['supplier_contact_id', 'seller_contact_id', 'seller_contact_id_2'];
  const { data: tx } = await sb.from('transactions_admin').select(cols.join(', ')).limit(5000);
  const ids = [...new Set(((tx ?? []) as Array<Record<string, string | null>>)
    .flatMap((t) => cols.map((c) => t[c])).filter((x): x is string => !!x))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('contacts').select('company_name, phone').in('id', ids.slice(i, i + 200));
    for (const c of (data ?? []) as Array<{ company_name: string | null; phone: string | null }>) if (!/mc[ -]?export/i.test(c.company_name ?? '')) add(c.company_name, c.phone);
  }
  const out = { at: Date.now(), names, phones };
  knownCache.set(side, out);
  return out;
}

interface LotRpcRow { dealer?: { id?: string; name?: string | null; phone?: string | null } | null; count?: number; markets?: Array<{ gap: number }> | null; prospect?: { id: string } | null }

/**
 * Les prochains fournisseurs que Dana qualifie d'office : les garages aux plus
 * gros lots de véhicules identiques, et aux meilleurs écarts face à nos pays
 * de vente — dans toute l'Europe —, pas encore fichés par elle ni connus de
 * l'équipe. Un garage raté ces 3 derniers jours attend (pas une panne de l'IA).
 */
export async function nextLotCandidates(ctx: SeriesContext, limit: number): Promise<string[]> {
  const { data, error } = await sb.rpc('agents_dealer_lots', { p_markets: ctx.dana.markets, p_min: ctx.dana.minLot, p_limit: 300 });
  if (error) { if (!/does not exist|schema cache|function/i.test(error.message)) console.warn(`[AGENTS] lots illisibles : ${error.message}`); return []; }
  const tried = await recentlyTried(ctx.agent.agent);
  const known = await knownCounterparts();
  const byDealer = new Map<string, { n: number; gap: number; lots: number }>();
  for (const r of (data ?? []) as LotRpcRow[]) {
    const id = r.dealer?.id;
    if (!id || r.prospect || tried.has(id)) continue;
    if (known.names.has(nameKey(r.dealer?.name)) || known.phones.has(phoneKey9(r.dealer?.phone))) continue;
    const gap = Math.max(0, ...(r.markets ?? []).map((m) => Number(m.gap) || 0));
    const cur = byDealer.get(id) ?? { n: 0, gap: 0, lots: 0 };
    byDealer.set(id, { n: Math.max(cur.n, r.count ?? 0), gap: Math.max(cur.gap, gap), lots: cur.lots + 1 });
  }
  // Le plus gros lot d'abord, puis l'écart (100 € = 1 point, 50 au plus), puis le nombre de lots.
  const rank = (x: { n: number; gap: number; lots: number }) => x.n * 10 + Math.min(50, x.gap / 100) + (x.lots - 1) * 5;
  return [...byDealer].sort((a, b) => rank(b[1]) - rank(a[1])).map(([id]) => id).slice(0, limit);
}

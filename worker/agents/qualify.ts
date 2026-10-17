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
 * Rien n'est envoyé à qui que ce soit : les mails restent à l'étape 2.3, et
 * passent par la validation.
 */
import { promises as dns } from 'node:dns';
import { fetchHtmlWithZyte } from '../scraper';
import { parseDealerInfoPage, extractEmails, mailtoEmails, extractPeople, contactLinks, pageText, type DealerPageInfo } from '../../src/lib/agents/dealerPage';
import {
  fitScore, qualifyPrompt, QUALIFY_SYSTEM, QUALIFY_SCHEMA, acceptedEmails, finalScore, normalizeTargets,
  type QualifyOutput, type AgentTargets,
} from '../../src/lib/agents/qualification';
import { opportunities, brandKey, type OfferLite, type DealerListingLite } from '../../src/lib/agents/opportunity';
import { sameDealer, isoOfCountry } from '../../src/lib/agents/keys';
import { SITE_LABEL } from '../../src/services/dealerDirectory';
import { countryVat } from '../../src/lib/offers/vat';
import { HAIKU } from '../../src/lib/agents/aiCost';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { sb, journal, type AgentRow } from './store';

export interface AiSettings {
  targets: Partial<AgentTargets> | null; daily_budget_usd: number | string; auto_discovery: boolean; auto_qualify_per_day: number; map_auto_add: boolean; map_min_score: number;
  // Phase 2.3 (SQL agents_premiers_mails) : consignes de Channing, premiers mails rédigés d'office par jour.
  instructions?: string; auto_draft_per_day?: number;
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
async function fetchPage(url: string, zyte: boolean): Promise<string | null> {
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

export interface SeriesContext { agent: AiAgent; taskId: string | null; targets: AgentTargets; targetCountries: string[]; offers: OfferLite[] }

export async function seriesContext(agent: AiAgent, taskId: string | null): Promise<SeriesContext> {
  const targets = normalizeTargets(agent.targets);
  const targetCountries = targets.countries.length ? targets.countries : await salesCountries();
  return { agent, taskId, targets, targetCountries, offers: await loadOffers() };
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
  const ids = group.map((m) => m.id);
  const siteOfRow = (m: DealerDb) => m.site ?? 'autoscout24';
  const sources = [...new Set(group.map((m) => SITE_LABEL[siteOfRow(m)] ?? siteOfRow(m)))];
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: lRows } = await sb.from('market_dealer_listings').select('listing_url, brand, model, title, year, mileage, price_eur, vehicle_type').in('dealer_id', ids).gte('last_seen_at', since).limit(1000);
  const listings = (lRows ?? []) as Array<DealerListingLite & { vehicle_type: string | null }>;
  const opps = opportunities(listings, ctx.offers, countryVat(d.country ?? 'FR'));
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
  const found = new Map<string, string>();
  for (const e of extractEmails(page?.imprint ?? '')) found.set(e, 'Impressum AutoScout24');
  const pages: Array<{ url: string; text: string }> = [];
  const note = (html: string, source: string) => { for (const e of [...mailtoEmails(html), ...extractEmails(pageText(html, 80_000))]) if (!found.has(e)) found.set(e, source); };
  if (website) {
    const home = await fetchPage(website, true);
    if (home) {
      note(home, website);
      pages.push({ url: website, text: pageText(home, 2500) });
      evidence.push({ url: website, note: 'site du garage' });
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
  const fitIn = { country: d.country, targetCountries: ctx.targetCountries, targets: ctx.targets, listings, opportunities: opps.length, nbBrands: brandsSeen.length };
  const fit = fitScore({ ...fitIn, hasEmail: emailsFound.length > 0, hasNamedContact: people.length > 0 });
  const webSearch = !website && emailsFound.length === 0;
  const prompt = qualifyPrompt({
    dealer: { name: d.name, country: d.country, city: d.city, zip: d.zip, street: d.street, phone, contactName, sources, legalId: firstOf(group.map((m) => m.legal_id)) },
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
  const { data: existing } = await sb.from('agent_prospects').select('id, stage, network_contact_id, dealer_id').in('dealer_id', ids).limit(1);
  const prev = (((existing ?? []) as Array<{ id: string; stage: string; network_contact_id: string | null; dealer_id: string }>)[0]) ?? null;
  let ai: QualifyOutput;
  let cost = 0;
  try {
    const budget = Number(ctx.agent.daily_budget_usd);
    const r = await callClaude<QualifyOutput>({
      // Un budget illisible vaut 0 (pas d'appel), jamais « sans limite ».
      agent: ctx.agent.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'qualification', model: HAIKU,
      system: QUALIFY_SYSTEM, user: prompt, schema: QUALIFY_SCHEMA as unknown as Record<string, unknown>,
      tools: webSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 }] : undefined,
      maxTokens: 6000, effort: 'low', prospectId: prev?.id ?? null, taskId: ctx.taskId,
    });
    ai = r.data as QualifyOutput;
    cost = r.costUsd;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { status: 'echec', name: d.name, score: null, cost: 0, detail: e instanceof Error ? e.message : String(e), addedToMap: false };
  }

  // 4. Contrôle des e-mails : écrits dans une page lue, domaine qui reçoit du courrier
  const confirmed = new Set<string>();
  if (webSearch) {
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
  const best = { ...ai.meilleur_contact, email: ai.meilleur_contact?.email && okEmails.has(ai.meilleur_contact.email.toLowerCase()) ? ai.meilleur_contact.email.toLowerCase() : null };
  if (!best.email) best.email = emails.find((e) => e.mx && /^(vo|occasion|gebraucht|used|verkoop|vente|sales|verkauf)/.test(e.email))?.email ?? emails.find((e) => e.mx)?.email ?? null;
  const contacts = [...people, ...(ai.contacts ?? []).filter((c) => c.nom && !people.some((p) => p.nom.toLowerCase() === c.nom.toLowerCase()))]
    .map((c) => ({ ...c, email: c.email && okEmails.has(c.email.toLowerCase()) ? c.email.toLowerCase() : null })).slice(0, 12);
  const fit2 = fitScore({ ...fitIn, hasEmail: okEmails.size > 0, hasNamedContact: contacts.length > 0 });
  const score = finalScore(fit2.score, ai);
  const site = website ?? (ai.site_web && /^https?:\/\//i.test(ai.site_web) ? ai.site_web : null);

  // 5. La fiche du prospect (une étape avancée par l'équipe n'est jamais ramenée en arrière)
  const now = new Date().toISOString();
  const stage = ai.exclure ? 'ecarte' : 'qualifie';
  const row: Record<string, unknown> = {
    agent: ctx.agent.agent, dealer_id: prev?.dealer_id ?? d.id, name: d.name, country: d.country, city: d.city, zip: d.zip, street: d.street,
    phone: phone ?? page?.phones[0] ?? null, website: site, legal_name: ai.raison_sociale, group_name: ai.groupe,
    sites: ai.nb_sites ?? (page?.branches.length || null), kind: ai.type, brands_official: (ai.marques_officielles ?? []).slice(0, 12),
    emails, people: contacts, best_contact: best, language: ai.langue, fit_score: fit2.score, fit_parts: fit2.parts, score,
    summary: ai.resume, exclusion_reason: ai.exclure ? ai.motif_exclusion : null, evidence, qualified_at: now,
    qualify_cost_usd: Math.round(cost * 10_000) / 10_000, updated_at: now,
  };
  if (!prev || ['qualifie', 'ecarte'].includes(prev.stage)) row.stage = stage;
  const { data: saved, error } = prev
    ? await sb.from('agent_prospects').update(row).eq('id', prev.id).select('id')
    : await sb.from('agent_prospects').upsert(row, { onConflict: 'dealer_id' }).select('id');
  if (error) return { status: 'echec', name: d.name, score, cost, detail: `fiche non enregistrée : ${error.message}`, addedToMap: false };
  const prospectId = ((saved ?? []) as Array<{ id: string }>)[0]?.id ?? prev?.id ?? null;
  if (site && site !== d.website) await sb.from('market_dealers').update({ website: site }).eq('id', d.id);

  // 6. La carte du réseau
  let addedToMap = false;
  const reachable = okEmails.size > 0 || !!(phone ?? page?.phones[0]);
  if (prospectId && !prev?.network_contact_id && !ai.exclure && ctx.agent.map_auto_add && score >= ctx.agent.map_min_score && reachable) {
    const at = d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null;
    addedToMap = await addToMap(ctx.agent.agent, prospectId, d, { score, summary: ai.resume, best, contacts, site, brands: brandsSeen, phone: phone ?? page?.phones[0] ?? null, at });
  }

  const who = best.nom ? `${best.nom}${best.fonction ? ` (${best.fonction})` : ''}` : best.email ?? 'pas encore d\'interlocuteur';
  await journal({
    agent: ctx.agent.agent, actor: ctx.agent.agent, kind: ai.exclure ? 'qualification_ecarte' : 'qualification',
    summary: ai.exclure
      ? `${d.name} (${d.country ?? '?'}) écarté : ${ai.motif_exclusion ?? 'hors cible'}`
      : `${d.name} (${d.country ?? '?'}) qualifié ${score}/100 — ${who}${addedToMap ? ' · ajouté à la carte' : ''}`,
    details: { dealer_id: d.id, prospect_id: prospectId, score, fit: fit2.score, cost_usd: Math.round(cost * 10_000) / 10_000, web_search: webSearch, sources },
  });
  return { status: ai.exclure ? 'ecarte' : 'qualifie', name: d.name, score, cost, detail: who, addedToMap };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
}

async function addToMap(agent: string, prospectId: string, d: DealerDb, q: {
  score: number; summary: string; best: { nom: string | null; fonction: string | null; email: string | null }; contacts: Array<{ nom: string; fonction: string; email: string | null }>;
  site: string | null; brands: string[]; phone: string | null;
  /** Position donnée par l'annonce (Marktplaats, Blocket, Leboncoin…) ; sinon OpenStreetMap. */
  at?: { lat: number; lng: number } | null;
}): Promise<boolean> {
  // Déjà sur la carte sous un autre nom ou le même téléphone : on relie, on n'ajoute pas.
  const { data: near } = await sb.from('network_contacts').select('id, name, phone').eq('country', (d.country ?? 'FR').toUpperCase()).limit(2000);
  const twin = ((near ?? []) as Array<{ id: string; name: string; phone: string | null }>).find((n) => sameDealer(n, { name: d.name, phone: q.phone }));
  if (twin) { await sb.from('agent_prospects').update({ network_contact_id: twin.id }).eq('id', prospectId); return false; }
  const at = q.at ?? await geocode(d.country, d.zip, d.city);
  const label = agent === 'dana' ? 'Dana' : 'Ada';
  const { data, error } = await sb.from('network_contacts').insert({
    name: d.name, kind: 'concession', role: 'acheteur', country: (d.country ?? 'FR').toUpperCase(), city: d.city,
    lat: at?.lat ?? null, lng: at?.lng ?? null, contact_name: q.best.nom, phone: q.phone, email: q.best.email, website: q.site,
    relation: 'nouveau', vehicle_types: q.brands.slice(0, 6).map((b) => b.charAt(0) + b.slice(1).toLowerCase()).join(', '),
    comment: `Ajouté par ${label} (IA), score ${q.score}/100 : ${q.summary}`.slice(0, 1000),
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
  const { data: recent } = await sb.from('agent_tasks').select('params').eq('kind', 'qualification').gte('created_at', new Date(Date.now() - 3 * 86_400_000).toISOString()).limit(500);
  const tried = new Set(((recent ?? []) as Array<{ params: { dealer_ids?: string[] } | null }>).flatMap((t) => t.params?.dealer_ids ?? []));
  return ((data ?? []) as Array<{ dealer_id: string }>).map((r) => r.dealer_id).filter((id) => !tried.has(id)).slice(0, limit);
}

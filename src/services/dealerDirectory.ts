/**
 * ANNUAIRE DES CONCESSIONS D'ADA (17/10, Channing : « nos acheteurs idéaux
 * sont ceux qui vendent les voitures que nous vendons, plus chères ! »).
 *
 * Chaque page d'annonces qu'ADA lit déjà (études quotidiennes, études,
 * relevés d'offres, Market Intelligence, découvertes d'Ada) dépose ici les
 * GARAGES qui publient — nom, adresse, téléphone, page du garage, site web,
 * position — et leurs annonces (marque, modèle, année, km, prix). Tous les
 * sites depuis le 17/10 (« fais tous les sites directement ») : AutoScout24,
 * Marktplaats, Gaspedaal, Leboncoin, La Centrale, mobile.de, coches.net,
 * Subito, Bilbasen, Blocket, Jófogás ; la base rapproche un même garage vu
 * sur plusieurs sites (agents_record_dealers, SQL agents_tous_sites).
 * Aucun coût d'IA. Best-effort : une étude ne casse jamais à cause de
 * l'annuaire ; tant que le SQL du 17/10 n'est pas collé, rien ne s'écrit.
 * Écriture par le worker seul (clé service) : dans le navigateur, on ne
 * tente rien.
 */
import type { ScrapedListing, ListingSeller } from '../lib/study-core/types';
import { toEur } from '../lib/study-core/business-logic';

type RpcResult = { data: unknown; error: { message: string } | null };
// Le client Supabase du worker ou un client simulé (tests) ; rpc absent = écriture d'avant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (t: string) => any; rpc?: (...args: any[]) => any };

/** Famille de site du vendeur : un garage a le même identifiant sur tous les AutoScout24 ;
 *  ailleurs, la clé du site (« MOBILE_DE » → « mobilede »). */
export const dealerSiteFamily = (siteKey: string): string => (/^AUTOSCOUT/i.test(siteKey) ? 'autoscout24' : siteKey.toLowerCase().replace(/[^a-z0-9]+/g, ''));

/** Le nom d'un site, pour l'écran (famille → libellé). */
export const SITE_LABEL: Record<string, string> = {
  autoscout24: 'AutoScout24', marktplaats: 'Marktplaats', gaspedaal: 'Gaspedaal', leboncoin: 'Leboncoin', lacentrale: 'La Centrale',
  mobilede: 'mobile.de', coches: 'coches.net', subito: 'Subito', bilbasen: 'Bilbasen', blocket: 'Blocket', jofogas: 'Jófogás', skelbiu: 'Skelbiu',
};

/** Page d'utilitaires, reconnue à son adresse : AutoScout24 catégorie X (la carrosserie
 *  n'est pas donnée sur ses pages de recherche, relevé 17/10 FR, NL, DE), et les
 *  rubriques utilitaires des autres sites (Leboncoin, Subito, coches.net, Marktplaats,
 *  Bilbasen, Blocket, mobile.de, Jófogás). */
const VAN_URL = /[?&]atype=x(&|$)|\/(utilitaires?|veicoli-commerciali|furgonetas?|bedrijfsauto-?s?|bedrijfswagens?|varebiler|varebil|transportbilar|transportbil|nutzfahrzeuge?|haszonjarmu|kisteherauto)(\/|\?|-|$)/i;
export const isVanSearch = (url: string | null | undefined): boolean => VAN_URL.test(url ?? '');

let warned = false;
const warnOnce = (m: string) => { if (!warned) console.warn(`[ANNUAIRE] ${m}`); warned = true; };

type DealerRowIn = {
  site: string; site_dealer_id: string; name: string; contact_name: string | null; site_url: string | null; imprint_url: string | null;
  phone: string | null; country: string | null; zip: string | null; city: string | null; street: string | null;
  website: string | null; lat: number | null; lng: number | null; legal_id: string | null; last_seen_at: string;
};

/**
 * Les garages d'une page : par la fonction de la base (une valeur connue n'est jamais
 * effacée, les doubles des autres sites sont rapprochés) ; sinon — SQL « tous sites »
 * pas encore collé — par l'écriture directe d'avant, sur ses colonnes d'avant.
 * Rend l'identifiant ADA de chaque garage, par identifiant du site.
 */
async function saveDealers(client: Client, rows: DealerRowIn[]): Promise<Map<string, string> | null> {
  if (typeof client.rpc === 'function') {
    const { data, error } = (await client.rpc('agents_record_dealers', { p_rows: rows })) as RpcResult;
    if (!error) return new Map(((data ?? []) as Array<{ id: string; site_dealer_id: string }>).map((d) => [d.site_dealer_id, d.id]));
    if (!/agents_record_dealers|schema cache|does not exist/i.test(error.message)) warnOnce(`rapprochement indisponible : ${error.message}`);
  }
  const legacy = rows.map((r) => ({
    site: r.site, site_dealer_id: r.site_dealer_id, name: r.name, contact_name: r.contact_name, site_url: r.site_url, imprint_url: r.imprint_url,
    phone: r.phone, country: r.country, zip: r.zip, city: r.city, street: r.street, last_seen_at: r.last_seen_at,
  }));
  const { data, error } = await client.from('market_dealers').upsert(legacy, { onConflict: 'site,site_dealer_id' }).select('id, site_dealer_id');
  if (error) { warnOnce(`garages non enregistrés : ${error.message}`); return null; }
  return new Map(((data ?? []) as Array<{ id: string; site_dealer_id: string }>).map((d) => [d.site_dealer_id, d.id]));
}

/** Enregistre les garages d'une page d'annonces et leurs annonces. Rend le nombre de garages vus. */
export async function recordDealerSightings(client: Client, listings: ScrapedListing[], ctx: { site: string; country?: string | null; sourceUrl?: string | null }): Promise<number> {
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined') return 0;
  const withSeller = listings.filter((l): l is ScrapedListing & { seller: ListingSeller } => !!l.seller?.id && !!l.seller?.name);
  if (withSeller.length === 0) return 0;
  try {
    const site = dealerSiteFamily(ctx.site);
    const vans = isVanSearch(ctx.sourceUrl);
    const now = new Date().toISOString();
    const sellers = new Map<string, ListingSeller>();
    for (const l of withSeller) if (!sellers.has(l.seller.id)) sellers.set(l.seller.id, l.seller);
    const rows: DealerRowIn[] = [...sellers.values()].map((s) => ({
      site, site_dealer_id: s.id, name: s.name, contact_name: s.contactName ?? null,
      site_url: s.siteUrl ?? null, imprint_url: s.imprintUrl ?? null, phone: s.phone ?? null,
      country: (s.country ?? ctx.country ?? '').toUpperCase() || null,
      zip: s.zip ?? null, city: s.city ?? null, street: s.street ?? null,
      website: s.website ?? null, lat: s.lat ?? null, lng: s.lng ?? null, legal_id: s.legalId ?? null, last_seen_at: now,
    }));
    const idOf = await saveDealers(client, rows);
    if (!idOf) return 0;
    const seen = new Set<string>();
    const listingRows: Array<Record<string, unknown>> = [];
    for (const l of withSeller) {
      const dealerId = idOf.get(l.seller.id);
      if (!dealerId || !l.listing_url) continue;
      const key = `${dealerId}|${l.listing_url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      listingRows.push({
        dealer_id: dealerId, listing_url: l.listing_url,
        brand: (l.brand ?? '').trim().toUpperCase() || null, model: (l.model ?? '').trim() || null,
        title: (l.title ?? '').slice(0, 200), year: l.year, mileage: l.mileage, fuel: l.fuel ?? null,
        vehicle_type: vans ? 'utilitaire' : l.vehicleType ?? null, price_eur: Number.isFinite(l.price) ? Math.round(toEur(l.price, l.currency)) : null,
        last_seen_at: now,
      });
    }
    if (listingRows.length > 0) {
      const { error: e2 } = await client.from('market_dealer_listings').upsert(listingRows, { onConflict: 'dealer_id,listing_url' });
      if (e2) warnOnce(`annonces des garages non enregistrées : ${e2.message}`);
    }
    return rows.length;
  } catch (e) {
    warnOnce(`annuaire en échec : ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

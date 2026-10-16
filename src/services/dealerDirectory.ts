/**
 * ANNUAIRE DES CONCESSIONS D'ADA (17/10, Channing : « nos acheteurs idéaux
 * sont ceux qui vendent les voitures que nous vendons, plus chères ! »).
 *
 * Chaque page d'annonces qu'ADA lit déjà (études quotidiennes, études,
 * relevés d'offres, Market Intelligence, découvertes d'Ada) dépose ici les
 * GARAGES qui publient — nom, adresse, téléphone, page du garage et
 * mentions légales — et leurs annonces (marque, modèle, année, km, prix).
 * Aucun coût d'IA. Best-effort : une étude ne casse jamais à cause de
 * l'annuaire ; tant que le SQL du 17/10 n'est pas collé, rien ne s'écrit.
 * Écriture par le worker seul (clé service) : dans le navigateur, on ne
 * tente rien.
 */
import type { ScrapedListing, ListingSeller } from '../lib/study-core/types';
import { toEur } from '../lib/study-core/business-logic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (t: string) => any };

/** Famille de site du vendeur : un garage a le même identifiant sur tous les AutoScout24. */
export const dealerSiteFamily = (siteKey: string): string => (/^AUTOSCOUT/i.test(siteKey) ? 'autoscout24' : siteKey.toLowerCase());

/** Page d'utilitaires : sur AutoScout24, seule l'adresse le dit (atype=X) — la carrosserie
 *  n'est pas donnée sur les pages de recherche (relevé 17/10 FR, NL, DE). */
export const isVanSearch = (url: string | null | undefined): boolean => /[?&]atype=x(&|$)/i.test(url ?? '');

let warned = false;
const warnOnce = (m: string) => { if (!warned) console.warn(`[ANNUAIRE] ${m}`); warned = true; };

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
    const rows = [...sellers.values()].map((s) => ({
      site, site_dealer_id: s.id, name: s.name, contact_name: s.contactName ?? null,
      site_url: s.siteUrl ?? null, imprint_url: s.imprintUrl ?? null, phone: s.phone ?? null,
      country: (s.country ?? ctx.country ?? '').toUpperCase() || null,
      zip: s.zip ?? null, city: s.city ?? null, street: s.street ?? null, last_seen_at: now,
    }));
    const { data, error } = await client.from('market_dealers').upsert(rows, { onConflict: 'site,site_dealer_id' }).select('id, site_dealer_id');
    if (error) { warnOnce(`garages non enregistrés : ${error.message}`); return 0; }
    const idOf = new Map(((data ?? []) as Array<{ id: string; site_dealer_id: string }>).map((d) => [d.site_dealer_id, d.id]));
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

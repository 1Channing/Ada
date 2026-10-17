/**
 * ADA — DÉCOUVRIR DES CONCESSIONS (17/10). Une tâche « decouverte_concessions »
 * posée depuis l'onglet Agents ou par le cycle automatique (site, pays,
 * marque, modèle facultatif, utilitaires, pages) : le worker lit les pages
 * de ce site (AutoScout24 par défaut, les plus récentes d'abord ; ou
 * Marktplaats, Gaspedaal, Leboncoin, La Centrale, mobile.de, coches.net,
 * Subito, Bilbasen, Blocket, Jófogás) et l'annuaire (market_dealers) garde
 * chaque garage et ses annonces, rapproché de ses fiches des autres sites.
 * Aucun coût d'IA ; les pages passent par le même lecteur que les études
 * (scrapeSearch). Le résultat dit combien d'annonces nommaient leur garage :
 * c'est la couverture réelle du site. La file des tâches est dans ./tasks.ts.
 */
import { recordDealerSightings, dealerSiteFamily } from '../../src/services/dealerDirectory';
import { discoveryUrl, discoveryPages, discoverySiteKey, DISCOVERY_SITE_LABEL, type DiscoveryParams } from '../../src/lib/agents/discovery';
import { ensureLearnedTaxonomy } from '../../src/lib/linkgen/taxonomy';
import { scrapeSearch } from '../scraper';
import { sb } from './store';

export async function discover(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = params as unknown as DiscoveryParams;
  const pages = discoveryPages(p.pages);
  // Les marques apprises par ADA sur chaque site (identifiants, slugs) : sans elles, seules les graines.
  await ensureLearnedTaxonomy().catch(() => undefined);
  const url = discoveryUrl(p);
  const siteKey = discoverySiteKey(p);
  const label = DISCOVERY_SITE_LABEL[String(p.site ?? 'AUTOSCOUT').toUpperCase()] ?? siteKey;
  const res = await scrapeSearch(url, 'full', { maxPagesCap: pages, maxListingsCap: pages * 40 });
  if (res.error && res.listings.length === 0) throw new Error(`lecture ${label} impossible : ${res.error}`);
  const named = res.listings.filter((l) => l.seller?.id && l.seller?.name);
  const ids = [...new Set(named.map((l) => l.seller?.id as string))];
  let known = 0;
  if (ids.length > 0) {
    const { data } = await sb.from('market_dealers').select('site_dealer_id').eq('site', dealerSiteFamily(siteKey)).in('site_dealer_id', ids);
    known = ((data ?? []) as unknown[]).length;
  }
  const dealers = await recordDealerSightings(sb, res.listings, { site: siteKey, country: p.country.toUpperCase(), sourceUrl: url });
  return {
    url, site: siteKey, annonces: res.listings.length, avec_garage: named.length,
    concessions: dealers, nouvelles: Math.max(0, dealers - known), total_site: res.totalCount ?? null,
  };
}

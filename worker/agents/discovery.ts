/**
 * ADA — DÉCOUVRIR DES CONCESSIONS (17/10). Une tâche « decouverte_concessions »
 * posée depuis l'onglet Agents ou par le cycle automatique (pays, marque,
 * modèle facultatif, utilitaires, pages) : le worker lit les pages
 * AutoScout24 de ce pays, les plus récentes d'abord, et l'annuaire
 * (market_dealers) garde chaque garage et ses annonces. Aucun coût d'IA ;
 * les pages passent par le même lecteur que les études (scrapeSearch).
 * La file des tâches est dans ./tasks.ts.
 */
import { recordDealerSightings } from '../../src/services/dealerDirectory';
import { discoveryUrl, discoveryPages, type DiscoveryParams } from '../../src/lib/agents/discovery';
import { scrapeSearch } from '../scraper';
import { sb } from './store';

export async function discover(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = params as unknown as DiscoveryParams;
  const pages = discoveryPages(p.pages);
  const url = discoveryUrl(p);
  const res = await scrapeSearch(url, 'full', { maxPagesCap: pages, maxListingsCap: pages * 20 });
  if (res.error && res.listings.length === 0) throw new Error(`lecture AutoScout24 impossible : ${res.error}`);
  const ids = [...new Set(res.listings.map((l) => l.seller?.id).filter((x): x is string => !!x))];
  let known = 0;
  if (ids.length > 0) {
    const { data } = await sb.from('market_dealers').select('site_dealer_id').eq('site', 'autoscout24').in('site_dealer_id', ids);
    known = ((data ?? []) as unknown[]).length;
  }
  const dealers = await recordDealerSightings(sb, res.listings, { site: `AUTOSCOUT_${p.country.toUpperCase()}`, country: p.country.toUpperCase(), sourceUrl: url });
  return { url, annonces: res.listings.length, concessions: dealers, nouvelles: Math.max(0, dealers - known), total_site: res.totalCount ?? null };
}

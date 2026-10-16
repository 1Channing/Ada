/**
 * ADA — DÉCOUVRIR DES CONCESSIONS (17/10). Une tâche « decouverte_concessions »
 * posée depuis l'onglet Agents (pays, marque, modèle facultatif, utilitaires,
 * pages) : le worker lit les pages AutoScout24 de ce pays, les plus récentes
 * d'abord, et l'annuaire (market_dealers) garde chaque garage et ses annonces.
 * Aucun coût d'IA ; les pages passent par le même lecteur que les études
 * (scrapeSearch). Une tâche à la fois, réservée par mise à jour
 * conditionnelle ; une tâche coupée par un redémarrage repart en échec.
 */
import { recordDealerSightings } from '../../src/services/dealerDirectory';
import { discoveryUrl, discoveryPages, type DiscoveryParams } from '../../src/lib/agents/discovery';
import { scrapeSearch } from '../scraper';
import { sb, journal } from './store';

const STUCK_MS = 30 * 60 * 1000;

interface Task { id: string; agent: string; kind: string; params: Record<string, unknown>; created_by: string | null }

async function discover(t: Task): Promise<Record<string, unknown>> {
  const p = t.params as unknown as DiscoveryParams;
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

let running = false;

/** Traite la prochaine tâche en attente (une à la fois). */
export async function runNextTask(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Tâche coupée par un redémarrage : échec explicite (on ne la relance pas d'office).
    await sb.from('agent_tasks').update({ status: 'echec', error: 'Interrompue par un redémarrage du worker — relancez-la.', finished_at: new Date().toISOString() })
      .eq('status', 'en_cours').lt('started_at', new Date(Date.now() - STUCK_MS).toISOString());
    const { data, error } = await sb.from('agent_tasks').select('id, agent, kind, params, created_by')
      .eq('status', 'en_attente').order('created_at', { ascending: true }).limit(1);
    if (error) { if (!/does not exist|schema cache/i.test(error.message)) console.warn(`[AGENTS] tâches illisibles : ${error.message}`); return; }
    const t = ((data ?? []) as Task[])[0];
    if (!t) return;
    const { data: claimed } = await sb.from('agent_tasks').update({ status: 'en_cours', started_at: new Date().toISOString() })
      .eq('id', t.id).eq('status', 'en_attente').select('id');
    if (!claimed || (claimed as unknown[]).length === 0) return;
    const p = t.params as unknown as DiscoveryParams;
    const label = `${p.country ?? '?'} · ${p.brand ?? '?'}${p.model ? ` ${p.model}` : ''}${p.vans ? ' (utilitaires)' : ''}`;
    try {
      if (t.kind !== 'decouverte_concessions') throw new Error(`tâche inconnue : ${t.kind}`);
      const result = await discover(t);
      await sb.from('agent_tasks').update({ status: 'terminee', result, finished_at: new Date().toISOString() }).eq('id', t.id);
      await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: 'decouverte',
        summary: `Découverte ${label} : ${result.annonces} annonces lues, ${result.concessions} concessions (dont ${result.nouvelles} nouvelles)`, details: result });
      console.warn(`[AGENTS] découverte ${label} : ${result.annonces} annonces, ${result.concessions} concessions`);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await sb.from('agent_tasks').update({ status: 'echec', error: msg, finished_at: new Date().toISOString() }).eq('id', t.id);
      await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: 'decouverte_echec', summary: `Découverte ${label} en échec : ${msg}` });
    }
  } catch (e) {
    console.warn(`[AGENTS] tâche en échec : ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
  }
}

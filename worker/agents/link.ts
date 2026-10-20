/**
 * LE FIL ET SA FICHE (20/10, Channing : « connecter la messagerie au reste : si un mail est envoyé via la
 * messagerie, la fiche arrive dans Discussions en cours »). Un fil sans fiche — un mail de l'équipe écrit
 * depuis la Messagerie d'ADA ou depuis Gmail, une réponse reçue — se rattache à la fiche de l'entreprise :
 * une adresse écrite sur la fiche, sinon le domaine (src/lib/agents/workflow.ts) ; l'envoi la fait ensuite
 * passer « contactée », la réponse « a répondu » (./store.ts).
 */
import { sb } from './store';
import { emailDomain } from '../../src/lib/agents/people';
import { matchProspect, type WfProspect } from '../../src/lib/agents/workflow';

// Les fiches de chaque agente, relues au plus une fois par minute (une synchronisation importe parfois des dizaines de mails).
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; rows: WfProspect[] }>();

async function prospectsOf(agent: string): Promise<WfProspect[]> {
  const hit = cache.get(agent);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const { data, error } = await sb.from('agent_prospects').select('id, name, stage, score, key_account, website, emails, people, best_contact')
    .eq('agent', agent).neq('stage', 'ecarte').limit(5000);
  if (error) return [];
  const rows = ((data ?? []) as WfProspect[]).map((p) => ({ ...p, emails: p.emails ?? [], people: p.people ?? [] }));
  cache.set(agent, { at: Date.now(), rows });
  return rows;
}

/** Les tests (et une fiche créée à l'instant) : relire les fiches au prochain appel. */
export function forgetLinks(): void { cache.clear(); }

/** Le fil sans fiche se rattache à celle de son entreprise ; rend la fiche du fil (déjà là, trouvée) ou null. */
export async function linkThread(agent: string, mailbox: string, threadId: string, addresses: Array<string | null | undefined>): Promise<string | null> {
  const { data } = await sb.from('agent_threads').select('prospect_id').eq('id', threadId).maybeSingle();
  const current = (data as { prospect_id?: string | null } | null)?.prospect_id ?? null;
  if (current) return current;
  const hit = matchProspect(addresses, await prospectsOf(agent), emailDomain(mailbox) || 'mc-export.com');
  if (!hit) return null;
  await sb.from('agent_threads').update({ prospect_id: hit.id }).eq('id', threadId).is('prospect_id', null);
  return hit.id;
}

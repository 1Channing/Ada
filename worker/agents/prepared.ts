/**
 * CE QUI A ÉTÉ PRÉPARÉ POUR UNE FICHE (20/10) : l'aiguillage, le premier mail, le plan d'un grand compte.
 * Il peut être refait tant que rien n'en est parti et que personne ne l'a corrigé — après « Chercher plus
 * loin » qui trouve mieux (./deep.ts), ou « Refaire le plan » (./tasks.ts). La nouvelle préparation est
 * enregistrée d'abord (./firstMail.ts) ; l'ancienne laisse la place ensuite, relue juste avant : un
 * plafond atteint ou une IA en panne ne laisse jamais la fiche sans rien, et un message validé ou corrigé
 * entre-temps reste.
 */
import { sb } from './store';

interface ThreadMessage { status: string; channel: string | null; author: string | null; body_text: string | null; ai_notes: { texte_initial?: string | null } | null }

/** Des messages qui ne sont pas partis : préparés pour Channing, à valider, brouillons, refusés. */
const REPLACEABLE = ['pour_channing', 'refuse', 'brouillon', 'a_valider'];

/** Un message que quelqu'un a écrit, ou un mail de l'agente corrigé à la main : ce travail n'est pas jeté. */
const handWork = (m: ThreadMessage) => m.author === 'humain'
  || (m.status !== 'refuse' && m.channel === 'mail' && !!m.ai_notes?.texte_initial && !(m.body_text ?? '').trim().startsWith(m.ai_notes.texte_initial.trim()));

const alive = (ms: ThreadMessage[]) => ms.some((m) => !REPLACEABLE.includes(m.status) || handWork(m));

async function messagesOf(threadId: string): Promise<ThreadMessage[]> {
  const { data } = await sb.from('agent_messages').select('status, channel, author, body_text, ai_notes').eq('thread_id', threadId).limit(50);
  return (data ?? []) as ThreadMessage[];
}

/** Les fils d'une fiche : aucun, préparés sans rien d'envoyé ni de corrigé (à refaire), ou vivants (on n'y touche pas). */
export async function preparedThreads(prospectId: string): Promise<{ kind: 'aucun' } | { kind: 'prepare'; ids: string[] } | { kind: 'vivant' }> {
  const { data } = await sb.from('agent_threads').select('id').eq('prospect_id', prospectId).limit(5);
  const threads = (data ?? []) as Array<{ id: string }>;
  if (!threads.length) return { kind: 'aucun' };
  for (const t of threads) if (alive(await messagesOf(t.id))) return { kind: 'vivant' };
  return { kind: 'prepare', ids: threads.map((t) => t.id) };
}

/** L'ancienne préparation laisse la place : chaque fil relu juste avant (parti ou corrigé entre-temps, il reste). */
export async function dropPrepared(ids: string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    if (alive(await messagesOf(id))) continue;
    await sb.from('agent_messages').delete().eq('thread_id', id);
    await sb.from('agent_threads').delete().eq('id', id);
    n++;
  }
  return n;
}

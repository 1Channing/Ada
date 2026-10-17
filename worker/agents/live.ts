/**
 * EN DIRECT (17/10, Channing : « un onglet live, qui permettrait de voir en
 * direct ce que l'agent fait »). Une tâche en cours écrit où elle en est dans
 * sa propre ligne (agent_tasks.result.live) : l'étape du moment, le compte
 * (fiche 3 sur 10) et ses dernières étapes horodatées. L'onglet Live d'ADA
 * les lit toutes les 3 secondes ; à la fin, le résultat de la tâche remplace
 * ce suivi. Aucune table de plus.
 *
 * Les écritures d'une tâche passent l'une après l'autre (jamais dans le
 * désordre) et ne retardent jamais le travail : un suivi qui échoue est
 * ignoré.
 */
import { sb } from './store';

export interface LiveStep { at: string; text: string }
interface Live { step: string; done: number | null; total: number | null; log: LiveStep[] }

const MAX_LOG = 30;
const state = new Map<string, Live>();
const chain = new Map<string, Promise<void>>();

/** L'étape du moment d'une tâche — et, si on le sait, où elle en est (3 sur 10). */
export function live(taskId: string | null | undefined, text: string, count?: { done: number; total: number }): void {
  if (!taskId) return;
  const s = state.get(taskId) ?? { step: '', done: null, total: null, log: [] };
  s.step = text;
  if (count) { s.done = count.done; s.total = count.total; }
  s.log = [...s.log, { at: new Date().toISOString(), text }].slice(-MAX_LOG);
  state.set(taskId, s);
  const result = { live: { ...s, log: [...s.log] } };
  const next = (chain.get(taskId) ?? Promise.resolve()).then(async () => {
    try {
      await sb.from('agent_tasks').update({ result }).eq('id', taskId).eq('status', 'en_cours');
    } catch { /* le suivi ne bloque jamais le travail */ }
  });
  chain.set(taskId, next);
}

/** Fin de tâche : attend les dernières écritures du suivi (le résultat final passe après elles). */
export async function liveDone(taskId: string): Promise<void> {
  await (chain.get(taskId) ?? Promise.resolve());
  state.delete(taskId);
  chain.delete(taskId);
}

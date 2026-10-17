/**
 * L'ANNUAIRE ET LES LOTS PRÉCALCULÉS (17/10, après le « statement timeout »
 * vu par Channing dans l'onglet Agents) : la base recalcule l'annuaire des
 * garages, les lots de Dana et ce que vaut chaque modèle par pays
 * (agents_refresh_index, SQL agents_index) — au démarrage, toutes les
 * 3 heures, et une à cinq minutes après une découverte. Les pages ne font
 * plus que lire : réponse en moins d'une seconde, quel que soit le volume.
 */
import { sb } from './store';

const EVERY_MS = 3 * 3600_000;
const MIN_GAP_MS = 5 * 60_000;
let last = 0;
let running = false;
let soon: ReturnType<typeof setTimeout> | null = null;

const missing = (m: string) => /does not exist|schema cache|agents_refresh_index/i.test(m);

export async function refreshIndex(reason: string): Promise<void> {
  if (running) return;
  running = true;
  last = Date.now();
  try {
    const { data, error } = await sb.rpc('agents_refresh_index');
    if (error) { if (!missing(error.message)) console.warn(`[AGENTS] annuaire non recalculé (${reason}) : ${error.message}`); return; }
    const r = (data ?? {}) as { dealers?: number; lots?: number; refs?: number; ms?: number };
    console.log(`[AGENTS] annuaire recalculé (${reason}) : ${r.dealers ?? 0} garages, ${r.lots ?? 0} lots, ${r.refs ?? 0} prix de marché en ${r.ms ?? '?'} ms`);
  } catch (e) {
    console.warn(`[AGENTS] annuaire non recalculé (${reason}) : ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
  }
}

/** Après une découverte : un recalcul bientôt (au plus un toutes les 5 minutes, les découvertes rapprochées n'en font qu'un). */
export function refreshSoon(reason: string): void {
  if (soon) return;
  const wait = Math.max(60_000, MIN_GAP_MS - (Date.now() - last));
  soon = setTimeout(() => { soon = null; void refreshIndex(reason); }, wait);
}

export function startIndexRefresh(): void {
  setTimeout(() => void refreshIndex('démarrage'), 2 * 60_000);
  setInterval(() => void refreshIndex('toutes les 3 heures'), EVERY_MS);
}

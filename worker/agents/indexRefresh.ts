/**
 * L'ANNUAIRE ET LES LOTS PRÉCALCULÉS (17/10, après le « statement timeout »
 * vu par Channing dans l'onglet Agents) : la base recalcule l'annuaire des
 * garages, les lots de Dana et ce que vaut chaque modèle par pays
 * (agents_refresh_index, SQL agents_index) — au démarrage, toutes les
 * 6 heures s'il y a du nouveau, et un quart d'heure après une découverte. Les pages ne font
 * plus que lire : réponse en moins d'une seconde, quel que soit le volume.
 */
import { sb } from './store';

// 21/10 (panne : crédit disque de la base épuisé) : un recalcul vide et réécrit les trois tables en relisant
// 30 000 annonces et 33 000 relevés (31 s à plein régime). Toutes les 6 heures au lieu de 3, et SEULEMENT si un
// garage ou une annonce a bougé depuis le dernier calcul ; après une découverte, au plus un recalcul par quart d'heure.
const EVERY_MS = 6 * 3600_000;
const MIN_GAP_MS = 15 * 60_000;
let last = 0;
let running = false;
let soon: ReturnType<typeof setTimeout> | null = null;

const missing = (m: string) => /does not exist|schema cache|agents_refresh_index/i.test(m);

/** Quelque chose a-t-il changé depuis le dernier calcul ? (annonce ou garage vu depuis ; inconnu → oui, fail-open) */
async function changedSinceLast(): Promise<{ changed: boolean; since: string | null }> {
  try {
    const { data: meta } = await sb.from('agent_index_meta').select('computed_at').maybeSingle();
    const since = (meta as { computed_at?: string } | null)?.computed_at ?? null;
    if (!since) return { changed: true, since: null };
    const [l, d] = await Promise.all([
      sb.from('market_dealer_listings').select('dealer_id', { count: 'exact', head: true }).gt('last_seen_at', since),
      sb.from('market_dealers').select('id', { count: 'exact', head: true }).gt('last_seen_at', since),
    ]);
    if (l.error || d.error) return { changed: true, since };
    return { changed: (l.count ?? 0) + (d.count ?? 0) > 0, since };
  } catch { return { changed: true, since: null }; }
}

export async function refreshIndex(reason: string): Promise<void> {
  if (running) return;
  running = true;
  last = Date.now();
  try {
    if (/toutes les 6 heures|démarrage/.test(reason)) {
      const c = await changedSinceLast();
      if (!c.changed) { console.log(`[AGENTS] annuaire : rien de nouveau depuis ${c.since?.slice(0, 16) ?? '?'} — recalcul (${reason}) sans objet`); return; }
    }
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

/** Après une découverte : un recalcul bientôt (au plus un par quart d'heure, les découvertes rapprochées n'en font qu'un). */
export function refreshSoon(reason: string): void {
  if (soon) return;
  const wait = Math.max(60_000, MIN_GAP_MS - (Date.now() - last));
  soon = setTimeout(() => { soon = null; void refreshIndex(reason); }, wait);
}

export function startIndexRefresh(): void {
  setTimeout(() => void refreshIndex('démarrage'), 2 * 60_000);
  setInterval(() => void refreshIndex('toutes les 6 heures'), EVERY_MS);
}

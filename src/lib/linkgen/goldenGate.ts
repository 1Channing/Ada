/**
 * VERROU DES CAS DORÉS (Truth Center brique 4, GO Channing 03/09).
 * Une auto-validation de mapping (le scout promeut une hypothèse en
 * « valid » sur score) n'est acceptée que si AUCUN cas doré du site n'est
 * en échec : une grammaire qui régresse ne doit pas, en plus, apprendre
 * par-dessus. Lecture en cache court ; fail-open si la table n'existe pas
 * encore (migration non collée) — on ne bloque jamais sur un doute technique.
 */
import { sharedSupabase as supabase } from '../supabaseShared';

let cache: { at: number; failing: Set<string> } | null = null;
const TTL_MS = 5 * 60_000;

export async function goldenFailingSites(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.failing;
  const failing = new Set<string>();
  try {
    const { data, error } = await supabase.from('truth_golden').select('site').eq('last_status', 'fail');
    if (!error) for (const r of (data ?? []) as Array<{ site: string }>) failing.add(r.site);
  } catch { /* table absente — fail-open */ }
  cache = { at: Date.now(), failing };
  return failing;
}

/** true = ce site a au moins un cas doré en échec → pas d'auto-validation. */
export async function goldenBlocked(site: string): Promise<boolean> {
  const f = await goldenFailingSites();
  const blocked = f.has(site);
  if (blocked) console.warn(`[GOLDEN_GATE] ${site} : cas doré en échec — auto-validation de mapping refusée`);
  return blocked;
}

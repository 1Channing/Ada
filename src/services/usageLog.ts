import { supabase } from '../lib/supabase';

/**
 * Journal d'usage — quelles pages servent vraiment au quotidien (demande
 * Channing 27/07). Un événement par changement de page, avec le visiteur
 * (nom saisi dans l'Ingestion si connu, sinon identifiant d'appareil
 * anonyme). Fail-open intégral : table absente ou réseau coupé → silence,
 * l'app ne dépend jamais du journal.
 */

const DEVICE_KEY = 'ada_device_id';
const NAMES_KEY = 'ada_contributor_names';

function visitorLabel(): string {
  try {
    const names = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '[]');
    if (Array.isArray(names) && typeof names[0] === 'string' && names[0].trim()) {
      return names[0].trim();
    }
  } catch { /* noms illisibles — identifiant d'appareil */ }
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `appareil-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'appareil-inconnu';
  }
}

// Anti-rebond : un même chemin ne compte qu'une fois par minute (les
// rechargements de navigation interne créent des doubles sinon).
let lastPath = '';
let lastAt = 0;

export async function logPageVisit(path: string): Promise<void> {
  const now = Date.now();
  if (path === lastPath && now - lastAt < 60_000) return;
  lastPath = path;
  lastAt = now;
  try {
    await supabase.from('app_usage_events').insert({ path, visitor: visitorLabel() });
  } catch { /* table pas encore créée ou hors-ligne — jamais bloquant */ }
}

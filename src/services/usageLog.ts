import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

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
  // Depuis les comptes : le prénom du profil connecté fait foi.
  try {
    const name = useAuth.getState().displayName;
    if (name.trim()) return name.trim();
  } catch { /* store pas prêt — replis historiques */ }
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

function currentUserId(): string | null {
  try { return useAuth.getState().userId; } catch { return null; }
}

/** Insertion dégradante : les colonnes user_id (04/09) et kind (04/09) peuvent
 *  manquer tant que le SQL n'est pas collé — on retombe sur la forme d'origine
 *  plutôt que de perdre l'événement (supabase-js ne lève pas, il renvoie error). */
async function insertEvent(row: { path: string; visitor: string; user_id: string | null; kind: 'page' | 'pulse' }): Promise<void> {
  const full = await supabase.from('app_usage_events').insert(row);
  if (!full.error) return;
  if (row.kind === 'pulse') return; // sans colonne kind, un battement passerait pour une page : on le tait
  const noKind = await supabase.from('app_usage_events').insert({ path: row.path, visitor: row.visitor, user_id: row.user_id });
  if (!noKind.error) return;
  await supabase.from('app_usage_events').insert({ path: row.path, visitor: row.visitor });
}

export async function logPageVisit(path: string): Promise<void> {
  const now = Date.now();
  if (path === lastPath && now - lastAt < 60_000) return;
  lastPath = path;
  lastAt = now;
  try {
    // Identité = le COMPTE (constat Channing 04/09 : « channing » et
    // « Channing » comptés deux fois — le premier événement d'une session
    // partait avant le chargement du profil et retombait sur l'ancien nom
    // saisi dans l'Ingestion). Le libellé reste informatif ; user_id fait foi.
    await insertEvent({ path, visitor: visitorLabel(), user_id: currentUserId(), kind: 'page' });
  } catch { /* table pas encore créée ou hors-ligne — jamais bloquant */ }
}

// ─── Battement de présence (demande Channing 04/09 : temps d'activité par
// personne et par semaine). Un changement de page ne dit rien de la durée :
// 40 min sur le Workflow sans naviguer = zéro trace. Toutes les 5 min, si
// l'onglet est visible ET que l'utilisateur a interagi dans les 5 dernières
// minutes, on écrit un événement kind='pulse' (compte connecté seulement).
// Jamais compté comme une page visitée.
export const PULSE_MS = 5 * 60_000;
let lastInteraction = Date.now();
let pulseStarted = false;

export function startActivityPulse(): void {
  if (pulseStarted || typeof window === 'undefined') return;
  pulseStarted = true;
  const bump = () => { lastInteraction = Date.now(); };
  for (const ev of ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'pointerdown']) {
    window.addEventListener(ev, bump, { passive: true });
  }
  window.setInterval(() => { void pulse(); }, PULSE_MS);
}

async function pulse(): Promise<void> {
  try {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastInteraction > PULSE_MS) return;
    const userId = currentUserId();
    if (!userId) return;
    await insertEvent({ path: window.location.pathname, visitor: visitorLabel(), user_id: userId, kind: 'pulse' });
  } catch { /* jamais bloquant */ }
}

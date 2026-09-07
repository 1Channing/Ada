/**
 * ALERTES DE CAPACITÉ (règle Channing 07/09) — quand une lecture plafonnée
 * touche son plafond, ADA le DIT : ligne en base (capacity_alerts, visible
 * par tous), bandeau rouge sur toutes les pages tant que non acquittée,
 * reprise dans « Ce matin ». Fail-open : table absente → silence.
 *
 * Usage : `const rows = capped(data, LIMIT, 'clé', 'message lisible')` —
 * si `data.length >= LIMIT`, l'alerte part (une fois par session par clé).
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

export interface CapacityAlert {
  key: string; message: string; limit_value: number | null; hits: number;
  first_hit_at: string; hit_at: string; acknowledged_at: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const reportedThisSession = new Set<string>();
const listeners = new Set<() => void>();
export function onCapacityChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Horodatage du build servi (vite define) — repli : maintenant. */
const BUILD_TIME = (() => { try { return __BUILD_TIME__; } catch { return new Date().toISOString(); } })();

export function reportCapacity(key: string, message: string, limit: number): void {
  if (reportedThisSession.has(key)) return;
  reportedThisSession.add(key);
  console.warn(`[CAPACITÉ] ${key} : ${message} (plafond ${limit})`);
  // Le build est transmis : un acquittement couvre tout code construit avant
  // lui (migration 20260907140000). Tant que le SQL n'est pas collé, la
  // signature à 4 arguments n'existe pas → repli sur l'ancienne.
  void sb.rpc('capacity_hit', { p_key: key, p_message: message, p_limit: limit, p_build: BUILD_TIME })
    .then(({ error }: { error: { message: string } | null }) => (error ? sb.rpc('capacity_hit', { p_key: key, p_message: message, p_limit: limit }) : null))
    .then(() => { for (const fn of listeners) fn(); })
    .catch(() => undefined);
}

/** Renvoie les lignes telles quelles et signale si le plafond est touché. */
export function capped<T>(rows: T[] | null | undefined, limit: number, key: string, message: string): T[] {
  const r = rows ?? [];
  if (r.length >= limit) reportCapacity(key, message, limit);
  return r;
}

export async function loadCapacityAlerts(): Promise<CapacityAlert[]> {
  const { data, error } = await sb.from('capacity_alerts').select('*').is('acknowledged_at', null).order('hit_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as CapacityAlert[];
}

/** « Traité » : l'alerte s'éteint aussitôt à l'écran ; l'écriture est
 *  VÉRIFIÉE (ligne renvoyée) — une politique RLS qui bloquerait l'update
 *  passait sans bruit avant (« j'ai toujours l'alerte », 07/09). */
export async function ackCapacity(key: string): Promise<string | null> {
  const userId = useAuth.getState().userId;
  const { data, error } = await sb.from('capacity_alerts')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
    .eq('key', key)
    .select('key');
  if (error) return error.message;
  if (!data?.length) return 'acquittement refusé par la base (droit de mise à jour manquant) — la migration 20260907100000 est-elle collée ?';
  for (const fn of listeners) fn();
  return null;
}

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

export function reportCapacity(key: string, message: string, limit: number): void {
  if (reportedThisSession.has(key)) return;
  reportedThisSession.add(key);
  console.warn(`[CAPACITÉ] ${key} : ${message} (plafond ${limit})`);
  void sb.rpc('capacity_hit', { p_key: key, p_message: message, p_limit: limit })
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

export async function ackCapacity(key: string): Promise<string | null> {
  const userId = useAuth.getState().userId;
  const { error } = await sb.from('capacity_alerts').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId }).eq('key', key);
  if (!error) for (const fn of listeners) fn();
  return error ? error.message : null;
}

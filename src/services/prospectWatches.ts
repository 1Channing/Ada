/**
 * VEILLES DE PROSPECTION PAR ADRESSE (29/10, Channing) : le mode d'études quotidiennes des
 * organisations de prospection — une adresse de recherche (Leboncoin, particuliers, secteur…), une
 * heure, et chaque jour les nouvelles annonces tombent dans les leads de toute l'organisation.
 * Tables à part des études MC Export (prospect_watches / prospect_watch_hits). Fail-open : tables
 * absentes (SQL du 29/10 pas collé) → message explicite, rien ne casse.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

const SQL_HINT = 'Veilles de prospection : SQL du 29/10 (veille_prospection) à coller.';
const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /prospect_watch|schema cache|does not exist/i.test(m);
const uid = (): string => { const id = useAuth.getState().userId; if (!id) throw new Error('Session absente'); return id; };

export interface ProspectWatch {
  id: string; user_id: string; label: string; url: string; run_hour: number; active: boolean;
  last_run_at: string | null; last_summary: string | null; created_at: string;
}

export interface WatchLead {
  id: string; watch_id: string; listing_url: string; title: string; price: number | null; year: number | null; mileage: number | null;
  fuel: string; site: string; published_at: string | null; status: string; first_seen_at: string;
  watch: Pick<ProspectWatch, 'id' | 'label' | 'url' | 'user_id'>;
}

/** Mes veilles (celles que j'ai créées). */
export async function listMyWatches(): Promise<{ rows: ProspectWatch[]; error: string | null }> {
  const { data, error } = await untyped.from('prospect_watches').select('*').eq('user_id', uid()).order('created_at');
  if (error) return { rows: [], error: missing(error.message) ? SQL_HINT : error.message };
  return { rows: (data ?? []) as ProspectWatch[], error: null };
}

export function watchUrlProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return 'Adresse illisible : colle l\'adresse complète de la page de recherche (https://…).'; }
  if (!/^https?:$/.test(u.protocol)) return 'L\'adresse doit commencer par https://.';
  if (!/\b(leboncoin|lacentrale|autoscout24|marktplaats|gaspedaal|mobile\.de|bilbasen|subito|coches|autotrack)\b/i.test(u.hostname)) return `Site ${u.hostname} : Ada ne sait pas encore lire ses pages de recherche — Leboncoin, La Centrale, AutoScout24, Marktplaats, Gaspedaal, mobile.de, Bilbasen, Subito.`;
  return null;
}

export async function saveWatch(w: Partial<ProspectWatch> & { url: string }): Promise<string | null> {
  const bad = watchUrlProblem(w.url);
  if (bad) return bad;
  const row = { label: (w.label ?? '').trim(), url: w.url.trim(), run_hour: w.run_hour ?? 7, active: w.active ?? true, user_id: uid(), updated_at: new Date().toISOString() };
  const { error } = w.id
    ? await untyped.from('prospect_watches').update(row).eq('id', w.id)
    : await untyped.from('prospect_watches').insert(row);
  if (!error) return null;
  return missing(error.message) ? SQL_HINT : error.message;
}

export async function deleteWatch(id: string): Promise<string | null> {
  const { error } = await untyped.from('prospect_watches').delete().eq('id', id);
  return error ? error.message : null;
}

/** « Lancer maintenant » : drapeau sondé par le worker toutes les 30 s. */
export async function forceRunWatch(id: string): Promise<string | null> {
  const { error } = await untyped.from('prospect_watches').update({ force_requested_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

/** Les leads des veilles de mon organisation (les miennes comprises), encore à prendre. */
export async function listWatchLeads(): Promise<WatchLead[]> {
  const { data, error } = await untyped
    .from('prospect_watch_hits')
    .select('*, watch:prospect_watches!inner(id, label, url, user_id)')
    .eq('status', 'inbox')
    .order('first_seen_at', { ascending: false })
    .limit(2000);
  if (error) { if (missing(error.message)) return []; throw new Error(error.message); }
  return (data ?? []) as WatchLead[];
}

/** Prendre un lead de veille : saved à mon nom si encore inbox (le second apprend qu'il est pris), puis ma négociation. */
export async function takeWatchLead(l: WatchLead): Promise<string | null> {
  const { data, error } = await untyped
    .from('prospect_watch_hits')
    .update({ status: 'saved', taken_by: uid(), taken_at: new Date().toISOString() })
    .eq('id', l.id)
    .eq('status', 'inbox')
    .select('id');
  if (error) return error.message;
  if (!data || data.length === 0) return 'Ce lead vient d\'être pris par un collègue.';
  const { error: negErr } = await supabase.from('negotiations').insert({
    user_id: uid(), title: l.title || l.listing_url, listing_url: l.listing_url, asking_price: l.price,
  });
  return negErr ? negErr.message : null;
}

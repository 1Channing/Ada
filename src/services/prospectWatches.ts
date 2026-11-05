/**
 * VEILLES DE PROSPECTION PAR ADRESSE (29/10, Channing) : le mode d'études quotidiennes des
 * organisations de prospection — une adresse de recherche (Leboncoin, particuliers, secteur…), une
 * heure, et chaque jour les nouvelles annonces tombent dans les leads de toute l'organisation.
 * Tables à part des études MC Export (prospect_watches / prospect_watch_hits). Fail-open : tables
 * absentes (SQL du 29/10 pas collé) → message explicite, rien ne casse.
 */
import { supabase } from '../lib/supabase';
import { compatibleTitles } from '../lib/vehicleIdentity';
import { fuelFamily } from './stockCompare';
import { useAuth } from './auth';

const SQL_HINT = 'Veilles de prospection : SQL du 29/10 (veille_prospection) à coller.';
const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /prospect_watch|schema cache|does not exist/i.test(m);
const uid = (): string => { const id = useAuth.getState().userId; if (!id) throw new Error('Session absente'); return id; };

export interface ProspectWatch {
  id: string; user_id: string; label: string; url: string; run_hour: number; active: boolean;
  /** Organisation qui reçoit les leads (30/10) ; null = celle de l'auteur. */
  lead_org?: string | null;
  last_run_at: string | null; last_summary: string | null; created_at: string;
  /** « Lancer maintenant » demandé, pas encore pris par le worker (sondé toutes les 30 s). */
  force_requested_at?: string | null;
}

export interface WatchLead {
  id: string; watch_id: string; listing_url: string; title: string; price: number | null; year: number | null; mileage: number | null;
  fuel: string; site: string; published_at: string | null; status: string; first_seen_at: string;
  watch: Pick<ProspectWatch, 'id' | 'label' | 'url' | 'user_id' | 'last_run_at'>;
}

/** Les veilles de l'organisation (01/11 : deux managers d'une même organisation voient et corrigent celles des
 *  uns et des autres — la base borne la lecture à l'organisation et l'écriture aux managers), avec l'auteur. */
export async function listMyWatches(): Promise<{ rows: Array<ProspectWatch & { author_name?: string }>; error: string | null }> {
  const { data, error } = await untyped.from('prospect_watches').select('*').order('created_at');
  if (error) return { rows: [], error: missing(error.message) ? SQL_HINT : error.message };
  const rows = (data ?? []) as Array<ProspectWatch & { author_name?: string }>;
  const ids = [...new Set(rows.map((r) => r.user_id))].filter((id) => id !== uid());
  if (ids.length) {
    const { data: ps } = await untyped.from('profiles').select('id, display_name').in('id', ids);
    const names = new Map(((ps ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [p.id, (p.display_name ?? '').trim() || 'collègue']));
    for (const r of rows) if (r.user_id !== uid()) r.author_name = names.get(r.user_id) ?? 'collègue';
  }
  return { rows, error: null };
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
  // L'auteur ne change pas quand un collègue manager corrige la veille (01/11).
  const row: Record<string, unknown> = { label: (w.label ?? '').trim(), url: w.url.trim(), run_hour: w.run_hour ?? 7, active: w.active ?? true, ...(w.id ? {} : { user_id: uid() }), updated_at: new Date().toISOString(), lead_org: w.lead_org || null };
  const write = (r: Record<string, unknown>) => (w.id ? untyped.from('prospect_watches').update(r).eq('id', w.id) : untyped.from('prospect_watches').insert(r));
  let { error } = await write(row);
  if (error && /lead_org/.test(error.message)) {
    const { lead_org, ...rest } = row;
    ({ error } = await write(rest));
    if (!error && lead_org) return 'Veille enregistrée pour TON organisation : SQL du 30/10 (manager_multi_organisations) à coller pour attribuer les leads à une autre agence.';
  }
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

/** Les veilles de l'organisation telles que la base les montre (pour afficher aussi celles sans lead, 01/11). */
export async function listOrgWatches(): Promise<Array<Pick<ProspectWatch, 'id' | 'label' | 'url' | 'user_id' | 'last_run_at' | 'last_summary' | 'active'>>> {
  const { data, error } = await untyped.from('prospect_watches').select('id, label, url, user_id, last_run_at, last_summary, active').order('created_at');
  if (error) return [];
  return (data ?? []) as Array<Pick<ProspectWatch, 'id' | 'label' | 'url' | 'user_id' | 'last_run_at' | 'last_summary' | 'active'>>;
}

/** Les leads des veilles de mon organisation (les miennes comprises), encore à prendre. */
export async function listWatchLeads(): Promise<WatchLead[]> {
  const { data, error } = await untyped
    .from('prospect_watch_hits')
    .select('*, watch:prospect_watches!inner(id, label, url, user_id, last_run_at)')
    .eq('status', 'inbox')
    .order('first_seen_at', { ascending: false })
    .limit(2000);
  if (error) { if (missing(error.message)) return []; throw new Error(error.message); }
  return (data ?? []) as WatchLead[];
}

/** DOUBLONS ENTRE PLATEFORMES (01/11, Channing : « une Volvo XC40 D3 sur Leboncoin ET La Centrale : un signal,
 *  et dire si le lead est disponible ou pris par X »). Les annonces des 45 derniers jours de toutes les veilles de
 *  l'organisation, tous statuts sauf la mémoire silencieuse, avec le prénom de qui a pris ou rejeté. */
export interface TwinHit { id: string; watch_id: string; listing_url: string; site: string; title: string; price: number | null; year: number | null; mileage: number | null; fuel?: string | null; status: string; taken_by: string | null; taken_by_name: string | null; watch: Pick<ProspectWatch, 'id' | 'label' | 'url'> }
export async function listTwinCandidates(): Promise<TwinHit[]> {
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const { data, error } = await untyped
    .from('prospect_watch_hits')
    .select('id, watch_id, listing_url, site, title, price, year, mileage, fuel, status, taken_by, watch:prospect_watches!inner(id, label, url)')
    .in('status', ['inbox', 'saved', 'rejected'])
    .gte('first_seen_at', since)
    .limit(4000);
  if (error) return [];
  const rows = (data ?? []) as TwinHit[];
  const ids = [...new Set(rows.map((r) => r.taken_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await untyped.from('profiles').select('id, display_name').in('id', ids);
    for (const p of (ps ?? []) as Array<{ id: string; display_name: string | null }>) names.set(p.id, (p.display_name ?? '').trim() || 'un collègue');
  }
  return rows.map((r) => ({ ...r, taken_by_name: r.taken_by ? names.get(r.taken_by) ?? 'un collègue' : null }));
}
/** Même véhicule ? Même année, kilométrage à 2 % (ou 500 km) près, prix à 3 % près quand les deux sont connus —
 *  ET même marque, même modèle, même énergie quand ils sont connus des deux côtés (05/11, Segré : « un T-Roc La
 *  Centrale en doublon avec un GLA Leboncoin » — l'ancienne règle ignorait le titre). */
export function sameVehicle(
  a: { year: number | null; mileage: number | null; price: number | null; title?: string | null; fuel?: string | null },
  b: { year: number | null; mileage: number | null; price: number | null; title?: string | null; fuel?: string | null },
): boolean {
  if (a.year == null || b.year == null || a.year !== b.year) return false;
  if (a.mileage == null || b.mileage == null) return false;
  if (Math.abs(a.mileage - b.mileage) > Math.max(500, 0.02 * Math.max(a.mileage, b.mileage))) return false;
  if (a.price != null && b.price != null && Math.abs(a.price - b.price) > 0.03 * Math.max(a.price, b.price)) return false;
  if (!compatibleTitles(a.title, b.title)) return false;
  const fa = fuelFamily(a.fuel), fb = fuelFamily(b.fuel);
  if (fa && fb && fa !== fb) return false;
  return true;
}

/** REJETER un lead (30/10, Channing : « lorsqu'il ne correspond pas aux critères ») : il disparaît pour toute
 *  l'organisation, la mémoire de la veille le garde (il ne reviendra pas). Seulement s'il est encore inbox. */
export async function rejectWatchLead(l: WatchLead): Promise<string | null> {
  const { data, error } = await untyped
    .from('prospect_watch_hits')
    .update({ status: 'rejected', taken_by: uid(), taken_at: new Date().toISOString() })
    .eq('id', l.id)
    .eq('status', 'inbox')
    .select('id');
  if (error) return /row-level security/i.test(error.message) ? 'Rejet refusé par la base : SQL du 30/10 (veille_rejet) à coller.' : error.message;
  if (!data || data.length === 0) return 'Ce lead vient d\'être pris ou rejeté par un collègue.';
  return null;
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

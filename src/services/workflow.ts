import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

/**
 * Workflow personnel : études quotidiennes + nouvelles annonces + négociations.
 * Tout est filtré par le compte connecté (RLS côté base en double sécurité).
 */

export interface DailySearch {
  id: string;
  label: string;
  source_country: string;
  target_country: string;
  brand: string;
  model: string;
  year_min: number | null;
  year_max: number | null;
  fuel: string;
  trim: string;
  price_gap_min: number;
  price_gap_max: number;
  run_hour: number;
  active: boolean;
  last_run_at: string | null;
}

export interface DailyHit {
  id: string;
  search_id: string;
  listing_url: string;
  title: string;
  price: number | null;
  previous_price: number | null;
  year: number | null;
  mileage: number | null;
  fuel: string;
  site: string;
  source_country: string;
  target_median: number | null;
  price_gap: number | null;
  kind: string;      // 'new' | 'price_drop' ('seed' jamais montré)
  status: string;    // 'inbox' | 'saved' | 'dismissed'
  first_seen_at: string;
  last_seen_at: string;
}

export interface Negotiation {
  id: string;
  title: string;
  listing_url: string;
  asking_price: number | null;
  negotiated_price: number | null;
  notes: string;
  status: string;    // 'open' | 'pushed_to_sale' | 'closed'
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

function uid(): string {
  const id = useAuth.getState().userId;
  if (!id) throw new Error('Session absente');
  return id;
}

// ── Études quotidiennes ─────────────────────────────────────────────────────

export async function listDailySearches(): Promise<DailySearch[]> {
  const { data, error } = await supabase
    .from('daily_searches')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DailySearch[];
}

export async function saveDailySearch(s: Partial<DailySearch> & { source_country: string; target_country: string; brand: string }): Promise<string | null> {
  const row = { ...s, user_id: uid(), updated_at: new Date().toISOString() };
  const { error } = s.id
    ? await supabase.from('daily_searches').update(row).eq('id', s.id)
    : await supabase.from('daily_searches').insert(row);
  return error ? error.message : null;
}

export async function deleteDailySearch(id: string): Promise<void> {
  await supabase.from('daily_searches').delete().eq('id', id);
}

// ── Nouvelles annonces (hits) ───────────────────────────────────────────────

/** Boîte de réception : nouveautés + baisses, jamais les seeds ni le trié. */
export async function listInboxHits(limit = 100): Promise<DailyHit[]> {
  const { data, error } = await supabase
    .from('daily_search_hits')
    .select('*')
    .eq('status', 'inbox')
    .neq('kind', 'seed')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DailyHit[];
}

/** Historique complet des trouvailles (page Résultats), seeds exclus. */
export async function listAllHits(limit = 400): Promise<DailyHit[]> {
  const { data, error } = await supabase
    .from('daily_search_hits')
    .select('*')
    .neq('kind', 'seed')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DailyHit[];
}

export async function dismissHit(id: string): Promise<void> {
  await supabase.from('daily_search_hits').update({ status: 'dismissed' }).eq('id', id);
}

/** Enregistrer : crée la négociation et marque le hit 'saved'. */
export async function saveHitToNegotiations(hit: DailyHit): Promise<string | null> {
  const { error } = await supabase.from('negotiations').insert({
    user_id: uid(),
    title: hit.title || hit.listing_url,
    listing_url: hit.listing_url,
    asking_price: hit.price,
  });
  if (error) return error.message;
  await supabase.from('daily_search_hits').update({ status: 'saved' }).eq('id', hit.id);
  return null;
}

// ── Négociations ────────────────────────────────────────────────────────────

export async function listNegotiations(): Promise<Negotiation[]> {
  const { data, error } = await supabase
    .from('negotiations')
    .select('*')
    .neq('status', 'closed')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Negotiation[];
}

export async function createNegotiation(title: string, listingUrl: string, askingPrice: number | null): Promise<string | null> {
  const { error } = await supabase.from('negotiations').insert({
    user_id: uid(), title, listing_url: listingUrl, asking_price: askingPrice,
  });
  return error ? error.message : null;
}

export async function updateNegotiation(id: string, patch: Partial<Negotiation>): Promise<void> {
  await supabase.from('negotiations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function deleteNegotiation(id: string): Promise<void> {
  await supabase.from('negotiations').delete().eq('id', id);
}

/** Pipeline : la négo devient une vente (transaction admin pré-remplie). */
export async function pushNegotiationToSale(n: Negotiation): Promise<{ transactionId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('transactions_admin')
    .insert({
      transaction_type: 'purchase',
      status: 'en_cours',
      notes: [n.title, n.listing_url, n.notes].filter(Boolean).join('\n'),
      purchase_price: n.negotiated_price ?? n.asking_price,
      owner_user_id: uid(),
    })
    .select('id')
    .single();
  if (error) return { transactionId: null, error: error.message };
  await updateNegotiation(n.id, { status: 'pushed_to_sale', transaction_id: data.id } as Partial<Negotiation>);
  return { transactionId: data.id, error: null };
}

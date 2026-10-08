/**
 * MARKET INTELLIGENCE — recherches sauvegardées (08/10, demande Channing) :
 * un nom + le jeu complet d'études (pays et tous les filtres), partagé par
 * l'équipe ; favoris ; suppression. Table mi_saved_searches (SQL du 08/10).
 */
import { supabase } from '../lib/supabase';
import type { MarketFilters } from './marketData';

export interface SavedSearch {
  id: string; name: string; studies: MarketFilters[]; favorite: boolean;
  created_by: string | null; created_by_name: string; created_at: string; updated_at: string;
}

const sb = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const SAVED_SQL_HINT = 'SQL du 08/10 (mi_saved_searches) à coller.';
const missing = (msg: string) => /does not exist|schema cache|relation/i.test(msg);

export async function listSavedSearches(): Promise<{ rows: SavedSearch[]; error: string | null }> {
  const { data, error } = await sb.from('mi_saved_searches').select('*').order('favorite', { ascending: false }).order('updated_at', { ascending: false }).limit(500);
  if (error) return { rows: [], error: missing(error.message) ? SAVED_SQL_HINT : error.message };
  return { rows: (data ?? []) as SavedSearch[], error: null };
}

/** Filtres nettoyés (clés vides retirées) pour comparer et enregistrer. */
export function cleanStudies(studies: MarketFilters[]): MarketFilters[] {
  return studies.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v != null && v !== '')) as MarketFilters);
}
export const studiesKey = (studies: MarketFilters[]) => JSON.stringify(cleanStudies(studies).map((f) => Object.fromEntries(Object.entries(f).sort())));

export async function saveSearch(name: string, studies: MarketFilters[], userId: string | null, userName: string, favorite = false): Promise<{ row: SavedSearch | null; error: string | null }> {
  const { data, error } = await sb.from('mi_saved_searches')
    .insert({ name: name.trim(), studies: cleanStudies(studies), favorite, created_by: userId, created_by_name: userName })
    .select('*').single();
  if (error) return { row: null, error: missing(error.message) ? SAVED_SQL_HINT : error.message };
  return { row: data as SavedSearch, error: null };
}

export async function setSearchFavorite(id: string, favorite: boolean): Promise<string | null> {
  const { error } = await sb.from('mi_saved_searches').update({ favorite, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

export async function renameSearch(id: string, name: string): Promise<string | null> {
  const { error } = await sb.from('mi_saved_searches').update({ name: name.trim(), updated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

export async function deleteSearch(id: string): Promise<string | null> {
  const { error } = await sb.from('mi_saved_searches').delete().eq('id', id);
  return error ? error.message : null;
}

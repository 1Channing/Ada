/**
 * ONGLETS MASQUÉS PAR CHOIX PERSONNEL (23/10, Channing : « j'en ai trop, je veux
 * activer ou désactiver selon mon bon vouloir », admin compris).
 *
 * Préférence du compte, rien à voir avec les droits : un onglet masqué reste
 * accessible par son adresse (et par le réglage), un onglet interdit par
 * l'admin ne réapparaît pas. Enregistrée dans profiles.hidden_tabs ; tant que
 * la colonne n'existe pas (SQL 20261023100000 pas collé) ou hors ligne, le
 * navigateur garde la liste en localStorage — rien ne casse (fail-open).
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

const LS_KEY = 'ada_hidden_tabs';

export function readLocalHiddenTabs(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** Enregistre la liste : dans le store (effet immédiat), le navigateur, puis la base. */
export async function saveHiddenTabs(keys: string[]): Promise<string | null> {
  const list = [...new Set(keys)];
  useAuth.setState({ hiddenTabs: list });
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* stockage indisponible */ }
  const userId = useAuth.getState().userId;
  if (!userId) return null;
  const { error } = await supabase.from('profiles').update({ hidden_tabs: list } as never).eq('id', userId);
  if (error && /hidden_tabs/.test(error.message ?? '')) return 'Le réglage est gardé sur ce navigateur seulement (SQL 20261023100000 à coller pour le retrouver partout).';
  return error ? error.message : null;
}

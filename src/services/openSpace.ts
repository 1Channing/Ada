/**
 * OPEN SPACE (demande Channing 05/09) — l'espace partagé des négociations.
 * Une négociation reste personnelle ; son propriétaire la POUSSE dans l'Open
 * space pour la rendre visible à toute l'équipe (titre, annonce, prix,
 * photos), et chacun y laisse des notes datées et signées.
 * Fail-open intégral : tables absentes (migration 20260905120000 non collée)
 * → listes vides, compteur 0, jamais d'erreur bloquante.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import type { Negotiation } from './workflow';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface OpenSpaceItem {
  id: string;
  negotiation_id: string;
  pushed_by: string;
  pushed_by_name: string;
  pushed_at: string;
  message: string;
  nego: Negotiation | null;
}

export interface OpenSpaceNote {
  id: string;
  item_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

let namesCache: Map<string, string> | null = null;
async function profileNames(): Promise<Map<string, string>> {
  if (namesCache) return namesCache;
  const { data } = await sb.from('profiles').select('id, display_name');
  namesCache = new Map(((data ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [p.id, (p.display_name ?? '').trim() || 'collègue']));
  return namesCache;
}

export async function listOpenSpace(): Promise<OpenSpaceItem[]> {
  const { data, error } = await sb.from('open_space_items').select('*, negotiations(*)').order('pushed_at', { ascending: false });
  if (error || !data) return [];
  const names = await profileNames();
  return (data as Array<Record<string, unknown>>).map((r) => {
    const n = r.negotiations as Record<string, unknown> | null;
    return {
      id: String(r.id), negotiation_id: String(r.negotiation_id), pushed_by: String(r.pushed_by),
      pushed_by_name: names.get(String(r.pushed_by)) ?? 'collègue',
      pushed_at: String(r.pushed_at), message: String(r.message ?? ''),
      nego: n ? ({ ...n, photos: Array.isArray(n.photos) ? n.photos : [] } as Negotiation) : null,
    };
  });
}

export async function listOpenSpaceNotes(): Promise<OpenSpaceNote[]> {
  const { data, error } = await sb.from('open_space_notes').select('*').order('created_at', { ascending: true });
  if (error || !data) return [];
  const names = await profileNames();
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), item_id: String(r.item_id), author_id: String(r.author_id),
    author_name: names.get(String(r.author_id)) ?? 'collègue',
    body: String(r.body ?? ''), created_at: String(r.created_at),
  }));
}

export async function pushToOpenSpace(negotiationId: string, message = ''): Promise<string | null> {
  const userId = useAuth.getState().userId;
  if (!userId) return 'Session absente';
  const { error } = await sb.from('open_space_items').insert({ negotiation_id: negotiationId, pushed_by: userId, message });
  if (!error) return null;
  if (/duplicate|unique/i.test(error.message)) return null; // déjà partagée
  if (/does not exist|relation/i.test(error.message)) return "L'Open space n'est pas encore installé (SQL du 05/09 à coller).";
  return error.message;
}

export async function removeFromOpenSpace(itemId: string): Promise<string | null> {
  const { error } = await sb.from('open_space_items').delete().eq('id', itemId);
  return error ? error.message : null;
}

export async function addOpenSpaceNote(itemId: string, body: string): Promise<string | null> {
  const userId = useAuth.getState().userId;
  if (!userId) return 'Session absente';
  const { error } = await sb.from('open_space_notes').insert({ item_id: itemId, author_id: userId, body });
  return error ? error.message : null;
}

export async function deleteOpenSpaceNote(id: string): Promise<string | null> {
  const { error } = await sb.from('open_space_notes').delete().eq('id', id);
  return error ? error.message : null;
}

/** Nouveautés poussées ou commentées par LES AUTRES depuis ma dernière visite. */
export async function openSpaceUnseenCount(): Promise<number> {
  const userId = useAuth.getState().userId;
  if (!userId) return 0;
  const { data: seen } = await sb.from('open_space_seen').select('seen_at').eq('user_id', userId).maybeSingle();
  const since = (seen as { seen_at?: string } | null)?.seen_at ?? '1970-01-01T00:00:00Z';
  const [items, notes] = await Promise.all([
    sb.from('open_space_items').select('id', { count: 'exact', head: true }).neq('pushed_by', userId).gt('pushed_at', since),
    sb.from('open_space_notes').select('id', { count: 'exact', head: true }).neq('author_id', userId).gt('created_at', since),
  ]);
  if (items.error && notes.error) return 0;
  return (items.count ?? 0) + (notes.count ?? 0);
}

export async function markOpenSpaceSeen(): Promise<void> {
  const userId = useAuth.getState().userId;
  if (!userId) return;
  await sb.from('open_space_seen').upsert({ user_id: userId, seen_at: new Date().toISOString() }, { onConflict: 'user_id' });
}

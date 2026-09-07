/**
 * CARTE EUROPE DU RÉSEAU — lectures/écritures des contacts (07/09/2026).
 * Tables network_contacts / network_contact_models (migration 20260907180000).
 * Lecture pour toute l'équipe ; écriture réservée aux comptes portant le
 * droit « carte:edition » (la politique RLS lit le même droit — un compte
 * sans droit voit ses écritures refusées par la base, pas seulement par
 * l'écran). Temps réel : la carte suit les modifications des autres.
 */
import { supabase } from '../lib/supabase';
import { brandKey, canonKey } from './marketData';
import { capped } from './capacity';

export type ContactKind = 'concession' | 'loueur' | 'trader' | 'convoyeur' | 'autre';
export type ContactRole = 'vendeur' | 'acheteur' | 'les_deux';

export interface NetworkContact {
  id: string;
  name: string;
  kind: ContactKind;
  role: ContactRole;
  country: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  relation: string;
  vehicle_types: string;
  monthly_volume: string;
  opportunity: string;
  margin: string;
  reliability: string;
  comment: string;
  notes: string;
  market_share: number | null;
  stock_total: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  models: NetworkContactModel[];
}

export interface NetworkContactModel {
  id: string;
  contact_id: string;
  brand: string;
  model: string;
  qty: number | null;
  note: string;
}

export const KIND_LABEL: Record<ContactKind, string> = {
  concession: 'Concession', loueur: 'Loueur', trader: 'Trader', convoyeur: 'Convoyeur', autre: 'Autre',
};
export const ROLE_LABEL: Record<ContactRole, string> = {
  vendeur: 'Vendeur', acheteur: 'Acheteur', les_deux: 'Acheteur & vendeur',
};
export const RELATION_SUGGESTIONS = ['froid', 'tiede', 'chaud', 'nouveau'];
export const RELATION_LABEL: Record<string, string> = { froid: 'Froid', tiede: 'Tiède', chaud: 'Chaud', nouveau: 'Nouveau' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export async function loadNetwork(): Promise<{ contacts: NetworkContact[]; error: string | null }> {
  const [{ data: c, error: e1 }, { data: m, error: e2 }] = await Promise.all([
    sb.from('network_contacts').select('*').order('name').limit(5000),
    sb.from('network_contact_models').select('*').limit(20000),
  ]);
  if (e1) return { contacts: [], error: e1.message as string };
  const models = capped((m ?? []) as NetworkContactModel[], 20000, 'carte.modeles', 'La carte lit 20 000 lignes marques/modèles au plus : des marques peuvent manquer sur des contacts.');
  const byContact = new Map<string, NetworkContactModel[]>();
  for (const row of models) (byContact.get(row.contact_id) ?? byContact.set(row.contact_id, []).get(row.contact_id)!).push(row);
  const contacts = capped((c ?? []) as Omit<NetworkContact, 'models'>[], 5000, 'carte.contacts', 'La carte lit 5 000 contacts au plus : des contacts peuvent manquer.')
    .map((row) => ({ ...row, models: (byContact.get(row.id) ?? []).sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0) || a.brand.localeCompare(b.brand)) }));
  return { contacts, error: e2 ? (e2.message as string) : null };
}

export type ContactInput = Omit<NetworkContact, 'id' | 'created_by' | 'created_at' | 'updated_at' | 'models'> & { id?: string };

export async function saveContact(input: ContactInput, userId: string | null): Promise<{ id: string | null; error: string | null }> {
  const row = { ...input, created_by: input.id ? undefined : userId };
  if (row.created_by === undefined) delete (row as { created_by?: unknown }).created_by;
  const { data, error } = await sb.from('network_contacts').upsert(row, { onConflict: 'id' }).select('id').maybeSingle();
  if (error) return { id: null, error: frenchDbError(error.message) };
  if (!data?.id) return { id: null, error: 'Écriture refusée par la base (droit « Carte du réseau · édition » manquant ?).' };
  return { id: data.id as string, error: null };
}

export async function deleteContact(id: string): Promise<string | null> {
  const { data, error } = await sb.from('network_contacts').delete().eq('id', id).select('id');
  if (error) return frenchDbError(error.message);
  if (!data?.length) return 'Suppression refusée par la base (droit « Carte du réseau · édition » manquant ?).';
  return null;
}

export async function moveContact(id: string, lat: number, lng: number): Promise<string | null> {
  const { data, error } = await sb.from('network_contacts').update({ lat, lng }).eq('id', id).select('id');
  if (error) return frenchDbError(error.message);
  if (!data?.length) return 'Déplacement refusé par la base (droit « Carte du réseau · édition » manquant ?).';
  return null;
}

/** Remplace la liste marques/modèles d'un contact (diff minimal). */
export async function saveContactModels(contactId: string, models: Array<{ brand: string; model: string; qty: number | null; note: string }>): Promise<string | null> {
  const clean = models
    .map((m) => ({ contact_id: contactId, brand: m.brand.trim().toUpperCase(), model: m.model.trim().toUpperCase(), qty: m.qty, note: m.note.trim() }))
    .filter((m) => m.brand);
  const { data: existing, error: e0 } = await sb.from('network_contact_models').select('id, brand, model').eq('contact_id', contactId);
  if (e0) return frenchDbError(e0.message);
  const keep = new Set(clean.map((m) => `${m.brand}|${m.model}`));
  const toDelete = ((existing ?? []) as Array<{ id: string; brand: string; model: string }>).filter((e) => !keep.has(`${e.brand}|${e.model}`)).map((e) => e.id);
  if (toDelete.length) {
    const { error } = await sb.from('network_contact_models').delete().in('id', toDelete);
    if (error) return frenchDbError(error.message);
  }
  if (clean.length) {
    const { error } = await sb.from('network_contact_models').upsert(clean, { onConflict: 'contact_id,brand,model' });
    if (error) return frenchDbError(error.message);
  }
  return null;
}

/** Abonnement temps réel — renvoie la fonction de désabonnement. */
export function subscribeNetwork(onChange: () => void): () => void {
  const ch = supabase.channel('network:live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'network_contacts' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'network_contact_models' }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(ch); };
}

/** Un contact suit-il ce modèle (ou cette marque) ? Clés canoniques du MI. */
export function contactMatchesQuery(c: NetworkContact, q: string): boolean {
  const k = canonKey(q);
  if (!k) return true;
  const hay = canonKey(`${c.name} ${c.contact_name ?? ''} ${c.city ?? ''} ${c.vehicle_types} ${c.comment} ${c.notes}`);
  if (hay.includes(k)) return true;
  return c.models.some((m) => brandKey(m.brand).includes(brandKey(q)) && brandKey(q).length >= 2 || canonKey(`${m.brand} ${m.model}`).includes(k) || (m.model && canonKey(m.model).includes(k)));
}

function frenchDbError(msg: string): string {
  if (/row-level security|permission denied/i.test(msg)) return 'Refusé par la base : ce compte n’a pas le droit « Carte du réseau · édition ».';
  if (/does not exist|schema cache/i.test(msg)) return `Table absente — la migration 20260907180000 est-elle collée ? (${msg})`;
  return msg;
}

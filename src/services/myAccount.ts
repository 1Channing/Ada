/**
 * MON COMPTE (26/11, Channing : « en cliquant sur le nom en haut à droite, chaque compte a accès à ses paramètres :
 * nom, prénom, adresse ; il voit son organisation et les gens qui y sont, sans pouvoir modifier ; et l'ajout d'une
 * signature e-mail visuelle qui s'ajoute à tous les e-mails envoyés depuis Ada par ce compte »).
 *
 * Tout passe par public.profiles : lecture/écriture de SA ligne (politique profiles_update_own), lecture des membres
 * de SON organisation (politique profiles_select du 12/10). La colonne address arrive par le SQL du 26/11 : tant
 * qu'elle manque, la page le dit et enregistre le reste (fail-open).
 */
import { supabase } from '../lib/supabase';

export interface MyAccount {
  display_name: string; first_name: string; last_name: string; phone: string; address: string;
  organisation: string; is_manager: boolean; is_admin: boolean;
}
export interface OrgMember { id: string; display_name: string; first_name: string | null; last_name: string | null; is_manager: boolean; is_admin: boolean; created_at: string | null }

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const COLS = 'display_name, first_name, last_name, phone, organisation, is_manager, is_admin';

export async function loadMyAccount(userId: string): Promise<{ account: MyAccount | null; addressColumnMissing: boolean; error: string | null }> {
  let addressColumnMissing = false;
  let { data, error } = await untyped.from('profiles').select(`${COLS}, address`).eq('id', userId).maybeSingle();
  if (error && /address/.test(error.message ?? '')) { addressColumnMissing = true; ({ data, error } = await untyped.from('profiles').select(COLS).eq('id', userId).maybeSingle()); }
  if (error) return { account: null, addressColumnMissing, error: error.message };
  if (!data) return { account: null, addressColumnMissing, error: null };
  const r = data as Record<string, unknown>;
  return {
    account: {
      display_name: str(r.display_name), first_name: str(r.first_name), last_name: str(r.last_name), phone: str(r.phone), address: str(r.address),
      organisation: str(r.organisation) || 'MC Export', is_manager: r.is_manager === true, is_admin: r.is_admin === true,
    },
    addressColumnMissing, error: null,
  };
}

/** Enregistre mes coordonnées (jamais les droits : le trigger de la base les protège de toute façon). */
export async function saveMyAccount(userId: string, patch: { display_name: string; first_name: string; last_name: string; phone: string; address: string }, withAddress: boolean): Promise<string | null> {
  const row: Record<string, string | null> = {
    display_name: patch.display_name.trim() || patch.first_name.trim() || 'Compte',
    first_name: patch.first_name.trim() || null, last_name: patch.last_name.trim() || null, phone: patch.phone.trim() || null,
  };
  if (withAddress) row.address = patch.address.trim() || null;
  const { data, error } = await untyped.from('profiles').update(row).eq('id', userId).select('id');
  if (error) return error.message;
  if (!data || (data as unknown[]).length === 0) return 'Rien n\'a été enregistré (ligne de profil introuvable ou protégée).';
  return null;
}

/** Les comptes de mon organisation — lecture seule, pas d'adresse e-mail (elle n'est pas dans profiles). */
export async function listOrgMembers(organisation: string): Promise<{ members: OrgMember[]; error: string | null }> {
  const { data, error } = await untyped.from('profiles').select('id, display_name, first_name, last_name, is_manager, is_admin, created_at').eq('organisation', organisation).order('display_name');
  if (error) return { members: [], error: error.message };
  return {
    members: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: str(r.id), display_name: str(r.display_name), first_name: (r.first_name as string | null) ?? null, last_name: (r.last_name as string | null) ?? null,
      is_manager: r.is_manager === true, is_admin: r.is_admin === true, created_at: (r.created_at as string | null) ?? null,
    })),
    error: null,
  };
}

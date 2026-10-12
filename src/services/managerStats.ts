/**
 * STATISTIQUES D'ORGANISATION (12/10 soir, Channing : « un compte de
 * prospection sur lequel j'ajoute la position de manager, qui donne accès à
 * un onglet Statistiques : négociations en cours avec notes et URL, nombre
 * d'URL lancées, rendez-vous pris, Open space… bref tout »).
 *
 * Trois RPC security definer (SQL 20261012210000), bornées à l'organisation
 * côté base : un manager ne voit que la sienne, un admin celle qu'il
 * demande. Fail-open : RPC absente → listes vides et message explicite.
 */
import { supabase } from '../lib/supabase';
import type { NegoOutcome } from './workflow';

export const MANAGER_SQL_HINT = 'Statistiques : SQL du 12/10 (manager_statistiques) à coller.';

export interface TeamMember { id: string; display_name: string; email: string | null; organisation: string; is_manager: boolean; created_at: string | null }
export interface TeamNegotiation {
  id: string; user_id: string; owner_name: string; title: string; listing_url: string; phone: string | null; notes: string;
  asking_price: number | null; negotiated_price: number | null;
  status: string; outcome: NegoOutcome | null; archived_at: string | null; created_at: string; updated_at: string;
  in_open_space: boolean; photos_count: number;
}
export interface TeamAnalyses { user_id: string; total: number; today: number; week: number; first_at: string; last_at: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args) as Promise<{ data: unknown; error: { message: string } | null }>;
const missing = (m: string) => /does not exist|function|schema cache/i.test(m);

export async function listTeamMembers(org: string | null): Promise<{ rows: TeamMember[]; error: string | null }> {
  const { data, error } = await rpc('manager_team_members', { p_org: org });
  if (error) return { rows: [], error: missing(error.message) ? MANAGER_SQL_HINT : error.message };
  return { rows: (data ?? []) as TeamMember[], error: null };
}

export async function listTeamNegotiations(org: string | null): Promise<{ rows: TeamNegotiation[]; error: string | null }> {
  const { data, error } = await rpc('manager_team_negotiations', { p_org: org });
  if (error) return { rows: [], error: missing(error.message) ? MANAGER_SQL_HINT : error.message };
  return { rows: ((data ?? []) as TeamNegotiation[]).map((r) => ({ ...r, photos_count: Number(r.photos_count ?? 0) })), error: null };
}

export async function listTeamAnalyses(org: string | null): Promise<{ rows: TeamAnalyses[]; error: string | null }> {
  const { data, error } = await rpc('manager_team_analyses', { p_org: org });
  if (error) return { rows: [], error: missing(error.message) ? MANAGER_SQL_HINT : error.message };
  return { rows: ((data ?? []) as TeamAnalyses[]).map((r) => ({ ...r, total: Number(r.total), today: Number(r.today), week: Number(r.week) })), error: null };
}

/** En cours = ce que le commercial voit (sa liste ou l'Open space) ; ni archivée après appel, ni clôturée. */
export const isOpenTeamNego = (n: TeamNegotiation) => n.status === 'open' || n.status === 'pushed_to_sale';
export const TEAM_OUTCOME_LABEL: Record<string, string> = { rdv: 'rendez-vous pris', flux: 'remise dans le flux', no_callback: 'ne pas rappeler', unavailable: 'plus disponible', deleted: 'supprimée' };

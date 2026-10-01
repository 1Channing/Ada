/**
 * TÂCHES PAR UTILISATEUR (02/10, demande Channing) : l'admin confie une
 * tâche à un compte (note + lien) depuis la boîte à apprendre ; la personne
 * la voit sur son accueil avec une pastille et la coche pour la valider.
 * Une liste par compte ; l'admin voit tout.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

export interface UserTask {
  id: string; assignee_id: string; created_by: string | null; key: string | null; title: string; note: string | null; link: string | null;
  status: 'open' | 'done'; created_at: string; done_at: string | null; seen_at: string | null;
}
export interface Assignee { id: string; name: string; isAdmin: boolean }

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);
const MISSING_MSG = 'SQL du 02/10 (user_tasks) à coller.';

export async function listAssignees(): Promise<Assignee[]> {
  const { data } = await untyped.from('profiles').select('id, display_name, is_admin').order('display_name');
  return ((data ?? []) as Array<{ id: string; display_name: string | null; is_admin: boolean | null }>)
    .map((p) => ({ id: p.id, name: p.display_name || p.id.slice(0, 8), isAdmin: !!p.is_admin }));
}

export async function listMyTasks(status: 'open' | 'done' | 'all' = 'all'): Promise<{ tasks: UserTask[]; error: string | null }> {
  const uid = useAuth.getState().userId;
  if (!uid) return { tasks: [], error: null };
  let q = untyped.from('user_tasks').select('*').eq('assignee_id', uid).order('created_at', { ascending: false }).limit(200);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { tasks: [], error: missing(error.message) ? MISSING_MSG : error.message };
  return { tasks: (data ?? []) as UserTask[], error: null };
}

export async function countMyOpenTasks(): Promise<number> {
  const r = await listMyTasks('open');
  return r.tasks.length;
}

/** Admin : toutes les tâches, tous comptes. */
export async function listAllTasks(status: 'open' | 'done' | 'all' = 'open'): Promise<{ tasks: UserTask[]; error: string | null }> {
  let q = untyped.from('user_tasks').select('*').order('created_at', { ascending: false }).limit(500);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { tasks: [], error: missing(error.message) ? MISSING_MSG : error.message };
  return { tasks: (data ?? []) as UserTask[], error: null };
}

export async function createTask(input: { assigneeId: string; title: string; note?: string | null; link?: string | null; key?: string | null }): Promise<string | null> {
  const uid = useAuth.getState().userId;
  const { error } = await untyped.from('user_tasks').insert({
    assignee_id: input.assigneeId, created_by: uid, key: input.key ?? null, title: input.title.trim(), note: input.note?.trim() || null, link: input.link?.trim() || null, status: 'open',
  });
  if (!error) return null;
  if (missing(error.message)) return MISSING_MSG;
  if (/duplicate|unique/i.test(error.message)) return 'Cette tâche existe déjà pour ce compte.';
  return error.message;
}

export async function setTaskDone(id: string, done: boolean): Promise<string | null> {
  const { error } = await untyped.from('user_tasks').update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null }).eq('id', id);
  return error ? error.message : null;
}

export async function markTasksSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await untyped.from('user_tasks').update({ seen_at: new Date().toISOString() }).in('id', ids).is('seen_at', null);
}

export async function deleteTask(id: string): Promise<string | null> {
  const { error } = await untyped.from('user_tasks').delete().eq('id', id);
  return error ? error.message : null;
}

/**
 * MAILS DE BIENVENUE (01/11) : dépôt par l'admin (texte final, celui de l'aperçu), envoi par le worker
 * depuis la boîte d'Ada. Fail-open : table absente → message explicite, le compte est créé quand même.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

const SQL_HINT = 'Mail de bienvenue : SQL du 01/11 (mails_bienvenue) à coller.';
const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface WelcomeMailRow { id: string; to_email: string; status: string; error: string | null; created_at: string; sent_at: string | null }

export async function queueWelcomeMail(m: { to_email: string; to_name: string; subject: string; body: string }): Promise<string | null> {
  const { error } = await untyped.from('welcome_mails').insert({ ...m, created_by: useAuth.getState().userId });
  if (!error) return null;
  return /welcome_mails|schema cache|does not exist/i.test(error.message) ? SQL_HINT : error.message;
}

/** Le dernier mail déposé pour une adresse (état d'envoi affiché dans Admin). */
export async function lastWelcomeMail(email: string): Promise<WelcomeMailRow | null> {
  const { data, error } = await untyped.from('welcome_mails').select('id, to_email, status, error, created_at, sent_at').eq('to_email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return data as WelcomeMailRow;
}

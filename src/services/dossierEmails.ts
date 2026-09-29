/**
 * E-MAILS D'UN DOSSIER (29/09, chantier e-mails — étape 3, côté front).
 * Le front ne parle jamais à Gmail : il dépose une ligne « queued » que le
 * worker envoie au nom de la personne connectée, puis lit le journal.
 */
import { supabase } from '../lib/supabase';

export interface DossierEmail {
  id: string; transaction_id: string; kind: string; to_email: string; subject: string; body: string;
  attachments: Array<{ path: string; name?: string }>; status: 'queued' | 'sent' | 'failed'; error: string | null;
  sender_email: string; sender_name: string | null; gmail_message_id: string | null; created_at: string; sent_at: string | null;
}

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missingTable = (msg: string) => /does not exist|relation|schema cache/i.test(msg);

export async function listDossierEmails(transactionId: string): Promise<{ mails: DossierEmail[]; error: string | null }> {
  const { data, error } = await untyped.from('dossier_emails').select('*').eq('transaction_id', transactionId).order('created_at', { ascending: false });
  if (error) return { mails: [], error: missingTable(error.message) ? 'SQL du 29/09 (dossier_emails) à coller.' : error.message };
  return { mails: (data ?? []) as DossierEmail[], error: null };
}

export async function queueDossierEmail(input: {
  transactionId: string; kind: string; to: string; subject: string; body: string;
  attachments: Array<{ path: string; name?: string }>; senderEmail: string; senderName: string | null; sentBy: string | null;
}): Promise<{ mail: DossierEmail | null; error: string | null }> {
  const { data, error } = await untyped.from('dossier_emails').insert({
    transaction_id: input.transactionId, kind: input.kind, to_email: input.to.trim(), subject: input.subject.trim(), body: input.body,
    attachments: input.attachments, sender_email: input.senderEmail, sender_name: input.senderName, sent_by: input.sentBy,
  }).select('*').single();
  if (error) return { mail: null, error: missingTable(error.message) ? 'SQL du 29/09 (dossier_emails) à coller avant d\'envoyer.' : error.message };
  return { mail: data as DossierEmail, error: null };
}

/** Retire une ligne en file ou en échec (jamais un envoi parti). */
export async function deleteDossierEmail(id: string): Promise<string | null> {
  const { error } = await untyped.from('dossier_emails').delete().eq('id', id).neq('status', 'sent');
  return error ? error.message : null;
}

/** Remet en file un envoi en échec — le worker le reprend dans les 20 s. */
export async function retryDossierEmail(id: string): Promise<string | null> {
  const { error } = await untyped.from('dossier_emails').update({ status: 'queued', error: null }).eq('id', id).eq('status', 'failed');
  return error ? error.message : null;
}

/** Dernier document généré d'un type pour ce dossier (certificat de cession…). */
export async function latestGeneratedDocument(transactionId: string, documentType: string): Promise<{ path: string; created_at: string } | null> {
  const { data } = await untyped.from('documents_admin_history').select('storage_path, created_at')
    .eq('transaction_id', transactionId).eq('document_type', documentType).not('storage_path', 'is', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const row = data as { storage_path: string | null; created_at: string } | null;
  return row?.storage_path ? { path: row.storage_path, created_at: row.created_at } : null;
}

/** Texte par défaut de l'e-mail 1 (cessions à signer), d'après les envois réels de Channing. */
export function buyerCessionTemplate(p: { vehicle: string; plate: string; vin: string; senderFirstName: string }): { subject: string; body: string } {
  const car = [p.vehicle, p.plate && `(${p.plate})`].filter(Boolean).join(' ');
  return {
    subject: `MC Export – cession to sign – ${car}`.trim(),
    body: `Hello,\n\nYou will find attached the cessions to sign and stamp for the ${car}${p.vin ? `, VIN ${p.vin}` : ''}.\n\nMany thanks,\n${p.senderFirstName}\nMC Export`,
  };
}

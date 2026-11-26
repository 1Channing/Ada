/**
 * E-MAILS D'UN DOSSIER (29/09, chantier e-mails — étape 3, côté front).
 * Le front ne parle jamais à Gmail : il dépose une ligne « queued » que le
 * worker envoie au nom de la personne connectée, puis lit le journal.
 */
import { supabase } from '../lib/supabase';
import { ADMIN_BUCKET } from './storageAccess';

export interface DossierEmail {
  id: string; transaction_id: string; kind: string; to_email: string; subject: string; body: string;
  attachments: Array<{ path: string; name?: string }>; status: 'queued' | 'sending' | 'sent' | 'failed'; error: string | null;
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

/** RELANCE GROUPÉE DEPUIS LA CARTE (07/11, Channing : « envoyer un mail à plusieurs personnes sans qu'ils voient les
 *  autres destinataires ») : UN e-mail par destinataire, même file, même worker, même expéditeur (la personne
 *  connectée) ; `batch_id` relie les envois d'une même relance. Sans dossier (transaction_id null — SQL du 07/11). */
export async function queueContactEmail(input: {
  contactId: string; batchId: string; to: string; subject: string; body: string; senderEmail: string; senderName: string | null; sentBy: string | null;
  /** 26/11 : PDF joints à chaque e-mail de la relance (déposés par uploadRelanceAttachment). */
  attachments?: Array<{ path: string; name?: string }>;
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await untyped.from('dossier_emails').insert({
    transaction_id: null, contact_id: input.contactId, batch_id: input.batchId, kind: 'relance_contact',
    to_email: input.to.trim(), subject: input.subject.trim(), body: input.body, attachments: input.attachments ?? [],
    sender_email: input.senderEmail, sender_name: input.senderName, sent_by: input.sentBy,
  }).select('id').single();
  if (error) return { id: null, error: /contact_id|batch_id|null value in column "transaction_id"|schema cache/i.test(error.message) ? 'Relance groupée : colle le SQL du 07/11 (relance_contacts).' : error.message };
  return { id: (data as { id: string }).id, error: null };
}

/** PIÈCE JOINTE D'UNE RELANCE GROUPÉE (26/11, Channing : « j'aimerais pouvoir ajouter un PDF aux mails ») : déposée une
 *  fois dans le storage (relances/<batch>/…), jointe par le worker à chaque e-mail de la relance. PDF seulement, 10 Mo au plus. */
export const RELANCE_ATTACHMENT_MAX_BYTES = 10_000_000;
export async function uploadRelanceAttachment(batchId: string, file: File): Promise<{ attachment: { path: string; name: string } | null; error: string | null }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return { attachment: null, error: `« ${file.name} » : PDF seulement.` };
  if (file.size > RELANCE_ATTACHMENT_MAX_BYTES) return { attachment: null, error: `« ${file.name} » dépasse 10 Mo : allège-le avant de l'envoyer.` };
  const safe = file.name.replace(/\.pdf$/i, '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'document';
  const path = `relances/${batchId}/${safe}.pdf`;
  const up = await supabase.storage.from(ADMIN_BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: true });
  if (up.error) return { attachment: null, error: /policy|security|denied|403/i.test(up.error.message) ? 'Dépôt refusé par la base : colle le SQL du 26/11 (mon_compte_relances_pj), puis réessaie.' : `Dépôt de « ${file.name} » en échec : ${up.error.message}` };
  return { attachment: { path, name: file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf` }, error: null };
}

/** E-MAIL DE TEST À SOI-MÊME (26/11, page Mon compte : « la possibilité de s'envoyer un mail à soi-même pour vérifier ») :
 *  même file, même worker, même signature que tous les envois du compte — on voit exactement ce que reçoit un contact. */
export async function queueSelfTestEmail(input: { email: string; displayName: string | null; userId: string }): Promise<{ id: string | null; error: string | null }> {
  const body = `Bonjour ${input.displayName || ''},\n\nCeci est un e-mail de test envoyé depuis Ada à ta propre adresse. Ta signature apparaît juste en dessous, telle que la voient les contacts.\n\nBien à toi,\n${input.displayName || input.email}\nMC Export`;
  const { data, error } = await untyped.from('dossier_emails').insert({
    transaction_id: null, contact_id: null, batch_id: null, kind: 'test', to_email: input.email.trim(), subject: 'Ada – test de ma signature e-mail',
    body, attachments: [], sender_email: input.email, sender_name: input.displayName, sent_by: input.userId,
  }).select('id').single();
  if (error) return { id: null, error: /policy|security|violates|403/i.test(error.message) ? 'Envoi refusé par la base : colle le SQL du 26/11 (mon_compte_relances_pj), puis réessaie.' : error.message };
  return { id: (data as { id: string }).id, error: null };
}

/** Statut d'un e-mail de la file (suivi du test). */
export async function getDossierEmailStatus(id: string): Promise<{ status: string; error: string | null; sent_at: string | null } | null> {
  const { data } = await untyped.from('dossier_emails').select('status, error, sent_at').eq('id', id).maybeSingle();
  return (data as { status: string; error: string | null; sent_at: string | null } | null) ?? null;
}

/** Les envois d'une relance groupée (statut par destinataire). */
export async function listBatchEmails(batchId: string): Promise<Array<{ id: string; to_email: string; status: string; error: string | null; sent_at: string | null }>> {
  const { data } = await untyped.from('dossier_emails').select('id, to_email, status, error, sent_at').eq('batch_id', batchId).order('created_at');
  return (data ?? []) as Array<{ id: string; to_email: string; status: string; error: string | null; sent_at: string | null }>;
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

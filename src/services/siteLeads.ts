/**
 * DEMANDES DU SITE mc-export.com : LECTURE ET TRAITEMENT DEPUIS ADA (07/11, Channing : « traiter les demandes
 * du site directement sur Ada… onglet dispo uniquement pour les administrateurs… envoyer des mails pour les
 * personnes connectées »). La table site_leads (SQL du 23/10) ; les e-mails partent par la file dossier_emails
 * (lead_id, SQL du 07/11), envoyés par le worker au nom du compte connecté.
 */
import { supabase } from '../lib/supabase';
import { leadKey, type SiteLead } from '../lib/siteLeads';

export type LeadStatus = 'nouvelle' | 'traitee' | 'ecartee';
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { nouvelle: 'À traiter', traitee: 'Traitée', ecartee: 'Écartée' };
export interface SiteLeadRow extends SiteLead { status: LeadStatus; notes: string | null; source: Record<string, unknown> | null }
export interface LeadEmail { id: string; to_email: string; subject: string; body: string; status: string; error: string | null; sender_email: string; created_at: string; sent_at: string | null }

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);

export async function listSiteLeads(): Promise<{ leads: SiteLeadRow[]; error: string | null }> {
  const { data, error } = await untyped.from('site_leads').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return { leads: [], error: missing(error.message) ? 'SQL du 23/10 (demandes_site) à coller.' : error.message };
  return { leads: (data ?? []) as SiteLeadRow[], error: null };
}

/** Change le statut ; « traitée » ou « écartée » coche aussi le rappel de la cloche (s'il est visible par ce compte). */
export async function setLeadStatus(id: string, status: LeadStatus): Promise<string | null> {
  const { error } = await untyped.from('site_leads').update({ status }).eq('id', id);
  if (error) return error.message;
  const done = status !== 'nouvelle';
  await untyped.from('user_tasks').update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null }).eq('key', leadKey(id));
  return null;
}

export async function saveLeadNotes(id: string, notes: string): Promise<string | null> {
  const { error } = await untyped.from('site_leads').update({ notes: notes.trim() || null }).eq('id', id);
  return error ? error.message : null;
}

export async function queueLeadEmail(input: { leadId: string; to: string; subject: string; body: string; senderEmail: string; senderName: string | null; sentBy: string | null }): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await untyped.from('dossier_emails').insert({
    transaction_id: null, lead_id: input.leadId, kind: 'reponse_site', to_email: input.to.trim(), subject: input.subject.trim(), body: input.body,
    attachments: [], sender_email: input.senderEmail, sender_name: input.senderName, sent_by: input.sentBy,
  }).select('id').single();
  if (error) return { id: null, error: /lead_id|null value in column "transaction_id"|schema cache|rattachement|row-level/i.test(error.message) ? 'Réponse aux demandes : colle le SQL du 07/11 (demandes_site_emails).' : error.message };
  return { id: (data as { id: string }).id, error: null };
}

export async function listLeadEmails(leadId: string): Promise<LeadEmail[]> {
  const { data } = await untyped.from('dossier_emails').select('id, to_email, subject, body, status, error, sender_email, created_at, sent_at').eq('lead_id', leadId).order('created_at', { ascending: false });
  return (data ?? []) as LeadEmail[];
}

/** Les demandes ayant déjà reçu au moins un e-mail (pour la liste). */
export async function leadsWithEmail(): Promise<Set<string>> {
  const { data } = await untyped.from('dossier_emails').select('lead_id').not('lead_id', 'is', null).limit(1000);
  return new Set(((data ?? []) as Array<{ lead_id: string }>).map((r) => r.lead_id));
}

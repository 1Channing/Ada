/**
 * ADA ET DANA — l'onglet Agents (16/10, Channing : « deux agents… des
 * adresses mails dédiées… tout leur travail dans un onglet dédié sur ADA,
 * afin que je puisse driver »). Ada (ada@mc-export.com) trouve des
 * acheteurs, Dana (dana@mc-export.com) des vendeurs.
 *
 * Phase 1 (zéro IA) : leurs boîtes branchées sur ADA. On lit les fils, on
 * écrit, et RIEN NE PART sans la validation d'un administrateur (la base
 * fige le texte validé ; le worker vérifie son empreinte, les horaires, le
 * plafond du jour et la liste « ne plus contacter » avant d'envoyer).
 * Accès : comptes MC Export avec le droit `agents` (sur autorisation).
 */
import { supabase } from '../lib/supabase';
import { replySubject } from '../lib/agents/mail';
import type { AgentTargets } from '../lib/agents/qualification';
import type { DanaTargets, LotFact } from '../lib/agents/sourcing';
import { SITE_LABEL } from './dealerDirectory';
import type { DeepEvidence } from '../lib/agents/deepResearch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
export const AGENTS_SQL_HINT = 'Agents : SQL du 16/10 (agents_socle) à coller dans Supabase.';
const missing = (m: string) => /does not exist|schema cache|relation|function .* not found/i.test(m);
const err = (m: string) => (missing(m) ? AGENTS_SQL_HINT : m);

export type AgentKey = 'ada' | 'dana';

export interface AgentSettings {
  agent: AgentKey; display_name: string; role: 'acheteurs' | 'vendeurs'; mailbox: string; sender_name: string;
  status: 'pause' | 'active'; signature: string; daily_first_contact_cap: number;
  send_days: number[]; send_from: string; send_to: string; min_gap_seconds: number; max_gap_seconds: number;
  owner_id: string | null; gmail_connected_email: string | null; gmail_connected_at: string | null;
  last_sync_at: string | null; last_sync_error: string | null; next_send_after: string | null; updated_at: string;
  // Phase 2.2 (17/10) — absents tant que le SQL agents_qualification n'est pas collé.
  // Ada : pays et marques visés ; Dana : taille d'un lot et nos pays de vente.
  // 18/10 : recherches approfondies d'office par jour (deepPerDay), gardées avec les cibles.
  targets?: (Partial<AgentTargets> & Partial<DanaTargets> & { deepPerDay?: number }) | null; daily_budget_usd?: number | string; auto_discovery?: boolean; auto_qualify_per_day?: number;
  map_auto_add?: boolean; map_min_score?: number;
  // Phase 2.3 (17/10) — SQL agents_premiers_mails.
  instructions?: string; auto_draft_per_day?: number;
  // Étape 2 (17/10) — SQL agents_recherche : recherches de comptes lancées d'office par jour.
  auto_research_per_day?: number;
}
export type EditableSettings = Pick<AgentSettings, 'sender_name' | 'signature' | 'daily_first_contact_cap' | 'send_days' | 'send_from' | 'send_to' | 'min_gap_seconds' | 'max_gap_seconds' | 'owner_id'>;

export interface AgentThread {
  id: string; agent: AgentKey; mailbox: string; gmail_thread_id: string | null; subject: string;
  counterpart_email: string | null; counterpart_name: string | null; network_contact_id: string | null;
  last_message_at: string | null; last_direction: 'in' | 'out' | null; last_classification: string | null;
  unread: boolean; archived: boolean; created_at: string;
}

// pour_channing / envoye_main (17/10, SQL agents_comptes) : préparé pour un grand compte, envoyé par Channing lui-même.
export type MessageStatus = 'brouillon' | 'a_valider' | 'valide' | 'envoi' | 'envoye' | 'echec' | 'refuse' | 'recu' | 'pour_channing' | 'envoye_main';
export type MessageKind = 'premier_contact' | 'relance' | 'reponse' | 'recu';
export interface Attachment { path: string; name: string; mime: string; size: number }
export interface AgentMessage {
  id: string; thread_id: string; agent: AgentKey; mailbox: string; channel: 'mail' | 'linkedin'; direction: 'in' | 'out';
  status: MessageStatus; kind: MessageKind; from_email: string | null; from_name: string | null;
  to_emails: string[]; cc_emails: string[]; subject: string; body_text: string; body_new: string | null; translation_fr: string | null;
  attachments: Attachment[]; classification: string | null; auto_reply: boolean; author: 'humain' | 'ada' | 'dana' | 'systeme';
  created_by: string | null; approved_by: string | null; approved_at: string | null; refused_reason: string | null; error: string | null;
  sent_at: string | null; received_at: string | null; created_at: string; updated_at: string;
  /** Brouillon d'une agente (17/10) : modèle, coût, langue, faits cités, points à vérifier ; pour un grand compte, la fiche d'appel et LinkedIn. */
  ai_notes?: {
    modele?: string; cout_usd?: number; langue?: string; mots?: number; faits?: Array<{ fait: string; source: string }>; alertes?: string[];
    grand_compte?: boolean; fiche_appel?: CallSheet | null; linkedin_url?: string | null; linkedin_nom?: string | null; linkedin_recherche?: string | null;
  } | null;
}
/** La fiche d'appel d'un grand compte, préparée pour Channing. */
export interface CallSheet { interlocuteur: string | null; pourquoi: string; accroche: string; points: string[]; questions: string[] }
export interface QueuedMessage extends AgentMessage { thread: Pick<AgentThread, 'subject' | 'counterpart_email' | 'counterpart_name'> | null }

export interface JournalRow { id: number; at: string; agent: AgentKey | null; actor: string; actor_id: string | null; kind: string; summary: string; thread_id: string | null; message_id: string | null }
export interface Suppression { email: string; reason: 'stop' | 'refus' | 'rebond' | 'plainte' | 'manuel'; agent: string | null; note: string | null; created_at: string }

export const AGENT_LABEL: Record<AgentKey, { name: string; role: string; tone: string; dot: string }> = {
  ada: { name: 'Ada', role: 'trouve des acheteurs', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200', dot: 'bg-indigo-500' },
  dana: { name: 'Dana', role: 'trouve des vendeurs', tone: 'bg-teal-50 text-teal-800 border-teal-200', dot: 'bg-teal-500' },
};

// --- Réglages et connexion des boîtes ------------------------------------------

export async function listSettings(): Promise<{ rows: AgentSettings[]; error: string | null }> {
  const { data, error } = await sb.from('agent_settings').select('*').order('agent');
  if (error) return { rows: [], error: err(error.message) };
  return { rows: (data ?? []) as AgentSettings[], error: null };
}

export async function updateSettings(agent: AgentKey, patch: Partial<EditableSettings>, userId: string | null): Promise<string | null> {
  const { error } = await sb.from('agent_settings').update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId }).eq('agent', agent);
  return error ? err(error.message) : null;
}

/** Adresse de l'écran Google pour connecter la boîte (admin). Le worker termine la connexion. */
export async function oauthUrl(agent: AgentKey): Promise<{ url: string | null; error: string | null }> {
  const returnTo = `${window.location.origin}/agents?onglet=reglages`;
  const { data, error } = await sb.rpc('agents_oauth_begin', { p_agent: agent, p_return_to: returnTo });
  if (error) return { url: null, error: err(error.message) };
  const j = data as { state: string; client_id: string; redirect_uri: string; login_hint: string };
  const q = new URLSearchParams({
    client_id: j.client_id, redirect_uri: j.redirect_uri, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.modify', access_type: 'offline', prompt: 'consent',
    login_hint: j.login_hint, state: j.state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, error: null };
}

export async function disconnectMailbox(agent: AgentKey): Promise<string | null> {
  const { error } = await sb.rpc('agents_mail_disconnect', { p_agent: agent });
  return error ? err(error.message) : null;
}

// --- Fils et messages ------------------------------------------------------------

export async function listThreads(opts: { agent?: AgentKey | null; archived?: boolean; limit?: number } = {}): Promise<{ rows: AgentThread[]; error: string | null }> {
  let q = sb.from('agent_threads').select('*').eq('archived', opts.archived ?? false)
    .order('last_message_at', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false }).limit(opts.limit ?? 200);
  if (opts.agent) q = q.eq('agent', opts.agent);
  const { data, error } = await q;
  if (error) return { rows: [], error: err(error.message) };
  return { rows: (data ?? []) as AgentThread[], error: null };
}

/** L'agente d'un fil (un lien d'alerte « /agents?fil=… » ouvre la bonne). */
export async function threadAgent(id: string): Promise<AgentKey | null> {
  const { data } = await sb.from('agent_threads').select('agent').eq('id', id).maybeSingle();
  const a = (data as { agent?: string } | null)?.agent;
  return a === 'ada' || a === 'dana' ? a : null;
}

export async function getThread(id: string): Promise<{ thread: AgentThread | null; messages: AgentMessage[]; error: string | null }> {
  const [{ data: t, error: e1 }, { data: m, error: e2 }] = await Promise.all([
    sb.from('agent_threads').select('*').eq('id', id).maybeSingle(),
    sb.from('agent_messages').select('*').eq('thread_id', id).order('created_at', { ascending: true }),
  ]);
  const e = e1 ?? e2;
  if (e) return { thread: null, messages: [], error: err(e.message) };
  return { thread: (t ?? null) as AgentThread | null, messages: (m ?? []) as AgentMessage[], error: null };
}

export interface Draft { to: string[]; cc?: string[]; subject: string; body: string }
type NewStatus = 'brouillon' | 'a_valider' | 'valide';

/** Nouvelle conversation (premier contact) depuis la boîte d'une agente. */
export async function startConversation(s: AgentSettings, d: Draft, status: NewStatus): Promise<{ threadId: string | null; error: string | null }> {
  const { data: t, error: e1 } = await sb.from('agent_threads').insert({
    agent: s.agent, mailbox: s.mailbox, subject: d.subject.trim(), counterpart_email: d.to[0] ?? null,
  }).select('id').single();
  if (e1) return { threadId: null, error: err(e1.message) };
  const threadId = (t as { id: string }).id;
  const { error: e2 } = await sb.from('agent_messages').insert({
    thread_id: threadId, agent: s.agent, mailbox: s.mailbox, direction: 'out', status, kind: 'premier_contact', author: 'humain',
    to_emails: d.to, cc_emails: d.cc ?? [], subject: d.subject.trim(), body_text: d.body,
  });
  if (e2) {
    await sb.from('agent_threads').delete().eq('id', threadId);
    return { threadId: null, error: err(e2.message) };
  }
  return { threadId, error: null };
}

/** Réponse (ou relance s'il n'a jamais répondu) dans un fil existant. */
export async function addToThread(thread: AgentThread, messages: AgentMessage[], d: Draft, status: NewStatus): Promise<string | null> {
  const answered = messages.some((m) => m.direction === 'in' && m.classification !== 'rebond' && !m.auto_reply);
  const { error } = await sb.from('agent_messages').insert({
    thread_id: thread.id, agent: thread.agent, mailbox: thread.mailbox, direction: 'out', status,
    kind: answered ? 'reponse' : 'relance', author: 'humain',
    to_emails: d.to, cc_emails: d.cc ?? [], subject: d.subject.trim(), body_text: d.body,
  });
  return error ? err(error.message) : null;
}

export async function editDraft(id: string, d: Draft): Promise<string | null> {
  const { error } = await sb.from('agent_messages').update({ to_emails: d.to, cc_emails: d.cc ?? [], subject: d.subject.trim(), body_text: d.body }).eq('id', id);
  return error ? err(error.message) : null;
}

export async function setMessageStatus(id: string, status: 'brouillon' | 'a_valider' | 'valide' | 'refuse', reason?: string): Promise<string | null> {
  const patch: Record<string, unknown> = { status };
  if (status === 'refuse') patch.refused_reason = (reason ?? '').trim() || null;
  if (status === 'brouillon') patch.error = null;
  const { error } = await sb.from('agent_messages').update(patch).eq('id', id);
  return error ? err(error.message) : null;
}

export async function deleteDraft(m: AgentMessage): Promise<string | null> {
  const { error } = await sb.from('agent_messages').delete().eq('id', m.id);
  if (error) return err(error.message);
  // Un fil qui ne contenait que ce brouillon disparaît avec lui (la base refuse si le fil a vécu).
  const { count } = await sb.from('agent_messages').select('id', { count: 'exact', head: true }).eq('thread_id', m.thread_id);
  if ((count ?? 0) === 0) await sb.from('agent_threads').delete().eq('id', m.thread_id);
  return null;
}

export async function setThreadFlags(id: string, flags: Partial<Pick<AgentThread, 'unread' | 'archived'>>): Promise<string | null> {
  const { error } = await sb.from('agent_threads').update(flags).eq('id', id);
  return error ? err(error.message) : null;
}

/** File de validation : à valider, puis validés en attente d'envoi, puis échecs. */
export async function listQueue(agent?: AgentKey): Promise<{ rows: QueuedMessage[]; error: string | null }> {
  let q = sb.from('agent_messages')
    .select('*, thread:agent_threads(subject, counterpart_email, counterpart_name)')
    .eq('direction', 'out').in('status', ['a_valider', 'valide', 'envoi', 'echec'])
    .order('created_at', { ascending: true }).limit(300);
  if (agent) q = q.eq('agent', agent);
  const { data, error } = await q;
  if (error) return { rows: [], error: err(error.message) };
  return { rows: (data ?? []) as QueuedMessage[], error: null };
}

export interface AgentCounts {
  aValider: number; enAttente: number; echecs: number; nonLus: number; recusAujourdhui: number; envoyesAujourdhui: number; premiersContactsAujourdhui: number; pourVous: number; auTravail: boolean;
  /** 18/10 : le travail du jour — fiches faites, entreprises trouvées sur le web. */
  fichesAujourdhui: number; trouvesAujourdhui: number;
}

export async function countsFor(agent: AgentKey, dayStartIso: string): Promise<AgentCounts> {
  const head = { count: 'exact', head: true };
  const q = () => sb.from('agent_messages').select('id', head).eq('agent', agent);
  const [a, w, f, u, r, s, c, v, t, fq, x] = await Promise.all([
    q().eq('status', 'a_valider'),
    q().in('status', ['valide', 'envoi']),
    q().eq('status', 'echec'),
    sb.from('agent_threads').select('id', head).eq('agent', agent).eq('unread', true).eq('archived', false),
    q().eq('direction', 'in').gte('received_at', dayStartIso),
    q().eq('status', 'envoye').gte('sent_at', dayStartIso),
    q().eq('status', 'envoye').in('kind', ['premier_contact', 'relance']).gte('sent_at', dayStartIso),
    // Grands comptes préparés pour vous (un fil = un compte ; 0 tant que le SQL agents_comptes n'est pas collé).
    sb.from('agent_messages').select('thread_id').eq('agent', agent).eq('status', 'pour_channing').limit(500),
    // Une tâche en cours : l'agente est au travail (pastille de l'onglet Live).
    sb.from('agent_tasks').select('id', head).eq('agent', agent).eq('status', 'en_cours'),
    // Le travail du jour (18/10) : 0 tant que les SQL du 17/10 ne sont pas collés.
    sb.from('agent_prospects').select('id', head).eq('agent', agent).gte('qualified_at', dayStartIso),
    sb.from('agent_accounts').select('id', head).eq('agent', agent).gte('found_at', dayStartIso),
  ]);
  const pourVous = new Set(((v.data ?? []) as Array<{ thread_id: string }>).map((m) => m.thread_id)).size;
  return {
    aValider: a.count ?? 0, enAttente: w.count ?? 0, echecs: f.count ?? 0, nonLus: u.count ?? 0, recusAujourdhui: r.count ?? 0, envoyesAujourdhui: s.count ?? 0, premiersContactsAujourdhui: c.count ?? 0,
    pourVous, auTravail: (t.count ?? 0) > 0, fichesAujourdhui: fq.count ?? 0, trouvesAujourdhui: x.count ?? 0,
  };
}

export async function listJournal(agent: AgentKey | null, limit = 200): Promise<{ rows: JournalRow[]; error: string | null }> {
  let q = sb.from('agent_journal').select('*').order('at', { ascending: false }).limit(limit);
  if (agent) q = q.eq('agent', agent);
  const { data, error } = await q;
  if (error) return { rows: [], error: err(error.message) };
  return { rows: (data ?? []) as JournalRow[], error: null };
}

// --- Ne plus contacter ---------------------------------------------------------------

export async function listSuppressions(): Promise<{ rows: Suppression[]; error: string | null }> {
  const { data, error } = await sb.from('email_suppressions').select('*').order('created_at', { ascending: false }).limit(1000);
  if (error) return { rows: [], error: err(error.message) };
  return { rows: (data ?? []) as Suppression[], error: null };
}

export async function addSuppression(email: string, reason: Suppression['reason'], note: string, agent: AgentKey | null, userId: string | null): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]*@[^\s@]+\.[^\s@]+$/.test(e)) return 'Une adresse (jean@garage.fr) ou un domaine entier (@garage.fr).';
  const { error } = await sb.from('email_suppressions').upsert({ email: e, reason, note: note.trim() || null, agent, created_by: userId }, { onConflict: 'email' });
  return error ? err(error.message) : null;
}

export async function removeSuppression(email: string): Promise<string | null> {
  const { error } = await sb.from('email_suppressions').delete().eq('email', email);
  return error ? err(error.message) : null;
}

export async function attachmentUrl(path: string): Promise<string | null> {
  const { data } = await sb.storage.from('agent-mail').createSignedUrl(path, 600);
  return (data as { signedUrl?: string } | null)?.signedUrl ?? null;
}

/** Texte de départ d'un message : deux lignes vides puis la signature de l'agente. */
export const withSignature = (s: AgentSettings) => `\n\n${s.signature.trim()}`;

/** Brouillon de réponse dans un fil : destinataire et objet repris. */
export function replyDraft(thread: AgentThread, messages: AgentMessage[], s: AgentSettings): Draft {
  const lastIn = [...messages].reverse().find((m) => m.direction === 'in' && m.from_email && !m.auto_reply && m.classification !== 'rebond');
  const to = lastIn?.from_email ?? thread.counterpart_email ?? '';
  return { to: to ? [to] : [], subject: replySubject(thread.subject), body: withSignature(s) };
}

// --- Phase 2 (17/10) : l'annuaire des concessions d'Ada -------------------------------

export interface DealerRow {
  id: string; name: string; country: string | null; city: string | null; zip: string | null; street: string | null;
  phone: string | null; contact_name: string | null; site_url: string | null; imprint_url: string | null; website: string | null;
  first_seen_at: string; last_seen_at: string; listings: number; listings_brand: number; nb_brands: number; vans: number;
  brands: string[] | null; median_price: number | null; last_listing_at: string | null; is_client: boolean; in_network: boolean;
  /** Qualification d'Ada (SQL du 17/10 agents_qualification) ; null = pas encore qualifié. */
  prospect?: DealerProspect | null;
  /** Tous sites (SQL du 17/10 agents_tous_sites) : le site de la fiche principale, toutes les
   *  fiches du garage (le même garage vu sur d'autres sites), sa position, son SIREN. */
  site?: string; sites?: string[]; members?: DealerMember[]; lat?: number | null; lng?: number | null; legal_id?: string | null;
}
/** Une fiche du garage sur un site d'annonces. */
export interface DealerMember { id: string; site: string; name: string; site_url: string | null; imprint_url: string | null; website: string | null; phone: string | null; city: string | null }
export interface DealerListing { dealer_id: string; listing_url: string; brand: string | null; model: string | null; title: string | null; year: number | null; mileage: number | null; fuel: string | null; vehicle_type: string | null; price_eur: number | null; last_seen_at: string }
export interface SalesProfile { countries: Array<{ country: string; n: number }>; brands: Array<{ brand: string; n: number }> }
/** Le suivi d'une tâche en cours : l'étape du moment, le compte (3 sur 10), les dernières étapes. */
export interface TaskLive { step: string; done: number | null; total: number | null; log: Array<{ at: string; text: string }> }

export interface AgentTask {
  id: string; agent: AgentKey; kind: 'decouverte_concessions' | 'qualification' | 'premier_mail' | 'recherche_comptes';
  params: { site?: string; country?: string; brand?: string; model?: string; vans?: boolean; pages?: number; dealer_ids?: string[]; account_ids?: string[]; prospect_ids?: string[]; segment?: string; auto?: boolean;
    /** 18/10 : une série de fiches à approfondir (prospect_ids), pas à préparer. */
    approfondie?: boolean };
  status: 'en_attente' | 'en_cours' | 'terminee' | 'echec' | 'annulee';
  result: {
    annonces?: number; avec_garage?: number; concessions?: number; nouvelles?: number; url?: string; site?: string; garages?: number; comptes?: number | string[]; qualifies?: number; ecartes?: number; echecs?: number; carte?: number;
    cout_usd?: number; arret?: string | null; rediges?: number; ignores?: number; details?: string[];
    // Recherche de comptes (étape 2).
    trouves?: number; gardes?: number; deja?: number; remarque?: string | null;
    // Recherche approfondie (18/10).
    enrichies?: number; rien?: number; preparees?: number;
    // En cours (17/10) : où la tâche en est, écrit par le worker pour l'onglet Live.
    live?: TaskLive;
  } | null;
  error: string | null; created_by: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}
/** La qualification d'un garage telle que l'annuaire la porte (dealer_id : la fiche qualifiée, tous sites). */
export interface DealerProspect { id: string; dealer_id?: string; stage: ProspectStage; score: number | null; kind: string | null; qualified_at: string | null; email: string | null; in_map: boolean }
export type ProspectStage = 'qualifie' | 'ecarte' | 'a_contacter' | 'contacte' | 'repondu' | 'interesse' | 'client' | 'perdu';
/** La fiche complète d'un garage qualifié par Ada ou Dana. */
export interface ProspectDetail {
  id: string; agent?: AgentKey; dealer_id: string | null; name: string; website: string | null; legal_name: string | null; group_name: string | null; sites: number | null;
  kind: string | null; brands_official: string[]; emails: Array<{ email: string; nature: string; source: string; mx: boolean }>;
  /** La recherche approfondie (18/10) ajoute le téléphone, le périmètre (groupe, pays, site) et sa marque (via « approfondie »). */
  people: Array<{ nom: string; fonction: string; email: string | null; source: string; linkedin?: string | null; telephone?: string | null; perimetre?: string | null; via?: string }>;
  best_contact: { nom: string | null; fonction: string | null; email: string | null; pourquoi: string; linkedin?: string | null; telephone?: string | null } | null;
  phone?: string | null; country?: string | null; city?: string | null;
  /** SQL agents_comptes (17/10) : grand compte (préparé pour Channing), nature du compte, lots vus par Dana. */
  key_account?: boolean; account_kind?: string | null; lots?: LotFact[];
  /** SQL agents_recherche (17/10) : l'entreprise trouvée par recherche web. */
  account_id?: string | null;
  language: string | null; fit_score: number | null; fit_parts: Array<{ label: string; points: number }>; score: number | null; summary: string | null;
  exclusion_reason: string | null; evidence: DeepEvidence[]; stage: ProspectStage; qualified_at: string | null; qualify_cost_usd: number | string;
  network_contact_id: string | null; notes: string;
}
export type AiSpend = Partial<Record<AgentKey, { today: number; month: number; runs_today: number }>>;
export type AiSettingsPatch = Required<Pick<AgentSettings, 'targets' | 'daily_budget_usd' | 'auto_discovery' | 'auto_qualify_per_day' | 'map_auto_add' | 'map_min_score'>>;
export const QUALIF_SQL_HINT = 'Qualification par l\'IA : SQL du 17/10 (agents_qualification) à coller dans Supabase.';
const errQualif = (m: string) => (missing(m) || /column .* does not exist|agents_ai_spend|agent_prospects|agent_runs|kind_check/i.test(m) ? QUALIF_SQL_HINT : m);
export const ANNUAIRE_SQL_HINT = 'Annuaire : SQL du 17/10 (agents_annuaire) à coller dans Supabase.';
export const SITES_SQL_HINT = 'Un même garage vu sur plusieurs sites apparaît encore plusieurs fois : SQL du 17/10 (agents_tous_sites) à coller dans Supabase.';
const errAnnuaire = (m: string) => (missing(m) ? ANNUAIRE_SQL_HINT : m);
/** Un calcul trop long pour la base (plus de 8 s) : l'annuaire et les lots se précalculent avec le SQL agents_index. */
export const INDEX_SQL_HINT = 'SQL du 17/10 (agents_index) à coller dans Supabase : l\'annuaire et les lots seront précalculés par le serveur.';
const slow = (what: string, m: string) => (/statement timeout|57014/i.test(m) ? `${what} : la base a mis trop de temps à répondre. ${INDEX_SQL_HINT}` : m);

export async function listDealers(f: { country?: string | null; brand?: string | null; query?: string | null; days?: number; limit?: number; exclude?: string[] }): Promise<{ rows: DealerRow[]; error: string | null }> {
  const args = { p_country: f.country || null, p_brand: f.brand || null, p_query: f.query?.trim() || null, p_days: f.days ?? 90, p_limit: f.limit ?? 300 };
  const exclude = (f.exclude ?? []).map((c) => c.toUpperCase());
  const first = await sb.rpc('agents_dealer_directory', exclude.length ? { ...args, p_exclude_countries: exclude } : args);
  if (!first.error) return { rows: (first.data ?? []) as DealerRow[], error: null };
  // SQL du 17/10 (agents_lots) pas encore collé : l'annuaire d'avant, trié ici.
  if (!exclude.length || !/p_exclude_countries|function|schema cache/i.test(first.error.message)) return { rows: [], error: slow('Annuaire', errAnnuaire(first.error.message)) };
  const { data, error } = await sb.rpc('agents_dealer_directory', args);
  if (error) return { rows: [], error: errAnnuaire(error.message) };
  return { rows: ((data ?? []) as DealerRow[]).filter((d) => !exclude.includes((d.country ?? '').toUpperCase())), error: null };
}

export async function dealerListings(dealerIds: string[], days = 90): Promise<DealerListing[]> {
  if (dealerIds.length === 0) return [];
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const out: DealerListing[] = [];
  for (let i = 0; i < dealerIds.length; i += 100) {
    const { data } = await sb.from('market_dealer_listings')
      .select('dealer_id, listing_url, brand, model, title, year, mileage, fuel, vehicle_type, price_eur, last_seen_at')
      .in('dealer_id', dealerIds.slice(i, i + 100)).gte('last_seen_at', since).order('last_seen_at', { ascending: false }).limit(5000);
    out.push(...((data ?? []) as DealerListing[]));
  }
  return out;
}

export async function salesProfile(): Promise<SalesProfile | null> {
  const { data, error } = await sb.rpc('agents_sales_profile');
  if (error || !data) return null;
  return data as SalesProfile;
}

/** Nos offres du moment (la vitrine des bonnes affaires), pour « plus cher que nous ». */
export async function ourOffers(): Promise<Array<{ id: string; brand: string; model: string; year: number | null; km: number | null; priceHt: number | null; title: string }>> {
  const { data } = await sb.from('intra_showcase').select('id, vehicle, price_ht, title').limit(500);
  return ((data ?? []) as Array<{ id: string; vehicle: { brand?: string; model?: string; year?: number | null; km?: number | null }; price_ht: number | null; title: string | null }>)
    .map((r) => ({ id: r.id, brand: r.vehicle?.brand ?? '', model: r.vehicle?.model ?? '', year: r.vehicle?.year ?? null, km: r.vehicle?.km ?? null, priceHt: r.price_ht, title: (r.title ?? '').trim() || `${r.vehicle?.brand ?? ''} ${r.vehicle?.model ?? ''}`.trim() }));
}

export async function listTasks(limit = 15, agent?: AgentKey): Promise<{ rows: AgentTask[]; error: string | null }> {
  let q = sb.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(limit);
  if (agent) q = q.eq('agent', agent);
  const { data, error } = await q;
  if (error) return { rows: [], error: errAnnuaire(error.message) };
  return { rows: (data ?? []) as AgentTask[], error: null };
}

export async function queueDiscovery(params: { site?: string; country: string; brand: string; model?: string; vans?: boolean; pages?: number }, userId: string | null): Promise<string | null> {
  const { error } = await sb.from('agent_tasks').insert({ agent: 'ada', kind: 'decouverte_concessions', params, created_by: userId });
  return error ? errAnnuaire(error.message) : null;
}

export async function cancelTask(id: string): Promise<string | null> {
  const { error } = await sb.from('agent_tasks').update({ status: 'annulee' }).eq('id', id);
  return error ? errAnnuaire(error.message) : null;
}

/** Coordonnées d'une adresse (OpenStreetMap), pour placer le garage sur la carte. Null si introuvable. */
async function geocode(d: DealerRow): Promise<{ lat: number; lng: number } | null> {
  try {
    const q = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: (d.country ?? '').toLowerCase() });
    if (d.zip) q.set('postalcode', d.zip.replace(/\s+[A-Z]{2}$/i, '').trim());
    if (d.city) q.set('city', d.city);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { 'accept-language': 'fr' } });
    const j = (await res.json()) as Array<{ lat: string; lon: string }>;
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  } catch { return null; }
}

/** Ajoute un garage de l'annuaire à la carte du réseau (acheteur potentiel, badge « IA · Ada »). */
export async function addDealerToMap(d: DealerRow, userId: string | null): Promise<{ placed: boolean; error: string | null }> {
  // La position donnée par l'annonce d'abord (Marktplaats, Blocket, Leboncoin…), sinon OpenStreetMap.
  const at = d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : await geocode(d);
  const brands = (d.brands ?? []).slice(0, 6).map((b) => b.charAt(0) + b.slice(1).toLowerCase()).join(', ');
  const sources = (d.sites ?? [d.site ?? 'autoscout24']).map((x) => SITE_LABEL[x] ?? x).join(', ');
  // Un lien de redirection Gaspedaal n'est pas un site web.
  const page = d.site_url && !/api\.gaspedaal\.nl\/redirect\//.test(d.site_url) ? d.site_url : null;
  const { error } = await sb.from('network_contacts').insert({
    name: d.name, kind: 'concession', role: 'acheteur', country: (d.country ?? 'FR').toUpperCase(), city: d.city,
    lat: at?.lat ?? null, lng: at?.lng ?? null, contact_name: d.contact_name, phone: d.phone,
    website: d.website ?? page, relation: 'nouveau', vehicle_types: brands,
    comment: `Trouvé par Ada dans l'annuaire (${sources}) : ${d.listings} annonce${d.listings > 1 ? 's' : ''} sur 90 jours.`,
    source: 'ada', ai_added_at: new Date().toISOString(), created_by: userId,
  });
  if (error) return { placed: false, error: /row-level security|permission/i.test(error.message) ? 'Ajout refusé : il faut le droit « Carte du réseau · édition ».' : error.message };
  return { placed: !!at, error: null };
}

// --- Dana (17/10) : les lots de véhicules identiques -------------------------------------------

/** Un lot : plusieurs véhicules identiques (marque, modèle, année) chez un même garage, tous pays. */
export interface DealerLot {
  dealer: { id: string; name: string; country: string | null; city: string | null; zip: string | null; phone: string | null; site: string | null; site_url: string | null; imprint_url: string | null; website: string | null };
  members: Array<{ id: string; site: string; site_url: string | null }>;
  brand: string; model: string; year: number; count: number;
  price_min: number; price_max: number; price_median: number; km_min: number | null; km_max: number | null; fuels: string[] | null;
  first_seen_at: string; last_seen_at: string; urls: string[];
  /** Ce que ces véhicules valent dans nos pays de vente (médiane, nombre d'annonces, écart brut). */
  markets: Array<{ market: string; n: number; median: number; gap: number }>;
  /** La fiche de Dana pour ce garage (SQL agents_comptes), ou null s'il n'est pas encore qualifié. */
  prospect?: { id: string; dealer_id: string; stage: ProspectStage; score: number | null; key_account: boolean; email: string | null; qualified_at: string | null } | null;
}
export const LOTS_SQL_HINT = 'Lots de Dana : SQL du 17/10 (agents_tous_sites puis agents_lots) à coller dans Supabase.';

export async function listLots(f: { country?: string | null; markets: string[]; min?: number; days?: number; brand?: string | null; limit?: number }): Promise<{ rows: DealerLot[]; error: string | null }> {
  const { data, error } = await sb.rpc('agents_dealer_lots', {
    p_country: f.country || null, p_markets: f.markets, p_min: f.min ?? 3, p_days: f.days ?? 45, p_brand: f.brand?.trim() || null, p_limit: f.limit ?? 200,
  });
  if (error) return { rows: [], error: missing(error.message) || /agents_dealer_lots|function/i.test(error.message) ? LOTS_SQL_HINT : slow('Lots de Dana', error.message) };
  return { rows: (data ?? []) as DealerLot[], error: null };
}

/** L'heure du dernier calcul de l'annuaire et des lots (null tant que le SQL agents_index n'est pas collé). */
export async function indexMeta(): Promise<{ computed_at: string; dealers: number; lots: number; refs: number } | null> {
  const { data, error } = await sb.from('agent_index_meta').select('computed_at, dealers, lots, refs').maybeSingle();
  if (error || !data?.computed_at) return null;
  return data as { computed_at: string; dealers: number; lots: number; refs: number };
}

/** Dana pose une découverte (tous pays, la France comprise) : ses garages et leurs lots entrent dans l'annuaire. */
export async function queueDanaDiscovery(params: { site?: string; country: string; brand: string; model?: string; pages?: number }, userId: string | null): Promise<string | null> {
  const { error } = await sb.from('agent_tasks').insert({ agent: 'dana', kind: 'decouverte_concessions', params, created_by: userId });
  return error ? errAnnuaire(error.message) : null;
}

/** Un garage qui a un lot entre sur la carte du réseau comme vendeur (badge « IA · Dana »). */
export async function addLotDealerToMap(l: DealerLot, userId: string | null): Promise<{ placed: boolean; error: string | null }> {
  const at = await geocode({ country: l.dealer.country, zip: l.dealer.zip, city: l.dealer.city } as DealerRow);
  const page = l.dealer.site_url && !/api\.gaspedaal\.nl\/redirect\//.test(l.dealer.site_url) ? l.dealer.site_url : null;
  const { error } = await sb.from('network_contacts').insert({
    name: l.dealer.name, kind: 'concession', role: 'vendeur', country: (l.dealer.country ?? 'FR').toUpperCase(), city: l.dealer.city,
    lat: at?.lat ?? null, lng: at?.lng ?? null, phone: l.dealer.phone, website: l.dealer.website ?? page, relation: 'nouveau',
    vehicle_types: `${l.brand.charAt(0)}${l.brand.slice(1).toLowerCase()} ${l.model}`,
    comment: `Repéré par Dana : ${l.count} ${l.brand} ${l.model} ${l.year} identiques en stock (${Math.round(l.price_min).toLocaleString('fr-FR')} à ${Math.round(l.price_max).toLocaleString('fr-FR')} €).`.slice(0, 1000),
    source: 'dana', ai_added_at: new Date().toISOString(), created_by: userId,
  });
  if (error) return { placed: false, error: /row-level security|permission/i.test(error.message) ? 'Ajout refusé : il faut le droit « Carte du réseau · édition ».' : error.message };
  return { placed: !!at, error: null };
}

// --- Phase 2.2 (17/10) : la qualification par l'IA ------------------------------------------

/** Qualifier des garages (Ada : acheteurs ; Dana : fournisseurs) : une tâche par série de 10 (le worker les traite une à une). */
export async function queueQualification(dealerIds: string[], userId: string | null, agent: AgentKey = 'ada'): Promise<string | null> {
  const ids = [...new Set(dealerIds)];
  for (let i = 0; i < ids.length; i += 10) {
    const { error } = await sb.from('agent_tasks').insert({ agent, kind: 'qualification', params: { dealer_ids: ids.slice(i, i + 10) }, created_by: userId });
    if (error) return errQualif(error.message);
  }
  return null;
}

/** Les fiches d'une agente pour ces garages (un même garage peut être un acheteur pour Ada et un fournisseur pour Dana). */
export async function prospectDetails(dealerIds: string[], agent: AgentKey = 'ada'): Promise<ProspectDetail[]> {
  if (dealerIds.length === 0) return [];
  const out: ProspectDetail[] = [];
  for (let i = 0; i < dealerIds.length; i += 100) {
    const { data } = await sb.from('agent_prospects').select('*').eq('agent', agent).in('dealer_id', dealerIds.slice(i, i + 100));
    out.push(...((data ?? []) as ProspectDetail[]));
  }
  return out;
}

export async function setProspectStage(id: string, stage: ProspectStage): Promise<string | null> {
  const { error } = await sb.from('agent_prospects').update({ stage, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? errQualif(error.message) : null;
}

/** Dépense IA du jour et du mois, par agente (null tant que le SQL n'est pas collé). */
/** Un appel à l'IA tel que l'onglet Live le montre (sans le texte : rien de ce qui est envoyé à l'IA n'est relu ici). */
export interface AiRun { id: string; purpose: string; task_id: string | null; prospect_id: string | null; web_searches: number; web_fetches: number; cost_usd: number | string; stop_reason: string | null; error: string | null; created_at: string }

export async function listRuns(agent: AgentKey, limit = 30): Promise<{ rows: AiRun[]; error: string | null }> {
  const { data, error } = await sb.from('agent_runs').select('id, purpose, task_id, prospect_id, web_searches, web_fetches, cost_usd, stop_reason, error, created_at')
    .eq('agent', agent).order('created_at', { ascending: false }).limit(limit);
  if (error) return { rows: [], error: errQualif(error.message) };
  return { rows: (data ?? []) as AiRun[], error: null };
}

export async function aiSpend(): Promise<AiSpend | null> {
  const { data, error } = await sb.rpc('agents_ai_spend');
  if (error || !data) return null;
  return data as AiSpend;
}

export async function updateAiSettings(agent: AgentKey, patch: AiSettingsPatch, userId: string | null): Promise<string | null> {
  const { error } = await sb.from('agent_settings').update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId }).eq('agent', agent);
  return error ? errQualif(error.message) : null;
}

// --- Phase 2.3 (17/10) : les premiers mails d'Ada ----------------------------------------------

export const MAILS_SQL_HINT = 'Premiers mails d\'Ada : SQL du 17/10 (agents_premiers_mails) à coller dans Supabase.';
const errMails = (m: string) => (missing(m) || /prospect_id|ai_notes|instructions|auto_draft_per_day|kind_check/i.test(m) ? MAILS_SQL_HINT : m);

/**
 * L'agente rédige le premier contact de ces prospects (5 par tâche) : un petit
 * compte arrive dans « À valider », un grand compte dans « Pour vous ».
 */
export async function queueFirstMails(prospectIds: string[], userId: string | null, agent: AgentKey = 'ada'): Promise<string | null> {
  const ids = [...new Set(prospectIds)];
  for (let i = 0; i < ids.length; i += 5) {
    const { error } = await sb.from('agent_tasks').insert({ agent, kind: 'premier_mail', params: { prospect_ids: ids.slice(i, i + 5) }, created_by: userId });
    if (error) return errMails(error.message);
  }
  return null;
}

/** Le fil de chaque prospect (s'il y en a un). */
export async function threadsOfProspects(prospectIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (prospectIds.length === 0) return out;
  const { data } = await sb.from('agent_threads').select('id, prospect_id').in('prospect_id', prospectIds.slice(0, 300));
  for (const r of (data ?? []) as Array<{ id: string; prospect_id: string }>) if (!out.has(r.prospect_id)) out.set(r.prospect_id, r.id);
  return out;
}

export async function updateMailSettings(agent: AgentKey, patch: { instructions: string; auto_draft_per_day: number }, userId: string | null): Promise<string | null> {
  const { error } = await sb.from('agent_settings').update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId }).eq('agent', agent);
  return error ? errMails(error.message) : null;
}

// --- Grands comptes (17/10) : préparé pour vous, envoyé par vous ------------------------------

export const COMPTES_SQL_HINT = 'Grands comptes et Dana : SQL du 17/10 (agents_comptes) à coller dans Supabase.';
const errComptes = (m: string) => (missing(m) || /pour_channing|envoye_main|status_check|key_account/i.test(m) ? COMPTES_SQL_HINT : m);

/** Le grand compte d'un envoi préparé : ce qu'il faut pour appeler, écrire, inviter. */
export interface ForYouProspect {
  id: string; name: string; country: string | null; city: string | null; phone: string | null; website: string | null;
  group_name: string | null; kind: string | null; account_kind: string | null; score: number | null; summary: string | null; stage: ProspectStage;
  best_contact: ProspectDetail['best_contact']; people: ProspectDetail['people'];
  /** 18/10 : ce qui manque se lit dans les e-mails ; les pistes de la recherche approfondie dans les pages lues. */
  emails?: ProspectDetail['emails']; evidence?: ProspectDetail['evidence'];
}
export interface ForYouMessage extends AgentMessage {
  thread: (Pick<AgentThread, 'subject' | 'counterpart_email' | 'counterpart_name'> & { prospect_id: string | null; prospect: ForYouProspect | null }) | null;
}

/** Ce qu'Ada et Dana ont préparé pour vous (grands comptes) : mails, notes LinkedIn et fiches d'appel, à envoyer vous-même. */
export async function listForYou(agent?: AgentKey): Promise<{ rows: ForYouMessage[]; error: string | null }> {
  let q = sb.from('agent_messages')
    .select('*, thread:agent_threads(subject, counterpart_email, counterpart_name, prospect_id, prospect:agent_prospects(id, name, country, city, phone, website, group_name, kind, account_kind, score, summary, stage, best_contact, people, emails, evidence))')
    .eq('status', 'pour_channing').order('created_at', { ascending: true }).limit(300);
  if (agent) q = q.eq('agent', agent);
  const { data, error } = await q;
  if (error) {
    // SQL agents_comptes pas encore collé : rien n'a pu être préparé, la file reste vide.
    if (/account_kind|key_account/i.test(error.message) || missing(error.message)) return { rows: [], error: null };
    return { rows: [], error: error.message };
  }
  return { rows: (data ?? []) as ForYouMessage[], error: null };
}

/** Vous l'avez envoyé (votre boîte, votre LinkedIn) : le message est figé, le prospect passe « contacté ». */
export async function markSentByHand(id: string): Promise<string | null> {
  const { error } = await sb.from('agent_messages').update({ status: 'envoye_main' }).eq('id', id);
  return error ? errComptes(error.message) : null;
}

/** Un lien Gmail qui ouvre le mail prêt à partir, dans votre boîte. */
export const gmailComposeUrl = (to: string[], subject: string, body: string) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to.join(','))}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

// --- Étape 2 (17/10) : la recherche de comptes ------------------------------------------------

export const RECHERCHE_SQL_HINT = 'Recherche de comptes : SQL du 17/10 (agents_recherche) à coller dans Supabase.';
const errRecherche = (m: string) => (missing(m) || /agent_accounts|account_id|recherche_comptes|kind_check|auto_research_per_day/i.test(m) ? RECHERCHE_SQL_HINT : m);

/** Une entreprise trouvée par une recherche web (leasing, loueur, flotte, groupe, négociant B2B, revendeur). */
export interface AgentAccount {
  id: string; agent: AgentKey; segment: string; country: string | null; name: string; website: string; city: string | null;
  size_hint: string | null; why: string | null; sources: string[]; status: 'nouveau' | 'qualifie' | 'ecarte';
  task_id: string | null; prospect_id: string | null; found_at: string; updated_at: string;
}

export async function listAccounts(agent?: AgentKey): Promise<{ rows: AgentAccount[]; error: string | null }> {
  let q = sb.from('agent_accounts').select('*').order('found_at', { ascending: false }).limit(1000);
  if (agent) q = q.eq('agent', agent);
  const { data, error } = await q;
  if (error) return { rows: [], error: errRecherche(error.message) };
  return { rows: (data ?? []) as AgentAccount[], error: null };
}

/** Les fiches des comptes (une par agente et par compte). */
export async function accountProspects(accountIds: string[]): Promise<ProspectDetail[]> {
  if (accountIds.length === 0) return [];
  const out: ProspectDetail[] = [];
  for (let i = 0; i < accountIds.length; i += 100) {
    const { data } = await sb.from('agent_prospects').select('*').in('account_id', accountIds.slice(i, i + 100));
    out.push(...((data ?? []) as ProspectDetail[]));
  }
  return out;
}

/** Une agente cherche sur le web un type de compte dans un pays (Haiku 5.5, 4 recherches au plus). */
export async function queueResearch(agent: AgentKey, params: { segment: string; country: string }, userId: string | null): Promise<string | null> {
  const { error } = await sb.from('agent_tasks').insert({ agent, kind: 'recherche_comptes', params, created_by: userId });
  return error ? errRecherche(error.message) : null;
}

/** Qualifier des comptes trouvés par recherche : une tâche par série de 10. */
export async function queueAccountQualification(accountIds: string[], userId: string | null, agent: AgentKey): Promise<string | null> {
  const ids = [...new Set(accountIds)];
  for (let i = 0; i < ids.length; i += 10) {
    const { error } = await sb.from('agent_tasks').insert({ agent, kind: 'qualification', params: { account_ids: ids.slice(i, i + 10) }, created_by: userId });
    if (error) return errRecherche(error.message);
  }
  return null;
}

/** Écarter un compte (ou le remettre à qualifier). */
export async function setAccountStatus(id: string, status: 'nouveau' | 'ecarte'): Promise<string | null> {
  const { error } = await sb.from('agent_accounts').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? errRecherche(error.message) : null;
}

export async function updateResearchSettings(agent: AgentKey, perDay: number, userId: string | null): Promise<string | null> {
  const { error } = await sb.from('agent_settings').update({ auto_research_per_day: perDay, updated_at: new Date().toISOString(), updated_by: userId }).eq('agent', agent);
  return error ? errRecherche(error.message) : null;
}

// --- 18/10 : la recherche approfondie et les grands comptes à compléter -------------------------------

/** L'agente va plus loin sur ces fiches (5 par tâche) : à qui appartient l'entreprise, qui décide, comment l'approcher. */
export async function queueDeepResearch(prospectIds: string[], userId: string | null, agent: AgentKey): Promise<string | null> {
  const ids = [...new Set(prospectIds)];
  for (let i = 0; i < ids.length; i += 5) {
    const { error } = await sb.from('agent_tasks').insert({ agent, kind: 'qualification', params: { prospect_ids: ids.slice(i, i + 5), approfondie: true }, created_by: userId });
    if (error) return errQualif(error.message);
  }
  return null;
}

/** Les grands comptes de l'agente qui ont leur fiche (qualifiés ou à contacter), les mieux notés d'abord. */
export async function listKeyAccounts(agent: AgentKey): Promise<{ rows: ProspectDetail[]; error: string | null }> {
  const { data, error } = await sb.from('agent_prospects').select('*').eq('agent', agent).eq('key_account', true)
    .in('stage', ['qualifie', 'a_contacter']).order('score', { ascending: false, nullsFirst: false }).limit(300);
  if (error) {
    // SQL agents_comptes pas encore collé : pas de grand compte.
    if (/key_account/i.test(error.message) || missing(error.message)) return { rows: [], error: null };
    return { rows: [], error: error.message };
  }
  return { rows: (data ?? []) as ProspectDetail[], error: null };
}

/** Les fiches en travail (tâches en attente ou en cours) : en recherche approfondie, ou en préparation de leur premier contact. */
export async function prospectWork(agent: AgentKey): Promise<{ deep: Set<string>; draft: Set<string> }> {
  const { data } = await sb.from('agent_tasks').select('kind, params').eq('agent', agent).in('kind', ['qualification', 'premier_mail']).in('status', ['en_attente', 'en_cours']).limit(100);
  const rows = (data ?? []) as Array<{ kind: string; params: { approfondie?: boolean; prospect_ids?: string[] } | null }>;
  return {
    deep: new Set(rows.filter((t) => t.kind === 'qualification' && t.params?.approfondie).flatMap((t) => t.params?.prospect_ids ?? [])),
    draft: new Set(rows.filter((t) => t.kind === 'premier_mail').flatMap((t) => t.params?.prospect_ids ?? [])),
  };
}

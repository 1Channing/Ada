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
}
export type EditableSettings = Pick<AgentSettings, 'sender_name' | 'signature' | 'daily_first_contact_cap' | 'send_days' | 'send_from' | 'send_to' | 'min_gap_seconds' | 'max_gap_seconds' | 'owner_id'>;

export interface AgentThread {
  id: string; agent: AgentKey; mailbox: string; gmail_thread_id: string | null; subject: string;
  counterpart_email: string | null; counterpart_name: string | null; network_contact_id: string | null;
  last_message_at: string | null; last_direction: 'in' | 'out' | null; last_classification: string | null;
  unread: boolean; archived: boolean; created_at: string;
}

export type MessageStatus = 'brouillon' | 'a_valider' | 'valide' | 'envoi' | 'envoye' | 'echec' | 'refuse' | 'recu';
export type MessageKind = 'premier_contact' | 'relance' | 'reponse' | 'recu';
export interface Attachment { path: string; name: string; mime: string; size: number }
export interface AgentMessage {
  id: string; thread_id: string; agent: AgentKey; mailbox: string; channel: 'mail' | 'linkedin'; direction: 'in' | 'out';
  status: MessageStatus; kind: MessageKind; from_email: string | null; from_name: string | null;
  to_emails: string[]; cc_emails: string[]; subject: string; body_text: string; body_new: string | null; translation_fr: string | null;
  attachments: Attachment[]; classification: string | null; auto_reply: boolean; author: 'humain' | 'ada' | 'dana' | 'systeme';
  created_by: string | null; approved_by: string | null; approved_at: string | null; refused_reason: string | null; error: string | null;
  sent_at: string | null; received_at: string | null; created_at: string; updated_at: string;
}
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
export async function listQueue(): Promise<{ rows: QueuedMessage[]; error: string | null }> {
  const { data, error } = await sb.from('agent_messages')
    .select('*, thread:agent_threads(subject, counterpart_email, counterpart_name)')
    .eq('direction', 'out').in('status', ['a_valider', 'valide', 'envoi', 'echec'])
    .order('created_at', { ascending: true }).limit(300);
  if (error) return { rows: [], error: err(error.message) };
  return { rows: (data ?? []) as QueuedMessage[], error: null };
}

export interface AgentCounts { aValider: number; enAttente: number; echecs: number; nonLus: number; recusAujourdhui: number; envoyesAujourdhui: number; premiersContactsAujourdhui: number }

export async function countsFor(agent: AgentKey, dayStartIso: string): Promise<AgentCounts> {
  const head = { count: 'exact', head: true };
  const q = () => sb.from('agent_messages').select('id', head).eq('agent', agent);
  const [a, w, f, u, r, s, c] = await Promise.all([
    q().eq('status', 'a_valider'),
    q().in('status', ['valide', 'envoi']),
    q().eq('status', 'echec'),
    sb.from('agent_threads').select('id', head).eq('agent', agent).eq('unread', true).eq('archived', false),
    q().eq('direction', 'in').gte('received_at', dayStartIso),
    q().eq('status', 'envoye').gte('sent_at', dayStartIso),
    q().eq('status', 'envoye').in('kind', ['premier_contact', 'relance']).gte('sent_at', dayStartIso),
  ]);
  return { aValider: a.count ?? 0, enAttente: w.count ?? 0, echecs: f.count ?? 0, nonLus: u.count ?? 0, recusAujourdhui: r.count ?? 0, envoyesAujourdhui: s.count ?? 0, premiersContactsAujourdhui: c.count ?? 0 };
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
}
export interface DealerListing { dealer_id: string; listing_url: string; brand: string | null; model: string | null; title: string | null; year: number | null; mileage: number | null; fuel: string | null; vehicle_type: string | null; price_eur: number | null; last_seen_at: string }
export interface SalesProfile { countries: Array<{ country: string; n: number }>; brands: Array<{ brand: string; n: number }> }
export interface AgentTask {
  id: string; agent: AgentKey; kind: 'decouverte_concessions'; params: { country?: string; brand?: string; model?: string; vans?: boolean; pages?: number };
  status: 'en_attente' | 'en_cours' | 'terminee' | 'echec' | 'annulee'; result: { annonces?: number; concessions?: number; nouvelles?: number; url?: string } | null;
  error: string | null; created_by: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}
export const ANNUAIRE_SQL_HINT = 'Annuaire : SQL du 17/10 (agents_annuaire) à coller dans Supabase.';
const errAnnuaire = (m: string) => (missing(m) ? ANNUAIRE_SQL_HINT : m);

export async function listDealers(f: { country?: string | null; brand?: string | null; query?: string | null; days?: number; limit?: number }): Promise<{ rows: DealerRow[]; error: string | null }> {
  const { data, error } = await sb.rpc('agents_dealer_directory', {
    p_country: f.country || null, p_brand: f.brand || null, p_query: f.query?.trim() || null, p_days: f.days ?? 90, p_limit: f.limit ?? 300,
  });
  if (error) return { rows: [], error: errAnnuaire(error.message) };
  return { rows: (data ?? []) as DealerRow[], error: null };
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

export async function listTasks(limit = 15): Promise<{ rows: AgentTask[]; error: string | null }> {
  const { data, error } = await sb.from('agent_tasks').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) return { rows: [], error: errAnnuaire(error.message) };
  return { rows: (data ?? []) as AgentTask[], error: null };
}

export async function queueDiscovery(params: { country: string; brand: string; model?: string; vans?: boolean; pages?: number }, userId: string | null): Promise<string | null> {
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
  const at = await geocode(d);
  const brands = (d.brands ?? []).slice(0, 6).map((b) => b.charAt(0) + b.slice(1).toLowerCase()).join(', ');
  const { error } = await sb.from('network_contacts').insert({
    name: d.name, kind: 'concession', role: 'acheteur', country: (d.country ?? 'FR').toUpperCase(), city: d.city,
    lat: at?.lat ?? null, lng: at?.lng ?? null, contact_name: d.contact_name, phone: d.phone,
    website: d.website ?? d.site_url, relation: 'nouveau', vehicle_types: brands,
    comment: `Trouvé par Ada dans l'annuaire (AutoScout24) : ${d.listings} annonce${d.listings > 1 ? 's' : ''} sur 90 jours.`,
    source: 'ada', ai_added_at: new Date().toISOString(), created_by: userId,
  });
  if (error) return { placed: false, error: /row-level security|permission/i.test(error.message) ? 'Ajout refusé : il faut le droit « Carte du réseau · édition ».' : error.message };
  return { placed: !!at, error: null };
}

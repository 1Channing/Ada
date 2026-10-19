/**
 * ADA ET DANA — accès base du worker (16/10) : réglages des deux agentes,
 * journal, alertes dans la cloche (user_tasks : la cloche sonne et, à
 * l'échéance immédiate, reminderMailer envoie l'e-mail au responsable).
 * Clé service : les règles RLS ne s'appliquent pas, les règles de la base
 * (triggers) si — un message validé ne change pas, même ici.
 */
import { sharedSupabase as supabase } from '../../src/lib/supabaseShared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sb = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any; storage: any };

export interface AgentRow {
  agent: 'ada' | 'dana';
  display_name: string;
  role: 'acheteurs' | 'vendeurs';
  mailbox: string;
  sender_name: string;
  status: 'pause' | 'active';
  signature: string;
  daily_first_contact_cap: number;
  send_days: number[];
  send_from: string;
  send_to: string;
  min_gap_seconds: number;
  max_gap_seconds: number;
  owner_id: string | null;
  gmail_connected_email: string | null;
  gmail_history_id: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  next_send_after: string | null;
}

const missing = (m: string) => /does not exist|schema cache|relation/i.test(m);
let warnedMissing = false;

/** Les deux agentes (vide tant que le SQL du 16/10 n'est pas collé). */
export async function loadAgents(): Promise<AgentRow[]> {
  const { data, error } = await sb.from('agent_settings').select('*').order('agent');
  if (error) {
    if (missing(error.message)) {
      if (!warnedMissing) console.warn('[AGENTS] tables absentes : SQL du 16/10 (agents_socle) à coller');
      warnedMissing = true;
    } else console.warn(`[AGENTS] réglages illisibles : ${error.message}`);
    return [];
  }
  return (data ?? []) as AgentRow[];
}

export async function updateAgent(agent: string, patch: Partial<AgentRow>): Promise<void> {
  const { error } = await sb.from('agent_settings').update(patch).eq('agent', agent);
  if (error) console.warn(`[AGENTS] ${agent} : réglage non enregistré (${error.message})`);
}

export interface JournalEntry {
  agent?: string | null;
  actor: 'humain' | 'ada' | 'dana' | 'systeme';
  actorId?: string | null;
  kind: string;
  summary: string;
  threadId?: string | null;
  messageId?: string | null;
  details?: Record<string, unknown>;
}

export async function journal(e: JournalEntry): Promise<void> {
  const { error } = await sb.from('agent_journal').insert({
    agent: e.agent ?? null, actor: e.actor, actor_id: e.actorId ?? null, kind: e.kind, summary: e.summary.slice(0, 500),
    thread_id: e.threadId ?? null, message_id: e.messageId ?? null, details: e.details ?? {},
  });
  if (error) console.warn(`[AGENTS] journal non écrit (${e.kind}) : ${error.message}`);
}

/** Alerte au responsable de l'agente : la cloche, et l'e-mail de rappel (échéance immédiate). Une seule par clé. */
export async function alertOwner(a: AgentRow, key: string, title: string, note: string, link: string): Promise<void> {
  if (!a.owner_id) return;
  const { error } = await sb.from('user_tasks').upsert({
    assignee_id: a.owner_id, created_by: a.owner_id, key, title: title.slice(0, 200), note: note.slice(0, 1500), link,
    due_at: new Date().toISOString(),
  }, { onConflict: 'key', ignoreDuplicates: true });
  if (error) console.warn(`[AGENTS] alerte non posée : ${error.message}`);
}

/**
 * L'étape du prospect rattaché à un fil avance (17/10) : envoyé → « contacté »,
 * réponse → « a répondu », demande d'arrêt → « perdu ». Jamais en arrière ; sans
 * effet tant que le SQL des premiers mails n'est pas collé (colonne absente).
 */
export async function advanceProspect(threadId: string, to: 'contacte' | 'repondu' | 'perdu'): Promise<void> {
  const { data, error } = await sb.from('agent_threads').select('prospect_id').eq('id', threadId).maybeSingle();
  const prospectId = (data as { prospect_id?: string | null } | null)?.prospect_id;
  if (error || !prospectId) return;
  const from = to === 'contacte' ? ['qualifie', 'a_contacter'] : to === 'repondu' ? ['qualifie', 'a_contacter', 'contacte'] : ['qualifie', 'a_contacter', 'contacte', 'repondu', 'interesse'];
  await sb.from('agent_prospects').update({ stage: to, updated_at: new Date().toISOString() }).eq('id', prospectId).in('stage', from);
}

/** Liste « ne plus contacter » (adresses et « @domaines »). */
export async function loadSuppressions(): Promise<string[]> {
  const { data, error } = await sb.from('email_suppressions').select('email');
  if (error) { console.warn(`[AGENTS] liste « ne plus contacter » illisible : ${error.message}`); return []; }
  return ((data ?? []) as Array<{ email: string }>).map((r) => r.email);
}

export async function suppress(email: string, reason: 'stop' | 'refus' | 'rebond' | 'plainte' | 'manuel', agent: string, note: string): Promise<boolean> {
  const { data, error } = await sb.from('email_suppressions')
    .upsert({ email: email.trim().toLowerCase(), reason, agent, note: note.slice(0, 300) }, { onConflict: 'email', ignoreDuplicates: true })
    .select('email');
  if (error) { console.warn(`[AGENTS] « ne plus contacter » non enregistré : ${error.message}`); return false; }
  return ((data ?? []) as unknown[]).length > 0;
}

/** Ce qu'une tâche a coûté jusqu'ici (tous ses appels à l'IA, agent_runs). */
export async function taskSpend(taskId: string): Promise<number> {
  const { data } = await sb.from('agent_runs').select('cost_usd').eq('task_id', taskId).limit(1000);
  return ((data ?? []) as Array<{ cost_usd: number | string | null }>).reduce((n, r) => n + Number(r.cost_usd ?? 0), 0);
}

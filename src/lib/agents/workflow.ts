/**
 * LE WORKFLOW D'ADA ET DANA (20/10, Channing : « à valider devient Workflow. 3 catégories, ne s'affiche que
 * la catégorie cliquée : 1. Discussions en cours — les fiches des entreprises contactées par e-mail ou
 * LinkedIn, mises ici dès qu'un mail est envoyé, ou qu'on l'y met ; 2. Fiches — les fiches complètes ;
 * 3. Brouillons — les fiches à compléter, où l'on sélectionne les entreprises qui nous intéressent. Éviter
 * les doublons d'affichage, et connecter la messagerie au reste »).
 * Une entreprise = une carte, dans une seule catégorie : la plus avancée de ses fiches (deux fiches
 * d'Autohaus Bleker, une contactée et une à compléter, n'en font qu'une, en discussion). Le fil d'un mail
 * envoyé ou reçu se rattache à la fiche de son entreprise (l'adresse, sinon le domaine).
 */
import { missingOf } from './deepResearch';
import { isSetAside, dayFr } from './setAside';
import { emailDomain, isWebmail } from './people';
import { sameDomain } from './teamMemory';
import { webKey } from './research';

export type WfColumn = 'discussions' | 'fiches' | 'brouillons';

/** Une note de l'équipe sur une fiche : « 20/10/2026 — Rappeler jeudi, il attend sa liste ». */
export const noteLine = (at: Date, text: string): string => `${dayFr(at)} — ${text.replace(/\s+/g, ' ').trim().slice(0, 1000)}`;
export const WF_COLUMNS: WfColumn[] = ['discussions', 'fiches', 'brouillons'];
export const WF_LABEL: Record<WfColumn, string> = { discussions: 'Discussions en cours', fiches: 'Fiches', brouillons: 'Brouillons' };

/** Les étapes d'une discussion (« perdu » : terminée, rangée à part). */
export const DISCUSSION_STAGES = ['contacte', 'repondu', 'interesse', 'client', 'perdu'];
/** Ce qui n'est pas encore parti : brouillons, à valider, validés en attente, en échec, préparés pour Channing. */
export const PENDING_STATUSES = ['brouillon', 'a_valider', 'valide', 'envoi', 'echec', 'pour_channing'];

export interface WfProspect {
  id: string; name: string; stage: string; score: number | null; key_account?: boolean | null; city?: string | null;
  website?: string | null; phone?: string | null; updated_at?: string | null; exclusion_reason?: string | null;
  emails: Array<{ email: string; mx: boolean; nature?: string | null }>;
  people: Array<{ nom: string; email?: string | null; linkedin?: string | null }>;
  best_contact: { nom?: string | null; email?: string | null; linkedin?: string | null; telephone?: string | null } | null;
}
export interface WfThread {
  id: string; prospect_id?: string | null; last_message_at?: string | null; last_direction?: string | null; unread?: boolean; archived?: boolean;
  subject?: string; counterpart_email?: string | null; counterpart_name?: string | null;
}
export interface WfMessage { id: string; thread_id: string; status: string; direction: 'in' | 'out'; created_at: string }

/** Ce qui bloque une fiche (elle reste un brouillon) : la personne qui décide, un e-mail publié, la note minimale. LinkedIn et téléphone sont un plus. */
const BLOCKING = /personne qui décide|aucun e-mail/;
export function blockingOf(p: WfProspect, minScore: number): { missing: string[]; extra: string[] } {
  const all = missingOf(p as never);
  const missing = all.filter((m) => BLOCKING.test(m));
  const extra = all.filter((m) => !BLOCKING.test(m));
  if (p.score != null && p.score < minScore) missing.push(`note ${p.score}, sous la note minimale (${minScore})`);
  return { missing, extra };
}

/** Les domaines d'une entreprise : son site (pas un site d'annonces ni un réseau social), ses adresses (pas une messagerie grand public, pas la nôtre). */
export function companyDomains(p: Pick<WfProspect, 'website' | 'emails' | 'best_contact' | 'people'>, ownDomain = 'mc-export.com'): string[] {
  const out = new Set<string>();
  const site = webKey(p.website);
  if (site) out.add(site);
  for (const e of [...p.emails.map((x) => x.email), p.best_contact?.email, ...p.people.map((x) => x.email)]) {
    const d = emailDomain(e);
    if (d && !isWebmail(d) && !sameDomain(d, ownDomain)) out.add(d);
  }
  return [...out];
}

/** Toutes les adresses d'une fiche (publiées, du contact retenu, des personnes). */
const addressesOf = (p: WfProspect) => new Set([...p.emails.map((x) => x.email), p.best_contact?.email, ...p.people.map((x) => x.email)].filter((x): x is string => !!x).map((x) => x.trim().toLowerCase()));

const STAGE_RANK: Record<string, number> = { client: 6, interesse: 5, repondu: 4, contacte: 3, perdu: 2, a_contacter: 1, qualifie: 0 };

/**
 * La fiche d'un fil (20/10) : l'adresse d'un destinataire ou de l'expéditeur, écrite sur une fiche ; sinon le domaine
 * de l'entreprise (jamais une messagerie grand public, jamais le nôtre). Plusieurs fiches de la même entreprise : la plus
 * avancée, puis le grand compte, puis la mieux notée. Une fiche écartée ne reçoit pas de fil.
 */
export function matchProspect<P extends WfProspect>(addresses: Array<string | null | undefined>, prospects: P[], ownDomain = 'mc-export.com'): P | null {
  const ext = [...new Set(addresses.map((x) => String(x ?? '').trim().toLowerCase()).filter((x) => x.includes('@') && !sameDomain(emailDomain(x), ownDomain)))];
  if (!ext.length) return null;
  const live = prospects.filter((p) => p.stage !== 'ecarte');
  const best = (ps: P[]) => [...ps].sort((a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0) || Number(!!b.key_account) - Number(!!a.key_account) || (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
  const exact = live.filter((p) => { const own = addressesOf(p); return ext.some((x) => own.has(x)); });
  if (exact.length) return best(exact);
  const domains = ext.map(emailDomain).filter((d) => d && !isWebmail(d));
  if (!domains.length) return null;
  return best(live.filter((p) => companyDomains(p, ownDomain).some((d) => domains.some((x) => sameDomain(x, d)))));
}

export interface WfCard<P extends WfProspect, M extends WfMessage> {
  column: WfColumn;
  /** La fiche montrée : la plus avancée de l'entreprise. */
  lead: P;
  /** Les autres fiches de la même entreprise (même site, même domaine d'adresse). */
  twins: P[];
  /** Ce qui n'est pas encore parti, sur les fils de l'entreprise. */
  pending: M[];
  /** Les fils de l'entreprise, le plus récent d'abord. */
  threads: WfThread[];
  /** Le dernier échange (un fil), une réponse non lue, une discussion terminée (« perdu »). */
  lastAt: string | null; unread: boolean; ended: boolean;
  /** Ce qui manque (brouillon) ou serait un plus. */
  missing: string[]; extra: string[];
}

const COLUMN_RANK: Record<WfColumn, number> = { discussions: 2, fiches: 1, brouillons: 0 };

/**
 * Les trois catégories. Une fiche en discussion (étape « contacté » et au-delà) ; sinon, avec quelque chose de
 * préparé (pas encore parti) ou complète : une fiche ; sinon un brouillon. Les fiches d'une même entreprise sont
 * réunies dans la catégorie de la plus avancée. Les mises de côté à part ; les messages en attente sans fiche aussi.
 */
export function buildWorkflow<P extends WfProspect, M extends WfMessage>(input: { prospects: P[]; threads: WfThread[]; messages: M[]; minScore: number; ownDomain?: string }): {
  discussions: Array<WfCard<P, M>>; fiches: Array<WfCard<P, M>>; brouillons: Array<WfCard<P, M>>; aside: P[]; orphans: M[];
} {
  const own = input.ownDomain ?? 'mc-export.com';
  const aside = input.prospects.filter(isSetAside);
  const live = input.prospects.filter((p) => p.stage !== 'ecarte');
  const liveIds = new Set(live.map((p) => p.id));
  const threadsOf = new Map<string, WfThread[]>();
  const prospectOfThread = new Map<string, string>();
  for (const t of input.threads) {
    if (!t.prospect_id || !liveIds.has(t.prospect_id)) continue;
    threadsOf.set(t.prospect_id, [...(threadsOf.get(t.prospect_id) ?? []), t]);
    prospectOfThread.set(t.id, t.prospect_id);
  }
  const pendingOf = new Map<string, M[]>();
  const orphans: M[] = [];
  const threadPid = new Map(input.threads.map((t) => [t.id, t.prospect_id ?? null]));
  for (const m of input.messages) {
    if (m.direction !== 'out' || !PENDING_STATUSES.includes(m.status)) continue;
    const pid = prospectOfThread.get(m.thread_id);
    if (pid) pendingOf.set(pid, [...(pendingOf.get(pid) ?? []), m]);
    // Un fil sans fiche : à part (pas un brouillon pas encore soumis : il reste dans la Messagerie). Celui d'une fiche
    // écartée ou mise de côté : ce qu'elle avait de préparé ne s'affiche plus.
    else if (!threadPid.get(m.thread_id) && m.status !== 'brouillon') orphans.push(m);
  }
  const columnOf = (p: P): WfColumn => (DISCUSSION_STAGES.includes(p.stage) ? 'discussions'
    : (pendingOf.get(p.id) ?? []).length || !blockingOf(p, input.minScore).missing.length ? 'fiches' : 'brouillons');

  // Une entreprise : les fiches qui partagent un domaine (de proche en proche).
  const parent = new Map(live.map((p) => [p.id, p.id]));
  const root = (id: string): string => { let r = id; while (parent.get(r) !== r) r = parent.get(r) as string; parent.set(id, r); return r; };
  const byDomain = new Map<string, string>();
  for (const p of live) {
    for (const d of companyDomains(p, own)) {
      const other = byDomain.get(d);
      if (other) parent.set(root(p.id), root(other)); else byDomain.set(d, p.id);
    }
  }
  const groups = new Map<string, P[]>();
  for (const p of live) groups.set(root(p.id), [...(groups.get(root(p.id)) ?? []), p]);

  const out = { discussions: [] as Array<WfCard<P, M>>, fiches: [] as Array<WfCard<P, M>>, brouillons: [] as Array<WfCard<P, M>> };
  for (const members of groups.values()) {
    const ranked = [...members].sort((a, b) => COLUMN_RANK[columnOf(b)] - COLUMN_RANK[columnOf(a)] || (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0)
      || (pendingOf.get(b.id)?.length ?? 0) - (pendingOf.get(a.id)?.length ?? 0) || Number(!!b.key_account) - Number(!!a.key_account) || (b.score ?? 0) - (a.score ?? 0));
    const lead = ranked[0];
    const column = columnOf(lead);
    const threads = members.flatMap((p) => threadsOf.get(p.id) ?? []).sort((a, b) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')));
    const { missing, extra } = blockingOf(lead, input.minScore);
    out[column].push({
      column, lead, twins: ranked.slice(1), pending: members.flatMap((p) => pendingOf.get(p.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
      threads, lastAt: threads[0]?.last_message_at ?? null, unread: threads.some((t) => !!t.unread && !t.archived), ended: lead.stage === 'perdu', missing, extra,
    });
  }
  // Discussions : une réponse non lue d'abord, puis le dernier échange ; les terminées à la fin. Fiches et brouillons : les grands comptes, puis la note.
  out.discussions.sort((a, b) => Number(a.ended) - Number(b.ended) || Number(b.unread) - Number(a.unread) || String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')));
  const byWorth = (a: WfCard<P, M>, b: WfCard<P, M>) => Number(!!b.lead.key_account) - Number(!!a.lead.key_account) || (b.lead.score ?? 0) - (a.lead.score ?? 0);
  out.fiches.sort((a, b) => Number(b.pending.length > 0) - Number(a.pending.length > 0) || byWorth(a, b));
  out.brouillons.sort(byWorth);
  return { ...out, aside, orphans };
}

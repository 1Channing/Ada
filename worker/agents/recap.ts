/**
 * LE BILAN DU JOUR, CÔTÉ WORKER (18/10 ; le moment et le texte :
 * src/lib/agents/recap.ts). À chaque cycle (10 min), pour chaque agente : si
 * son bilan du jour est dû et pas encore parti, un mail à chaque compte MC
 * Export d'ADA (organisation MC Export, compte non bloqué), depuis la boîte de
 * l'agente (délégation Gmail du domaine, comme les rappels) ; si Google
 * refuse cette boîte (pas encore créée), chacun le reçoit de sa propre
 * adresse. Un verrou par agente et par jour (app_config, posé AVANT l'envoi)
 * : deux workers, pendant un redéploiement, n'envoient jamais deux bilans.
 * Le mail porte l'en-tête interne d'ADA : la synchro de la boîte le laisse
 * dans Gmail, hors de la Messagerie et des chiffres (le 18/10, ses 4 copies
 * comptaient comme « envoyés »).
 */
import { sb, journal, loadSuppressions } from './store';
import { mailCreds } from '../mailer';
import { sendInternal } from './internalMail';
import { spentToday } from './claude';
import type { AiAgent } from './qualify';
import { recapDue, recapMail, recapToOf, type RecapInput } from '../../src/lib/agents/recap';
import { parisClock, parisDayStart, workHoursLabel, suppressionMatch } from '../../src/lib/agents/sendPolicy';
import { segmentOf, COUNTRY_FR } from '../../src/lib/agents/research';

/** Les relevés d'annonces d'office par jour (le même nombre que le cycle de ./tasks.ts). */
const DISCOVERIES_PER_DAY = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface TaskRow { kind: string; status: string; params: Record<string, unknown> | null; result: Record<string, unknown> | null; created_by: string | null; created_at: string; finished_at: string | null }

/** Les comptes MC Export d'ADA (organisation MC Export ou vide, non bloqués), avec leur adresse. */
export async function mcExportAccounts(): Promise<Array<{ id: string; email: string }>> {
  const { data, error } = await sb.from('profiles').select('id, organisation, blocked').limit(1000);
  if (error) return [];
  const ids = new Set(((data ?? []) as Array<{ id: string; organisation: string | null; blocked: boolean | null }>)
    .filter((p) => !p.blocked && (!(p.organisation ?? '').trim() || p.organisation === 'MC Export')).map((p) => p.id));
  const admin = (sb as unknown as { auth: { admin: { listUsers: (o: { page: number; perPage: number }) => Promise<{ data: { users?: Array<{ id: string; email?: string | null }> } | null; error: { message: string } | null }> } } }).auth.admin;
  const out = new Map<string, string>();
  for (let page = 1; page <= 10; page++) {
    const { data: u, error: e } = await admin.listUsers({ page, perPage: 200 });
    if (e) break;
    const users = u?.users ?? [];
    for (const x of users) { const m = (x.email ?? '').trim().toLowerCase(); if (ids.has(x.id) && EMAIL.test(m)) out.set(x.id, m); }
    if (users.length < 200) break;
  }
  return [...out].map(([id, email]) => ({ id, email })).sort((x, y) => x.email.localeCompare(y.email));
}

/** Les adresses des comptes MC Export d'ADA. */
export async function mcExportEmails(): Promise<string[]> {
  return (await mcExportAccounts()).map((x) => x.email);
}

/** Les destinataires du bilan d'une agente : les comptes cochés dans ses Réglages (tous tant que rien n'est
 *  choisi), sauf les boîtes des agentes et les adresses « ne plus contacter » (le 18/10, le compte de test
 *  ada-test@, sans boîte Gmail, avait rebondi). */
export async function recapRecipients(a: { targets?: unknown }): Promise<string[]> {
  const [all, suppressed, { data: boxes }] = await Promise.all([mcExportAccounts(), loadSuppressions(), sb.from('agent_settings').select('mailbox')]);
  const chosen = recapToOf(a.targets);
  const own = new Set(((boxes ?? []) as Array<{ mailbox: string | null }>).map((b) => (b.mailbox ?? '').trim().toLowerCase()));
  return all.filter((x) => (!chosen || chosen.includes(x.id)) && !own.has(x.email) && !suppressionMatch([x.email], suppressed)).map((x) => x.email);
}

/** Le bilan d'une agente : envoyé s'il est dû (au plus une fois par jour). */
export async function maybeSendRecap(a: AiAgent, now = new Date()): Promise<'envoye' | 'pas_encore' | 'deja' | 'sans_mail' | 'personne'> {
  const creds = mailCreds();
  if (!creds) return 'sans_mail';
  // Personne de coché dans ses Réglages : pas de bilan.
  if (recapToOf(a.targets)?.length === 0) return 'personne';
  const day = parisClock(now).ymd;
  const lockKey = `agents_bilan:${a.agent}:${day}`;
  const { data: lock } = await sb.from('app_config').select('key').eq('key', lockKey).maybeSingle();
  if (lock) return 'deja';

  // La journée de l'agente.
  const since = parisDayStart(now).toISOString();
  const { data: tRows } = await sb.from('agent_tasks').select('kind, status, params, result, created_by, created_at, finished_at').eq('agent', a.agent).gte('created_at', since).limit(500);
  const tasks = (tRows ?? []) as TaskRow[];
  const spent = await spentToday(a.agent);
  const ok = (t: TaskRow) => t.status !== 'echec' && t.status !== 'annulee';
  const auto = (t: TaskRow) => !t.created_by;
  const research = tasks.filter((t) => t.kind === 'recherche_comptes');
  const discoveries = tasks.filter((t) => t.kind === 'decouverte_concessions');
  const activity = tasks.flatMap((t) => [t.created_at, t.finished_at]).filter((x): x is string => !!x).sort();
  const budget = Number(a.daily_budget_usd);
  const due = recapDue({
    now, window: a, worked: tasks.length > 0 || spent > 0,
    pending: tasks.filter((t) => t.status === 'en_attente' || t.status === 'en_cours').length,
    lastActivityAt: activity.length ? activity[activity.length - 1] : null,
    researchQuota: Number(a.auto_research_per_day ?? 0), researchToday: research.filter((t) => auto(t) && ok(t)).length,
    discoveryOn: !!a.auto_discovery, discoveryQuota: DISCOVERIES_PER_DAY, discoveryToday: discoveries.filter((t) => auto(t) && ok(t)).length,
    budgetReached: Number.isFinite(budget) && spent >= budget,
  });
  if (!due) return 'pas_encore';
  // Personne à prévenir (profils illisibles) : pas de verrou, on réessaie au cycle suivant.
  const to = await recapRecipients(a);
  if (to.length === 0) { console.warn(`[AGENTS] bilan du jour ${a.agent} : aucun compte MC Export trouvé`); return 'pas_encore'; }

  // Le verrou du jour, posé avant d'envoyer : un second worker trouve la clé et s'arrête.
  const { error: lockErr } = await sb.from('app_config').insert({ key: lockKey, value: { at: now.toISOString(), statut: 'envoi' } });
  if (lockErr) return 'deja';

  // Les chiffres.
  const { data: pRows } = await sb.from('agent_prospects').select('id, name, score, key_account, network_contact_id, stage').eq('agent', a.agent).gte('qualified_at', since).order('score', { ascending: false }).limit(500);
  const fiches = (pRows ?? []) as Array<{ id: string; name: string; score: number | null; key_account?: boolean; network_contact_id: string | null; stage: string }>;
  const { data: mRows } = await sb.from('agent_messages').select('thread_id, status, kind, author, created_at, thread:agent_threads(prospect:agent_prospects(name))').eq('agent', a.agent).gte('created_at', since).limit(500);
  const msgs = (mRows ?? []) as Array<{ thread_id: string; status: string; kind: string; author?: string; thread: { prospect: { name: string } | null } | null }>;
  const preparedNames = [...new Map(msgs.filter((m) => m.status === 'pour_channing').map((m) => [m.thread_id, m.thread?.prospect?.name ?? 'grand compte'])).values()];
  const { data: wFor } = await sb.from('agent_messages').select('thread_id').eq('agent', a.agent).eq('status', 'pour_channing').limit(500);
  const { data: wVal } = await sb.from('agent_messages').select('id').eq('agent', a.agent).eq('status', 'a_valider').limit(500);
  const { data: keys } = await sb.from('agent_prospects').select('id').eq('agent', a.agent).eq('key_account', true).in('stage', ['qualifie', 'a_contacter']).limit(500);
  const keyIds = ((keys ?? []) as Array<{ id: string }>).map((k) => k.id);
  const { data: kThreads } = keyIds.length ? await sb.from('agent_threads').select('prospect_id').in('prospect_id', keyIds).limit(1000) : { data: [] };
  const withThread = new Set(((kThreads ?? []) as Array<{ prospect_id: string }>).map((t) => t.prospect_id));
  const deepTasks = tasks.filter((t) => t.kind === 'qualification' && t.params?.approfondie && t.status === 'terminee');
  const { data: dj } = await sb.from('agent_journal').select('summary').eq('agent', a.agent).eq('kind', 'recherche_approfondie').gte('at', since).limit(50);
  const deepFound = ((dj ?? []) as Array<{ summary: string }>).map((j) => j.summary).filter((x) => / — à approcher : /.test(x))
    .map((x) => `${x.split(' : recherche approfondie')[0]} → ${x.split(' — à approcher : ')[1]}`).slice(0, 5);
  const base = (process.env.ADA_APP_URL ?? 'https://ada.mc-export.com').replace(/\/+$/, '');
  const input: RecapInput = {
    agent: a.agent === 'dana' ? 'dana' : 'ada', name: a.display_name, now, hours: workHoursLabel(a),
    research: research.filter((t) => t.status === 'terminee').map((t) => {
      const seg = segmentOf(a.agent === 'dana' ? 'dana' : 'ada', String(t.params?.segment ?? ''));
      const c = String(t.params?.country ?? '').toUpperCase();
      const what = t.params?.notes ? 'recherche ciblée' : seg ? seg.label.toLowerCase() : String(t.params?.segment ?? '');
      return { label: `${what} · ${COUNTRY_FR[c] ?? c}`, found: Number(t.result?.gardes ?? 0) };
    }),
    discoveries: discoveries.filter((t) => t.status === 'terminee').length,
    listings: discoveries.reduce((n, t) => n + Number(t.result?.annonces ?? 0), 0),
    fiches: fiches.filter((p) => p.stage !== 'ecarte').length, keyFiches: fiches.filter((p) => p.key_account && p.stage !== 'ecarte').length,
    top: fiches.filter((p) => p.stage !== 'ecarte').slice(0, 5).map((p) => ({ name: p.name, score: p.score })),
    deep: { done: deepTasks.reduce((n, t) => n + Number(t.result?.fiches ?? 0), 0), enriched: deepTasks.reduce((n, t) => n + Number(t.result?.enrichies ?? 0), 0), found: deepFound },
    prepared: preparedNames, drafts: msgs.filter((m) => m.status === 'a_valider' && m.kind === 'premier_contact').length,
    replies: msgs.filter((m) => m.kind === 'reponse' && m.author === a.agent).length,
    map: fiches.filter((p) => !!p.network_contact_id).length,
    spent, budget: Number.isFinite(budget) ? budget : 0,
    waiting: {
      forYou: new Set(((wFor ?? []) as Array<{ thread_id: string }>).map((m) => m.thread_id)).size,
      toValidate: ((wVal ?? []) as unknown[]).length,
      toComplete: keyIds.filter((id) => !withThread.has(id)).length,
    },
    link: `${base}/agents?agente=${a.agent}&onglet=valider`,
  };
  const mail = recapMail(input);

  // L'envoi : depuis la boîte de l'agente ; si Google la refuse, chacun de sa propre adresse (on n'essaie plus sa boîte ensuite).
  let sent = 0;
  let fromSelf = 0;
  const failed: string[] = [];
  let agentBoxOk = true;
  for (const r of to) {
    try {
      const how = await sendInternal(creds, a, r, mail, 'bilan', agentBoxOk);
      sent++;
      if (how === 'soi') { agentBoxOk = false; fromSelf++; }
    } catch { failed.push(r); }
  }
  await sb.from('app_config').update({ value: { at: now.toISOString(), statut: 'envoye', destinataires: to.length, envoyes: sent, de_soi: fromSelf, echecs: failed.length }, updated_at: new Date().toISOString() }).eq('key', lockKey);
  await journal({
    agent: a.agent, actor: 'systeme', kind: 'bilan_jour',
    summary: `Bilan du jour envoyé à ${sent} personne${sent > 1 ? 's' : ''} de MC Export${fromSelf ? ` (${fromSelf} depuis leur propre adresse : la boîte ${a.mailbox} n'est pas encore utilisable)` : ''}${failed.length ? ` — ${failed.length} en échec` : ''}`,
    details: { destinataires: to.length, envoyes: sent, de_soi: fromSelf, echecs: failed.length, objet: mail.subject },
  });
  console.log(`[AGENTS] bilan du jour ${a.agent} : ${sent}/${to.length} envoyé(s)${failed.length ? `, ${failed.length} en échec` : ''}`);
  return 'envoye';
}

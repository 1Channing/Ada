/**
 * LA RECHERCHE CIBLÉE ET LE BILAN À QUI L'A LANCÉE (18/10, Channing :
 * « lancer une recherche ciblée sur une entreprise donnée […] type, pays,
 * et des notes (Opus 5.5 lorsqu'il y a des notes), une limite de dépense en
 * option ; un bilan de la recherche par mail au compte qui l'a lancée ; si
 * elle n'a pas pu aboutir faute de budget, proposer d'augmenter le budget ou
 * de finir soi-même, c'est gratuit ». Le texte du mail : src/lib/agents/researchMail.ts.
 * Avec des notes, une seule tâche « recherche_comptes » :
 * 1. Opus 5.5 cherche en suivant les notes (./research.ts) ;
 * 2. la fiche de chaque entreprise trouvée (5 au plus) ;
 * 3. la recherche approfondie, les notes en consigne, sur Opus 5.5 (3 au plus)
 *    — aussi sur la fiche d'une entreprise déjà connue que les notes visent.
 * La limite de dépense (facultative) est relue entre deux étapes, sur ce que
 * la tâche a réellement coûté (agent_runs) : une étape commencée va jusqu'au
 * bout. Le budget du jour de l'agente reste le plafond de tout.
 * À la fin, ou à l'arrêt, le compte qui l'a lancée reçoit le bilan, depuis la
 * boîte de l'agente. Sans notes : une recherche par type coché ; le bilan part
 * quand la dernière du même lancement (params.lot) est finie.
 */
import { OPUS, fmtUsd } from '../../src/lib/agents/aiCost';
import { segmentOf, webKey, COUNTRY_FR } from '../../src/lib/agents/research';
import { researchMail, googleUrl, type ResearchMailCompany, type ResearchMailInput } from '../../src/lib/agents/researchMail';
import { missingOf, type DeepProspect } from '../../src/lib/agents/deepResearch';
import { linkedinSearchUrl } from '../../src/lib/agents/firstMail';
import { nameKey } from '../../src/lib/agents/keys';
import { mailCreds } from '../mailer';
import { researchAccounts, type ResearchResult } from './research';
import { qualifyAccount, seriesContext, type AiAgent } from './qualify';
import { deepResearch } from './deep';
import { mcExportAccounts } from './recap';
import { sendInternal } from './internalMail';
import { BudgetReached, AiUnavailable } from './claude';
import { sb, journal, taskSpend } from './store';
import { live } from './live';

interface Task { id: string; agent: string; kind: string; params: Record<string, unknown>; created_by: string | null }
type Stop = ResearchMailInput['stopped'];

const MAX_FICHES = 5;
const MAX_DEEP = 3;
const usd = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;
const pl = (n: number) => (n > 1 ? 's' : '');

/** L'adresse du compte qui a lancé la recherche. */
async function userEmail(id: string): Promise<string | null> {
  const admin = (sb as unknown as { auth?: { admin?: { getUserById?: (id: string) => Promise<{ data: { user?: { email?: string | null } | null } | null }> } } }).auth?.admin;
  try {
    const m = (await admin?.getUserById?.(id))?.data?.user?.email;
    if (m) return m.trim().toLowerCase();
  } catch { /* repli : la liste des comptes MC Export */ }
  return (await mcExportAccounts()).find((x) => x.id === id)?.email ?? null;
}

const appLink = (agent: string) => `${(process.env.ADA_APP_URL ?? 'https://ada.mc-export.com').replace(/\/+$/, '')}/agents?agente=${agent}&onglet=comptes`;

/** Envoie le bilan à qui a lancé la recherche ; une ligne au journal dans tous les cas. */
async function mailLauncher(a: AiAgent, userId: string | null, input: ResearchMailInput): Promise<void> {
  const creds = mailCreds();
  const to = userId ? await userEmail(userId) : null;
  if (!creds || !to) {
    await journal({ agent: a.agent, actor: 'systeme', kind: 'recherche_bilan', summary: `Bilan de la recherche non envoyé : ${!creds ? 'envoi de mails inactif' : 'adresse du compte introuvable'}` });
    return;
  }
  const mail = researchMail(input);
  try {
    const how = await sendInternal(creds, a, to, mail, 'recherche');
    await journal({ agent: a.agent, actor: 'systeme', kind: 'recherche_bilan', summary: `Bilan de la recherche envoyé à ${to}${how === 'soi' ? ' (depuis sa propre adresse)' : ''}`, details: { objet: mail.subject } });
  } catch (e) {
    await journal({ agent: a.agent, actor: 'systeme', kind: 'recherche_bilan', summary: `Bilan de la recherche non envoyé à ${to} : ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` });
  }
}

interface FicheRow extends DeepProspect { id: string; key_account?: boolean | null; account_id: string | null; stage: string }

/** La fiche d'une entreprise pour le bilan : note, grand compte, qui contacter, ce qui manque, les pistes. */
function ficheOf(p: FicheRow): NonNullable<ResearchMailCompany['fiche']> {
  const best = p.best_contact;
  return {
    score: p.score ?? null, key: p.key_account === true,
    contact: best?.nom ? `${best.nom}${best.fonction ? `, ${best.fonction}` : ''}` : null,
    email: best?.email ?? null, phone: best?.telephone ?? p.phone ?? null,
    missing: missingOf({ best_contact: p.best_contact, emails: p.emails ?? [], people: p.people ?? [], phone: p.phone }),
    leads: (p.evidence ?? []).filter((e) => e.piste).map((e) => e.note),
  };
}

/** Ce qui reste à faire à la main pour une entreprise (gratuit) : les recherches toutes prêtes. */
function handWork(role: 'ada' | 'dana', name: string, what: string, roles: string, person?: string | null): { what: string; links: Array<{ label: string; url: string }> } {
  return {
    what: `${name} : ${what}`,
    links: [
      { label: 'Google', url: googleUrl(`${name} ${person ?? roles}`) },
      { label: 'LinkedIn', url: linkedinSearchUrl(name, role, 'fr', person ?? null) },
    ],
  };
}

export async function targetedResearch(t: Task, a: AiAgent): Promise<{ result: Record<string, unknown>; summary: string }> {
  const role: 'ada' | 'dana' = a.agent === 'dana' ? 'dana' : 'ada';
  const notes = String(t.params.notes ?? '').trim();
  const limit = Number(t.params.limite_usd) > 0 ? Number(t.params.limite_usd) : null;
  const keys = Array.isArray(t.params.segments) && t.params.segments.length ? t.params.segments.map(String) : [String(t.params.segment ?? '')];
  const segs = keys.map((k) => segmentOf(role, k)).filter((x): x is NonNullable<typeof x> => !!x);
  const roles = segs[0]?.roles ?? 'responsable VO';
  const country = String(t.params.country ?? '').toUpperCase();
  const st: { stop: Stop } = { stop: null };
  const halt = (e: unknown) => {
    if (e instanceof BudgetReached) st.stop = { reason: 'budget', detail: `le budget du jour ${role === 'dana' ? 'de Dana' : 'd\'Ada'} est atteint` };
    else if (e instanceof AiUnavailable) st.stop = { reason: 'ia', detail: `l'IA n'est pas disponible (${e.message})` };
    else throw e;
  };
  const overLimit = async () => {
    if (st.stop) return true;
    if (limit == null) return false;
    const spent = await taskSpend(t.id);
    if (spent < limit) return false;
    st.stop = { reason: 'limite', detail: `la limite de ${usd(limit)} est atteinte (${usd(spent)} dépensés)` };
    return true;
  };

  // 1. La recherche, avec les notes.
  let found: ResearchResult | null = null;
  try { found = (await researchAccounts(t.id, t.params, a)).result; } catch (e) { halt(e); }

  // 2. Les fiches : des entreprises trouvées, et de celles déjà trouvées mais encore sans fiche (une recherche
  //    arrêtée avant, par exemple) ; les entreprises déjà connues avec leur fiche passent à l'étape 3.
  const known = found?.connues ?? [];
  const names = new Set(known.map((k) => nameKey(k.name)).filter(Boolean));
  const webs = new Set(known.map((k) => k.webKey).filter(Boolean));
  const isKnown = (name: string, site: string | null | undefined) => names.has(nameKey(name)) || (!!site && webs.has(webKey(site)));
  let knownAccounts: string[] = [];
  if (known.length) {
    const { data } = await sb.from('agent_accounts').select('id, name, website, status').eq('agent', a.agent).eq('status', 'nouveau').limit(5000);
    knownAccounts = ((data ?? []) as Array<{ id: string; name: string; website: string | null }>).filter((x) => isKnown(x.name, x.website)).map((x) => x.id);
  }
  const newIds = [...(found?.ids ?? []), ...knownAccounts].slice(0, MAX_FICHES);
  const ctx = newIds.length ? await seriesContext(a, t.id) : null;
  let fiches = 0;
  const ficheDone = new Set<string>();
  for (const [i, id] of newIds.entries()) {
    if (await overLimit()) break;
    live(t.id, `Fiche ${i + 1} sur ${newIds.length}`, { done: i, total: newIds.length });
    try {
      const o = await qualifyAccount(id, ctx as NonNullable<typeof ctx>);
      if (o.status !== 'echec') { fiches++; ficheDone.add(id); }
    } catch (e) { halt(e); }
  }
  const { data: newRows } = newIds.length ? await sb.from('agent_prospects').select('*').eq('agent', a.agent).in('account_id', newIds) : { data: [] };
  let knownRows: FicheRow[] = [];
  if (known.length) {
    const { data } = await sb.from('agent_prospects').select('*').eq('agent', a.agent).limit(5000);
    knownRows = ((data ?? []) as FicheRow[]).filter((p) => !newIds.includes(p.account_id ?? '') && isKnown(p.name, p.website));
  }

  // 3. La recherche approfondie, les notes en consigne (Opus 5.5) : d'abord ce que les notes visent et qui est déjà connu, puis les nouvelles fiches.
  const targets = [...knownRows, ...((newRows ?? []) as FicheRow[])].filter((p) => p.stage !== 'ecarte').slice(0, MAX_DEEP);
  const deepDone = new Set<string>();
  for (const [i, p] of targets.entries()) {
    if (await overLimit()) break;
    live(t.id, `Recherche approfondie ${i + 1} sur ${targets.length} : ${p.name}`, { done: i, total: targets.length });
    try {
      const o = await deepResearch(p.id, a, t.id, true, notes, OPUS);
      if (o.status === 'enrichi' || o.status === 'rien') deepDone.add(p.id);
    } catch (e) { halt(e); }
  }

  // 4. Le bilan, relu à la fin (les fiches et la recherche approfondie ont pu tout changer).
  const ids = [...new Set([...targets.map((p) => p.id), ...((newRows ?? []) as FicheRow[]).map((p) => p.id), ...knownRows.map((p) => p.id)])];
  const { data: finalRows } = ids.length ? await sb.from('agent_prospects').select('*').in('id', ids) : { data: [] };
  const byId = new Map(((finalRows ?? []) as FicheRow[]).map((p) => [p.id, p]));
  const { data: accRows } = newIds.length ? await sb.from('agent_accounts').select('id, name, city, segment').in('id', newIds) : { data: [] };
  const accounts = (accRows ?? []) as Array<{ id: string; name: string; city: string | null; segment: string }>;
  const fresh = ((newRows ?? []) as FicheRow[]);
  const companies: ResearchMailCompany[] = [
    ...accounts.map((acc) => {
      const p = fresh.find((x) => x.account_id === acc.id);
      const f = p ? byId.get(p.id) ?? p : null;
      return { name: acc.name, city: acc.city, type: segmentOf(role, acc.segment)?.label ?? acc.segment, known: knownAccounts.includes(acc.id), fiche: f ? ficheOf(f) : null };
    }),
    ...knownRows.map((p) => ({ name: p.name, city: p.city ?? null, type: null, known: true, fiche: ficheOf(byId.get(p.id) ?? p) })),
  ];
  const todo: ResearchMailInput['todo'] = [];
  if (st.stop) {
    if (!found) todo.push({ what: 'La recherche elle-même', links: [{ label: 'Google', url: googleUrl(`${notes} ${COUNTRY_FR[country] ?? country}`) }] });
    for (const acc of accounts) if (!ficheDone.has(acc.id)) todo.push(handWork(role, acc.name, `trouver qui décide (${roles})`, roles));
    for (const p of targets) {
      if (deepDone.has(p.id)) continue;
      const f = byId.get(p.id) ?? p;
      todo.push(handWork(role, p.name, `aller plus loin (à qui elle appartient, qui décide, comment la joindre)`, roles, f.best_contact?.nom ?? null));
    }
  }
  const cost = await taskSpend(t.id);
  await mailLauncher(a, t.created_by, {
    agent: role, name: a.display_name, ask: { types: segs.map((x) => x.label), country: COUNTRY_FR[country] ?? country, notes, limit },
    companies, dropped: found ? found.ecartes : 0, cost, stopped: st.stop, todo, link: appLink(a.agent),
  });

  const result = {
    ciblee: true, segment: segs[0]?.key ?? keys[0], country, trouves: found?.trouves ?? 0, gardes: found?.gardes ?? 0, deja: knownRows.length, ecartes: found?.ecartes ?? 0,
    fiches, approfondies: deepDone.size, cout_usd: Math.round(cost * 10_000) / 10_000, comptes: found?.comptes ?? [], arret: st.stop?.detail ?? null, limite_usd: limit,
  };
  const summary = `Recherche ciblée · ${COUNTRY_FR[country] ?? country} : ${result.gardes} entreprise${pl(result.gardes)} trouvée${pl(result.gardes)}`
    + `${knownRows.length ? `, ${knownRows.length} déjà connue${pl(knownRows.length)}` : ''}, ${fiches} fiche${pl(fiches)}, ${deepDone.size} recherche${pl(deepDone.size)} approfondie${pl(deepDone.size)} — ${fmtUsd(cost)}`
    + `${st.stop ? ` (arrêt : ${st.stop.detail})` : ''}`;
  return { result, summary };
}

/**
 * Le bilan d'un lancement sans notes (une recherche par type coché) : quand la dernière recherche du même
 * lancement est finie, une seule fois (verrou dans app_config), au compte qui l'a lancé.
 */
export async function lotMail(t: Task, a: AiAgent): Promise<void> {
  const lot = typeof t.params.lot === 'string' ? t.params.lot : null;
  if (!lot || !t.created_by) return;
  const { data } = await sb.from('agent_tasks').select('id, status, params, result, error').eq('agent', t.agent).eq('kind', 'recherche_comptes').eq('created_by', t.created_by).limit(200);
  const mine = ((data ?? []) as Array<{ id: string; status: string; params: Record<string, unknown> | null; result: Record<string, unknown> | null; error: string | null }>).filter((x) => x.params?.lot === lot);
  if (mine.some((x) => x.status === 'en_attente' || x.status === 'en_cours')) return;
  const { error: lockErr } = await sb.from('app_config').insert({ key: `recherche_bilan:${lot}`, value: { at: new Date().toISOString() } });
  if (lockErr) return; // déjà envoyé (un autre worker, ou une tâche de la même série)
  const role: 'ada' | 'dana' = a.agent === 'dana' ? 'dana' : 'ada';
  const country = String(t.params.country ?? '').toUpperCase();
  const label = (p: Record<string, unknown> | null) => segmentOf(role, String(p?.segment ?? ''))?.label ?? String(p?.segment ?? '');
  const companies: ResearchMailCompany[] = [];
  let dropped = 0;
  let cost = 0;
  let stop: Stop = null;
  const todo: ResearchMailInput['todo'] = [];
  for (const x of mine) {
    const r = x.result ?? {};
    cost += Number(r.cout_usd ?? 0);
    dropped += Number(r.ecartes ?? 0);
    for (const n of (Array.isArray(r.comptes) ? r.comptes : []).map(String)) companies.push({ name: n, city: null, type: label(x.params) });
    if (x.status === 'echec') {
      const budget = /plafond du jour|budget/i.test(x.error ?? '');
      stop = stop ?? (budget ? { reason: 'budget', detail: `le budget du jour ${role === 'dana' ? 'de Dana' : 'd\'Ada'} est atteint` } : { reason: 'ia', detail: (x.error ?? 'une recherche a échoué').slice(0, 200) });
      todo.push({ what: `La recherche « ${label(x.params).toLowerCase()} »`, links: [{ label: 'Google', url: googleUrl(`${label(x.params)} ${COUNTRY_FR[country] ?? country}`) }] });
    }
  }
  await mailLauncher(a, t.created_by, {
    agent: role, name: a.display_name, ask: { types: [...new Set(mine.map((x) => label(x.params)))], country: COUNTRY_FR[country] ?? country, notes: null, limit: null },
    companies, dropped, cost, stopped: stop, todo, link: appLink(a.agent),
  });
}

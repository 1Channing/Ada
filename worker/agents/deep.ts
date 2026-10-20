/**
 * LA RECHERCHE APPROFONDIE, CÔTÉ WORKER (18/10 ; la consigne, le schéma et la
 * fusion : src/lib/agents/deepResearch.ts). Pour une fiche : Haiku 5.5
 * cherche (8 recherches, 5 pages au plus) à qui appartient l'entreprise,
 * comment elle revend (ou achète) ses véhicules et qui en décide. ADA relit
 * chaque page citée pour un e-mail ou un téléphone — et le domaine de
 * l'e-mail doit recevoir du courrier —, garde un profil LinkedIn seulement
 * s'il a été vu dans un résultat, puis complète la fiche et met la note à
 * jour (partie « joignable »).
 * Un grand compte déjà préparé pour Channing, sans rien d'envoyé, est
 * repréparé avec ce qui a été trouvé ; lancée à la main, la recherche
 * prépare aussi un grand compte qui ne l'était pas. Rien n'est envoyé.
 * 19/10 (le test DMD) : avant de chercher, ce que l'équipe sait déjà de
 * l'entreprise (./team.ts) ; qui chercher — pour démarrer, pour décider,
 * l'aiguilleur — et la méthode ; les leçons validées par Channing ; après,
 * les personnes connues de l'équipe ajoutées à la fiche et l'adresse
 * probable de celles qui n'en ont pas, quand le format de la société est
 * prouvé par une vraie adresse (jamais utilisée sans clic).
 */
import { live } from './live';
import { sb, journal, loadSuppressions } from './store';
import { teamFor, type TeamMask } from './team';
import { lessonsBlock } from './lessons';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { fetchPage, hasMx, type AiAgent } from './qualify';
import { draftFirstMail } from './firstMail';
import {
  deepSystem, deepSchema, deepPrompt, mergeDeep, deepSummary, phoneWritten, DEEP_SEARCHES, DEEP_FETCHES,
  type DeepOutput, type DeepProspect, type DeepChecked, type DeepPerson,
} from '../../src/lib/agents/deepResearch';
import { teamPromptLines, teamPeople, withTeamPeople, companyKeys, teamKnownOf, TEAM_SOURCE_LABEL, type TeamMatch, type TeamSource } from '../../src/lib/agents/teamMemory';
import { ROLES_BY_SEGMENT, rolesForKind } from '../../src/lib/agents/roles';
import { provenFormats, withProbableEmails, type KnownPair } from '../../src/lib/agents/emailPattern';
import { emailDomain } from '../../src/lib/agents/people';
import { suppressionMatch } from '../../src/lib/agents/sendPolicy';
import { acceptedLinkedin, EMAIL_OK, HOME_COUNTRY } from '../../src/lib/agents/qualification';
import { lookupLinkedin, discoverLinkedin } from './linkedin';
import { bestFromDiscovered } from '../../src/lib/agents/linkedinLookup';
import { segmentOf } from '../../src/lib/agents/research';
import { mailtoEmails, extractEmails, pageText } from '../../src/lib/agents/dealerPage';
import { HAIKU } from '../../src/lib/agents/aiCost';

export interface DeepOutcome { status: 'enrichi' | 'rien' | 'ignore' | 'echec'; name: string; detail: string; cost: number; prepared: boolean }
type Row = DeepProspect & { id: string; agent: string; stage: string };

const normUrl = (x: string) => x.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
const hostOf = (x: string) => { try { return new URL(x).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

interface ThreadMessage { status: string; channel: string | null; author: string | null; body_text: string | null; ai_notes: { texte_initial?: string | null } | null }
/** Un message que quelqu'un a écrit, ou un mail de l'agente corrigé à la main : ce travail n'est pas jeté. */
const handWork = (m: ThreadMessage) => m.author === 'humain'
  || (m.status !== 'refuse' && m.channel === 'mail' && !!m.ai_notes?.texte_initial && !(m.body_text ?? '').trim().startsWith(m.ai_notes.texte_initial.trim()));

/** Le fil préparé d'une fiche : aucun, préparé sans rien d'envoyé (repréparable), ou vivant (envoyé, reçu, corrigé : on n'y touche pas). */
async function preparedThread(prospectId: string): Promise<{ kind: 'aucun' } | { kind: 'prepare'; id: string } | { kind: 'vivant' }> {
  const { data } = await sb.from('agent_threads').select('id').eq('prospect_id', prospectId).limit(5);
  const threads = (data ?? []) as Array<{ id: string }>;
  if (!threads.length) return { kind: 'aucun' };
  for (const t of threads) {
    const { data: ms } = await sb.from('agent_messages').select('status, channel, author, body_text, ai_notes').eq('thread_id', t.id).limit(50);
    // 20/10 : un brouillon « à valider » (l'aiguillage d'un grand compte, le premier mail d'un petit) n'est pas parti non plus.
    if (((ms ?? []) as ThreadMessage[]).some((m) => !['pour_channing', 'refuse', 'brouillon', 'a_valider'].includes(m.status) || handWork(m))) return { kind: 'vivant' };
  }
  return { kind: 'prepare', id: threads[0].id };
}

/** Ce que la recherche approfondie rend, vérifié par ADA, avant toute écriture sur la fiche ; et ce que l'équipe en savait. */
export interface DeepRun { out: DeepOutput; checked: DeepChecked; cost: number; team: TeamMatch[] }

export interface DeepCoreInput {
  role: 'ada' | 'dana'; p: DeepProspect; a: AiAgent; taskId: string | null;
  note?: string; model?: string; segment?: { key?: string; label: string; roles: string; size: string | null } | null;
  /** Le banc d'essai (19/10) cache l'entreprise testée à la mémoire de l'équipe. */
  mask?: TeamMask;
  /** La fiche en base (l'appel lui est rattaché), ou null : le banc d'essai travaille « à blanc ». */
  prospectId: string | null;
  /** Le banc d'essai (19/10) a sa propre limite de dépense : ses appels ne comptent pas dans le budget du jour. */
  bench?: boolean;
}

/**
 * La recherche elle-même (18/10 ; à part depuis le 19/10 pour le banc d'essai) : l'appel à l'IA, puis le
 * contrôle — chaque e-mail et chaque téléphone relus dans la page citée, le domaine de l'e-mail qui reçoit
 * du courrier, un profil LinkedIn seulement s'il a été vu. Rien n'est écrit ici.
 */
export async function deepCore(i: DeepCoreInput): Promise<DeepRun | { error: string; cost: number }> {
  const { role, p, a, taskId } = i;
  const note = i.note ?? '';
  // 19/10 : ce que l'équipe sait déjà, qui chercher, les leçons de Channing.
  const team = await teamFor(p, i.mask ?? {});
  if (team.length) live(taskId, `${p.name} : déjà connue de l'équipe (${team.length} contact${team.length > 1 ? 's' : ''} : carte, Workflow, mails…)`);
  const segKey = i.segment?.key ?? null;
  const roles = (segKey && ROLES_BY_SEGMENT[role][segKey]) || rolesForKind(role, p.kind);
  const lessons = await lessonsBlock(a.agent, 'recherche', { segment: segKey, kind: p.kind, country: p.country });
  const prompt = deepPrompt({ role, p, segment: i.segment ?? null, note, roles, team: teamPromptLines(team), lessons });
  const named = `${p.name}${p.country ? ` (${p.country})` : ''}`;
  live(taskId, `${named} : recherche approfondie sur le web — ${note.trim() ? 'avec votre consigne' : 'à qui elle appartient, qui décide'} (${DEEP_SEARCHES} recherches au plus)`);
  let out: DeepOutput;
  let cost = 0;
  let seenUrls: string[] = [];
  try {
    const budget = Number(a.daily_budget_usd);
    const r = await callClaude<DeepOutput>({
      // Un budget illisible vaut 0 (pas d'appel), jamais « sans limite » ; le banc d'essai a sa limite à lui.
      // Haiku 5.5 ; une recherche ciblée (notes de Channing, 18/10) passe par Opus 5.5.
      agent: a.agent, budgetUsd: i.bench ? Number.POSITIVE_INFINITY : Number.isFinite(budget) ? budget : 0,
      purpose: i.bench ? 'banc_essai' : 'recherche_approfondie', model: i.model ?? HAIKU,
      system: deepSystem(role), user: prompt, schema: deepSchema(role) as unknown as Record<string, unknown>,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: DEEP_SEARCHES }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: DEEP_FETCHES }],
      // 18/10 : 8 000 jetons ne suffisaient pas toujours (Arval France : réponse coupée) — 16 000, moins de 0,01 $ de plus.
      // 19/10 : la méthode v2 (deux personnes, aiguilleur, fraîcheur) fait réfléchir Haiku plus longtemps sur les grands
      // groupes — 3 réponses coupées sur 10 au banc d'essai. 32 000 (payés seulement s'ils servent), 10 minutes au plus.
      maxTokens: 32_000, timeoutMs: 10 * 60_000, effort: 'medium', prospectId: i.prospectId, taskId,
    });
    cost = r.costUsd;
    if (!r.data) return { error: 'réponse de l\'IA illisible', cost };
    out = r.data;
    seenUrls = r.seenUrls ?? [];
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { error: e instanceof Error ? e.message : String(e), cost: 0 };
  }

  // Le contrôle : chaque e-mail et chaque téléphone relus dans la page citée.
  live(taskId, `${named} : contrôle des e-mails, téléphones et profils LinkedIn trouvés`);
  const pages = new Map<string, string | null>();
  const pageOf = async (url: string): Promise<string | null> => {
    if (!/^https?:\/\//i.test(url)) return null;
    if (!pages.has(url)) pages.set(url, await fetchPage(url, false));
    return pages.get(url) ?? null;
  };
  const emails: DeepChecked['emails'] = p.emails.filter((e) => e.mx).map((e) => ({ email: e.email, nature: e.nature, source: e.source, mx: true }));
  const mailCands = new Map<string, { email: string; nature: string; source: string }>();
  const addMail = (email: string | null | undefined, nature: string, source: string | null | undefined) => {
    const m = String(email ?? '').trim().toLowerCase();
    if (EMAIL_OK.test(m) && source && !mailCands.has(m)) mailCands.set(m, { email: m, nature, source });
  };
  for (const e of out.emails ?? []) addMail(e.email, e.nature, e.source);
  for (const x of out.personnes ?? []) addMail(x.email, 'nominatif', x.source);
  for (const c of mailCands.values()) {
    if (emails.some((e) => e.email === c.email)) continue;
    const html = await pageOf(c.source);
    if (!html || ![...mailtoEmails(html), ...extractEmails(pageText(html, 200_000))].includes(c.email)) continue;
    emails.push({ ...c, mx: await hasMx(c.email.split('@')[1] ?? '') });
  }
  const phones: DeepChecked['phones'] = p.phone ? [{ numero: p.phone, service: 'téléphone de la fiche', source: '' }] : [];
  const phoneCands = [
    ...(out.telephones ?? []).map((t) => ({ numero: t.numero, service: t.service, source: t.source })),
    ...(out.personnes ?? []).filter((x) => x.telephone).map((x) => ({ numero: String(x.telephone), service: x.nom, source: x.source })),
  ];
  for (const t of phoneCands) {
    const d = String(t.numero ?? '').replace(/\D/g, '');
    if (d.length < 8 || phones.some((x) => x.numero.replace(/\D/g, '').endsWith(d.slice(-8)))) continue;
    const html = await pageOf(t.source);
    if (!html) continue;
    const tels = [...html.matchAll(/tel:([^"'\s>]+)/gi)].map((m) => m[1]).join(' ');
    if (phoneWritten(t.numero, `${pageText(html, 200_000)} ${tels}`)) phones.push({ numero: t.numero.trim(), service: t.service, source: t.source });
  }
  const seen = new Set(seenUrls.map(normUrl));
  const seenHosts = new Set(seenUrls.map(hostOf).filter(Boolean));
  const checked: DeepChecked = {
    emails, phones,
    linkedin: (url, name) => acceptedLinkedin(url, name, seenUrls, prompt),
    seen: (url) => !!url && (seen.has(normUrl(url)) || !!pages.get(url) || seenHosts.has(hostOf(url))),
  };
  return { out, checked, cost, team };
}

/**
 * Après la fusion (19/10) : les personnes connues de l'équipe sur la fiche, et l'adresse probable de
 * celles qui n'ont pas d'adresse — dans le format prouvé par une vraie adresse nominative de la
 * société (équipe, ou page lue), sur un domaine de l'entreprise qui reçoit du courrier, jamais une
 * adresse sur « ne plus contacter ».
 */
export async function withTeamAndProbable(p: DeepProspect, people: DeepPerson[], emails: DeepProspect['emails'], team: TeamMatch[]): Promise<DeepPerson[]> {
  const all = withTeamPeople(people, teamPeople(team));
  const pairs: KnownPair[] = [
    ...team.filter((m) => m.person && m.email).map((m) => ({ name: m.person as string, email: m.email as string, source: m.source })),
    ...all.filter((x) => x.email && emails.some((e) => e.email === x.email && e.mx)).map((x) => ({ name: x.nom, email: x.email as string, source: 'page' })),
  ];
  const formats = provenFormats(pairs);
  if (!formats.length) return all;
  // Les domaines de l'entreprise : sa fiche, et ceux par lesquels l'équipe l'a reconnue.
  const keys = companyKeys({ name: p.name, group_name: p.group_name, website: p.website, emails: emails.map((e) => e.email), phone: p.phone, city: p.city, country: p.country });
  const domains = [...new Set([...keys.domains, ...team.filter((m) => m.email && (m.source === 'carte' || m.source === 'workflow' || m.why !== 'nom')).map((m) => emailDomain(m.email))].filter(Boolean))];
  const usable: typeof formats = [];
  for (const f of formats) if (await hasMx(f.domain)) usable.push(f);
  const blocked = await loadSuppressions();
  return withProbableEmails(all, usable, domains, (e) => !!suppressionMatch([e], blocked));
}

export async function deepResearch(prospectId: string, a: AiAgent, taskId: string | null, manual: boolean, note = '', model: string = HAIKU): Promise<DeepOutcome> {
  const { data } = await sb.from('agent_prospects').select('*').eq('id', prospectId).maybeSingle();
  const row = data as Row | null;
  if (!row) return { status: 'echec', name: prospectId, detail: 'fiche introuvable', cost: 0, prepared: false };
  const skip = (detail: string): DeepOutcome => ({ status: 'ignore', name: row.name, detail, cost: 0, prepared: false });
  if (row.agent !== a.agent) return skip(row.agent === 'dana' ? 'fiche de Dana' : 'fiche d\'Ada');
  if (row.stage === 'ecarte') return skip('fiche écartée');
  const role: 'ada' | 'dana' = a.agent === 'dana' ? 'dana' : 'ada';
  if (role === 'ada' && (row.country ?? '').toUpperCase() === HOME_COUNTRY) return skip('entreprise en France : pas un acheteur pour Ada');
  const p: DeepProspect = { ...row, emails: row.emails ?? [], people: row.people ?? [], evidence: row.evidence ?? [], fit_parts: row.fit_parts ?? [] };

  // Une entreprise trouvée par recherche web : son type de compte et qui décide chez elle.
  let segment: { key: string; label: string; roles: string; size: string | null } | null = null;
  if (row.account_id) {
    const { data: acc } = await sb.from('agent_accounts').select('segment, size_hint').eq('id', row.account_id).maybeSingle();
    const x = acc as { segment: string; size_hint: string | null } | null;
    const seg = x ? segmentOf(role, x.segment) : null;
    if (seg) segment = { key: seg.key, label: seg.label, roles: seg.roles, size: x?.size_hint ?? null };
  }
  // La consigne laissée par Channing en lançant la recherche (18/10).
  const run = await deepCore({ role, p, a, taskId, note, model, segment, prospectId: row.id });
  if ('error' in run) return { status: 'echec', name: row.name, detail: run.error, cost: run.cost, prepared: false };
  const { out, checked } = run;
  let cost = run.cost;

  // La fiche complétée, la note à jour ; les personnes connues de l'équipe, les adresses probables (19/10).
  const at = new Date().toISOString();
  const { patch, news } = mergeDeep(p, out, checked, at, cost);
  patch.people = (await withTeamAndProbable(p, patch.people ?? [], patch.emails ?? p.emails, run.team)).slice(0, 20);
  // 20/10 : LinkedIn cherché pour de bon — d'abord PAR POSTE (« acheteur VO » Groupe DMD… : pour 99 % des
  // fiches on n'a aucun nom), puis UN PAR UN pour les personnes nommées sans profil (l'équipe d'abord :
  // Florent Jabouille chez DMD y était, personne ne l'avait cherché).
  let aiStopped = false; // plafond du jour atteint ou IA en panne : la fiche est enregistrée telle quelle
  try {
    const d = await discoverLinkedin(p, patch.people, role, a, taskId, row.id);
    if (d.added) { patch.people = d.people.slice(0, 20); news.personnes += d.added; news.linkedin += d.added; }
    cost += d.cost;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) aiStopped = true; else throw e;
  }
  const li = aiStopped ? null : await lookupLinkedin(p, patch.people, patch.best_contact ?? p.best_contact ?? null, a, taskId, row.id);
  if (li && li.searched) {
    patch.people = li.people;
    const best = patch.best_contact ?? p.best_contact ?? null;
    const bestFound = best?.nom && !best.linkedin ? li.people.find((x) => x.linkedin && x.nom.trim().toLowerCase() === String(best.nom).trim().toLowerCase())?.linkedin ?? null : null;
    if (bestFound && best) patch.best_contact = { ...best, linkedin: bestFound };
    news.linkedin += li.found;
    cost += li.cost;
  }
  // 20/10 : sans contact retenu, le pôle du groupe trouvé sur LinkedIn ; sans pôle, le premier directeur VO de
  // concession — et la fiche dit que les autres sont à contacter un par un.
  const fromLi = bestFromDiscovered(patch.best_contact ?? p.best_contact ?? null, patch.people ?? []);
  if (fromLi && fromLi !== (patch.best_contact ?? p.best_contact ?? null)) { patch.best_contact = fromLi; news.contact = true; }
  let { error } = await sb.from('agent_prospects').update({ ...patch, updated_at: at }).eq('id', row.id);
  if (error && /key_account/.test(error.message)) {
    // SQL agents_comptes pas encore collé : sans la colonne « grand compte ».
    const { key_account: _k, ...legacy } = patch;
    void _k;
    ({ error } = await sb.from('agent_prospects').update({ ...legacy, updated_at: at }).eq('id', row.id));
  }
  if (error) return { status: 'echec', name: row.name, detail: `fiche non enregistrée : ${error.message}`, cost, prepared: false };
  const summary = deepSummary(row.name, news, patch.best_contact ?? null);
  await journal({
    agent: a.agent, actor: a.agent, kind: 'recherche_approfondie', summary,
    details: { prospect_id: row.id, cost_usd: Math.round(cost * 10_000) / 10_000, score: patch.score, ...news },
  });

  // Un grand compte préparé pour Channing (rien d'envoyé) est repréparé avec le nouveau contact ;
  // lancée à la main, la recherche prépare aussi un grand compte qui ne l'était pas — et, 20/10 (Channing : « qu'elle
  // prépare tout le plan, qu'on n'ait plus qu'à valider »), un petit compte : son premier mail, ou l'aiguillage.
  let prepared = false;
  const fresh = news.contact || news.emails > 0 || news.linkedin > 0;
  // 19/10 : une entreprise que l'équipe connaît déjà (Florent Jabouille chez DMD, sur la carte) : rien de préparé d'office,
  // même après une recherche lancée à la main — « Préparer pour vous » reste sur la fiche, pour un choix explicite.
  const known = teamKnownOf(patch.people ?? p.people);
  if (fresh && known.length) {
    const who = known.slice(0, 2).map((x) => `${x.nom}${x.via ? ` (${TEAM_SOURCE_LABEL[x.via as TeamSource] ?? x.via})` : ''}`).join(', ');
    await journal({
      agent: a.agent, actor: a.agent, kind: 'deja_connue',
      summary: `${row.name} : déjà connue de l'équipe (${who}) — rien de préparé d'office ; « Préparer pour vous » reste possible sur la fiche`,
      details: { prospect_id: row.id },
    });
  } else if (fresh) {
    const t = await preparedThread(row.id);
    if (t.kind === 'prepare' || (t.kind === 'aucun' && manual)) {
      if (t.kind === 'prepare') {
        // Rien n'en est parti : la préparation d'avant laisse la place (ses messages, puis le fil).
        await sb.from('agent_messages').delete().eq('thread_id', t.id);
        await sb.from('agent_threads').delete().eq('id', t.id);
      }
      live(taskId, `${row.name}${row.country ? ` (${row.country})` : ''} : ${t.kind === 'prepare' ? 'nouvelle préparation' : 'préparation'} ${patch.key_account ?? row.key_account ? 'pour vous' : 'à valider'}, avec ce qui a été trouvé (IA)`);
      prepared = (await draftFirstMail(row.id, a, taskId, { manual })).status === 'redige';
    }
  }
  return { status: fresh || news.groupe || news.pistes || news.personnes ? 'enrichi' : 'rien', name: row.name, detail: summary, cost, prepared };
}

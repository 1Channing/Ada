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
 */
import { live } from './live';
import { sb, journal } from './store';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { fetchPage, hasMx, type AiAgent } from './qualify';
import { draftFirstMail } from './firstMail';
import {
  deepSystem, deepSchema, deepPrompt, mergeDeep, deepSummary, phoneWritten, DEEP_SEARCHES, DEEP_FETCHES,
  type DeepOutput, type DeepProspect, type DeepChecked,
} from '../../src/lib/agents/deepResearch';
import { acceptedLinkedin, EMAIL_OK, HOME_COUNTRY } from '../../src/lib/agents/qualification';
import { segmentOf } from '../../src/lib/agents/research';
import { mailtoEmails, extractEmails, pageText } from '../../src/lib/agents/dealerPage';
import { HAIKU } from '../../src/lib/agents/aiCost';

export interface DeepOutcome { status: 'enrichi' | 'rien' | 'ignore' | 'echec'; name: string; detail: string; cost: number; prepared: boolean }
type Row = DeepProspect & { id: string; agent: string; stage: string };

const normUrl = (x: string) => x.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
const hostOf = (x: string) => { try { return new URL(x).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** Le fil préparé d'une fiche : aucun, préparé sans rien d'envoyé (repréparable), ou vivant (envoyé, reçu, à valider : on n'y touche pas). */
async function preparedThread(prospectId: string): Promise<{ kind: 'aucun' } | { kind: 'prepare'; id: string } | { kind: 'vivant' }> {
  const { data } = await sb.from('agent_threads').select('id').eq('prospect_id', prospectId).limit(5);
  const threads = (data ?? []) as Array<{ id: string }>;
  if (!threads.length) return { kind: 'aucun' };
  for (const t of threads) {
    const { data: ms } = await sb.from('agent_messages').select('status').eq('thread_id', t.id).limit(50);
    if (((ms ?? []) as Array<{ status: string }>).some((m) => !['pour_channing', 'refuse', 'brouillon'].includes(m.status))) return { kind: 'vivant' };
  }
  return { kind: 'prepare', id: threads[0].id };
}

export async function deepResearch(prospectId: string, a: AiAgent, taskId: string | null, manual: boolean): Promise<DeepOutcome> {
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
  let segment: { label: string; roles: string; size: string | null } | null = null;
  if (row.account_id) {
    const { data: acc } = await sb.from('agent_accounts').select('segment, size_hint').eq('id', row.account_id).maybeSingle();
    const x = acc as { segment: string; size_hint: string | null } | null;
    const seg = x ? segmentOf(role, x.segment) : null;
    if (seg) segment = { label: seg.label, roles: seg.roles, size: x?.size_hint ?? null };
  }
  const prompt = deepPrompt({ role, p, segment });
  const named = `${row.name}${row.country ? ` (${row.country})` : ''}`;
  live(taskId, `${named} : recherche approfondie sur le web — à qui elle appartient, qui décide (${DEEP_SEARCHES} recherches au plus)`);
  let out: DeepOutput;
  let cost = 0;
  let seenUrls: string[] = [];
  try {
    const budget = Number(a.daily_budget_usd);
    const r = await callClaude<DeepOutput>({
      // Un budget illisible vaut 0 (pas d'appel), jamais « sans limite ».
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'recherche_approfondie', model: HAIKU,
      system: deepSystem(role), user: prompt, schema: deepSchema(role) as unknown as Record<string, unknown>,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: DEEP_SEARCHES }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: DEEP_FETCHES }],
      // 18/10 : 8 000 jetons ne suffisaient pas toujours (Arval France : réponse coupée) — 16 000, moins de 0,01 $ de plus.
      maxTokens: 16_000, effort: 'medium', prospectId: row.id, taskId,
    });
    cost = r.costUsd;
    if (!r.data) return { status: 'echec', name: row.name, detail: 'réponse de l\'IA illisible', cost, prepared: false };
    out = r.data;
    seenUrls = r.seenUrls ?? [];
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    return { status: 'echec', name: row.name, detail: e instanceof Error ? e.message : String(e), cost: 0, prepared: false };
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
  const phones: DeepChecked['phones'] = row.phone ? [{ numero: row.phone, service: 'téléphone de la fiche', source: '' }] : [];
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

  // La fiche complétée, la note à jour.
  const at = new Date().toISOString();
  const { patch, news } = mergeDeep(p, out, checked, at, cost);
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
  // lancée à la main, la recherche prépare aussi un grand compte qui ne l'était pas.
  let prepared = false;
  const fresh = news.contact || news.emails > 0 || news.linkedin > 0;
  if (fresh) {
    const t = await preparedThread(row.id);
    if (t.kind === 'prepare' || (t.kind === 'aucun' && manual && patch.key_account)) {
      if (t.kind === 'prepare') {
        // Rien n'en est parti : la préparation d'avant laisse la place (ses messages, puis le fil).
        await sb.from('agent_messages').delete().eq('thread_id', t.id);
        await sb.from('agent_threads').delete().eq('id', t.id);
      }
      live(taskId, `${named} : ${t.kind === 'prepare' ? 'nouvelle préparation' : 'préparation'} pour vous, avec ce qui a été trouvé (IA)`);
      prepared = (await draftFirstMail(row.id, a, taskId)).status === 'redige';
    }
  }
  return { status: fresh || news.groupe || news.pistes || news.personnes ? 'enrichi' : 'rien', name: row.name, detail: summary, cost, prepared };
}

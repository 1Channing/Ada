/**
 * ADA ET DANA — LA FILE DE TRAVAIL (17/10). Les tâches de agent_tasks, une
 * à la fois (réservée par mise à jour conditionnelle ; une tâche coupée par
 * un redémarrage repart en échec) :
 * - « decouverte_concessions » : lire des pages d'annonces d'un site
 *   (AutoScout24, Marktplaats, Leboncoin… — ./discovery.ts) ;
 * - « qualification » : qualifier une série de garages ou de comptes, 10 au
 *   plus (./qualify.ts) ; la série s'arrête au plafond de dépense du jour ;
 * - « recherche_comptes » (étape 2) : chercher sur le web un type de compte
 *   dans un pays (./research.ts) ;
 * - « premier_mail » : rédiger les premiers mails de 5 prospects au plus
 *   (./firstMail.ts), qui entrent dans « À valider ».
 * - « qualification » avec params.approfondie (18/10) : la recherche
 *   approfondie de 5 fiches au plus (./deep.ts) — à qui appartient
 *   l'entreprise, qui décide, comment l'approcher.
 *
 * Le cycle automatique (toutes les 10 min, dans les jours et heures de
 * travail de chaque agente — Réglages, heure de Paris ; du lundi au vendredi,
 * 8 h 30-18 h au départ) pose lui-même des tâches quand les Réglages le
 * permettent :
 * - Ada : jusqu'à 8 découvertes par jour (cibles en rotation sur tous les
 *   sites des pays cibles, 3 pages chacune), les qualifications du jour
 *   (auto_qualify_per_day) parmi les garages de ses pays et marques ;
 * - Dana : ses relevés d'annonces s'ils sont cochés (18/10 : comme Ada,
 *   jusqu'à 8 par jour, la France d'abord puis toute l'Europe, dans ses
 *   marques), les qualifications du jour parmi les garages aux plus gros
 *   lots de véhicules identiques ;
 * - pour les deux : les recherches de comptes du jour
 *   (auto_research_per_day ; types de comptes et pays en rotation, Ada dans
 *   ses pays d'export, Dana dans toute l'Europe), les comptes trouvés étant
 *   qualifiés avant l'annuaire ; les premiers contacts du jour
 *   (auto_draft_per_day) — pas plus de deux jours d'envois en attente de
 *   validation, ni plus de 10 grands comptes en attente dans « Pour
 *   vous » —, dans le budget ;
 * - 18/10 : les recherches approfondies du jour (targets.deepPerDay, 5 au
 *   départ) sur les grands comptes à compléter — la personne qui décide pas
 *   trouvée, ou aucun e-mail publié —, une fois par fiche et par mois ;
 * - 18/10 : le bilan du jour à toute l'équipe MC Export (./recap.ts), dès
 *   que l'agente a fini, sinon à la fin de ses heures — pas avant 7 h.
 * Les tâches automatiques n'ont pas d'auteur.
 */
import { discover } from './discovery';
import { qualifyDealer, qualifyAccount, seriesContext, nextCandidates, nextLotCandidates, nextAccountCandidates, type AiAgent, type SeriesContext } from './qualify';
import { researchAccounts } from './research';
import { refreshSoon } from './indexRefresh';
import { researchPairs, nextResearchPair, segmentOf, RESEARCH_COUNTRIES, COUNTRY_FR, type ResearchParams } from '../../src/lib/agents/research';
import { draftFirstMail, nextDraftCandidates } from './firstMail';
import { deepResearch } from './deep';
import { maybeSendRecap } from './recap';
import { aiConfigured, aiPaused, spentToday, clearAiPause, BudgetReached, AiUnavailable, NO_KEY } from './claude';
import { discoveryPairs, nextDiscoveryPair, discoveryUrl, DISCOVERY_SITE_LABEL, DISCOVERY_SITES, type DiscoveryParams } from '../../src/lib/agents/discovery';
import { normalizeDanaTargets, danaScanCountries } from '../../src/lib/agents/sourcing';
import { ensureLearnedTaxonomy } from '../../src/lib/linkgen/taxonomy';
import { inSendWindow, parisDayStart } from '../../src/lib/agents/sendPolicy';
import { fmtUsd } from '../../src/lib/agents/aiCost';
import { aiProblemOf } from '../../src/lib/agents/aiErrors';
import { isIncomplete, deepPerDayOf, lastDeepAt, type DeepEvidence } from '../../src/lib/agents/deepResearch';
import { sb, journal, loadAgents } from './store';
import { live, liveDone } from './live';

const STUCK_MS = 45 * 60 * 1000;
const MAX_SERIES = 10;
const AUTO_DISCOVERIES_PER_DAY = 8;
const AUTO_DISCOVERY_GAP_MS = 45 * 60 * 1000;
const AUTO_RESEARCH_GAP_MS = 90 * 60 * 1000;
/** Grands comptes préparés et pas encore traités par Channing : au-delà, l'agente n'en prépare pas d'autres. */
const KEY_ACCOUNT_BACKLOG = 10;
/** Une recherche approfondie : 5 fiches au plus par tâche, chacune une fois par mois (sauf à la main). */
const MAX_DEEP_SERIES = 5;
const DEEP_AGAIN_MS = 30 * 86_400_000;

interface Task { id: string; agent: string; kind: string; params: Record<string, unknown>; created_by: string | null }

const missing = (m: string) => /does not exist|schema cache|column/i.test(m);
const label = (p: Partial<DiscoveryParams>) =>
  `${DISCOVERY_SITE_LABEL[String(p.site ?? 'AUTOSCOUT').toUpperCase()] ?? p.site} ${p.country ?? '?'} · ${p.brand ?? '?'}${p.model ? ` ${p.model}` : ''}${p.vans ? ' (utilitaires)' : ''}`;
const researchLabel = (agent: string, p: Partial<ResearchParams>) => {
  const seg = segmentOf(agent === 'dana' ? 'dana' : 'ada', p.segment);
  const c = String(p.country ?? '?').toUpperCase();
  return `${seg ? seg.label.toLowerCase() : p.segment ?? '?'} · ${COUNTRY_FR[c] ?? c}`;
};

/** Ce que la tâche va faire, en clair (première ligne de l'onglet Live). */
function startLabel(t: Task): string {
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  if (t.kind === 'qualification' && t.params.approfondie) {
    const k = n(t.params.prospect_ids);
    return `recherche approfondie de ${k} fiche${k > 1 ? 's' : ''}`;
  }
  if (t.kind === 'qualification') {
    const k = n(t.params.account_ids) + n(t.params.dealer_ids);
    return `${k} fiche${k > 1 ? 's' : ''} à préparer`;
  }
  if (t.kind === 'premier_mail') { const k = n(t.params.prospect_ids); return `${k} premier${k > 1 ? 's' : ''} mail${k > 1 ? 's' : ''} à écrire`; }
  if (t.kind === 'recherche_comptes') return `recherche web — ${researchLabel(t.agent, t.params)}`;
  return `relevé d'annonces — ${label(t.params)}`;
}

async function agentRow(agent: string): Promise<AiAgent | null> {
  return ((await loadAgents()) as AiAgent[]).find((a) => a.agent === agent) ?? null;
}

async function runQualification(t: Task): Promise<{ result: Record<string, unknown>; summary: string }> {
  const a = await agentRow(t.agent);
  if (!a) throw new Error('agente introuvable');
  if (!aiConfigured()) throw new AiUnavailable(NO_KEY);
  // Les comptes trouvés par recherche d'abord, puis les garages de l'annuaire : 10 au plus en tout.
  const accountIds = (Array.isArray(t.params.account_ids) ? t.params.account_ids : []).map(String).slice(0, MAX_SERIES);
  const dealerIds = (Array.isArray(t.params.dealer_ids) ? t.params.dealer_ids : []).map(String).slice(0, MAX_SERIES - accountIds.length);
  const items = [...accountIds.map((id) => ({ id, account: true })), ...dealerIds.map((id) => ({ id, account: false }))];
  if (items.length === 0) throw new Error('aucun garage ni compte pour une fiche');
  const ctx = await seriesContext(a, t.id);
  // echecs_ids : ce qui a vraiment échoué (attend 3 jours) ; une panne de l'IA ou un arrêt ne retient rien.
  const r = { garages: dealerIds.length, comptes: accountIds.length, qualifies: 0, ecartes: 0, echecs: 0, carte: 0, cout_usd: 0, arret: null as string | null, details: [] as string[], echecs_ids: [] as string[] };
  const failed = (id: string, detail: string) => { r.echecs++; r.details.push(detail); if (!aiProblemOf(detail)) r.echecs_ids.push(id); };
  for (const [i, { id, account }] of items.entries()) {
    live(t.id, `Fiche ${i + 1} sur ${items.length}`, { done: i, total: items.length });
    try {
      const o = account ? await qualifyAccount(id, ctx) : await qualifyDealer(id, ctx);
      r.cout_usd += o.cost;
      if (o.status === 'qualifie') r.qualifies++;
      else if (o.status === 'ecarte') r.ecartes++;
      else failed(id, `${o.name} : ${o.detail}`);
      if (o.addedToMap) r.carte++;
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) { r.arret = e.message; break; }
      failed(id, e instanceof Error ? e.message : String(e));
    }
  }
  r.cout_usd = Math.round(r.cout_usd * 10_000) / 10_000;
  if (r.qualifies + r.ecartes === 0 && r.arret) throw new Error(r.arret);
  const what = [dealerIds.length ? `${dealerIds.length} garage${dealerIds.length > 1 ? 's' : ''}` : '', accountIds.length ? `${accountIds.length} compte${accountIds.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' et ');
  const summary = `Fiches de ${what} : ${r.qualifies} prête${r.qualifies > 1 ? 's' : ''}, ${r.ecartes} écarté${r.ecartes > 1 ? 's' : ''}`
    + `${r.echecs ? `, ${r.echecs} en échec` : ''}${r.carte ? `, ${r.carte} ajouté${r.carte > 1 ? 's' : ''} à la carte` : ''} — ${fmtUsd(r.cout_usd)}${r.arret ? ` (arrêt : ${r.arret})` : ''}`;
  return { result: r, summary };
}

/** La recherche approfondie d'une série de fiches (5 au plus) ; elle s'arrête au plafond de dépense ou à une panne de l'IA. */
async function runDeep(t: Task): Promise<{ result: Record<string, unknown>; summary: string }> {
  const a = await agentRow(t.agent);
  if (!a) throw new Error('agente introuvable');
  if (!aiConfigured()) throw new AiUnavailable(NO_KEY);
  const ids = (Array.isArray(t.params.prospect_ids) ? t.params.prospect_ids : []).map(String).slice(0, MAX_DEEP_SERIES);
  if (ids.length === 0) throw new Error('aucune fiche à approfondir');
  const r = { approfondie: true, fiches: ids.length, enrichies: 0, rien: 0, ignorees: 0, echecs: 0, preparees: 0, cout_usd: 0, arret: null as string | null, details: [] as string[] };
  for (const [i, id] of ids.entries()) {
    live(t.id, `Fiche ${i + 1} sur ${ids.length}`, { done: i, total: ids.length });
    try {
      const o = await deepResearch(id, a, t.id, !!t.created_by);
      r.cout_usd += o.cost;
      if (o.status === 'enrichi') r.enrichies++;
      else if (o.status === 'rien') r.rien++;
      else if (o.status === 'ignore') { r.ignorees++; r.details.push(`${o.name} : ${o.detail}`); }
      else { r.echecs++; r.details.push(`${o.name} : ${o.detail}`); }
      if (o.prepared) r.preparees++;
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) { r.arret = e.message; break; }
      r.echecs++;
      r.details.push(e instanceof Error ? e.message : String(e));
    }
  }
  r.cout_usd = Math.round(r.cout_usd * 10_000) / 10_000;
  if (r.enrichies + r.rien === 0 && r.arret) throw new Error(r.arret);
  const k = ids.length;
  const summary = `Recherche approfondie de ${k} fiche${k > 1 ? 's' : ''} : ${r.enrichies} complétée${r.enrichies > 1 ? 's' : ''}`
    + `${r.rien ? `, ${r.rien} sans rien de plus de sûr` : ''}${r.preparees ? `, ${r.preparees} préparée${r.preparees > 1 ? 's' : ''} pour vous` : ''}`
    + `${r.echecs ? `, ${r.echecs} en échec` : ''} — ${fmtUsd(r.cout_usd)}${r.arret ? ` (arrêt : ${r.arret})` : ''}`;
  return { result: r, summary };
}

async function runDrafts(t: Task): Promise<{ result: Record<string, unknown>; summary: string }> {
  const a = await agentRow(t.agent);
  if (!a) throw new Error('agente introuvable');
  if (!aiConfigured()) throw new AiUnavailable(NO_KEY);
  const ids = (Array.isArray(t.params.prospect_ids) ? t.params.prospect_ids : []).map(String).slice(0, 5);
  if (ids.length === 0) throw new Error('aucun prospect');
  const r = { prospects: ids.length, rediges: 0, ignores: 0, echecs: 0, cout_usd: 0, arret: null as string | null, details: [] as string[] };
  for (const [i, id] of ids.entries()) {
    live(t.id, `Mail ${i + 1} sur ${ids.length}`, { done: i, total: ids.length });
    try {
      const o = await draftFirstMail(id, a, t.id);
      r.cout_usd += o.cost;
      if (o.status === 'redige') r.rediges++;
      else { if (o.status === 'ignore') r.ignores++; else r.echecs++; r.details.push(`${o.name} : ${o.detail}`); }
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) { r.arret = e.message; break; }
      r.echecs++;
      r.details.push(e instanceof Error ? e.message : String(e));
    }
  }
  r.cout_usd = Math.round(r.cout_usd * 10_000) / 10_000;
  if (r.rediges === 0 && r.arret) throw new Error(r.arret);
  const summary = `Premiers contacts : ${r.rediges} rédigé${r.rediges > 1 ? 's' : ''} (à valider ou pour vous)${r.ignores ? `, ${r.ignores} ignoré${r.ignores > 1 ? 's' : ''}` : ''}${r.echecs ? `, ${r.echecs} en échec` : ''} — ${fmtUsd(r.cout_usd)}${r.arret ? ` (arrêt : ${r.arret})` : ''}`;
  return { result: r, summary };
}

let running = false;

/** Traite la prochaine tâche en attente (une à la fois). */
export async function runNextTask(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Tâche coupée par un redémarrage : échec explicite (on ne la relance pas d'office).
    await sb.from('agent_tasks').update({ status: 'echec', error: 'Interrompue par un redémarrage du worker — relancez-la.', finished_at: new Date().toISOString() })
      .eq('status', 'en_cours').lt('started_at', new Date(Date.now() - STUCK_MS).toISOString());
    const { data, error } = await sb.from('agent_tasks').select('id, agent, kind, params, created_by')
      .eq('status', 'en_attente').order('created_at', { ascending: true }).limit(1);
    if (error) { if (!missing(error.message)) console.warn(`[AGENTS] tâches illisibles : ${error.message}`); return; }
    const t = ((data ?? []) as Task[])[0];
    if (!t) return;
    const { data: claimed } = await sb.from('agent_tasks').update({ status: 'en_cours', started_at: new Date().toISOString() })
      .eq('id', t.id).eq('status', 'en_attente').select('id');
    if (!claimed || (claimed as unknown[]).length === 0) return;
    const auto = t.created_by ? '' : ' (automatique)';
    // Lancée par une personne : on réessaie l'IA tout de suite (crédits ajoutés, clé corrigée…).
    if (t.created_by) clearAiPause();
    live(t.id, `Démarrage : ${startLabel(t)}${auto}`);
    try {
      if (t.kind === 'decouverte_concessions') {
        const result = await discover(t.params, t.id);
        await liveDone(t.id);
        await sb.from('agent_tasks').update({ status: 'terminee', result, finished_at: new Date().toISOString() }).eq('id', t.id);
        // Les garages et les lots trouvés apparaissent après le prochain calcul de l'annuaire.
        if (Number(result.concessions) > 0) refreshSoon('découverte');
        await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: 'decouverte',
          summary: `Découverte ${label(t.params)}${auto} : ${result.annonces} annonces lues, ${result.avec_garage} avec leur garage, ${result.concessions} concessions (dont ${result.nouvelles} nouvelles)`, details: result });
      } else if (t.kind === 'qualification') {
        const deep = !!t.params.approfondie;
        const { result, summary } = deep ? await runDeep(t) : await runQualification(t);
        await liveDone(t.id);
        await sb.from('agent_tasks').update({ status: 'terminee', result, finished_at: new Date().toISOString() }).eq('id', t.id);
        await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: deep ? 'recherche_approfondie_serie' : 'qualification_serie', summary: `${summary}${auto}`, details: result });
      } else if (t.kind === 'premier_mail') {
        const { result, summary } = await runDrafts(t);
        await liveDone(t.id);
        await sb.from('agent_tasks').update({ status: 'terminee', result, finished_at: new Date().toISOString() }).eq('id', t.id);
        await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: 'premiers_mails', summary: `${summary}${auto}`, details: result });
      } else if (t.kind === 'recherche_comptes') {
        const a = await agentRow(t.agent);
        if (!a) throw new Error('agente introuvable');
        if (!aiConfigured()) throw new AiUnavailable(NO_KEY);
        const { result, summary } = await researchAccounts(t.id, t.params, a);
        await liveDone(t.id);
        await sb.from('agent_tasks').update({ status: 'terminee', result, finished_at: new Date().toISOString() }).eq('id', t.id);
        await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: 'recherche_comptes', summary: `${summary}${auto}`, details: result as unknown as Record<string, unknown> });
      } else {
        throw new Error(`tâche inconnue : ${t.kind}`);
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await liveDone(t.id);
      await sb.from('agent_tasks').update({ status: 'echec', error: msg, finished_at: new Date().toISOString() }).eq('id', t.id);
      const what = t.kind === 'qualification' ? (t.params.approfondie ? 'Recherche approfondie' : 'Préparation des fiches') : t.kind === 'premier_mail' ? 'Rédaction des premiers mails'
        : t.kind === 'recherche_comptes' ? `Recherche ${researchLabel(t.agent, t.params)}` : `Découverte ${label(t.params)}`;
      await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: `${t.kind === 'decouverte_concessions' ? 'decouverte' : t.kind}_echec`, summary: `${what}${auto} en échec : ${msg}` });
    }
  } catch (e) {
    console.warn(`[AGENTS] tâche en échec : ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
  }
}

// --- Le cycle automatique -------------------------------------------------------------------

/**
 * Les tâches qui comptent pour le rythme et la rotation : pas celles en échec ni les annulées — après une
 * panne (clé, crédits), l'agente reprend tout de suite, par ce qui avait échoué.
 */
const done = <T extends { status?: string }>(rows: T[]): T[] => rows.filter((h) => h.status !== 'echec' && h.status !== 'annulee');

/** Une tâche de ce genre attend ou tourne. Pour les fiches, la recherche approfondie (params.approfondie) compte à part. */
async function pending(agent: string, kind: string, deep = false): Promise<boolean> {
  const { data } = await sb.from('agent_tasks').select('id, params').eq('agent', agent).eq('kind', kind).in('status', ['en_attente', 'en_cours']).limit(20);
  const rows = (data ?? []) as Array<{ params: { approfondie?: boolean } | null }>;
  return kind === 'qualification' ? rows.some((t) => !!t.params?.approfondie === deep) : rows.length > 0;
}

async function autoDiscovery(a: AiAgent, countries: string[], brands: string[], vanBrands: string[]): Promise<void> {
  if (!a.auto_discovery || await pending(a.agent, 'decouverte_concessions')) return;
  const { data } = await sb.from('agent_tasks').select('params, created_at, created_by, status').eq('agent', a.agent).eq('kind', 'decouverte_concessions')
    .order('created_at', { ascending: false }).limit(300);
  const history = done((data ?? []) as Array<{ params: Partial<DiscoveryParams> | null; created_at: string; created_by: string | null; status?: string }>);
  const autoOnes = history.filter((h) => !h.created_by);
  const dayStart = parisDayStart(new Date()).getTime();
  if (autoOnes.filter((h) => Date.parse(h.created_at) >= dayStart).length >= AUTO_DISCOVERIES_PER_DAY) return;
  if (autoOnes[0] && Date.now() - Date.parse(autoOnes[0].created_at) < AUTO_DISCOVERY_GAP_MS) return;
  // Une marque pas encore apprise sur un site : la découverte est sautée (elle reviendra quand ADA la connaîtra).
  await ensureLearnedTaxonomy().catch(() => undefined);
  const usable = (p: DiscoveryParams) => { try { discoveryUrl(p); return true; } catch { return false; } };
  const next = nextDiscoveryPair(discoveryPairs(countries, brands, vanBrands), history, usable);
  if (!next) return;
  const { error } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'decouverte_concessions', params: { ...next, pages: 3 }, created_by: null });
  if (error) console.warn(`[AGENTS] découverte automatique non posée : ${error.message}`);
}

async function autoQualify(a: AiAgent): Promise<void> {
  if (!aiConfigured() || aiPaused() || !(a.auto_qualify_per_day > 0) || await pending(a.agent, 'qualification')) return;
  const dayStart = parisDayStart(new Date()).toISOString();
  const { data } = await sb.from('agent_prospects').select('id').eq('agent', a.agent).gte('qualified_at', dayStart).limit(1000);
  const remaining = a.auto_qualify_per_day - ((data ?? []) as unknown[]).length;
  const budget = Number(a.daily_budget_usd);
  if (remaining <= 0 || !Number.isFinite(budget) || (await spentToday(a.agent)) >= budget) return;
  const ctx = await seriesContext(a, null);
  const n = Math.min(MAX_SERIES, remaining);
  // Les comptes trouvés par recherche d'abord ; puis, Ada : des acheteurs dans ses pays et ses marques ; Dana : les garages aux plus gros lots.
  const accountIds = await nextAccountCandidates(ctx, n);
  const dealerIds = accountIds.length >= n ? [] : ctx.role === 'dana' ? await nextLotCandidates(ctx, n - accountIds.length) : await nextCandidates(ctx, n - accountIds.length);
  if (accountIds.length + dealerIds.length === 0) return;
  const params: Record<string, unknown> = { auto: true };
  if (accountIds.length) params.account_ids = accountIds;
  if (dealerIds.length) params.dealer_ids = dealerIds;
  const { error } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'qualification', params, created_by: null });
  if (error) console.warn(`[AGENTS] qualification automatique non posée : ${error.message}`);
}

/**
 * Les recherches de comptes du jour (auto_research_per_day), 90 minutes au
 * moins entre deux : chaque type de compte dans chaque pays, une fois, puis
 * de nouveau au bout de 30 jours. Ada dans ses pays d'export, Dana dans toute
 * l'Europe (la France d'abord).
 */
async function autoResearch(a: AiAgent, ctx: SeriesContext): Promise<void> {
  const perDay = Number(a.auto_research_per_day ?? 0);
  if (!aiConfigured() || aiPaused() || !(perDay > 0) || await pending(a.agent, 'recherche_comptes')) return;
  const budget = Number(a.daily_budget_usd);
  if (!Number.isFinite(budget) || (await spentToday(a.agent)) >= budget) return;
  const { data } = await sb.from('agent_tasks').select('params, created_at, created_by, status').eq('agent', a.agent).eq('kind', 'recherche_comptes')
    .order('created_at', { ascending: false }).limit(500);
  const history = done((data ?? []) as Array<{ params: Partial<ResearchParams> | null; created_at: string; created_by: string | null; status?: string }>);
  const autoOnes = history.filter((h) => !h.created_by);
  const dayStart = parisDayStart(new Date()).getTime();
  if (autoOnes.filter((h) => Date.parse(h.created_at) >= dayStart).length >= perDay) return;
  if (autoOnes[0] && Date.now() - Date.parse(autoOnes[0].created_at) < AUTO_RESEARCH_GAP_MS) return;
  const next = nextResearchPair(researchPairs(ctx.role, ctx.role === 'dana' ? RESEARCH_COUNTRIES : ctx.targetCountries), history);
  if (!next) return;
  const { error } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'recherche_comptes', params: { ...next, auto: true }, created_by: null });
  if (error && !missing(error.message)) console.warn(`[AGENTS] recherche automatique non posée : ${error.message}`);
}

/**
 * Les recherches approfondies du jour (targets.deepPerDay, 5 au départ) :
 * les grands comptes à compléter — la personne qui décide pas trouvée, ou
 * aucun e-mail publié —, les mieux notés d'abord, chacun une fois par mois
 * (une recherche en échec ou annulée ne compte pas : elle est reprise).
 */
export async function autoDeep(a: AiAgent): Promise<void> {
  const perDay = deepPerDayOf(a.targets);
  if (!aiConfigured() || aiPaused() || perDay <= 0 || await pending(a.agent, 'qualification', true)) return;
  const budget = Number(a.daily_budget_usd);
  if (!Number.isFinite(budget) || (await spentToday(a.agent)) >= budget) return;
  const dayStart = parisDayStart(new Date());
  const { data } = await sb.from('agent_tasks').select('params, created_at, created_by, status').eq('agent', a.agent).eq('kind', 'qualification')
    .gte('created_at', dayStart.toISOString()).order('created_at', { ascending: false }).limit(500);
  // Aujourd'hui : les fiches confiées (une panne ou une annulation ne compte pas, elles sont reprises) ; chacune une fois par jour au plus.
  const todayRows = done((data ?? []) as Array<{ params: { approfondie?: boolean; prospect_ids?: string[] } | null; created_at: string; created_by: string | null; status?: string }>)
    .filter((t) => t.params?.approfondie);
  const used = todayRows.filter((t) => !t.created_by).reduce((n, t) => n + (t.params?.prospect_ids?.length ?? 0), 0);
  const remaining = perDay - used;
  if (remaining <= 0) return;
  const triedToday = new Set(todayRows.flatMap((t) => t.params?.prospect_ids ?? []));
  const { data: ps, error } = await sb.from('agent_prospects').select('id, best_contact, emails, score, evidence')
    .eq('agent', a.agent).eq('key_account', true).in('stage', ['qualifie', 'a_contacter']).order('score', { ascending: false }).limit(200);
  if (error) return; // SQL agents_comptes pas encore collé : pas de grand compte
  // Une fois par mois : la date de la dernière recherche se lit sur la fiche (une recherche ratée n'en laisse pas, elle est reprise le lendemain).
  const monthAgo = Date.now() - DEEP_AGAIN_MS;
  const ids = ((ps ?? []) as Array<{ id: string; best_contact: { nom: string | null } | null; emails: Array<{ email: string; mx: boolean }> | null; evidence: DeepEvidence[] | null }>)
    .filter((p) => !triedToday.has(p.id) && Date.parse(lastDeepAt(p.evidence) ?? '1970-01-01') < monthAgo
      && isIncomplete({ best_contact: p.best_contact as never, emails: (p.emails ?? []) as never }))
    .slice(0, Math.min(MAX_DEEP_SERIES, remaining)).map((p) => p.id);
  if (ids.length === 0) return;
  const { error: e2 } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'qualification', params: { prospect_ids: ids, approfondie: true, auto: true }, created_by: null });
  if (e2) console.warn(`[AGENTS] recherche approfondie automatique non posée : ${e2.message}`);
}

async function autoDraft(a: AiAgent): Promise<void> {
  if (!aiConfigured() || aiPaused() || !((a.auto_draft_per_day ?? 0) > 0) || await pending(a.agent, 'premier_mail')) return;
  const dayStart = parisDayStart(new Date()).toISOString();
  // Un premier contact = un fil (un grand compte en compte deux messages : le mail et la note LinkedIn).
  const threads = (rows: unknown) => new Set(((rows ?? []) as Array<{ thread_id: string }>).map((m) => m.thread_id)).size;
  const { data: today } = await sb.from('agent_messages').select('thread_id').eq('agent', a.agent).eq('author', a.agent).eq('kind', 'premier_contact').gte('created_at', dayStart).limit(500);
  const remaining = (a.auto_draft_per_day ?? 0) - threads(today);
  // Pas plus de deux jours d'envois qui attendent la validation : l'agente n'empile pas.
  const { data: waiting } = await sb.from('agent_messages').select('thread_id').eq('agent', a.agent).eq('kind', 'premier_contact').in('status', ['a_valider', 'valide']).limit(500);
  const { data: forYou } = await sb.from('agent_messages').select('thread_id').eq('agent', a.agent).eq('status', 'pour_channing').limit(500);
  const allow = { small: threads(waiting) < 2 * Math.max(1, a.daily_first_contact_cap), big: threads(forYou) < KEY_ACCOUNT_BACKLOG };
  const budget = Number(a.daily_budget_usd);
  if (remaining <= 0 || (!allow.small && !allow.big) || !Number.isFinite(budget) || (await spentToday(a.agent)) >= budget) return;
  const ids = await nextDraftCandidates(a, Math.min(5, remaining), allow);
  if (ids.length === 0) return;
  const { error } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'premier_mail', params: { prospect_ids: ids, auto: true }, created_by: null });
  if (error) console.warn(`[AGENTS] premiers mails automatiques non posés : ${error.message}`);
}

/** Le cycle, pour Ada puis Dana : chacune dans ses jours et heures de travail (Réglages, heure de Paris — les mêmes que pour l'envoi). */
export async function autoCycle(): Promise<void> {
  for (const agent of ['ada', 'dana']) {
    try {
      const a = await agentRow(agent);
      if (!a || a.targets == null) continue; // SQL du 17/10 (qualification) pas encore collé
      // Le bilan du jour à l'équipe (18/10) : dès qu'elle a fini, ou à la fin de ses heures — donc aussi hors de ses heures.
      await maybeSendRecap(a).catch((e: unknown) => console.warn(`[AGENTS] bilan du jour (${agent}) : ${e instanceof Error ? e.message : String(e)}`));
      if (!inSendWindow(new Date(), a)) continue;
      // Dana attend ses réglages (SQL agents_comptes : taille des lots, pays de vente).
      if (agent === 'dana' && !(a.targets && typeof a.targets === 'object' && 'minLot' in a.targets)) continue;
      const ctx = await seriesContext(a, null);
      // Les relevés d'annonces (sans IA) : Ada dans ses pays d'export ; Dana partout, la France d'abord, dans ses marques.
      if (agent === 'ada') await autoDiscovery(a, ctx.targetCountries, ctx.targets.brands, ctx.targets.vanBrands);
      else await autoDiscovery(a, danaScanCountries(Object.keys(DISCOVERY_SITES)), normalizeDanaTargets(a.targets).brands, []);
      await autoResearch(a, ctx);
      await autoQualify(a);
      await autoDeep(a);
      await autoDraft(a);
    } catch (e) {
      console.warn(`[AGENTS] cycle automatique (${agent}) : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

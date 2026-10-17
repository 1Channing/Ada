/**
 * ADA ET DANA — LA FILE DE TRAVAIL (17/10). Les tâches de agent_tasks, une
 * à la fois (réservée par mise à jour conditionnelle ; une tâche coupée par
 * un redémarrage repart en échec) :
 * - « decouverte_concessions » : lire des pages AutoScout24 (./discovery.ts) ;
 * - « qualification » : qualifier une série de garages, 10 au plus
 *   (./qualify.ts) ; la série s'arrête au plafond de dépense du jour ;
 * - « premier_mail » : rédiger les premiers mails de 5 prospects au plus
 *   (./firstMail.ts), qui entrent dans « À valider ».
 *
 * Le cycle automatique (toutes les 10 min, du lundi au vendredi, 8 h-19 h à
 * Paris) pose lui-même des tâches quand les Réglages le permettent :
 * jusqu'à 6 découvertes par jour (cibles en rotation, 3 pages chacune), les
 * qualifications du jour (auto_qualify_per_day) et les premiers mails du
 * jour (auto_draft_per_day ; pas plus de deux jours d'envois en attente de
 * validation), dans le budget. Les tâches automatiques n'ont pas d'auteur.
 */
import { discover } from './discovery';
import { qualifyDealer, seriesContext, nextCandidates, type AiAgent } from './qualify';
import { draftFirstMail, nextDraftCandidates } from './firstMail';
import { aiConfigured, spentToday, BudgetReached, AiUnavailable } from './claude';
import { discoveryPairs, nextDiscoveryPair, type DiscoveryParams } from '../../src/lib/agents/discovery';
import { parisClock, parisDayStart } from '../../src/lib/agents/sendPolicy';
import { fmtUsd } from '../../src/lib/agents/aiCost';
import { sb, journal, loadAgents } from './store';

const STUCK_MS = 45 * 60 * 1000;
const MAX_SERIES = 10;
const AUTO_DISCOVERIES_PER_DAY = 6;
const AUTO_DISCOVERY_GAP_MS = 60 * 60 * 1000;

interface Task { id: string; agent: string; kind: string; params: Record<string, unknown>; created_by: string | null }

const missing = (m: string) => /does not exist|schema cache|column/i.test(m);
const label = (p: Partial<DiscoveryParams>) => `${p.country ?? '?'} · ${p.brand ?? '?'}${p.model ? ` ${p.model}` : ''}${p.vans ? ' (utilitaires)' : ''}`;

async function agentRow(agent: string): Promise<AiAgent | null> {
  return ((await loadAgents()) as AiAgent[]).find((a) => a.agent === agent) ?? null;
}

async function runQualification(t: Task): Promise<{ result: Record<string, unknown>; summary: string }> {
  const a = await agentRow(t.agent);
  if (!a) throw new Error('agente introuvable');
  if (!aiConfigured()) throw new AiUnavailable('ANTHROPIC_API_KEY absente sur le worker : l\'IA d\'Ada n\'est pas branchée.');
  const ids = (Array.isArray(t.params.dealer_ids) ? t.params.dealer_ids : []).map(String).slice(0, MAX_SERIES);
  if (ids.length === 0) throw new Error('aucun garage à qualifier');
  const ctx = await seriesContext(a, t.id);
  const r = { garages: ids.length, qualifies: 0, ecartes: 0, echecs: 0, carte: 0, cout_usd: 0, arret: null as string | null, details: [] as string[] };
  for (const id of ids) {
    try {
      const o = await qualifyDealer(id, ctx);
      r.cout_usd += o.cost;
      if (o.status === 'qualifie') r.qualifies++;
      else if (o.status === 'ecarte') r.ecartes++;
      else { r.echecs++; r.details.push(`${o.name} : ${o.detail}`); }
      if (o.addedToMap) r.carte++;
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) { r.arret = e.message; break; }
      r.echecs++;
      r.details.push(e instanceof Error ? e.message : String(e));
    }
  }
  r.cout_usd = Math.round(r.cout_usd * 10_000) / 10_000;
  if (r.qualifies + r.ecartes === 0 && r.arret) throw new Error(r.arret);
  const summary = `Qualification de ${ids.length} garage${ids.length > 1 ? 's' : ''} : ${r.qualifies} qualifié${r.qualifies > 1 ? 's' : ''}, ${r.ecartes} écarté${r.ecartes > 1 ? 's' : ''}`
    + `${r.echecs ? `, ${r.echecs} en échec` : ''}${r.carte ? `, ${r.carte} ajouté${r.carte > 1 ? 's' : ''} à la carte` : ''} — ${fmtUsd(r.cout_usd)}${r.arret ? ` (arrêt : ${r.arret})` : ''}`;
  return { result: r, summary };
}

async function runDrafts(t: Task): Promise<{ result: Record<string, unknown>; summary: string }> {
  const a = await agentRow(t.agent);
  if (!a) throw new Error('agente introuvable');
  if (!aiConfigured()) throw new AiUnavailable('ANTHROPIC_API_KEY absente sur le worker : l\'IA d\'Ada n\'est pas branchée.');
  const ids = (Array.isArray(t.params.prospect_ids) ? t.params.prospect_ids : []).map(String).slice(0, 5);
  if (ids.length === 0) throw new Error('aucun prospect');
  const r = { prospects: ids.length, rediges: 0, ignores: 0, echecs: 0, cout_usd: 0, arret: null as string | null, details: [] as string[] };
  for (const id of ids) {
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
  const summary = `Premiers mails : ${r.rediges} rédigé${r.rediges > 1 ? 's' : ''} (à valider)${r.ignores ? `, ${r.ignores} ignoré${r.ignores > 1 ? 's' : ''}` : ''}${r.echecs ? `, ${r.echecs} en échec` : ''} — ${fmtUsd(r.cout_usd)}${r.arret ? ` (arrêt : ${r.arret})` : ''}`;
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
    try {
      if (t.kind === 'decouverte_concessions') {
        const result = await discover(t.params);
        await sb.from('agent_tasks').update({ status: 'terminee', result, finished_at: new Date().toISOString() }).eq('id', t.id);
        await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: 'decouverte',
          summary: `Découverte ${label(t.params)}${auto} : ${result.annonces} annonces lues, ${result.concessions} concessions (dont ${result.nouvelles} nouvelles)`, details: result });
      } else if (t.kind === 'qualification') {
        const { result, summary } = await runQualification(t);
        await sb.from('agent_tasks').update({ status: 'terminee', result, finished_at: new Date().toISOString() }).eq('id', t.id);
        await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: 'qualification_serie', summary: `${summary}${auto}`, details: result });
      } else if (t.kind === 'premier_mail') {
        const { result, summary } = await runDrafts(t);
        await sb.from('agent_tasks').update({ status: 'terminee', result, finished_at: new Date().toISOString() }).eq('id', t.id);
        await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: 'premiers_mails', summary: `${summary}${auto}`, details: result });
      } else {
        throw new Error(`tâche inconnue : ${t.kind}`);
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await sb.from('agent_tasks').update({ status: 'echec', error: msg, finished_at: new Date().toISOString() }).eq('id', t.id);
      const what = t.kind === 'qualification' ? 'Qualification' : t.kind === 'premier_mail' ? 'Rédaction des premiers mails' : `Découverte ${label(t.params)}`;
      await journal({ agent: t.agent, actor: 'systeme', actorId: t.created_by, kind: `${t.kind === 'decouverte_concessions' ? 'decouverte' : t.kind}_echec`, summary: `${what}${auto} en échec : ${msg}` });
    }
  } catch (e) {
    console.warn(`[AGENTS] tâche en échec : ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
  }
}

// --- Le cycle automatique -------------------------------------------------------------------

async function pending(agent: string, kind: string): Promise<boolean> {
  const { data } = await sb.from('agent_tasks').select('id').eq('agent', agent).eq('kind', kind).in('status', ['en_attente', 'en_cours']).limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}

async function autoDiscovery(a: AiAgent, countries: string[], brands: string[], vanBrands: string[]): Promise<void> {
  if (!a.auto_discovery || await pending(a.agent, 'decouverte_concessions')) return;
  const { data } = await sb.from('agent_tasks').select('params, created_at, created_by').eq('agent', a.agent).eq('kind', 'decouverte_concessions')
    .order('created_at', { ascending: false }).limit(300);
  const history = (data ?? []) as Array<{ params: Partial<DiscoveryParams> | null; created_at: string; created_by: string | null }>;
  const autoOnes = history.filter((h) => !h.created_by);
  const dayStart = parisDayStart(new Date()).getTime();
  if (autoOnes.filter((h) => Date.parse(h.created_at) >= dayStart).length >= AUTO_DISCOVERIES_PER_DAY) return;
  if (autoOnes[0] && Date.now() - Date.parse(autoOnes[0].created_at) < AUTO_DISCOVERY_GAP_MS) return;
  const next = nextDiscoveryPair(discoveryPairs(countries, brands, vanBrands), history);
  if (!next) return;
  const { error } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'decouverte_concessions', params: { ...next, pages: 3 }, created_by: null });
  if (error) console.warn(`[AGENTS] découverte automatique non posée : ${error.message}`);
}

async function autoQualify(a: AiAgent): Promise<void> {
  if (!aiConfigured() || !(a.auto_qualify_per_day > 0) || await pending(a.agent, 'qualification')) return;
  const dayStart = parisDayStart(new Date()).toISOString();
  const { data } = await sb.from('agent_prospects').select('id').eq('agent', a.agent).gte('qualified_at', dayStart).limit(1000);
  const remaining = a.auto_qualify_per_day - ((data ?? []) as unknown[]).length;
  const budget = Number(a.daily_budget_usd);
  if (remaining <= 0 || !Number.isFinite(budget) || (await spentToday(a.agent)) >= budget) return;
  const ctx = await seriesContext(a, null);
  const ids = await nextCandidates(ctx, Math.min(MAX_SERIES, remaining));
  if (ids.length === 0) return;
  const { error } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'qualification', params: { dealer_ids: ids, auto: true }, created_by: null });
  if (error) console.warn(`[AGENTS] qualification automatique non posée : ${error.message}`);
}

async function autoDraft(a: AiAgent): Promise<void> {
  if (!aiConfigured() || !((a.auto_draft_per_day ?? 0) > 0) || await pending(a.agent, 'premier_mail')) return;
  const dayStart = parisDayStart(new Date()).toISOString();
  const { data: today } = await sb.from('agent_messages').select('id').eq('agent', a.agent).eq('author', a.agent).eq('kind', 'premier_contact').gte('created_at', dayStart).limit(500);
  const remaining = (a.auto_draft_per_day ?? 0) - ((today ?? []) as unknown[]).length;
  // Pas plus de deux jours d'envois qui attendent la validation : Ada n'empile pas.
  const { data: waiting } = await sb.from('agent_messages').select('id').eq('agent', a.agent).eq('kind', 'premier_contact').in('status', ['a_valider', 'valide']).limit(500);
  const backlog = ((waiting ?? []) as unknown[]).length;
  const budget = Number(a.daily_budget_usd);
  if (remaining <= 0 || backlog >= 2 * Math.max(1, a.daily_first_contact_cap) || !Number.isFinite(budget) || (await spentToday(a.agent)) >= budget) return;
  const ids = await nextDraftCandidates(a, Math.min(5, remaining));
  if (ids.length === 0) return;
  const { error } = await sb.from('agent_tasks').insert({ agent: a.agent, kind: 'premier_mail', params: { prospect_ids: ids, auto: true }, created_by: null });
  if (error) console.warn(`[AGENTS] premiers mails automatiques non posés : ${error.message}`);
}

/** Le cycle : du lundi au vendredi, 8 h-19 h à Paris. Ada seulement pour l'instant (Dana : phase 3). */
export async function autoCycle(): Promise<void> {
  const clock = parisClock(new Date());
  if (clock.isoDay > 5 || clock.minutes < 8 * 60 || clock.minutes >= 19 * 60) return;
  try {
    const a = await agentRow('ada');
    if (!a || a.targets == null) return; // SQL du 17/10 (qualification) pas encore collé
    const ctx = await seriesContext(a, null);
    await autoDiscovery(a, ctx.targetCountries, ctx.targets.brands, ctx.targets.vanBrands);
    await autoQualify(a);
    await autoDraft(a);
  } catch (e) {
    console.warn(`[AGENTS] cycle automatique : ${e instanceof Error ? e.message : String(e)}`);
  }
}

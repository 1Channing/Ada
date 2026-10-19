/**
 * LE BANC D'ESSAI, CÔTÉ WORKER (19/10 ; la grille, la fiche à blanc et le
 * verdict : src/lib/agents/bench.ts). Une tâche « qualification » avec
 * params.banc (sans SQL à coller) : pour chaque entreprise de la carte dont
 * l'équipe connaît le bon interlocuteur, la recherche approfondie de
 * l'agente « à blanc » — le nom, le pays, la ville et le site seulement ;
 * rien n'est écrit sur une fiche, rien n'est préparé ni envoyé —, puis le
 * verdict face au contact connu. Haiku 5.5 par défaut (comme « Chercher
 * plus loin »), Opus 5.5 sur demande. Le banc a sa propre limite de dépense
 * (3 $ par défaut), relue avant chaque entreprise ; ses appels ne comptent
 * pas dans le budget du jour de l'agente.
 */
import { HAIKU, OPUS, fmtUsd } from '../../src/lib/agents/aiCost';
import { mergeDeep, DEEP_METHOD } from '../../src/lib/agents/deepResearch';
import { benchCandidates, benchProspect, benchVerdict, benchTally, BENCH_DEFAULT, VERDICT_POINTS, type BenchContact, type BenchTrial } from '../../src/lib/agents/bench';
import { deepCore } from './deep';
import { BudgetReached, AiUnavailable } from './claude';
import { sb, taskSpend } from './store';
import { live } from './live';
import type { AiAgent } from './qualify';

interface Task { id: string; agent: string; kind: string; params: Record<string, unknown>; created_by: string | null }

export async function runBench(t: Task, a: AiAgent): Promise<{ result: Record<string, unknown>; summary: string }> {
  const role: 'ada' | 'dana' = a.agent === 'dana' ? 'dana' : 'ada';
  const n = Math.max(1, Math.min(BENCH_DEFAULT.max, Math.round(Number(t.params.n) || BENCH_DEFAULT.n)));
  const opus = t.params.modele === 'opus';
  const limit = Number(t.params.limite_usd) > 0 ? Number(t.params.limite_usd) : BENCH_DEFAULT.limitUsd;
  const { data, error } = await sb.from('network_contacts').select('id, name, country, city, website, role, kind, contact_name, email, source').limit(5000);
  if (error) throw new Error(`carte illisible : ${error.message}`);
  const all = (data ?? []) as BenchContact[];
  const asked = Array.isArray(t.params.contact_ids) ? t.params.contact_ids.map(String) : [];
  const pool = benchCandidates(all, role);
  const chosen = asked.length ? pool.filter((c) => asked.includes(c.id)) : pool.slice(0, n);
  if (chosen.length === 0) throw new Error(`aucun contact de la carte ne peut servir de grille pour ${a.display_name} (il faut un nom et une adresse nominative d'entreprise)`);

  const trials: BenchTrial[] = [];
  let stop: string | null = null;
  for (const [i, c] of chosen.entries()) {
    const spent = await taskSpend(t.id);
    if (spent >= limit) { stop = `limite de ${fmtUsd(limit)} atteinte (${fmtUsd(spent)} dépensés)`; break; }
    live(t.id, `Banc d'essai ${i + 1} sur ${chosen.length} : ${c.name}`, { done: i, total: chosen.length });
    const p = benchProspect(c);
    try {
      const before = await taskSpend(t.id);
      const run = await deepCore({ role, p, a, taskId: t.id, model: opus ? OPUS : HAIKU, prospectId: null, bench: true });
      const cost = Math.round(((await taskSpend(t.id)) - before) * 10_000) / 10_000;
      const known = { nom: c.contact_name ?? '', email: (c.email ?? '').toLowerCase() };
      if ('error' in run) {
        trials.push({ contact_id: c.id, entreprise: c.name, pays: c.country, connu: known, trouve: { nom: null, fonction: null, email: null }, verdict: 'rien', detail: `échec : ${run.error}`, points: 0, cout_usd: cost });
        continue;
      }
      const { patch } = mergeDeep(p, run.out, run.checked, new Date().toISOString(), run.cost);
      const best = patch.best_contact ?? null;
      const v = benchVerdict({ name: known.nom, email: known.email }, { best, people: patch.people ?? [], emails: patch.emails ?? [] });
      trials.push({
        contact_id: c.id, entreprise: c.name, pays: c.country, connu: known,
        trouve: { nom: best?.nom ?? null, fonction: best?.fonction ?? null, email: best?.email ?? null },
        verdict: v.verdict, detail: v.detail, points: VERDICT_POINTS[v.verdict], cout_usd: cost,
      });
    } catch (e) {
      if (e instanceof BudgetReached || e instanceof AiUnavailable) { stop = e.message; break; }
      trials.push({ contact_id: c.id, entreprise: c.name, pays: c.country, connu: { nom: c.contact_name ?? '', email: c.email ?? '' }, trouve: { nom: null, fonction: null, email: null }, verdict: 'rien', detail: `échec : ${e instanceof Error ? e.message : String(e)}`, points: 0, cout_usd: 0 });
    }
  }
  const tally = benchTally(trials);
  const result = { banc: true, methode: DEEP_METHOD, modele: opus ? 'opus' : 'haiku', essais: trials, ...tally, arret: stop };
  if (trials.length === 0 && stop) throw new Error(stop);
  const same = tally.par_verdict.meme_personne;
  const summary = `Banc d'essai (${opus ? 'Opus 5.5' : 'Haiku 5.5'}) : ${trials.length} entreprise${trials.length > 1 ? 's' : ''}, note ${tally.note ?? '—'}/100, `
    + `${same} fois la même personne — ${fmtUsd(tally.cout_usd)}${stop ? ` (arrêt : ${stop})` : ''}`;
  return { result, summary };
}

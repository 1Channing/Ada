/**
 * LA RELANCE GROUPÉE RÉÉCRITE PAR L'AGENTE, CÔTÉ WORKER (27/11 ; src/lib/agents/groupMail.ts). Une tâche
 * « premier_mail » avec params.relance_groupee {objet, corps, langue, theme, categorie, signataire, n, exemple, mode}
 * et params.note. Rien n'est écrit dans agent_messages : le résultat (objet, corps, traduction, alertes) est rendu
 * dans agent_tasks.result et la fenêtre de la Carte le reprend. Le mail reste signé par la personne connectée.
 */
import { OPUS } from '../../src/lib/agents/aiCost';
import { doctrineOf } from '../../src/lib/agents/danaDoctrine';
import { groupMailSystem, groupMailPrompt, checkGroupMail, GROUP_MAIL_SCHEMA, type GroupMailOutput, type GroupMailMaterial } from '../../src/lib/agents/groupMail';
import { callClaude, BudgetReached, AiUnavailable } from './claude';
import { live } from './live';
import type { AiAgent } from './qualify';

export interface GroupMailParams {
  objet: string; corps: string; langue: string; theme?: string; categorie?: string; signataire?: string; n?: number;
  exemple?: { societe: string; prenom: string; pays: string } | null; mode?: 'reecrire' | 'traduire';
}
export interface GroupMailResult { objet: string; corps: string; traduction_fr: string | null; alertes: string[]; mots: number; cout_usd: number; mode: 'reecrire' | 'traduire' }

export async function rewriteGroupMail(p: GroupMailParams, note: string, a: AiAgent, taskId: string | null): Promise<GroupMailResult> {
  const signatory = (p.signataire ?? '').trim() || 'Channing';
  const mode: 'reecrire' | 'traduire' = p.mode === 'traduire' ? 'traduire' : 'reecrire';
  if (mode === 'reecrire' && !note.trim()) throw new Error('pas de note : rien à réécrire');
  if (!p.corps?.trim()) throw new Error('mail vide');
  const m: GroupMailMaterial = {
    signatory, lang: p.langue || 'fr', themeLabel: p.theme ?? '', kindLabel: p.categorie ?? '', recipientsCount: Number(p.n) || 1,
    example: p.exemple ?? null, subject: p.objet ?? '', body: p.corps, note, mode,
  };
  live(taskId, mode === 'traduire' ? `${a.display_name} traduit le mail groupé de ${signatory} (IA)` : `${a.display_name} réécrit le mail groupé de ${signatory} selon sa note (IA)`);
  let out: GroupMailOutput;
  let cost = 0;
  try {
    const budget = Number(a.daily_budget_usd);
    const r = await callClaude<GroupMailOutput>({
      agent: a.agent, budgetUsd: Number.isFinite(budget) ? budget : 0, purpose: 'relance_groupee', model: OPUS,
      system: groupMailSystem(a.display_name, a.agent === 'dana' ? doctrineOf(a.instructions) : (a.instructions ?? ''), signatory), user: groupMailPrompt(m),
      schema: GROUP_MAIL_SCHEMA as unknown as Record<string, unknown>, maxTokens: 4000, effort: 'medium', taskId, fallbacks: true,
    });
    out = r.data as GroupMailOutput;
    cost = r.costUsd;
  } catch (e) {
    if (e instanceof BudgetReached || e instanceof AiUnavailable) throw e;
    throw new Error(e instanceof Error ? e.message : String(e));
  }
  if (!out?.corps?.trim()) throw new Error('réponse vide de l\'IA');
  const check = checkGroupMail(out, `${p.objet}\n${p.corps}`, note, a.display_name);
  const corps = mode === 'traduire' ? p.corps : check.body;
  const objet = mode === 'traduire' ? p.objet : (out.objet?.trim() || p.objet).slice(0, 200);
  return {
    objet, corps, traduction_fr: (p.langue || 'fr') === 'fr' ? null : (out.traduction_fr ?? null),
    alertes: mode === 'traduire' ? [] : check.warnings, mots: check.words, cout_usd: Math.round(cost * 10_000) / 10_000, mode,
  };
}

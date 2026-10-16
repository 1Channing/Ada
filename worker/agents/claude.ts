/**
 * ADA ET DANA — L'APPEL À CLAUDE (17/10, phase 2.2). SDK officiel
 * (@anthropic-ai/sdk), variable Railway ANTHROPIC_API_KEY (la même que la
 * veille juridique).
 *
 * - Plafond par jour et par agente (agent_settings.daily_budget_usd) : lu
 *   dans agent_runs avant chaque appel ; atteint → l'appel n'a pas lieu.
 * - Chaque appel est inscrit dans agent_runs (modèle, jetons, recherches web,
 *   coût), réussi ou non.
 * - Consigne fixe mise en cache (même texte d'un appel à l'autre).
 * - Outils serveur (recherche web, lecture de page) : un tour mis en pause
 *   par l'API (« pause_turn ») est repris tel quel, trois fois au plus.
 * - Crédits épuisés : pause de 6 h, une seule alerte.
 */
import Anthropic from '@anthropic-ai/sdk';
import { costUsd, addUsage, type UsageLike } from '../../src/lib/agents/aiCost';
import { parisDayStart } from '../../src/lib/agents/sendPolicy';
import { sb } from './store';

export class AiUnavailable extends Error {}
export class BudgetReached extends Error {}

let client: Anthropic | null = null;
const api = (): Anthropic | null => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ maxRetries: 2, timeout: 5 * 60_000 });
  return client;
};
export const aiConfigured = (): boolean => !!process.env.ANTHROPIC_API_KEY;

let creditPauseUntil = 0;

/** Dépense du jour (heure de Paris) d'une agente, en dollars. */
export async function spentToday(agent: string): Promise<number> {
  const { data, error } = await sb.from('agent_runs').select('cost_usd').eq('agent', agent).gte('created_at', parisDayStart(new Date()).toISOString());
  if (error) return 0;
  return ((data ?? []) as Array<{ cost_usd: number | string }>).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
}

export interface ClaudeCall {
  agent: 'ada' | 'dana';
  budgetUsd: number;
  purpose: string;
  model: string;
  system: string;
  user: string;
  schema?: Record<string, unknown>;
  tools?: Anthropic.Messages.ToolUnion[];
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  prospectId?: string | null;
  taskId?: string | null;
}
export interface ClaudeResult<T> { data: T | null; text: string; costUsd: number; stopReason: string | null; webSearches: number }

async function record(c: ClaudeCall, usage: UsageLike, cost: number, stopReason: string | null, error: string | null): Promise<string | null> {
  const { data, error: e } = await sb.from('agent_runs').insert({
    agent: c.agent, purpose: c.purpose, model: c.model, prospect_id: c.prospectId ?? null, task_id: c.taskId ?? null,
    input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0, cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    web_searches: usage.server_tool_use?.web_search_requests ?? 0, web_fetches: usage.server_tool_use?.web_fetch_requests ?? 0,
    cost_usd: Math.round(cost * 10_000) / 10_000, stop_reason: stopReason, error: error?.slice(0, 500) ?? null,
  }).select('id');
  if (e) console.warn(`[AGENTS] appel IA non inscrit : ${e.message}`);
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}

/** Le texte JSON de la réponse : le dernier bloc texte qui se lit, sinon tout le texte. */
function parseJson<T>(blocks: Anthropic.Messages.ContentBlock[]): { data: T | null; text: string } {
  const texts = blocks.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map((b) => b.text);
  for (const t of [...texts].reverse()) {
    try { return { data: JSON.parse(t) as T, text: t }; } catch { /* bloc intermédiaire */ }
  }
  const all = texts.join('');
  try { return { data: JSON.parse(all) as T, text: all }; } catch { return { data: null, text: all }; }
}

export async function callClaude<T>(c: ClaudeCall): Promise<ClaudeResult<T>> {
  const a = api();
  if (!a) throw new AiUnavailable('ANTHROPIC_API_KEY absente sur le worker');
  if (Date.now() < creditPauseUntil) throw new AiUnavailable('crédits API Anthropic épuisés — reprise automatique dans quelques heures');
  const spent = await spentToday(c.agent);
  if (spent >= c.budgetUsd) throw new BudgetReached(`plafond du jour atteint (${spent.toFixed(2)} $ sur ${c.budgetUsd} $)`);

  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: c.user }];
  let usage: UsageLike = {};
  let final: Anthropic.Messages.Message | null = null;
  try {
    for (let i = 0; i < 4; i++) {
      const res = await a.messages.create({
        model: c.model,
        max_tokens: c.maxTokens ?? 8000,
        system: [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }],
        messages,
        ...(c.tools?.length ? { tools: c.tools } : {}),
        output_config: { effort: c.effort ?? 'low', ...(c.schema ? { format: { type: 'json_schema', schema: c.schema } } : {}) },
      });
      usage = addUsage(usage, res.usage as UsageLike);
      final = res;
      if (res.stop_reason !== 'pause_turn') break;
      // Tour d'outils serveur mis en pause : on renvoie la réponse telle quelle, l'API reprend.
      messages.push({ role: 'assistant', content: res.content });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/credit balance|insufficient_quota|billing/i.test(msg)) creditPauseUntil = Date.now() + 6 * 3600_000;
    await record(c, usage, costUsd(c.model, usage), null, msg);
    throw e instanceof Anthropic.APIError ? new Error(`API Claude ${e.status ?? ''} : ${msg}`.trim()) : e;
  }
  const cost = costUsd(c.model, usage);
  const stop = final?.stop_reason ?? null;
  if (stop === 'refusal') {
    await record(c, usage, cost, stop, 'refus du modèle');
    throw new Error('le modèle a décliné la demande');
  }
  if (stop === 'max_tokens' || stop === 'pause_turn') {
    await record(c, usage, cost, stop, 'réponse incomplète');
    throw new Error(`réponse incomplète (${stop})`);
  }
  const { data, text } = c.schema ? parseJson<T>(final?.content ?? []) : { data: null, text: (final?.content ?? []).filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map((b) => b.text).join('') };
  if (c.schema && data == null) {
    await record(c, usage, cost, stop, 'réponse illisible');
    throw new Error('réponse illisible (JSON attendu)');
  }
  await record(c, usage, cost, stop, null);
  return { data, text, costUsd: cost, stopReason: stop, webSearches: usage.server_tool_use?.web_search_requests ?? 0 };
}

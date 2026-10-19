/**
 * ADA ET DANA — L'APPEL À CLAUDE (17/10, phase 2.2). SDK officiel
 * (@anthropic-ai/sdk). La clé : AGENTS_ANTHROPIC_API_KEY (une clé à part
 * pour les agentes : leur dépense se suit et se coupe sans toucher la veille
 * juridique), sinon ANTHROPIC_API_KEY (celle du worker).
 *
 * - Plafond par jour et par agente (agent_settings.daily_budget_usd) : lu
 *   dans agent_runs avant chaque appel ; atteint → l'appel n'a pas lieu.
 * - Chaque appel est inscrit dans agent_runs (modèle, jetons, recherches web,
 *   coût), réussi ou non.
 * - Consigne fixe mise en cache (même texte d'un appel à l'autre).
 * - Outils serveur (recherche web, lecture de page) : un tour mis en pause
 *   par l'API (« pause_turn ») est repris tel quel, trois fois au plus.
 * - Opus 5.5 : repli serveur en cas de refus (fallbacks « default », en-tête
 *   server-side-fallback-2026-07-01), comme recommandé pour ce modèle.
 * - Une clé « multi-espaces » (pas rattachée à un espace de travail) doit
 *   dire dans quel espace travailler : AGENTS_ANTHROPIC_WORKSPACE_ID
 *   (wrkspc_…) part alors dans l'en-tête anthropic-workspace-id (18/10).
 * - Panne de réglage (crédits épuisés, clé refusée, clé sans espace de
 *   travail, droits) : message en clair (src/lib/agents/aiErrors.ts), et le
 *   travail automatique d'Ada et Dana s'arrête une heure ; une tâche lancée
 *   par une personne réessaie tout de suite (le réglage a pu être corrigé).
 */
import Anthropic from '@anthropic-ai/sdk';
import { costUsd, addUsage, type UsageLike } from '../../src/lib/agents/aiCost';
import { aiProblemOf } from '../../src/lib/agents/aiErrors';
import { parisDayStart } from '../../src/lib/agents/sendPolicy';
import { sb } from './store';

export class AiUnavailable extends Error {}
export class BudgetReached extends Error {}

const apiKey = (): string => process.env.AGENTS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
/** L'espace de travail d'une clé qui n'y est pas rattachée (wrkspc_…), facultatif. */
const workspaceId = (): string => (process.env.AGENTS_ANTHROPIC_WORKSPACE_ID ?? '').trim();
let client: Anthropic | null = null;
const api = (): Anthropic | null => {
  if (!apiKey()) return null;
  client ??= new Anthropic({
    apiKey: apiKey(), maxRetries: 2, timeout: 5 * 60_000,
    ...(workspaceId() ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId() } } : {}),
  });
  return client;
};
export const aiConfigured = (): boolean => !!apiKey();
/** Le message quand aucune clé n'est posée sur le worker. */
export const NO_KEY = 'aucune clé API Anthropic sur le worker (AGENTS_ANTHROPIC_API_KEY, ou ANTHROPIC_API_KEY) : l\'IA d\'Ada et Dana n\'est pas branchée';

/** Pause du travail automatique après une panne de réglage (crédits, clé, espace de travail, droits). */
let pause: { until: number; reason: string; short: string } | null = null;
const PAUSE_MS = 3600_000;
/** Le dernier appel à l'IA (pour /health) : quand, réussi ou non, et la panne en quelques mots. */
let lastCall: { at: string; ok: boolean; problem: string | null } | null = null;
const STARTED_AT = new Date().toISOString();

/**
 * L'état de l'IA des agentes, sans aucun secret (route /health du worker) : quelle clé est posée,
 * si l'espace de travail part dans l'en-tête, la pause éventuelle, le dernier appel. De quoi vérifier
 * de l'extérieur qu'après un changement de variables le worker a redémarré et que l'IA répond.
 */
export function aiStatus(): { key: 'agents' | 'worker' | null; workspaceHeader: boolean; paused: string | null; lastCall: typeof lastCall; startedAt: string } {
  return {
    key: process.env.AGENTS_ANTHROPIC_API_KEY ? 'agents' : process.env.ANTHROPIC_API_KEY ? 'worker' : null,
    workspaceHeader: !!workspaceId(),
    paused: pause && Date.now() < pause.until ? pause.short : null,
    lastCall,
    startedAt: STARTED_AT,
  };
}

/** Une tâche lancée par une personne réessaie tout de suite, même pendant la pause. */
export function clearAiPause(): void { pause = null; }
/** Le travail automatique attend (panne de réglage dans l'heure) : pas de nouvelle tâche d'IA d'office. */
export const aiPaused = (): boolean => !!pause && Date.now() < pause.until;

/**
 * Dépense du jour (heure de Paris) d'une agente, en dollars — hors banc d'essai (19/10 : il a sa propre
 * limite). `at` : un autre jour que celui d'aujourd'hui (le bilan d'une journée se compte sur sa journée).
 */
export async function spentToday(agent: string, at: Date = new Date()): Promise<number> {
  const start = parisDayStart(at);
  const next = parisDayStart(new Date(start.getTime() + 26 * 3600_000));
  const { data, error } = await sb.from('agent_runs').select('cost_usd').eq('agent', agent).neq('purpose', 'banc_essai')
    .gte('created_at', start.toISOString()).lt('created_at', next.toISOString());
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
  /** Délai d'une requête, si elle peut être longue (recherche approfondie) ; sinon celui du client (5 minutes). */
  timeoutMs?: number;
  effort?: 'low' | 'medium' | 'high';
  prospectId?: string | null;
  taskId?: string | null;
  /** Repli serveur sur un autre modèle si celui-ci décline (Opus 5.5). */
  fallbacks?: boolean;
}
export interface ClaudeResult<T> {
  data: T | null; text: string; costUsd: number; stopReason: string | null; webSearches: number;
  /** Les adresses réellement vues dans les résultats de recherche ou de lecture web (pour vérifier un profil cité). */
  seenUrls: string[];
}

/** Les adresses des résultats d'outils serveur (recherche web, lecture de page) d'une réponse. */
function toolResultUrls(blocks: Block[], into: Set<string>): void {
  for (const b of blocks) {
    if (!/_tool_result$/.test(String(b.type ?? ''))) continue;
    for (const m of JSON.stringify(b).matchAll(/"url"\s*:\s*"(https?:\/\/[^"\\]+)"/g)) into.add(m[1]);
  }
}

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

type Block = { type: string; text?: string };
const textsOf = (blocks: Block[]) => blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string);

/** Le texte JSON de la réponse : le dernier bloc texte qui se lit, sinon tout le texte. */
function parseJson<T>(blocks: Block[]): { data: T | null; text: string } {
  const texts = textsOf(blocks);
  for (const t of [...texts].reverse()) {
    try { return { data: JSON.parse(t) as T, text: t }; } catch { /* bloc intermédiaire */ }
  }
  const all = texts.join('');
  try { return { data: JSON.parse(all) as T, text: all }; } catch { return { data: null, text: all }; }
}

export async function callClaude<T>(c: ClaudeCall): Promise<ClaudeResult<T>> {
  const a = api();
  if (!a) throw new AiUnavailable(NO_KEY);
  if (pause && Date.now() < pause.until) throw new AiUnavailable(`${pause.reason} (le travail automatique reprend seul dans l'heure)`);
  const spent = await spentToday(c.agent);
  if (spent >= c.budgetUsd) throw new BudgetReached(`plafond du jour atteint (${spent.toFixed(2)} $ sur ${c.budgetUsd} $)`);

  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: c.user }];
  let usage: UsageLike = {};
  let final: { content: Block[]; stop_reason: string | null } | null = null;
  const seen = new Set<string>();
  try {
    for (let i = 0; i < 4; i++) {
      const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        model: c.model,
        max_tokens: c.maxTokens ?? 8000,
        system: [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }],
        messages,
        ...(c.tools?.length ? { tools: c.tools } : {}),
        output_config: { effort: c.effort ?? 'low', ...(c.schema ? { format: { type: 'json_schema', schema: c.schema } } : {}) },
      };
      const opts = c.timeoutMs ? { timeout: c.timeoutMs } : undefined;
      const res = c.fallbacks
        ? await a.beta.messages.create({ ...(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, opts)
        : await a.messages.create(params, opts);
      usage = addUsage(usage, res.usage as UsageLike);
      final = { content: res.content as Block[], stop_reason: res.stop_reason };
      toolResultUrls(final.content, seen);
      if (res.stop_reason !== 'pause_turn') break;
      // Tour d'outils serveur mis en pause : on renvoie la réponse telle quelle, l'API reprend.
      messages.push({ role: 'assistant', content: res.content as Anthropic.Messages.ContentBlockParam[] });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const problem = aiProblemOf(msg, e instanceof Anthropic.APIError ? e.status : null);
    if (problem) pause = { until: Date.now() + PAUSE_MS, reason: problem.text, short: problem.short };
    lastCall = { at: new Date().toISOString(), ok: false, problem: problem?.short ?? 'autre erreur de l\'API' };
    await record(c, usage, costUsd(c.model, usage), null, msg);
    if (problem) throw new AiUnavailable(problem.text);
    throw e instanceof Anthropic.APIError ? new Error(`API Claude ${e.status ?? ''} : ${msg}`.trim()) : e;
  }
  lastCall = { at: new Date().toISOString(), ok: true, problem: null };
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
  const { data, text } = c.schema ? parseJson<T>(final?.content ?? []) : { data: null, text: textsOf(final?.content ?? []).join('') };
  if (c.schema && data == null) {
    await record(c, usage, cost, stop, 'réponse illisible');
    throw new Error('réponse illisible (JSON attendu)');
  }
  await record(c, usage, cost, stop, null);
  return { data, text, costUsd: cost, stopReason: stop, webSearches: usage.server_tool_use?.web_search_requests ?? 0, seenUrls: [...seen] };
}

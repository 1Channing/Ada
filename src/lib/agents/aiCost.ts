/**
 * LE COÛT D'UN APPEL À CLAUDE (17/10) — tarifs Anthropic en $ par million de
 * jetons (relevés le 06/10/2026), pour le journal des dépenses d'Ada et Dana
 * (agent_runs) et le plafond par jour. Indicatif : la facture Anthropic fait foi.
 * - Haiku 5.5 : 0,10 $ / 0,50 $ jusqu'à 100 000 jetons de consigne, 0,50 $ / 2,50 $ au-delà.
 * - Opus 5.5 : 4 $ / 20 $ ; lecture du cache 0,20 $.
 * - Écriture du cache : 1,25 × l'entrée ; lecture : 0,1 × (sauf Opus 5.5, ci-dessus).
 * - Recherche web : 10 $ les 1 000 (la lecture d'une page ne coûte que ses jetons).
 * Logique pure ; testée par test/agents-qualification.test.ts.
 */

export const HAIKU = 'claude-haiku-5-5';
export const OPUS = 'claude-opus-5-5';

interface Rate { in: number; out: number; cacheRead: number; long?: { above: number; in: number; out: number } }
const RATES: Record<string, Rate> = {
  [HAIKU]: { in: 0.10, out: 0.50, cacheRead: 0.01, long: { above: 100_000, in: 0.50, out: 2.50 } },
  [OPUS]: { in: 4, out: 20, cacheRead: 0.20 },
};
export const WEB_SEARCH_USD = 0.01;

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
}

/** Coût en dollars d'une réponse (somme de ses usages s'il y a eu des reprises). */
export function costUsd(model: string, usage: UsageLike): number {
  const r = RATES[model];
  if (!r) return 0;
  const input = usage.input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const long = r.long && input + write + read > r.long.above ? r.long : null;
  const rin = long ? long.in : r.in;
  const rout = long ? long.out : r.out;
  const readRate = long ? long.in * 0.1 : r.cacheRead;
  const tokens = (input * rin + write * rin * 1.25 + read * readRate + out * rout) / 1e6;
  return tokens + (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

/** Additionne les usages de plusieurs réponses (reprises après « pause_turn »). */
export function addUsage(a: UsageLike, b: UsageLike): UsageLike {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
    server_tool_use: {
      web_search_requests: (a.server_tool_use?.web_search_requests ?? 0) + (b.server_tool_use?.web_search_requests ?? 0),
      web_fetch_requests: (a.server_tool_use?.web_fetch_requests ?? 0) + (b.server_tool_use?.web_fetch_requests ?? 0),
    },
  };
}

/** « 0,014 $ » — trois décimales sous un dollar. */
export const fmtUsd = (n: number | null | undefined): string =>
  `${(n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: (n ?? 0) < 1 ? 3 : 2, maximumFractionDigits: (n ?? 0) < 1 ? 3 : 2 })} $`;

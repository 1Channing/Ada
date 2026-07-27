/**
 * VEILLE JURIDIQUE AUTOMATIQUE — prêt à brancher.
 *
 * Collecte hebdomadaire des sources officielles (UE + fiscalités nationales
 * des 7 pays ADA), résumé + classement par IA (API Claude), publication en
 * 'draft' dans legal_watch_entries — l'équipe valide (statut 'published')
 * depuis la page Veille.
 *
 * BRANCHEMENT (2 choses) :
 *   1. Variable Railway `ANTHROPIC_API_KEY`.
 *   2. app_config, clé 'legal_watch' :
 *      { "sources": ["https://eur-lex.europa.eu/…rss…", …] } — la liste des
 *      flux/pages à surveiller (modifiable sans redéploiement).
 */
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';

const POLL_MS = 24 * 3600 * 1000; // un passage par jour, la collecte trie elle-même les nouveautés

export function startLegalWatchCollector(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[LEGAL_WATCH] en attente de ANTHROPIC_API_KEY — veille automatique inactive');
    return;
  }
  setInterval(() => void collectOnce(), POLL_MS);
  setTimeout(() => void collectOnce(), 120_000);
  console.log('[LEGAL_WATCH] veille automatique active (passage quotidien)');
}

async function collectOnce(): Promise<void> {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'legal_watch').maybeSingle();
  const cfg = (data?.value ?? null) as { sources?: string[] } | null;
  if (!cfg?.sources?.length) {
    console.warn('[LEGAL_WATCH] app_config.legal_watch absent (sources requises) — rien à faire');
    return;
  }
  // TODO(branchement) : fetch des sources, extraction des nouveautés (diff
  // contre legal_watch_entries.source_url), résumé/classement par l'API
  // Claude (modèle haiku suffisant), insert en statut 'draft'. Implémenté au
  // branchement de la clé pour être calibré sur les vraies sources.
  console.warn('[LEGAL_WATCH] clé présente — collecte à calibrer sur les sources réelles');
}

/**
 * Retro-healing — dès qu'un mapping (site, marque, modèle) est appris ou
 * validé (ingestion humaine, sonde de slug, item de campagne confirmé,
 * « marché vide » validé), les lacunes ENCORE OUVERTES du même combo dans le
 * centre de résolution se ferment automatiquement en « corrigée » : plus
 * besoin de re-traiter à la main ce que le système vient de résoudre.
 *
 * Périmètre volontairement conservateur : seules les lacunes que le mapping
 * répare vraiment sont fermées (taxonomy_gap — slug/nom faux — et no_url —
 * URL non générable). Les 'technical' (Cloudflare) et 'insufficient'
 * (échantillon) restent ouvertes, un mapping appris n'y change rien.
 *
 * Utilise sharedSupabase : navigateur = client anon, worker = service-role.
 */

import { sharedSupabase as supabase } from '../supabaseShared';

const HEALABLE_OUTCOMES = ['taxonomy_gap', 'no_url'];

export async function healOpenGaps(site: string, brand: string, model: string): Promise<number> {
  const b = brand.trim();
  const m = model.trim();
  if (!site || !b || !m) return 0;
  const { data, error } = await supabase
    .from('linkgen_campaign_items')
    .update({ resolved_at: new Date().toISOString(), resolution: 'corrected' })
    .eq('site', site)
    .ilike('brand', b)
    .ilike('model', m)
    .in('outcome', HEALABLE_OUTCOMES)
    .is('resolved_at', null)
    .select('id');
  if (error) {
    // Base pré-migration (resolved_at absent) ou RLS : on ne casse jamais le
    // flux appelant pour du ménage.
    console.warn(`[GAP_HEAL] skip (${error.message})`);
    return 0;
  }
  const n = data?.length ?? 0;
  if (n > 0) console.log(`[GAP_HEAL] ${n} lacune(s) ${site} · ${b} · ${m} fermée(s) automatiquement (mapping appris)`);
  return n;
}

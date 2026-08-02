/**
 * Taxonomie moissonnée — pont entre la moisson PURE des adaptateurs
 * (adapter.harvestTaxonomy : référentiel marques/modèles embarqué dans les
 * pages, ex. mobile.de {"label":"Skoda","value":"22900"}) et le dictionnaire
 * enum persistant (linkgen_enum_mappings), puis réinjection au démarrage
 * (adapter.learnEnumValues) pour que buildSearchUrl/prefill utilisent les
 * codes appris lors des runs précédents.
 *
 * Philosophie identique au reste du mapping : certain-ou-rien. On n'insère
 * que du nouveau ; un code déjà connu avec un AUTRE label est conservé tel
 * quel et le conflit loggé (warn → worker_logs).
 */

import { sharedSupabase as supabase } from '../supabaseShared';
import { allSiteAdapters } from '../study-core/marketplaces';

export interface TaxonomyEntry { field: string; code: string; label: string }

/** Bilan d'une moisson : nombre de nouveaux codes, ventilés par champ —
 *  affiché dans le journal d'ingestion (« rien de nouveau » est une info). */
export interface TaxonomyHarvestSummary { learned: number; byField: Record<string, number> }

const EMPTY_SUMMARY: TaxonomyHarvestSummary = { learned: 0, byField: {} };

/** Persiste une moisson : insertion des inconnus uniquement, conflits loggés. */
export async function persistTaxonomyHarvest(site: string, entries: TaxonomyEntry[]): Promise<TaxonomyHarvestSummary> {
  if (!entries.length) return EMPTY_SUMMARY;
  const fields = [...new Set(entries.map((e) => e.field))];
  const { data: existing, error } = await supabase
    .from('linkgen_enum_mappings')
    .select('field, code, label')
    .eq('site', site)
    .in('field', fields);
  if (error) {
    console.warn(`[TAXONOMY] lecture dictionnaire échouée (${site}): ${error.message}`);
    return EMPTY_SUMMARY;
  }
  const known = new Map((existing ?? []).map((r) => [`${r.field}|${r.code}`, r.label as string]));
  const now = new Date().toISOString();
  // Typé sur la forme réelle de la table : la moisson écrit le chemin le plus
  // chaud du système (13 470+ entrées) — un Record opaque privait TypeScript
  // de toute garantie sur ce qui part au dictionnaire.
  const fresh: Array<{
    site: string; field: string; code: string; label: string;
    confirmations: number; last_confirmed_at: string; updated_at: string;
  }> = [];
  for (const e of entries) {
    const prev = known.get(`${e.field}|${e.code}`);
    if (prev === undefined) {
      fresh.push({ site, field: e.field, code: e.code, label: e.label, confirmations: 1, last_confirmed_at: now, updated_at: now });
    } else if (prev.toLowerCase() !== e.label.toLowerCase()) {
      console.warn(`[TAXONOMY] conflit ${site}/${e.field}/${e.code}: gardé "${prev}", ignoré "${e.label}"`);
    }
  }
  if (fresh.length) {
    // UPSERT ignore-doublons (29/07) : la lecture anti-doublon ci-dessus est
    // plafonnée à 1000 lignes par PostgREST — au-delà (AS24 : 5826 modèles),
    // l'insert groupé heurtait la contrainte UNIQUE (site,field,code) et TOUT
    // le lot était perdu (spam « insertion échouée » du 29/07 au matin). Les
    // doublons sont ignorés ligne à ligne, les labels existants JAMAIS
    // réécrits (certain-ou-rien intact), le neuf passe toujours.
    const { error: insErr } = await supabase
      .from('linkgen_enum_mappings')
      .upsert(fresh, { onConflict: 'site,field,code', ignoreDuplicates: true });
    if (insErr) {
      console.warn(`[TAXONOMY] insertion échouée (${site}): ${insErr.message}`);
      return EMPTY_SUMMARY;
    }
    console.warn(`[TAXONOMY] ${site}: ${fresh.length} entrée(s) apprise(s) (${fields.join(', ')})`);
  }
  const byField: Record<string, number> = {};
  for (const f of fresh) byField[f.field] = (byField[f.field] ?? 0) + 1;
  return { learned: fresh.length, byField };
}

let taxonomyLoaded = false;

/**
 * Variante « une fois par session » pour le FRONT (prefill d'ingestion,
 * génération d'URL) : sans elle, le navigateur ne connaît que les graines
 * humaines et ignore les 178 marques + modèles moissonnés (constat 26/07 :
 * prefill sans marque sur ms=25xxx). Le worker, lui, recharge à chaque
 * campagne via loadLearnedTaxonomy.
 */
export async function ensureLearnedTaxonomy(): Promise<void> {
  if (taxonomyLoaded) return;
  await loadLearnedTaxonomy();
}

/**
 * Recharge le dictionnaire persistant dans les adaptateurs qui savent
 * apprendre (learnEnumValues). Appelé au chargement de la connaissance de
 * campagne et au boot ingestion — idempotent, silencieux si table vide.
 */
export async function loadLearnedTaxonomy(): Promise<void> {
  taxonomyLoaded = true;
  for (const adapter of allSiteAdapters()) {
    if (!adapter.learnEnumValues) continue;
    // TOUS les champs du site — chaque adaptateur ignore ceux qu'il ne
    // connaît pas (l'ancien filtre 'ms:%' était un héritage mobile.de qui
    // privait Leboncoin de ses enums modèle u_car_model, constat iX1 28/07).
    // Lecture PAGINÉE : PostgREST plafonne toute requête à 1000 lignes (même
    // avec limit=), et Blocket/mobile.de dépassent ce cap — sans .range(),
    // l'adaptateur perdait silencieusement la fin de son dictionnaire.
    const data: Array<{ field: string; code: string; label: string }> = [];
    let readError = false;
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await supabase
        .from('linkgen_enum_mappings')
        .select('field, code, label')
        .eq('site', adapter.key)
        .order('id', { ascending: true })
        .range(from, from + 999);
      if (error) { readError = true; break; }
      data.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    if (readError || !data.length) continue;
    const byField = new Map<string, Array<{ code: string; label: string }>>();
    for (const r of data) {
      const list = byField.get(r.field) ?? [];
      list.push({ code: r.code, label: r.label });
      byField.set(r.field, list);
    }
    for (const [field, pairs] of byField) adapter.learnEnumValues(field, pairs);
    console.log(`[TAXONOMY] ${adapter.key}: ${data.length} code(s) réinjecté(s) dans l'adaptateur`);
  }
}

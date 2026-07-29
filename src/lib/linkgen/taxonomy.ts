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

/** Persiste une moisson : insertion des inconnus uniquement, conflits loggés. */
export async function persistTaxonomyHarvest(site: string, entries: TaxonomyEntry[]): Promise<number> {
  if (!entries.length) return 0;
  const fields = [...new Set(entries.map((e) => e.field))];
  const { data: existing, error } = await supabase
    .from('linkgen_enum_mappings')
    .select('field, code, label')
    .eq('site', site)
    .in('field', fields);
  if (error) {
    console.warn(`[TAXONOMY] lecture dictionnaire échouée (${site}): ${error.message}`);
    return 0;
  }
  const known = new Map((existing ?? []).map((r) => [`${r.field}|${r.code}`, r.label as string]));
  const now = new Date().toISOString();
  const fresh: Array<Record<string, unknown>> = [];
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
      return 0;
    }
    console.warn(`[TAXONOMY] ${site}: ${fresh.length} entrée(s) apprise(s) (${fields.join(', ')})`);
  }
  return fresh.length;
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
    const { data, error } = await supabase
      .from('linkgen_enum_mappings')
      .select('field, code, label')
      .eq('site', adapter.key);
    if (error || !data?.length) continue;
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

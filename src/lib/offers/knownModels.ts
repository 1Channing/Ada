/**
 * MODÈLES CONNUS PAR MARQUE pour les offres fournisseur — union du
 * référentiel ADA (fenêtres d'études : ne connaît que ce qui a été étudié,
 * d'où « ASTRA L » gardé tel quel le 16/09 : aucune étude Astra) et de la
 * TAXONOMIE MOISSONNÉE des sites (linkgen_enum_mappings : AutoScout, mobile.de,
 * Marktplaats — le catalogue entier, marque ↔ modèle prouvé par le site).
 * Lecture paginée, une fois par session, fail-open (référentiel seul).
 */
import { sharedSupabase as supabase } from '../supabaseShared';

type Row = { field: string; code: string; label: string };
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();

async function readSite(site: string, fields: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('linkgen_enum_mappings').select('field, code, label').eq('site', site).in('field', fields).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Sites dont le code modèle porte le code marque (« 54;1916 » = Opel;Astra). */
const CODED_SITES: Array<{ site: string; make: string; model: string }> = [
  { site: 'AUTOSCOUT_FR', make: 'as:make', model: 'as:model' },
  { site: 'MOBILE_DE', make: 'ms:make', model: 'ms:model' },
];

let cache: Promise<Record<string, string[]>> | null = null;

export function loadLearnedModelsByBrand(): Promise<Record<string, string[]>> {
  if (cache) return cache;
  cache = (async () => {
    const byBrand: Record<string, Set<string>> = {};
    const add = (brand: string, model: string) => { const b = fold(brand), m = fold(model); if (b && m) (byBrand[b] ??= new Set()).add(m); };
    for (const s of CODED_SITES) {
      try {
        const rows = await readSite(s.site, [s.make, s.model]);
        const makes = new Map(rows.filter((r) => r.field === s.make).map((r) => [r.code, r.label]));
        for (const r of rows) {
          if (r.field !== s.model) continue;
          const makeCode = r.code.split(';')[0];
          const make = makes.get(makeCode);
          if (make) add(make, r.label);
        }
      } catch { /* site illisible : les autres sources restent */ }
    }
    try {
      // Marktplaats : code « opel;astra;1064 » — la marque est dans le code
      // (slug gardé tel quel : « mercedes-benz » rejoint « Mercedes-Benz » d'AS24).
      const rows = await readSite('MARKTPLAATS', ['model_facet']);
      for (const r of rows) { const [brandSlug] = r.code.split(';'); if (brandSlug) add(brandSlug, r.label); }
    } catch { /* idem */ }
    return Object.fromEntries(Object.entries(byBrand).map(([b, set]) => [b, [...set].sort()]));
  })();
  return cache;
}

/** Fusion référentiel + taxonomie (le référentiel garde ses libellés, la taxonomie complète). */
export function mergeKnownModels(a: Record<string, string[]>, b: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const src of [a, b]) for (const [brand, models] of Object.entries(src)) for (const m of models) (out[fold(brand)] ??= new Set()).add(fold(m));
  return Object.fromEntries(Object.entries(out).map(([b, set]) => [b, [...set].sort()]));
}

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
    // Une marque connue d'un site existe même sans modèle appris (BYD sur
    // AutoScout : code marque seul, 21/09) — elle doit pouvoir être choisie.
    const ensure = (brand: string) => { const b = fold(brand); if (b) byBrand[b] ??= new Set(); };
    const add = (brand: string, model: string) => { const b = fold(brand), m = fold(model); if (b && m) (byBrand[b] ??= new Set()).add(m); };
    for (const s of CODED_SITES) {
      try {
        const rows = await readSite(s.site, [s.make, s.model]);
        const makes = new Map(rows.filter((r) => r.field === s.make).map((r) => [r.code, r.label]));
        for (const label of makes.values()) ensure(label);
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
    try {
      // Leboncoin : u_car_brand (code = marque) et u_car_model « BYD_Dolphin Surf »
      // (code = MARQUE_Modèle ; la marque est le plus long code de marque qui préfixe).
      const rows = await readSite('LEBONCOIN', ['u_car_brand', 'u_car_model']);
      const brands = rows.filter((r) => r.field === 'u_car_brand').map((r) => r.code).sort((a, b) => b.length - a.length);
      for (const b of brands) ensure(b);
      for (const r of rows) {
        if (r.field !== 'u_car_model') continue;
        const brand = brands.find((b) => r.code.toUpperCase().startsWith(`${b.toUpperCase()}_`));
        if (brand) add(brand, r.label);
      }
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

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Map as MapIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * CARTE DE L'IGNORANCE (demande Channing 29/08) — l'autre visage du Truth
 * Center : non plus « ce qu'on doute » mais « ce qu'on SAIT ne pas savoir ».
 *
 * Demande = les marques/modèles/carburants des études actives (mêmes données
 * que l'onglet Doutes). Savoir = les dictionnaires moissonnés
 * (linkgen_enum_mappings, 24 000+ entrées apprises des annonces elles-mêmes).
 * Le croisement, organisé en entonnoir Pays → Site → Marque → Modèle, montre
 * chaque slug MANQUANT — et son remède (une URL humaine dans l'ingestion).
 *
 * Exigences PAR SITE (inventaire du 29/08, champs réels de la base) :
 *  - requis   : sans slug appris, la recherche modèle est IMPOSSIBLE ou fausse
 *               (Subito sb:model — constat NX : page marque entière ;
 *                mobile.de ms:model ; Marktplaats model_facet ; Blocket codes).
 *  - fragile  : des candidats devinés servent en attendant (Leboncoin
 *               u_car_model — constat Classe GLA 28/08 : la liste peut rater).
 *  - dérivé   : le slug se calcule du label, jamais bloquant (AutoScout,
 *               Gaspedaal, Bilbasen chemins ; Jófogás slugify ; Skelbiu
 *               mots-clés).
 * Carburant : « registre » = grammaire prouvée du registre unique, rien à
 * apprendre. Carrosserie : pré-câblée (backlog) — déjà moissonnée sur
 * Leboncoin (vehicle_type) et Skelbiu (sk:body).
 */

interface StudyLike {
  brand: string;
  model: string | null;
  fuel: string | null;
  source_country: string;
  target_country: string;
}

interface MappingRow { site: string; field: string; code: string; label: string }

type ModelNeed = 'requis' | 'fragile' | 'dérivé';
interface SiteSpec {
  site: string;
  country: string;
  modelNeed: ModelNeed;
  /** Familles de champs où chercher le modèle (préfixe si scopé par marque). */
  modelFields: string[];
  modelScoped: boolean;
  brandFields: string[];
  fuelDict: string[];   // [] = couvert par le registre / la voie native
  bodyFields: string[];
}

const SITE_SPECS: SiteSpec[] = [
  { site: 'AUTOSCOUT_FR', country: 'FR', modelNeed: 'dérivé', modelFields: ['as:model'], modelScoped: false, brandFields: ['as:make'], fuelDict: [], bodyFields: [] },
  { site: 'LEBONCOIN', country: 'FR', modelNeed: 'fragile', modelFields: ['u_car_model'], modelScoped: false, brandFields: ['u_car_brand'], fuelDict: [], bodyFields: ['vehicle_type'] },
  { site: 'AUTOSCOUT_DE', country: 'DE', modelNeed: 'dérivé', modelFields: ['as:model'], modelScoped: false, brandFields: ['as:make'], fuelDict: [], bodyFields: [] },
  { site: 'MOBILE_DE', country: 'DE', modelNeed: 'requis', modelFields: ['ms:model'], modelScoped: false, brandFields: ['ms:make'], fuelDict: [], bodyFields: [] },
  { site: 'AUTOSCOUT_NL', country: 'NL', modelNeed: 'dérivé', modelFields: ['as:model'], modelScoped: false, brandFields: ['as:make'], fuelDict: [], bodyFields: [] },
  { site: 'MARKTPLAATS', country: 'NL', modelNeed: 'requis', modelFields: ['model_facet'], modelScoped: false, brandFields: [], fuelDict: [], bodyFields: [] },
  { site: 'GASPEDAAL', country: 'NL', modelNeed: 'dérivé', modelFields: ['gp:model:'], modelScoped: true, brandFields: ['gp:brand'], fuelDict: ['gp:fuel'], bodyFields: [] },
  { site: 'AUTOSCOUT_IT', country: 'IT', modelNeed: 'dérivé', modelFields: ['as:model'], modelScoped: false, brandFields: ['as:make'], fuelDict: [], bodyFields: [] },
  { site: 'SUBITO', country: 'IT', modelNeed: 'requis', modelFields: ['sb:model:'], modelScoped: true, brandFields: ['sb:brand'], fuelDict: ['sb:fuel'], bodyFields: [] },
  { site: 'AUTOSCOUT_ES', country: 'ES', modelNeed: 'dérivé', modelFields: ['as:model'], modelScoped: false, brandFields: ['as:make'], fuelDict: [], bodyFields: [] },
  { site: 'AUTOSCOUT_BE', country: 'BE', modelNeed: 'dérivé', modelFields: ['as:model'], modelScoped: false, brandFields: ['as:make'], fuelDict: [], bodyFields: [] },
  { site: 'BILBASEN', country: 'DK', modelNeed: 'dérivé', modelFields: ['bb:model'], modelScoped: false, brandFields: [], fuelDict: [], bodyFields: [] },
  { site: 'BLOCKET', country: 'SE', modelNeed: 'requis', modelFields: ['bl:modelcode:', 'bl:model:'], modelScoped: true, brandFields: ['bl:brand', 'bl:brandcode'], fuelDict: ['bl:fuel'], bodyFields: [] },
  { site: 'SKELBIU', country: 'LT', modelNeed: 'dérivé', modelFields: [], modelScoped: false, brandFields: [], fuelDict: ['sk:fuel'], bodyFields: ['sk:body'] },
  { site: 'JOFOGAS', country: 'HU', modelNeed: 'dérivé', modelFields: ['jf:model:'], modelScoped: true, brandFields: ['jf:brand'], fuelDict: ['jf:fuel'], bodyFields: [] },
  // La Centrale : le paramètre attend le LIBELLÉ commercial (« RAV 4 » avec
  // espace, non dérivable de « RAV4 ») — dictionnaire lc:model:* appris par
  // moisson, sinon page marque. category = carrosserie native (pré-câblage).
  { site: 'LACENTRALE', country: 'FR', modelNeed: 'fragile', modelFields: ['lc:model:'], modelScoped: true, brandFields: ['lc:make'], fuelDict: [], bodyFields: ['lc:body'] },
];

const canon = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Récupération PAGINÉE des familles utiles (≈6 000 lignes sur 24 000). */
async function fetchMappings(): Promise<MappingRow[]> {
  const exact = [
    'u_car_brand', 'u_car_model', 'vehicle_type', 'ms:make', 'ms:model',
    'model_facet', 'sb:brand', 'bb:model', 'gp:brand', 'jf:brand',
    'bl:brand', 'bl:brandcode', 'sk:body', 'sk:fuel', 'sb:fuel',
    'gp:fuel', 'jf:fuel', 'bl:fuel', 'as:make', 'as:model',
    'lc:make', 'lc:body',
  ];
  const prefixes = ['sb:model:', 'bl:model:', 'bl:modelcode:', 'jf:model:', 'gp:model:', 'lc:model:'];
  const out: MappingRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = async (filter: (q: any) => any) => {
    for (let from = 0; from < 30_000; from += 1000) {
      const q = filter(supabase.from('linkgen_enum_mappings').select('site, field, code, label').range(from, from + 999));
      const { data, error } = await q;
      if (error || !data) return;
      out.push(...(data as MappingRow[]));
      if (data.length < 1000) return;
    }
  };
  await page((q: any) => q.in('field', exact));
  for (const p of prefixes) await page((q: any) => q.like('field', `${p}%`));
  return out;
}

type ModelState = 'connu' | 'manquant' | 'fragile-connu' | 'fragile-manquant' | 'dérivé';

interface SiteReport {
  spec: SiteSpec;
  models: Array<{ brand: string; model: string; state: ModelState }>;
  missingCount: number;
  fuels: string[];        // labels appris ('' = registre)
  bodies: string[];       // carrosseries moissonnées
}

function buildReports(studies: StudyLike[], mappings: MappingRow[]): SiteReport[] {
  // Demande : (marque, modèle) des études actives, par pays impliqué.
  const demandByCountry = new Map<string, Map<string, { brand: string; model: string }>>();
  for (const s of studies) {
    if (!s.brand || !s.model) continue;
    for (const c of [s.source_country, s.target_country]) {
      if (!c) continue;
      const m = demandByCountry.get(c) ?? demandByCountry.set(c, new Map()).get(c)!;
      m.set(`${canon(s.brand)}|${canon(s.model)}`, { brand: s.brand, model: s.model });
    }
  }

  const bySiteField = new Map<string, MappingRow[]>();
  for (const r of mappings) {
    const k = `${r.site}`;
    (bySiteField.get(k) ?? bySiteField.set(k, []).get(k)!).push(r);
  }

  const reports: SiteReport[] = [];
  for (const spec of SITE_SPECS) {
    const demand = demandByCountry.get(spec.country);
    const rows = bySiteField.get(spec.site) ?? [];
    const models: SiteReport['models'] = [];
    let missing = 0;
    for (const { brand, model } of demand?.values() ?? []) {
      const cb = canon(brand), cm = canon(model);
      let state: ModelState;
      if (spec.modelNeed === 'dérivé' && spec.modelFields.length === 0) {
        state = 'dérivé';
      } else {
        const hit = rows.some((r) => {
          const inFamily = spec.modelFields.some((f) =>
            spec.modelScoped ? r.field.startsWith(f) : r.field === f);
          if (!inFamily) return false;
          if (spec.modelScoped) {
            // famille scopée : sb:model:toyota — la marque vit dans le champ.
            const scope = canon(r.field.split(':').pop() ?? '');
            if (scope && scope !== cb && !cb.includes(scope) && !scope.includes(cb)) return false;
          }
          const cl = canon(r.label), cc = canon(r.code);
          return cl === cm || cl.includes(cm) || cm.includes(cl) || cc.includes(cm);
        });
        state = spec.modelNeed === 'requis'
          ? (hit ? 'connu' : 'manquant')
          : spec.modelNeed === 'fragile'
            ? (hit ? 'fragile-connu' : 'fragile-manquant')
            : 'dérivé';
      }
      if (state === 'manquant') missing += 1;
      models.push({ brand, model, state });
    }
    models.sort((a, b) => (a.state === 'manquant' ? -1 : 1) - (b.state === 'manquant' ? -1 : 1) || a.brand.localeCompare(b.brand));
    reports.push({
      spec,
      models,
      missingCount: missing,
      fuels: spec.fuelDict.length === 0 ? [] : rows.filter((r) => spec.fuelDict.includes(r.field)).map((r) => r.label),
      bodies: spec.bodyFields.length === 0 ? [] : rows.filter((r) => spec.bodyFields.includes(r.field)).map((r) => r.label),
    });
  }
  return reports;
}

const STATE_STYLE: Record<ModelState, string> = {
  'connu': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'manquant': 'bg-rose-50 text-rose-700 border-rose-300',
  'fragile-connu': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'fragile-manquant': 'bg-amber-50 text-amber-800 border-amber-300',
  'dérivé': 'bg-slate-50 text-slate-500 border-slate-200',
};
const STATE_LABEL: Record<ModelState, string> = {
  'connu': 'slug appris',
  'manquant': 'SLUG MANQUANT',
  'fragile-connu': 'enum appris',
  'fragile-manquant': 'candidats devinés',
  'dérivé': 'dérivé du nom',
};

export function KnowledgeMap({ studies }: { studies: StudyLike[] }) {
  const [mappings, setMappings] = useState<MappingRow[] | null>(null);
  const [selCountry, setSelCountry] = useState<string | null>(null);
  const [openSite, setOpenSite] = useState<string | null>(null);

  useEffect(() => { void fetchMappings().then(setMappings); }, []);

  const reports = useMemo(() => (mappings ? buildReports(studies, mappings) : []), [studies, mappings]);
  const countries = useMemo(() => {
    const m = new Map<string, { missing: number; fragile: number; sites: number }>();
    for (const r of reports) {
      const c = m.get(r.spec.country) ?? m.set(r.spec.country, { missing: 0, fragile: 0, sites: 0 }).get(r.spec.country)!;
      c.missing += r.missingCount;
      c.fragile += r.models.filter((x) => x.state === 'fragile-manquant').length;
      c.sites += 1;
    }
    return [...m.entries()].sort((a, b) => b[1].missing - a[1].missing || b[1].fragile - a[1].fragile);
  }, [reports]);
  const active = selCountry ?? countries[0]?.[0] ?? null;

  if (!mappings) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Lecture des dictionnaires appris…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-900">
        <MapIcon className="w-5 h-5 shrink-0 mt-0.5" />
        <p>
          Ce que les études actives DEMANDENT, croisé avec ce que les dictionnaires ont APPRIS des annonces.
          Un <span className="font-semibold text-rose-700">slug manquant</span> = recherche modèle impossible sur ce site ;
          le remède est toujours le même : colle une URL humaine du modèle (Atelier → Ingestion), le scrape apprend le reste.
        </p>
      </div>

      {/* ── Entonnoir niveau 1 : PAYS ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {countries.map(([c, agg]) => (
          <button
            key={c}
            onClick={() => { setSelCountry(c); setOpenSite(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
              c === active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
            }`}
          >
            <span className="font-semibold">{c}</span>
            {agg.missing > 0 && <span className="text-xs font-semibold text-rose-500 bg-rose-50 rounded-full px-1.5">{agg.missing}</span>}
            {agg.missing === 0 && agg.fragile > 0 && <span className="text-xs font-semibold text-amber-600 bg-amber-50 rounded-full px-1.5">{agg.fragile}</span>}
            {agg.missing === 0 && agg.fragile === 0 && <span className={`text-xs ${c === active ? 'text-slate-300' : 'text-slate-400'}`}>ok</span>}
          </button>
        ))}
      </div>

      {/* ── Niveau 2 : SITES du pays → 3 : marques/modèles ────────────────── */}
      <div className="space-y-2">
        {reports.filter((r) => r.spec.country === active).map((r) => {
          const isOpen = openSite === r.spec.site;
          const fragile = r.models.filter((m) => m.state === 'fragile-manquant').length;
          return (
            <div key={r.spec.site} className="bg-white border border-slate-200 rounded-xl">
              <button
                onClick={() => setOpenSite(isOpen ? null : r.spec.site)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
              >
                {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                <span className="font-medium text-slate-800">{r.spec.site}</span>
                <span className="text-xs text-slate-400">modèles : {r.spec.modelNeed}</span>
                <span className="ml-auto flex items-center gap-2 text-xs">
                  {r.missingCount > 0 && <span className="text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5 font-medium">{r.missingCount} manquant(s)</span>}
                  {fragile > 0 && <span className="text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{fragile} deviné(s)</span>}
                  {r.missingCount === 0 && fragile === 0 && <span className="text-emerald-700">✓</span>}
                </span>
              </button>
              {isOpen && (
                <div className="px-5 pb-4 space-y-3 border-t border-slate-100 pt-3">
                  {r.models.length === 0 ? (
                    <p className="text-xs text-slate-400">Aucune étude active ne vise ce pays.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {r.models.map((m) => (
                        <span
                          key={`${m.brand}|${m.model}`}
                          title={STATE_LABEL[m.state]}
                          className={`text-xs border rounded-full px-2 py-0.5 ${STATE_STYLE[m.state]}`}
                        >
                          {m.brand} {m.model}
                          {(m.state === 'manquant' || m.state === 'fragile-manquant') && <span className="font-semibold"> · {STATE_LABEL[m.state]}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                    <span>
                      Carburant : {r.spec.fuelDict.length === 0
                        ? <span className="text-emerald-700">registre prouvé</span>
                        : `${[...new Set(r.fuels)].length} appris (${[...new Set(r.fuels)].slice(0, 6).join(', ') || 'aucun'})`}
                    </span>
                    <span>
                      Carrosserie : {r.spec.bodyFields.length === 0
                        ? <span className="text-slate-400">— (backlog, câblage prêt)</span>
                        : <span className="text-violet-700">{[...new Set(r.bodies)].length} moissonnées — prêtes pour le chantier carrosserie</span>}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

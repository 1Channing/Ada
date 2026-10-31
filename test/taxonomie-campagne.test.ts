/**
 * Campagnes et re-scans mensuels → apprentissage des sites (31/10 après-midi, Channing : « il faut ajouter dans
 * l'apprentissage des sites les recherches des scans mensuels et celles des campagnes lancées manuellement qui ne
 * passent pas »). Le moteur de campagne (le même pour les campagnes manuelles et le re-scan mensuel) :
 *   - scrape un modèle appris dans l'Atelier au lieu de l'écarter comme « non exprimable » ;
 *   - note ce qu'un site ne sait pas écrire (source « campagne ») ;
 *   - note ce que le scrape a prouvé faux (source « campagne_echec ») ;
 *   - ne note rien pour la découverte, un échec technique ou Marktplaats.
 */
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';
import type { ScrapedListing } from '../src/lib/study-core/types';
import type { CampaignPlanItem } from '../src/lib/linkgen/campaignPlanner';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

const notes: Array<Record<string, unknown>> = [];
const db: FakeDb = { linkgen_learned_rules: [], linkgen_mapping_memory: [], market_snapshots: [], linkgen_enum_mappings: [] };
setSharedSupabase(fakeSupabase(db, { linkgen_note_gap: (a) => { notes.push(a); return { data: null, error: null }; } }) as never);
const { executeCampaignItem } = await import('../src/lib/linkgen/campaignEngine');
const { planCampaign, summarizePlan, combinationProof, emptyComboKey } = await import('../src/lib/linkgen/campaignPlanner');
const { brandKey: bKey } = await import('../src/services/marketData');
const { refModelKey: rmk } = await import('../src/services/vehicleRef');
const { modelFamilyKey } = await import('../src/lib/study-core/business-logic');
const { setLearnedRulesForTests } = await import('../src/lib/linkgen/learnedRules');

const listing = (o: Partial<ScrapedListing>): ScrapedListing => ({
  title: `${o.brand ?? ''} ${o.model ?? ''}`.trim(), description: '', price: 20000, currency: 'EUR', price_type: 'one-off',
  year: 2021, mileage: 60000, trim: null, listing_url: `https://x/${Math.random()}`, brand: null, model: null, fuel: null, ...o,
} as ScrapedListing);
const many = (n: number, o: Partial<ScrapedListing>) => Array.from({ length: n }, (_, i) => listing({ price: 20000 + i * 100, ...o }));
const plan = (o: Partial<CampaignPlanItem>) => ({ site: '', brand: '', model: '', year: 2021, kind: 'reinforcement', ...o }) as CampaignPlanItem;
const notesFor = (model: string) => notes.filter((n) => n.p_model === model);

console.log('\n=== UN MODÈLE APPRIS DANS L\'ATELIER EST SCRAPÉ PAR LES CAMPAGNES ===\n');
setLearnedRulesForTests([{
  id: 'r-cls', site: 'LACENTRALE', kind: 'modele', brand_key: 'MERCEDES', model_key: 'CLS', criterion: '', value_key: '',
  rule: { op: 'param', param: 'makesModelsCommercialNames', value: 'MERCEDES::CLASSE CLS' }, status: 'active',
} as never]);
const urls: string[] = [];
const r1 = await executeCampaignItem(1, plan({ site: 'LACENTRALE', brand: 'MERCEDES', model: 'CLS-CLASS' }), async (u) => {
  urls.push(u);
  return { listings: many(8, { brand: 'MERCEDES', model: 'CLASSE CLS', title: 'MERCEDES CLASSE CLS 350 D' }), error: null };
});
ok(r1.outcome !== 'no_url' && urls.length > 0 && urls[0].includes('MERCEDES%3A%3ACLASSE%20CLS'),
  'La Centrale « CLS-CLASS » (appris : « Classe CLS ») : la campagne scrape l\'adresse apprise au lieu de « segment non exprimable »', [r1.outcome, r1.detail, urls[0]]);
ok(notesFor('CLS-CLASS').length === 0, 'modèle appris : aucune lacune notée');

console.log('\n=== CE QU\'UN SITE NE SAIT PAS ÉCRIRE PART DANS LA FILE (« campagne ») ===\n');
const r2urls: string[] = [];
const r2 = await executeCampaignItem(2, plan({ site: 'LACENTRALE', brand: 'MERCEDES', model: 'GLB-CLASS' }), async (u) => { r2urls.push(u); return { listings: [], error: null }; });
const n2 = notesFor('GLB-CLASS');
ok(r2.outcome === 'no_url' && r2urls.length === 0, 'modèle inconnu de La Centrale et jamais appris : toujours écarté sans scrape (0 appel Zyte)', [r2.outcome, r2urls]);
ok(n2.length === 1 && n2[0].p_kind === 'modele' && n2[0].p_source === 'campagne' && n2[0].p_site === 'LACENTRALE'
  && String(n2[0].p_start_url).includes('makesModelsCommercialNames=MERCEDES'),
  '… et noté pour l\'apprentissage : ligne modèle, source « campagne », page de départ = page marque', n2);

console.log('\n=== CE QUE LE SCRAPE A PROUVÉ FAUX PART DANS LA FILE (« campagne_echec ») ===\n');
// AutoScout24 « sait écrire » X5 (slug /bmw/x5), mais le site sert la page marque entière : repli silencieux.
const fallback = async () => ({
  listings: many(12, { brand: 'BMW', model: 'X3', title: 'BMW X3 xDrive20d' }), error: null,
  diagnostics: { silentFallback: { modelApplied: false, evidence: 'compteur de la page marque' } },
});
const r3 = await executeCampaignItem(3, plan({ site: 'AUTOSCOUT_DE', brand: 'BMW', model: 'X5' }), fallback);
const n3 = notesFor('X5');
ok(r3.outcome === 'taxonomy_gap' && n3.length === 1 && n3[0].p_source === 'campagne_echec',
  'repli silencieux (page marque entière), sondes épuisées : ligne notée « campagne_echec »', [r3.outcome, n3.map((n) => n.p_source)]);

// Le site applique un filtre, mais les annonces sont d'un autre modèle : analyse « modèle rejeté ».
const r4 = await executeCampaignItem(4, plan({ site: 'AUTOSCOUT_DE', brand: 'BMW', model: 'X6' }), async () => ({
  listings: many(12, { brand: 'BMW', model: 'X3', title: 'BMW X3 xDrive20d' }), error: null,
}));
const n4 = notesFor('X6');
ok(r4.outcome === 'taxonomy_gap' && n4.length === 1 && n4[0].p_source === 'campagne_echec',
  'annonces d\'un autre modèle (X3 servies pour X6) : ligne notée « campagne_echec »', [r4.outcome, r4.detail, n4.map((n) => n.p_source)]);

console.log('\n=== CE QUI N\'EST PAS UN PROBLÈME DE TAXONOMIE N\'Y VA PAS ===\n');
const r5 = await executeCampaignItem(5, plan({ site: 'AUTOSCOUT_DE', brand: 'BMW', model: 'X1' }), async () => ({ listings: [], error: 'BLOCKED: 403' }));
ok(r5.outcome === 'technical' && notesFor('X1').length === 0, 'blocage technique (403) : rien n\'est noté', [r5.outcome, notesFor('X1')]);
const before = notes.length;
await executeCampaignItem(6, plan({ site: 'AUTOSCOUT_DE', brand: 'BMW', model: '', discovery: true, kind: 'exploration' }), async () => ({ listings: many(12, { brand: 'BMW', model: 'X3' }), error: null }));
ok(notes.length === before, 'découverte (moisson, sans modèle) : rien n\'est noté');
await executeCampaignItem(7, plan({ site: 'MARKTPLAATS', brand: 'BMW', model: 'X7' }), async () => ({
  listings: many(12, { brand: 'BMW', model: 'X3', title: 'BMW X3' }), error: null,
}));
ok(!notesFor('X7').some((n) => n.p_source === 'campagne_echec'), 'Marktplaats (modèle en texte libre) : pas de ligne « échec prouvé »', notesFor('X7'));

console.log('\n=== CAMPAGNES : PAS DE SCRAPE SANS PREUVE QUE LA COMBINAISON EXISTE (31/10) ===\n');
// Les trois preuves : le MARCHÉ (annonces vues par carburant), le TERRAIN (déjà vu par ADA), les IMMATRICULATIONS UE.
const yrs = (n: number) => Object.fromEntries([2020, 2021, 2022, 2023, 2024, 2025].map((y) => [String(y), n]));
const moto = {
  [`${bKey('BMW')}|${rmk('BMW', 'M5')}`]: [{ fuel: 'ESSENCE', total: 20000, years: yrs(3000) }, { fuel: 'PLUG_IN_HYBRID', total: 6000, years: yrs(1000) }],
  [`${bKey('VOLKSWAGEN')}|${rmk('VOLKSWAGEN', 'TOUAREG')}`]: [{ fuel: 'DIESEL', total: 50000, years: yrs(8000) }, { fuel: 'PLUG_IN_HYBRID', total: 9000, years: yrs(1500) }],
};
const marketFuel = {
  rows: 3,
  byCombo: { [`${bKey('TOYOTA')}|${modelFamilyKey('YARIS CROSS')}`]: { HYBRIDE: { count: 50, sites: ['COCHES', 'MARKTPLAATS'], labels: ['Yaris Cross'] } } },
  brandSites: {},
};
const knowledge = {
  brands: ['TOYOTA', 'BMW', 'VOLKSWAGEN'],
  modelsByBrand: { TOYOTA: ['YARIS CROSS'], BMW: ['M5'], VOLKSWAGEN: ['TOUAREG'] },
  fuelsByBrandModel: {}, trimsByBrandModel: {}, coveredBySite: {},
  refCombos: [{ brand: 'BUGATTI', model: 'CHIRON' }, { brand: 'NISSAN', model: 'NAVARA' }, { brand: 'TESLA', model: 'CYBERTRUCK' }],
  motorisations: moto, marketFuel, observedFuelCombos: new Set([emptyComboKey('NISSAN', 'NAVARA', 'DIESEL')]),
} as never;
let seed = 7; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const stats = { unproven: [] as string[] };
const plan1 = planCampaign(knowledge, { sites: ['AUTOSCOUT_DE'], total: 500, rng, filters: { fuels: ['PLUG_IN_HYBRID', 'HYBRIDE', 'ELECTRIQUE'], yearMin: 2023, yearMax: 2024 } }, stats);
const has = (b: string, m: string, f?: string) => plan1.some((p) => p.brand === b && p.model === m && (!f || p.fuel === f));
ok(!has('BUGATTI', 'CHIRON') && !has('TESLA', 'CYBERTRUCK') && !has('NISSAN', 'NAVARA'),
  'Bugatti Chiron, Tesla Cybertruck, Nissan Navara électrifiés : aucune preuve → jamais planifiés (0 appel Zyte)', plan1.map((p) => `${p.brand} ${p.model} ${p.fuel}`));
ok(stats.unproven.some((u) => /^BUGATTI CHIRON plug_in_hybrid — aucune preuve/.test(u)) && stats.unproven.some((u) => /^NISSAN NAVARA/.test(u)),
  'les combinaisons écartées sont tracées, avec la raison', stats.unproven.slice(0, 4));
ok(has('TOYOTA', 'YARIS CROSS', 'HYBRIDE') && !has('TOYOTA', 'YARIS CROSS', 'ELECTRIQUE'),
  'Yaris Cross hybride : prouvée par le marché (50 annonces) → planifiée ; Yaris Cross électrique : aucune preuve → écartée');
ok(has('BMW', 'M5', 'PLUG_IN_HYBRID') && !has('BMW', 'M5', 'ELECTRIQUE') && !has('VOLKSWAGEN', 'TOUAREG', 'HYBRIDE') && has('VOLKSWAGEN', 'TOUAREG', 'PLUG_IN_HYBRID'),
  'immatriculations UE : M5 et Touareg rechargeables planifiés ; Touareg hybride simple (0 immat.) et M5 électrique écartés');
const sum = summarizePlan(plan1, stats);
ok((sum.unproven ?? 0) === stats.unproven.length && (sum.unprovenSample ?? []).length > 0, 'l\'aperçu de campagne affiche le nombre de combinaisons écartées et des exemples', sum.unproven);
// « Hybride » seul ciblé, la M5 n'existant qu'en rechargeable : la variante qui existe est étudiée (comme avant).
const plan2 = planCampaign(knowledge, { sites: ['AUTOSCOUT_DE'], total: 50, rng, filters: { fuels: ['HYBRIDE'], brands: ['BMW'], yearMin: 2024, yearMax: 2024 } });
const m5 = plan2.filter((p) => p.model);
ok(m5.length === 1 && m5[0].fuel === 'PLUG_IN_HYBRID', 'M5 « hybride » ciblé : étudiée en rechargeable, la seule qui existe (la page marque de découverte reste à part)', plan2.map((p) => `${p.model} ${p.fuel}`));
// Hypothèse tapée par l'opérateur : son intention prime, planifiée sans preuve (comme avant).
const plan3 = planCampaign(knowledge, { sites: ['AUTOSCOUT_DE'], total: 10, rng, filters: { fuels: ['ELECTRIQUE'], brands: ['TESLA'], models: ['ROADSTER 2'], yearMin: 2025, yearMax: 2025 } });
ok(plan3.some((p) => p.model === 'ROADSTER 2' && p.hypothesis), 'un modèle tapé à la main (hypothèse) reste planifié : c\'est au site de dire s\'il existe');
ok(combinationProof(knowledge, 'NISSAN', 'NAVARA', 'DIESEL', 2024).proven && !combinationProof(knowledge, 'NISSAN', 'NAVARA', 'PLUG_IN_HYBRID', 2024).proven,
  'Navara diesel : déjà vue par ADA → prouvée ; Navara hybride rechargeable → non');

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);

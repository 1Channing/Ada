/**
 * LE LIVRE DU SITE, SOURCE UNIQUE (01/11, Channing : « chaque site a un livre unique… on ne devine jamais une
 * adresse »). Les 8 modèles appris par l'ancien « Apprentissage des sites » s'écrivent désormais depuis le seul livre
 * de leur site (linkgen_enum_mappings) — plus aucune règle apprise à part :
 *   - 6 directement par l'adaptateur (le livre contient déjà le nom du site) ;
 *   - 2 par la traduction canonique du générateur (ENYAQ → « Enyaq iV » sur Gaspedaal, ZS → « MG ZS » sur Skelbiu).
 * Les campagnes (et le re-scan mensuel, même moteur) les scrapent ; un modèle absent du livre reste écarté sans scrape.
 * Puis : pas de scrape sans preuve que la combinaison existe (31/10).
 */
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';
import type { ScrapedListing } from '../src/lib/study-core/types';
import type { CampaignPlanItem } from '../src/lib/linkgen/campaignPlanner';
import type { SiteKey } from '../src/lib/linkgen/types';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

const db: FakeDb = { linkgen_mapping_memory: [], market_snapshots: [], linkgen_enum_mappings: [] };
setSharedSupabase(fakeSupabase(db) as never);
const { generateSearchUrlsWithMemory } = await import('../src/lib/linkgen/generator');
const { ensureLearnedTaxonomy } = await import('../src/lib/linkgen/taxonomy');
const { executeCampaignItem } = await import('../src/lib/linkgen/campaignEngine');
const { planCampaign, summarizePlan, combinationProof, emptyComboKey } = await import('../src/lib/linkgen/campaignPlanner');
const { brandKey: bKey } = await import('../src/services/marketData');
const { refModelKey: rmk } = await import('../src/services/vehicleRef');
const { modelFamilyKey } = await import('../src/lib/study-core/business-logic');

const listing = (o: Partial<ScrapedListing>): ScrapedListing => ({
  title: `${o.brand ?? ''} ${o.model ?? ''}`.trim(), description: '', price: 20000, currency: 'EUR', price_type: 'one-off',
  year: 2021, mileage: 60000, trim: null, listing_url: `https://x/${Math.random()}`, brand: null, model: null, fuel: null, ...o,
} as ScrapedListing);
const many = (n: number, o: Partial<ScrapedListing>) => Array.from({ length: n }, (_, i) => listing({ price: 20000 + i * 100, ...o }));
const plan = (o: Partial<CampaignPlanItem>) => ({ site: '', brand: '', model: '', year: 2021, kind: 'reinforcement', ...o }) as CampaignPlanItem;
const gen = async (site: string, brand: string, model: string) => (await generateSearchUrlsWithMemory({ selectedSites: [site as SiteKey], brand, model }))[0];

// Les 8 modèles de l'ancien apprentissage, tels qu'ils sont dans le livre de leur site en base (relevé du 01/11).
const THE_8: Array<{ site: string; brand: string; model: string; expect: string; viaBook?: true }> = [
  { site: 'GASPEDAAL', brand: 'SKODA', model: 'ENYAQ', expect: '/skoda/enyaq-iv', viaBook: true },
  { site: 'LACENTRALE', brand: 'CUPRA', model: 'RAVAL', expect: 'makesModelsCommercialNames=CUPRA%3A%3ARAVAL' },
  { site: 'LEBONCOIN', brand: 'MERCEDES', model: 'CLS-CLASS', expect: 'u_car_model=MERCEDES-BENZ_Classe%20CLS' },
  { site: 'LACENTRALE', brand: 'MERCEDES', model: 'CLS-CLASS', expect: 'makesModelsCommercialNames=MERCEDES%3A%3ACLASSE%20CLS' },
  { site: 'LACENTRALE', brand: 'PEUGEOT', model: '3008', expect: 'makesModelsCommercialNames=PEUGEOT%3A%3A3008' },
  { site: 'LEBONCOIN', brand: 'NISSAN', model: '370Z', expect: 'u_car_model=NISSAN_370Z' },
  { site: 'LEBONCOIN', brand: 'NISSAN', model: 'NAVARA', expect: 'u_car_model=NISSAN_Navara' },
  { site: 'SKELBIU', brand: 'MG/MG MOTOR', model: 'ZS', expect: 'category_id=2924', viaBook: true },
];

console.log('\n=== SANS LE LIVRE : RIEN N\'EST DEVINÉ ===\n');
const before = await gen('GASPEDAAL', 'SKODA', 'ENYAQ');
ok(!before.url.includes('enyaq-iv') && !before.modelFromBook, 'Gaspedaal ENYAQ, livre vide : pas de « Enyaq iV » sorti de nulle part', before.url);
const beforeSk = await gen('SKELBIU', 'MG/MG MOTOR', 'ZS');
ok(!beforeSk.url.includes('2924'), 'Skelbiu ZS, livre vide : aucune catégorie inventée', beforeSk.url);

console.log('\n=== LES 8 MODÈLES S\'ÉCRIVENT DEPUIS LE LIVRE DE LEUR SITE ===\n');
let id = 0;
const book = (site: string, field: string, code: string, label: string) => db.linkgen_enum_mappings.push({ id: ++id, site, field, code, label });
book('GASPEDAAL', 'gp:brand', 'skoda', 'Skoda');
book('GASPEDAAL', 'gp:model:skoda', 'enyaq-iv', 'Enyaq iV');
book('LACENTRALE', 'lc:make', 'cupra', 'CUPRA');
book('LACENTRALE', 'lc:make', 'mercedes', 'MERCEDES');
book('LACENTRALE', 'lc:make', 'peugeot', 'PEUGEOT');
book('LACENTRALE', 'lc:model:cupra', 'raval', 'RAVAL');
book('LACENTRALE', 'lc:model:mercedes', 'classe-cls', 'CLASSE CLS');
book('LACENTRALE', 'lc:model:peugeot', '3008', '3008');
book('LEBONCOIN', 'u_car_brand', 'MERCEDES-BENZ', 'MERCEDES-BENZ');
book('LEBONCOIN', 'u_car_brand', 'NISSAN', 'NISSAN');
book('LEBONCOIN', 'u_car_model', 'MERCEDES-BENZ_Classe CLS', 'Classe CLS');
book('LEBONCOIN', 'u_car_model', 'NISSAN_370Z', '370Z');
book('LEBONCOIN', 'u_car_model', 'NISSAN_Navara', 'Navara');
book('SKELBIU', 'sk:cat', '2924', 'MG ZS');
await ensureLearnedTaxonomy(0);

for (const m of THE_8) {
  const r = await gen(m.site, m.brand, m.model);
  ok(r.url.includes(m.expect) && r.mappingSource === 'default_template' && Boolean(r.modelFromBook) === Boolean(m.viaBook),
    `${m.site} ${m.brand} ${m.model} → ${m.expect}${m.viaBook ? ' (nom du livre)' : ''}`, [r.url, r.modelFromBook ?? false]);
}
const fuelYear = (await generateSearchUrlsWithMemory({ selectedSites: ['GASPEDAAL'], brand: 'SKODA', model: 'ENYAQ', fuel: 'ELECTRIQUE', yearFrom: '2023', yearTo: '2023' }))[0];
ok(fuelYear.url.includes('/skoda/enyaq-iv') && fuelYear.url.includes('bmin=2023'), 'le nom du livre vaut avec tous les critères (carburant, années)', fuelYear.url);
const unknown = await gen('LACENTRALE', 'MERCEDES', 'GLB-CLASS');
ok(!unknown.modelFromBook && !/GLB/i.test(unknown.url), 'GLB absent du livre de La Centrale : rien n\'est inventé', unknown.url);

console.log('\n=== LES CAMPAGNES (ET LE RE-SCAN MENSUEL) LES SCRAPENT ===\n');
const urls: string[] = [];
const r1 = await executeCampaignItem(1, plan({ site: 'GASPEDAAL', brand: 'SKODA', model: 'ENYAQ' }), async (u) => {
  urls.push(u);
  return { listings: many(8, { brand: 'SKODA', model: 'ENYAQ', title: 'Skoda Enyaq iV 80' }), error: null };
});
ok(r1.outcome !== 'no_url' && urls.length > 0 && urls[0].includes('/skoda/enyaq-iv'),
  'Gaspedaal ENYAQ : la campagne scrape l\'adresse écrite avec le nom du livre (« Enyaq iV ») au lieu de « segment non exprimable »', [r1.outcome, r1.detail, urls[0]]);
const skUrls: string[] = [];
const r1b = await executeCampaignItem(2, plan({ site: 'SKELBIU', brand: 'MG/MG MOTOR', model: 'ZS' }), async (u) => {
  skUrls.push(u);
  return { listings: many(8, { title: 'MG ZS, 2021 m.' }), error: null };
});
ok(r1b.outcome !== 'no_url' && skUrls.length > 0 && skUrls[0].includes('category_id=2924'), 'Skelbiu ZS : scrapé sur sa catégorie « MG ZS »', [r1b.outcome, skUrls[0]]);
const r2urls: string[] = [];
const r2 = await executeCampaignItem(3, plan({ site: 'LACENTRALE', brand: 'MERCEDES', model: 'GLB-CLASS' }), async (u) => { r2urls.push(u); return { listings: [], error: null }; });
ok(r2.outcome === 'no_url' && r2urls.length === 0, 'modèle absent du livre : toujours écarté sans scrape (0 appel Zyte)', [r2.outcome, r2urls]);

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

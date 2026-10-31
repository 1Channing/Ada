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

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);

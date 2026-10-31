/**
 * L'apprentissage des sites, côté worker (30/10, Channing : « nos taxonomies doivent être parfaites […] il est
 * également important que ce soit automatisé »). Une proposition de Claude : règle déduite, deux contrôles, « à
 * valider » — ou refus automatique ; conflit signalé ; catalogue officiel Jófogás ; lignes résolues d'elles-mêmes ;
 * règle suspendue après deux contrôles hebdomadaires en échec ; rappel « à valider » dans la cloche.
 */
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';
import { leboncoinAdapter } from '../src/lib/study-core/marketplaces/leboncoin';
import { subitoAdapter } from '../src/lib/study-core/marketplaces/subito';
import { gaspedaalAdapter } from '../src/lib/study-core/marketplaces/gaspedaal';
import { structuredModelMatches } from '../src/lib/study-core/business-logic';
import type { ScrapedListing } from '../src/lib/study-core/types';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

const listing = (o: Partial<ScrapedListing>): ScrapedListing => ({
  title: `${o.brand ?? ''} ${o.model ?? ''}`.trim(), description: '', price: 20000, currency: 'EUR', price_type: 'one-off',
  year: 2022, mileage: 50000, trim: null, listing_url: `https://x/${Math.random()}`, brand: null, model: null, fuel: null, ...o,
} as ScrapedListing);
const many = (n: number, o: Partial<ScrapedListing>) => Array.from({ length: n }, () => listing(o));

const db: FakeDb = {
  profiles: [{ id: 'u-channing', organisation: 'MC Export', blocked: false }],
  linkgen_learning_items: [], linkgen_learned_rules: [], linkgen_enum_mappings: [], user_tasks: [],
};
const users = [{ id: 'u-channing', email: 'channing@mc-export.com' }];
setSharedSupabase({ ...fakeSupabase(db), auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } } } as never);
const { learningProposalsTick, learningHourlyTick, weeklyRecheck, learningProbeTick, checkProposal } = await import('../worker/taxonomyLearning');
const { lacentraleAdapter } = await import('../src/lib/study-core/marketplaces/lacentrale');

const scraped: string[] = [];
const scrapeBy = (f: (url: string) => ScrapedListing[]) => async (url: string) => { scraped.push(url); return { listings: f(url) }; };
const item = (o: Record<string, unknown>) => ({
  id: `it-${db.linkgen_learning_items.length + 1}`, brand: '', model: '', criterion: '', value: '', attempts: 0, status: 'proposee', priority: 0,
  proposed_at: new Date().toISOString(), ...o,
});

console.log('\n=== UNE PROPOSITION DE MODÈLE (SUBITO) ===\n');
const SB0 = subitoAdapter.buildSearchUrl({ brand: 'BMW', model: '' }).url;
const SB1 = SB0.replace('/auto/bmw/', '/auto/bmw/serie-1/');
db.linkgen_learning_items.push(item({ id: 'm1', kind: 'modele', site: 'SUBITO', brand: 'BMW', model: 'Serie 1', start_url: SB0, proposed_url: SB1 }));
const bmw1 = scrapeBy(() => many(5, { brand: 'BMW', model: 'Serie 1', title: 'BMW Serie 1 118d' }));
await learningProposalsTick({ scrape: bmw1, fetchText: async () => null });
const m1 = db.linkgen_learning_items.find((x) => x.id === 'm1')!;
const chk = m1.check_result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
ok(m1.status === 'validee' && JSON.stringify((m1.learned as Record<string, unknown>).rule) === JSON.stringify({ op: 'segments', after: 'bmw', segments: ['serie-1'] }),
  'la règle est déduite (segment « serie-1 » après la marque)', m1);
const auto1 = db.linkgen_learned_rules.find((r) => r.item_id === 'm1');
ok(Boolean(auto1) && auto1!.status === 'active' && auto1!.validated_by === null && auto1!.proof_url === SB1 && String(m1.decision_note).startsWith('Validé automatiquement'),
  'contrôles à 100 % sur les deux adresses (5/5) : validée AUTOMATIQUEMENT, règle active avec sa preuve', [auto1, m1.decision_note]);
ok(chk?.verdict === 'ok' && chk.claude.verdict === 'ok' && chk.ada.verdict === 'ok', 'deux contrôles conformes : l\'adresse de Claude et celle construite par ADA', chk);
ok(typeof m1.verify_url === 'string' && (m1.verify_url as string).includes('/auto/bmw/serie-1/') && scraped.length === 2 && scraped[1] === m1.verify_url,
  'le lien « Vérifier sur le site » : la page marque d\'ADA, le modèle posé par la règle — et scrapé', m1.verify_url);
ok((m1.learned as Record<string, unknown>).brand_key === 'BMW' && Boolean((m1.learned as Record<string, unknown>).model_key), 'les clés marque / modèle de la règle sont posées');

console.log('\n=== FIABLE, MAIS PAS À 100 % : POUR VOUS ===\n');
const SB3 = SB0.replace('/auto/bmw/', '/auto/bmw/serie-3/');
db.linkgen_learning_items.push(item({ id: 'm3', kind: 'modele', site: 'SUBITO', brand: 'BMW', model: 'Serie 3', start_url: SB0, proposed_url: SB3 }));
await learningProposalsTick({ scrape: scrapeBy(() => [...many(9, { brand: 'BMW', model: 'Serie 3' }), listing({ brand: 'BMW', model: 'Serie 2' })]), fetchText: async () => null });
const m3 = db.linkgen_learning_items.find((x) => x.id === 'm3')!;
ok(m3.status === 'a_valider' && (m3.check_result as Record<string, unknown>).verdict === 'ok' && !db.linkgen_learned_rules.some((r) => r.item_id === 'm3'),
  '9/10 conformes : contrôle « conforme » mais pas à 100 % → attend un administrateur, aucune règle posée', m3.check_result);

console.log('\n=== ENYAQ / ENYAQ iV (GASPEDAAL, 31/10) ===\n');
ok(structuredModelMatches('Enyaq iV', 'ENYAQ') && structuredModelMatches('Superb iV', 'SUPERB') && !structuredModelMatches('Yaris Cross', 'YARIS') && !structuredModelMatches('Enyaq Coupé iV', 'ENYAQ'),
  '« Enyaq iV » est un Enyaq (marque électrifiée Skoda) ; « Yaris Cross » n\'est pas une Yaris ; le coupé reste à part');
const GP0 = gaspedaalAdapter.buildSearchUrl({ brand: 'SKODA', model: '' }).url;
const GP1 = GP0.replace('/skoda', '/skoda/enyaq-iv');
db.linkgen_learning_items.push(item({ id: 'g1', kind: 'modele', site: 'GASPEDAAL', brand: 'SKODA', model: 'ENYAQ', start_url: GP0, proposed_url: GP1 }));
await learningProposalsTick({ scrape: scrapeBy(() => many(40, { brand: 'Skoda', model: 'Enyaq iV', title: 'Skoda Enyaq iV - 60' })), fetchText: async () => null });
const g1 = db.linkgen_learning_items.find((x) => x.id === 'g1')!;
ok(g1.status === 'validee' && db.linkgen_learned_rules.some((r) => r.item_id === 'g1' && JSON.stringify(r.rule) === JSON.stringify({ op: 'segments', after: 'skoda', segments: ['enyaq-iv'] })),
  'l\'Enyaq de Gaspedaal (40/40 « Enyaq iV ») : validé automatiquement, segment « enyaq-iv »', [g1.status, g1.check_result]);

console.log('\n=== REFUS AUTOMATIQUE ===\n');
db.linkgen_learning_items.push(item({ id: 'm2', kind: 'modele', site: 'SUBITO', brand: 'BMW', model: 'Serie 2', start_url: SB0, proposed_url: `${SB1}${SB1.includes('?') ? '&' : '?'}fuel=diesel` }));
scraped.length = 0;
await learningProposalsTick({ scrape: bmw1, fetchText: async () => null });
const m2 = db.linkgen_learning_items.find((x) => x.id === 'm2')!;
ok(m2.status === 'a_chercher' && String(m2.decision_note).startsWith('Refus automatique') && m2.attempts === 1 && m2.proposed_url === null && scraped.length === 0,
  'deux choses changées : refus automatique, la ligne repart à chercher avec le motif, sans aucun scrape', m2);

console.log('\n=== UNE PROPOSITION DE FILTRE (LEBONCOIN, KM MINIMUM) ===\n');
const LBC0 = leboncoinAdapter.buildSearchUrl({ brand: 'TOYOTA', model: '' }).url;
db.linkgen_learning_items.push(item({ id: 'f1', kind: 'filtre', site: 'LEBONCOIN', brand: 'TOYOTA', criterion: 'mileageMin', value: '20000', start_url: LBC0, proposed_url: `${LBC0}&mileage=20000-max` }));
const kmOk = scrapeBy((u) => many(6, { brand: 'TOYOTA', mileage: u.includes('mileage=40000') ? 52000 : 31000 }));
await learningProposalsTick({ scrape: kmOk, fetchText: async () => null });
let f1 = db.linkgen_learning_items.find((x) => x.id === 'f1')!;
ok(f1.status === 'validee' && (f1.check_result as Record<string, unknown>).verdict === 'ok' && String(f1.verify_url).includes('mileage=40000-max'),
  'km min : forme « plage » apprise, vérifiée avec une AUTRE valeur (40 000), 6/6 et 6/6 → validée automatiquement', [f1.status, f1.verify_url]);
ok((f1.learned as Record<string, unknown>).value_key === '*', 'une forme générale : elle vaudra pour toutes les valeurs');

db.linkgen_learning_items.push(item({ id: 'f2', kind: 'filtre', site: 'LEBONCOIN', brand: 'TOYOTA', criterion: 'mileageMin', value: '20000', start_url: LBC0, proposed_url: `${LBC0}&mileage=20000-max` }));
await learningProposalsTick({ scrape: scrapeBy(() => many(6, { brand: 'TOYOTA', mileage: 9000 })), fetchText: async () => null });
const f2 = db.linkgen_learning_items.find((x) => x.id === 'f2')!;
ok((f2.check_result as Record<string, unknown>).verdict === 'echec', 'des annonces sous la borne : contrôle en échec (jamais validable)', f2.check_result);

db.linkgen_learned_rules.push({ id: 'r-old', status: 'active', site: 'LEBONCOIN', kind: 'filtre', brand_key: '', model_key: '', criterion: 'mileageMin', value_key: '*', rule: {} });
db.linkgen_learning_items.push(item({ id: 'f3', kind: 'filtre', site: 'LEBONCOIN', brand: 'TOYOTA', criterion: 'mileageMin', value: '20000', start_url: LBC0, proposed_url: `${LBC0}&mileage=20000-max` }));
await learningProposalsTick({ scrape: kmOk, fetchText: async () => null });
const f3 = db.linkgen_learning_items.find((x) => x.id === 'f3')!;
ok((f3.check_result as Record<string, unknown>).conflict === true, 'une règle active existe déjà pour ce cas : conflit signalé', f3.check_result);
db.linkgen_learned_rules = [];

console.log('\n=== CATALOGUE OFFICIEL JÓFOGÁS, RÉSOLUTION AUTOMATIQUE ===\n');
db.linkgen_learning_items.push(item({ id: 'j1', kind: 'modele', site: 'JOFOGAS', brand: 'TOYOTA', model: 'C-HR', status: 'a_chercher' }));
db.linkgen_learning_items.push(item({ id: 'j2', kind: 'modele', site: 'JOFOGAS', brand: 'TOYOTA', model: 'Yaris Cross', status: 'a_chercher' }));
const fetched: string[] = [];
const fetchText = async (url: string) => {
  fetched.push(url);
  if (url.startsWith('https://auto.jofogas.hu/magyarorszag/auto/toyota')) return '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"selectedParams":{"cb_cars":"toyota","cg":"2020"}}}}</script>';
  if (url.startsWith('https://searchparams.jofogas.hu/models?cg=2020&cb_cars=toyota')) return JSON.stringify({ status: 'OK', data: { name: 'mo_cars', options: { 33: 'RAV 4', 47: 'Yaris', 48: 'Egyéb', 49: 'C-Hr' } } });
  return null;
};
const NOW = new Date('2026-10-31T08:30:00Z'); // 9 h 30 à Paris
const h1 = await learningHourlyTick({ scrape: kmOk, fetchText }, NOW);
const jf = db.linkgen_enum_mappings.filter((r) => r.field === 'jf:modelid:toyota');
ok(jf.length === 3 && !jf.some((r) => r.label === 'Egyéb') && jf.some((r) => r.code === '49' && r.label === 'C-Hr'), 'catalogue officiel : les modèles de la marque, identifiants du site, sans « Egyéb » (« Autre »)', jf);
ok(db.linkgen_learning_items.find((x) => x.id === 'j1')!.status === 'resolue' && db.linkgen_learning_items.find((x) => x.id === 'j2')!.status === 'a_chercher',
  'le C-HR se ferme tout seul (« résolue ») ; le Yaris Cross, absent du catalogue, reste pour Claude', h1);
const reminder = db.user_tasks.find((t) => String(t.key).startsWith('apprentissage:2026-10-31'));
ok(Boolean(reminder) && /\d+ ligne\(s\) à valider/.test(String(reminder?.title)) && reminder?.assignee_id === 'u-channing' && reminder?.link === '/apprentissage-sites?onglet=valider',
  'à 9 h 30 : « N lignes à valider » dans la cloche de Channing, avec le lien', reminder);

console.log('\n=== CONTRÔLE HEBDOMADAIRE ===\n');
f1 = db.linkgen_learning_items.find((x) => x.id === 'f1')!;
f1.status = 'validee';
db.linkgen_learned_rules.push({
  id: 'r1', status: 'active', site: 'LEBONCOIN', kind: 'filtre', brand_key: '', model_key: '', brand: 'TOYOTA', model: '', criterion: 'mileageMin',
  value_key: '*', value: '20000', rule: { encoding: 'range', param: 'mileage', side: 'min', sep: '-', openMin: '', openMax: 'max' }, fail_count: 0, last_check_at: null, item_id: 'f1',
});
const bad = scrapeBy(() => many(6, { brand: 'TOYOTA', mileage: 9000 }));
await weeklyRecheck({ scrape: bad, fetchText }, NOW);
let r1 = db.linkgen_learned_rules.find((r) => r.id === 'r1')!;
ok(r1.status === 'active' && r1.fail_count === 1 && r1.last_check_at === NOW.toISOString(), 'un premier échec : compté, la règle reste active');
await weeklyRecheck({ scrape: bad, fetchText }, new Date(NOW.getTime() + 3 * 86_400_000));
r1 = db.linkgen_learned_rules.find((r) => r.id === 'r1')!;
ok(r1.fail_count === 1, 'moins d\'une semaine après : pas re-testée');
await weeklyRecheck({ scrape: bad, fetchText }, new Date(NOW.getTime() + 8 * 86_400_000));
r1 = db.linkgen_learned_rules.find((r) => r.id === 'r1')!;
const f1b = db.linkgen_learning_items.find((x) => x.id === 'f1')!;
ok(r1.status === 'suspendue' && f1b.status === 'a_chercher' && /suspendue/.test(String(f1b.decision_note)), 'deux échecs : la règle est suspendue, la ligne repart à chercher', [r1.status, f1b.status]);
ok(db.user_tasks.some((t) => t.key === 'apprentissage-suspendue:r1'), 'alerte de suspension dans la cloche');
ok(db.linkgen_learning_items.find((x) => x.id === 'm3')!.status === 'a_valider', 'ce qui n\'est pas à 100 % attend toujours un administrateur');

console.log('\n=== ADA ESSAIE SEULE, PUIS LE NOM EXACT DE CLAUDE (31/10) ===\n');
const LC0 = lacentraleAdapter.buildSearchUrl({ brand: 'MERCEDES', model: '' }).url;
const lcScrape = scrapeBy((u) => (u.includes('MERCEDES%3A%3ACLASSE%20CLS') ? many(8, { brand: 'MERCEDES', model: 'CLASSE CLS' })
  : u.includes('CUPRA%3A%3A') ? [] : many(8, { brand: 'MERCEDES', model: 'CLASSE E' })));
db.linkgen_learning_items.push(item({ id: 'p1', kind: 'modele', site: 'LACENTRALE', brand: 'MERCEDES', model: 'CLS-CLASS', status: 'a_chercher', priority: 2, start_url: LC0 }));
db.linkgen_learning_items.push(item({ id: 'p2', kind: 'modele', site: 'LACENTRALE', brand: 'CUPRA', model: 'RAVAL', status: 'a_chercher', priority: 1, start_url: lacentraleAdapter.buildSearchUrl({ brand: 'CUPRA', model: '' }).url }));
await learningProbeTick({ scrape: lcScrape, fetchText: async () => null }, NOW.getTime());
const p1 = db.linkgen_learning_items.find((x) => x.id === 'p1')!;
const p1rule = db.linkgen_learned_rules.find((r) => r.item_id === 'p1');
ok(p1.status === 'validee' && JSON.stringify(p1rule?.rule) === JSON.stringify({ op: 'param', param: 'makesModelsCommercialNames', value: 'MERCEDES::CLASSE CLS' }),
  'La Centrale CLS-CLASS : ADA essaie « CLS-CLASS », « Classe CLS »… trouve seule la bonne adresse (8/8) et la valide — sans Claude', [p1.status, p1rule?.rule]);
const p2 = db.linkgen_learning_items.find((x) => x.id === 'p2')!;
ok(p2.status === 'a_chercher' && /ADA a essayé seule « RAVAL »/.test(String(p2.decision_note)), 'Raval : rien de conforme — la ligne reste pour Claude, avec ce qui a été essayé', p2.decision_note);
const cupra = () => scraped.filter((u) => u.includes('CUPRA')).length;
const before = cupra();
await learningProbeTick({ scrape: lcScrape, fetchText: async () => null }, NOW.getTime() + 60_000);
ok(cupra() === before, 'une ligne déjà essayée n\'est pas re-scrapée avant 24 h');

const cupraScrape = scrapeBy((u) => (u.includes('CUPRA%3A%3ARAVAL%20E') ? many(6, { brand: 'CUPRA', model: 'RAVAL E' }) : []));
p2.status = 'proposee'; p2.proposed_label = 'Raval e'; p2.proposed_url = null;
await learningProposalsTick({ scrape: scrapeBy(() => []), fetchText: async () => null });
ok(p2.status === 'a_chercher' && /avec le nom « Raval e »/.test(String(p2.decision_note)) && p2.proposed_label === null, 'nom envoyé mais rien de conforme : refus automatique expliqué, la ligne repart', p2.decision_note);
p2.status = 'proposee'; p2.proposed_label = 'Raval e';
await learningProposalsTick({ scrape: cupraScrape, fetchText: async () => null });
ok(p2.status === 'validee' && String(p2.proposed_url).includes('CUPRA%3A%3ARAVAL%20E'), 'le nom exact lu par Claude (« Raval e ») : ADA construit l\'adresse, 6/6 → validée automatiquement', [p2.status, p2.proposed_url]);

console.log('\n=== UN SEUL CONTRÔLE À LA FOIS (31/10, la course de 09:56) ===\n');
// L'essai seul passe la ligne « proposee » puis la contrôle lui-même ; le passage des propositions (60 s) tombait
// pendant ce contrôle et la reprenait : deux scrapes de trop, et un journal « à valider » après « validé ».
const GLC = 'MERCEDES%3A%3ACLASSE%20GLC';
db.linkgen_learning_items.push(item({ id: 'q1', kind: 'modele', site: 'LACENTRALE', brand: 'MERCEDES', model: 'GLC-CLASS', status: 'a_chercher', priority: 9, start_url: LC0 }));
let passResult: number | null = null;
const passScraped: string[] = [];
const raceScrape = async (url: string) => {
  scraped.push(url);
  if (passResult === null && db.linkgen_learning_items.find((x) => x.id === 'q1')!.status === 'proposee') {
    passResult = await learningProposalsTick({ scrape: async (u: string) => { passScraped.push(u); return { listings: [] }; }, fetchText: async () => null });
  }
  return { listings: url.includes(GLC) ? many(8, { brand: 'MERCEDES', model: 'CLASSE GLC' }) : [] };
};
await learningProbeTick({ scrape: raceScrape, fetchText: async () => null }, NOW.getTime() + 120_000);
const q1 = db.linkgen_learning_items.find((x) => x.id === 'q1')!;
ok(passResult === 0 && passScraped.length === 0, 'le passage des propositions tombe pendant le contrôle de l\'essai seul : il laisse la ligne (aucun scrape en double)', [passResult, passScraped]);
ok(q1.status === 'validee' && db.linkgen_learned_rules.filter((r) => r.item_id === 'q1').length === 1, 'contrôlée une seule fois : validée, une seule règle', q1.status);

// Claude envoie le nom pendant que l'essai seul scrape : c'est SA proposition qui compte, l'essai ne contrôle rien.
const GLE = 'MERCEDES%3A%3ACLASSE%20GLE';
db.linkgen_learning_items.push(item({ id: 'q2', kind: 'modele', site: 'LACENTRALE', brand: 'MERCEDES', model: 'GLE-CLASS', status: 'a_chercher', priority: 9, start_url: LC0 }));
const q2 = db.linkgen_learning_items.find((x) => x.id === 'q2')!;
const fromQ2 = scraped.length;
const claudeMeanwhile = async (url: string) => {
  scraped.push(url);
  if (q2.status === 'a_chercher') { q2.status = 'proposee'; q2.proposed_label = 'Classe GLE'; q2.proposed_url = null; }
  return { listings: url.includes(GLE) ? many(8, { brand: 'MERCEDES', model: 'CLASSE GLE' }) : [] };
};
await learningProbeTick({ scrape: claudeMeanwhile, fetchText: async () => null }, NOW.getTime() + 180_000);
ok(q2.status === 'proposee' && q2.proposed_label === 'Classe GLE' && q2.proposed_url == null && !db.linkgen_learned_rules.some((r) => r.item_id === 'q2')
  && scraped.slice(fromQ2).every((u) => !u.includes('yearMin')),
  'la ligne a été proposée pendant l\'essai seul : elle garde la proposition de Claude, l\'essai n\'écrit ni ne contrôle rien', [q2.status, q2.proposed_url, scraped.slice(fromQ2)]);
await learningProposalsTick({ scrape: scrapeBy((u) => (u.includes(GLE) ? many(8, { brand: 'MERCEDES', model: 'CLASSE GLE' }) : [])), fetchText: async () => null });
ok(q2.status === 'validee' && db.linkgen_learned_rules.filter((r) => r.item_id === 'q2').length === 1, 'puis le passage suivant contrôle la proposition de Claude : validée, une règle', q2.status);

// La ligne change pendant le contrôle (décision prise ailleurs) : jamais de règle active sans sa ligne validée.
const SB5 = SB0.replace('/auto/bmw/', '/auto/bmw/serie-5/');
db.linkgen_learning_items.push(item({ id: 'c1', kind: 'modele', site: 'SUBITO', brand: 'BMW', model: 'Serie 5', start_url: SB0, proposed_url: SB5 }));
const c1 = db.linkgen_learning_items.find((x) => x.id === 'c1')!;
let calls = 0;
const flip = async (url: string) => {
  scraped.push(url);
  if (++calls === 2) c1.status = 'ignoree';
  return { listings: many(6, { brand: 'BMW', model: 'Serie 5', title: 'BMW Serie 5 520d' }) };
};
const outcome = await checkProposal(c1 as never, { scrape: flip, fetchText: async () => null });
ok(outcome === 'deja_traitee' && c1.status === 'ignoree' && !c1.learned && !db.linkgen_learned_rules.some((r) => r.item_id === 'c1'),
  'la ligne change pendant le contrôle : la règle tout juste écrite est effacée, rien n\'est écrit sur la ligne', [outcome, c1.status, db.linkgen_learned_rules.filter((r) => r.item_id === 'c1').length]);

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);

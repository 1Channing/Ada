/**
 * Dana et les grands comptes (17/10, Channing : « des fournisseurs long
 * terme… les retours leasing, loueurs, les acheteurs / vendeurs des gros
 * groupes » ; « elles préparent, vous envoyez » ; « publiées seulement +
 * LinkedIn »). La partie pure (réglages, lots, score d'un fournisseur, grand
 * compte, profil LinkedIn, consignes et contrôles des mails sans prix), puis
 * le parcours du worker avec un faux serveur Claude, de fausses pages et une
 * base simulée : Dana qualifie un garage français à lot, puis un site de
 * groupe (grand compte : la personne qui décide et son profil LinkedIn vu
 * dans un résultat) ; un petit compte reçoit le mail d'achat de Dana, à
 * valider ; le grand compte est préparé pour Channing (mail, note LinkedIn,
 * fiche d'appel) ; un autre site du même groupe n'a pas de mail à part.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as dns } from 'node:dns';
import {
  normalizeDanaTargets, lotFactOf, lotsFromListings, lotLine, danaFitScore, isKeyAccount, groupKey, looksLikeGroup, DEFAULT_DANA_TARGETS, DANA_SCORE_HELP,
} from '../src/lib/agents/sourcing';
import { qualifySchema, qualifyPrompt, acceptedLinkedin, QUALIFY_SCHEMA, REACH_SCORE_HELP, type QualifyOutput } from '../src/lib/agents/qualification';
import {
  danaFirstMailPrompt, checkDanaMail, keyAccountPrompt, keyAccountSystem, checkKeyAccount, linkedinSearchUrl, KEY_ACCOUNT_SCHEMA,
  type FirstMailOutput, type KeyAccountOutput,
} from '../src/lib/agents/firstMail';
import { HAIKU, OPUS } from '../src/lib/agents/aiCost';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

console.log('\n=== DANA : LOTS, FOURNISSEURS ET GRANDS COMPTES ===\n');

// --- Réglages et lots ------------------------------------------------------------------------
ok(JSON.stringify(normalizeDanaTargets(null)) === JSON.stringify(DEFAULT_DANA_TARGETS), 'réglages : par défaut, lots de 3 et NL / DK / BE / DE');
const t1 = normalizeDanaTargets({ minLot: 1, markets: ['nl', 'NL', 'xx1', 'dk'] });
ok(t1.minLot === 3 && t1.markets.join() === 'NL,DK', 'réglages : un « lot » de 1 refusé, pays en majuscules sans doublon ni code invalide', t1);
ok(normalizeDanaTargets({ minLot: 50 }).minLot === 20, 'réglages : lot de 20 au plus');

const lot = lotFactOf({
  brand: 'TOYOTA', model: 'Yaris Cross', year: 2023, count: 5, price_min: 22_900, price_max: 24_500, km_min: 15_000, km_max: 30_000, first_seen_at: daysAgo(40),
  markets: [{ market: 'DK', gap: 1300 }, { market: 'NL', gap: 4200 }],
});
ok(lot.bestGap === 4200 && lot.bestMarket === 'NL', 'lot : le pays de vente le mieux payé', lot);
const fromStock = lotsFromListings([
  ...Array.from({ length: 3 }, (_, i) => ({ brand: 'TOYOTA', model: 'C-HR', year: 2021, mileage: 40_000 + i * 1000, price_eur: 21_900 + i * 100 })),
  { brand: 'TOYOTA', model: 'CHR', year: 2021, mileage: 50_000, price_eur: 20_900 },
  { brand: 'TOYOTA', model: 'C-HR', year: 2022, mileage: 10_000, price_eur: 25_900 },
], 3);
ok(fromStock.length === 1 && fromStock[0].count === 4 && fromStock[0].priceMin === 20_900 && fromStock[0].kmMax === 50_000, 'lots sans la base : C-HR = CHR, même année, à partir de 3', fromStock);

const forMail = lotLine(lot, false);
const forUs = lotLine(lot, true);
ok(/^5 × Toyota Yaris Cross 2023, de 15\s000 à 30\s000 km, en ligne depuis au moins 40 jours$/.test(forMail) && !/€|écart/.test(forMail), 'lot pour un mail : modèle, nombre, km, ancienneté — jamais de prix ni d\'écart', forMail);
ok(/affichés de 22\s900 à 24\s500 € TTC/.test(forUs) && /écart brut \+4\s200 € face aux annonces NL/.test(forUs), 'lot pour nous : prix affichés et écart brut', forUs);

const fit = danaFitScore({ lots: [lot, { ...lot, model: 'Corolla', count: 3, bestGap: null, bestMarket: null }], listings: 25, hasEmail: true, hasNamedContact: true });
ok(fit.score === 22 + 10 + 25 + 10 + 5 + 8 + 4 && fit.parts.length === 7 && fit.parts.some((p) => /^écart brut \+4\s200 € \(NL\)$/.test(p.label)),
  'score fournisseur : lot de 5, deux lots, écart, ancienneté, stock suivi, e-mail, interlocuteur', fit);
ok(danaFitScore({ lots: [], listings: 3, hasEmail: false, hasNamedContact: false }).score === 0, 'score fournisseur : sans lot ni contact = 0');

// Le « i » des Réglages dit vrai : chaque barème affiché est celui du calcul.
{
  const pts = (f: ReturnType<typeof danaFitScore>, re: RegExp) => f.parts.find((p) => re.test(p.label))?.points ?? 0;
  const bare = { listings: 0, hasEmail: false, hasNamedContact: false };
  const one = (count: number, extra: Partial<typeof lot> = {}) => ({ ...lot, count, bestGap: null, bestMarket: null, firstSeenAt: daysAgo(1), ...extra });
  const list = (xs: number[]) => xs.map((p) => `+${p}`).join(', ');
  const shown = DANA_SCORE_HELP.map(([, p]) => p);
  const computed = [
    list([2, 3, 4, 6].map((n) => pts(danaFitScore({ ...bare, lots: [one(n)] }), /^lot de/))),
    list([pts(danaFitScore({ ...bare, lots: [one(3), one(3, { model: 'Corolla' })] }), / lots$/)]),
    list([500, 1000, 3000].map((g) => pts(danaFitScore({ ...bare, lots: [one(3, { bestGap: g, bestMarket: 'NL' })] }), /^écart brut/))),
    list([pts(danaFitScore({ ...bare, lots: [one(3, { firstSeenAt: daysAgo(31) })] }), /^en stock depuis/)]),
    list([20, 50].map((n) => pts(danaFitScore({ ...bare, listings: n, lots: [] }), /^stock suivi/))),
  ];
  const reach = danaFitScore({ lots: [], listings: 0, hasEmail: true, hasNamedContact: true }).parts.map((p) => `+${p.points}`);
  ok(shown.join(' | ') === computed.join(' | ') && REACH_SCORE_HELP.map(([, p]) => p).join() === reach.join(),
    'la note de Dana expliquée (le « i » des Réglages) : les barèmes affichés sont ceux du calcul', { shown, computed, reach });
}

ok(isKeyAccount(true, null, null) && isKeyAccount(false, 'loueur_ou_leasing', 1) && isKeyAccount(null, 'flotte_entreprise', null) && isKeyAccount(false, 'concession_marque', 3) && !isKeyAccount(false, 'independant_multimarque', 1),
  'grand compte : l\'IA le dit, ou groupe / loueur / leasing / flotte, ou 3 sites et plus');
ok(groupKey('Groupe Autosphère') === 'autosphere' && groupKey('AUTOSPHERE SAS') === 'autosphere' && groupKey('Stern Groep') === 'stern' && groupKey(null) === '', 'groupe : « Groupe Autosphère » = « AUTOSPHERE SAS »');
ok(looksLikeGroup('TOYOTA NANTERRE - AUTOSPHERE') && looksLikeGroup('Groupe Bernier') && looksLikeGroup('Stern Groep') && !looksLikeGroup('Technic Auto') && !looksLikeGroup('Garage du Centre - Metz'),
  'groupe : un nom qui l\'annonce (« … - AUTOSPHERE », « Groupe Bernier »)');

// --- Qualification : schéma et consigne de Dana --------------------------------------------------
const sDana = qualifySchema('dana') as unknown as { required: string[]; properties: Record<string, { description?: string; properties?: Record<string, unknown> }> };
ok(sDana.required.includes('grand_compte') && 'linkedin' in (sDana.properties.meilleur_contact.properties ?? {}) && JSON.stringify(QUALIFY_SCHEMA).includes('grand_compte'),
  'schéma : grand compte et profil LinkedIn demandés, pour Ada comme pour Dana');
const prDana = qualifyPrompt({
  role: 'dana', lots: [forUs], decisionSearch: true,
  dealer: { name: 'TOYOTA NANTERRE - AUTOSPHERE', country: 'FR', city: 'Nanterre', zip: '92000', street: null, phone: null, contactName: null, sources: ['Leboncoin'] },
  fit, stock: { listings: 25, brands: ['TOYOTA'], vans: 0, medianPrice: 23_500, opportunities: [] }, page: null, emailsFound: [], pages: [], webSearch: false,
});
ok(prDana.includes('Lots de véhicules identiques vus par Dana : 5 × Toyota Yaris Cross 2023') && /Grand compte probable : cherche sur le web .*ventes de VO ou des cessions de stock.*LinkedIn/.test(prDana),
  'consigne de Dana : ses lots, et la recherche de la personne qui décide des cessions pour un groupe', prDana.split('\n').slice(-1));

// --- Profil LinkedIn : seulement s'il a été vu, au nom de la personne ----------------------------
const seen = ['https://fr.linkedin.com/in/sophie-martin-vo-8b1a2c?trk=public', 'https://www.linkedin.com/company/autosphere'];
ok(acceptedLinkedin('https://fr.linkedin.com/in/sophie-martin-vo-8b1a2c', 'Sophie Martin', seen, '') === 'https://www.linkedin.com/in/sophie-martin-vo-8b1a2c', 'LinkedIn : vu dans un résultat, au nom de la personne → gardé, adresse remise au propre');
ok(acceptedLinkedin('https://www.linkedin.com/in/paul-durand', 'Paul Durand', seen, '') === null, 'LinkedIn : jamais vu (supposé) → écarté');
ok(acceptedLinkedin('https://fr.linkedin.com/in/sophie-martin-vo-8b1a2c', 'Karim Benali', seen, '') === null, 'LinkedIn : profil vu mais d\'une autre personne → écarté');
ok(acceptedLinkedin('https://www.linkedin.com/company/autosphere', 'Autosphere', seen, '') === null, 'LinkedIn : une page entreprise n\'est pas un profil');

// --- Mails : Dana ne parle jamais de prix ; le grand compte est préparé pour Channing -----------
const mailMaterial = {
  company: 'Technic Auto', country: 'FR', city: 'Forbach', language: 'fr', contact: { name: 'Karim Benali', role: 'responsable VO' }, kind: 'independant_multimarque', group: null,
  summary: 'Négociant à Forbach.', stock: { listings: 7, byBrand: [{ brand: 'Toyota', n: 6 }] }, lots: [forMail], instructions: '',
};
const pMail = danaFirstMailPrompt(mailMaterial);
ok(pMail.startsWith('Écris le premier mail en français.') && pMail.includes('Lot : 5 × Toyota Yaris Cross 2023') && !pMail.includes('€') && pMail.includes('ne promets aucune condition'),
  'consigne du mail de Dana : le lot sans aucun prix, aucune condition promise sans vos consignes');
const goodDana: FirstMailOutput = {
  objet: 'Vos 5 Yaris Cross 2023',
  corps: 'Bonjour Monsieur Benali,\n\nJ\'ai vu que Technic Auto a cinq Toyota Yaris Cross de 2023 en ligne depuis plusieurs semaines. Je suis Dana, aux achats chez MC Export, exportateur de véhicules récents près d\'Angers. Nous pouvons reprendre ce lot en une fois, ou une partie, et nous cherchons des professionnels avec qui travailler régulièrement.\n\nSeriez-vous ouvert à une offre pour les cinq ?\n\nSi vous n\'êtes pas vendeur, dites-le-moi simplement et je ne vous relancerai pas.',
  traduction_fr: null, faits: [{ fait: 'cinq Toyota Yaris Cross de 2023', source: 'lot' }],
};
ok(checkDanaMail(goodDana, pMail).warnings.length === 0, 'contrôle Dana : un bon mail passe sans remarque', checkDanaMail(goodDana, pMail));
ok(checkDanaMail({ ...goodDana, corps: `${goodDana.corps}\nNous pourrions vous proposer un prix ferme rapidement.` }, pMail).warnings.some((w) => w.includes('prix')), 'contrôle Dana : un mot de prix est signalé au validateur');
const pKey = keyAccountPrompt(pMail, [{ nom: 'Sophie Martin', fonction: 'directrice VO', linkedin: 'https://www.linkedin.com/in/sophie-martin-vo-8b1a2c' }]);
ok(pKey.startsWith('Prépare la prise de contact de Channing en français : le mail, la note d\'invitation LinkedIn, et la fiche d\'appel en français.') && pKey.includes('- Sophie Martin, directrice VO (profil LinkedIn trouvé)'),
  'consigne grand compte : pour Channing, avec les interlocuteurs connus');
ok(/GRAND COMPTE/.test(keyAccountSystem('dana')) && /Aucun prix/.test(keyAccountSystem('dana')) && /première personne/.test(keyAccountSystem('ada')) && !/Aucun prix, aucune estimation/.test(keyAccountSystem('ada')),
  'consigne grand compte : au nom de Channing ; aucun prix côté Dana');
ok((KEY_ACCOUNT_SCHEMA.required as readonly string[]).join() === 'objet,corps,linkedin,fiche_appel,traduction_fr,faits', 'schéma grand compte : mail, note LinkedIn, fiche d\'appel, traduction, faits');
const keyOut: KeyAccountOutput = {
  objet: 'Vos séries de véhicules récents',
  corps: 'Bonjour Madame Martin,\n\nJe vois chez Toyota Nanterre, du groupe Autosphere, quatre Peugeot 208 de 2022 en ligne. Je suis Channing, de MC Export : nous achetons des véhicules récents en lots, partout en Europe, pour l\'export, et nous cherchons des groupes avec qui travailler dans la durée, sur leurs retours de stock et leurs séries.\n\nQui suit les cessions de véhicules aux marchands dans votre groupe ?\n\nSi ce n\'est pas un sujet pour vous, dites-le-moi et je ne reviendrai pas vers vous.',
  linkedin: 'Bonjour Sophie, je suis Channing, de MC Export. Nous achetons des véhicules récents en lots dans toute l\'Europe ; vos sites ont souvent des séries identiques. Ravi d\'échanger avec vous.',
  fiche_appel: { interlocuteur: 'Sophie Martin, directrice VO', pourquoi: 'Elle décide des cessions de stock VO du groupe.', accroche: 'Je vous appelle au sujet de vos séries de véhicules récents.', points: ['Quatre Peugeot 208 de 2022 à Nanterre', 'Achat en lots, partout en Europe'], questions: ['Qui gère les cessions aux marchands ?', 'Quels volumes par mois ?', 'Quels modèles reviennent souvent ?'] },
  traduction_fr: null, faits: [{ fait: 'quatre Peugeot 208 de 2022', source: 'lot' }],
};
const pKeyAuto = keyAccountPrompt(danaFirstMailPrompt({ ...mailMaterial, company: 'TOYOTA NANTERRE - AUTOSPHERE', city: 'Nanterre', contact: { name: 'Sophie Martin', role: 'directrice VO' }, group: 'Autosphere', lots: ['4 × Peugeot 208 2022, de 20 000 à 26 000 km'] }),
  [{ nom: 'Sophie Martin', fonction: 'directrice VO', linkedin: null }]);
ok(checkKeyAccount(keyOut, pKeyAuto, 'dana').warnings.length === 0, 'contrôle grand compte : mail et note en ordre', checkKeyAccount(keyOut, pKeyAuto, 'dana'));
const longNote = checkKeyAccount({ ...keyOut, linkedin: `${keyOut.linkedin} ${'x'.repeat(200)} www.mc-export.com` }, pKeyAuto, 'dana');
ok(longNote.warnings.some((w) => w.includes('trop longue')) && longNote.warnings.some((w) => w.includes('lien')), 'contrôle grand compte : note LinkedIn trop longue, lien signalés', longNote.warnings);
ok(linkedinSearchUrl('Autosphere', 'dana', 'fr') === 'https://www.linkedin.com/search/results/people/?keywords=remarketing%20VO%20Autosphere'
  && linkedinSearchUrl('Stern', 'ada', 'nl', 'Jan de Vries').endsWith('keywords=Jan%20de%20Vries%20Stern'), 'LinkedIn sans profil vu : la recherche de la bonne fonction, ou de la personne nommée');

// --- Le parcours du worker -------------------------------------------------------------------------
type Row = Record<string, unknown>;
const now = new Date().toISOString();
const listing = (dealer: string, i: number, brand: string, model: string, year: number, km: number, price: number) =>
  ({ dealer_id: dealer, listing_url: `${dealer}-${i}`, brand, model, year, mileage: km, price_eur: price, title: '', vehicle_type: null, last_seen_at: now });
const db: FakeDb = {
  market_dealers: [
    // Le garage à lots de Forbach (Leboncoin), et un site de groupe (« … - AUTOSPHERE »).
    { id: 'f1', site: 'leboncoin', parent_id: null, name: 'TECHNIC AUTO', country: 'FR', city: 'Forbach', zip: '57600', street: null, phone: '+33387000000', contact_name: null, site_url: null, imprint_url: null, website: null, lat: 49.18, lng: 6.9, legal_id: null },
    { id: 'g1', site: 'leboncoin', parent_id: null, name: 'TOYOTA NANTERRE - AUTOSPHERE', country: 'FR', city: 'Nanterre', zip: '92000', street: null, phone: '+33141000000', contact_name: null, site_url: null, imprint_url: null, website: null, lat: 48.89, lng: 2.2, legal_id: null },
  ],
  market_dealer_listings: [
    ...Array.from({ length: 5 }, (_, i) => listing('f1', i, 'TOYOTA', 'Yaris Cross', 2023, 15_000 + i * 3750, 22_900 + i * 400)),
    listing('f1', 5, 'TOYOTA', 'C-HR', 2021, 50_000, 21_900), listing('f1', 6, 'SUZUKI', 'Vitara', 2022, 30_000, 19_900),
    ...Array.from({ length: 4 }, (_, i) => listing('g1', i, 'PEUGEOT', '208', 2022, 20_000 + i * 2000, 15_900 + i * 300)),
    listing('g1', 4, 'TOYOTA', 'Yaris', 2023, 9_000, 18_900), listing('g1', 5, 'TOYOTA', 'Corolla', 2022, 30_000, 23_900),
  ],
  agent_prospects: [
    // Un autre site du même groupe, qualifié (petit compte) : pas de mail à part, c'est le groupe qu'on approche.
    { id: 'g2p', agent: 'dana', dealer_id: 'g2', name: 'PEUGEOT VERSAILLES - AUTOSPHERE', country: 'FR', city: 'Versailles', group_name: 'Groupe Autosphère', kind: 'groupe', language: 'fr', summary: 'Site du groupe Autosphere.',
      stage: 'qualifie', score: 41, key_account: false, network_contact_id: null, brands_official: [], people: [], lots: [],
      best_contact: { nom: null, fonction: 'VO', email: 'vo.versailles@autosphere.fr' }, emails: [{ email: 'vo.versailles@autosphere.fr', mx: true }] },
  ],
  // Une qualification d'Ada portait sur f1 : elle ne retient pas Dana. t9 vient d'être confié à Dana : il attend.
  agent_tasks: [
    { id: 'ta', agent: 'ada', kind: 'qualification', params: { dealer_ids: ['f1'] }, created_at: now },
    { id: 'td', agent: 'dana', kind: 'qualification', params: { dealer_ids: ['t9'] }, created_at: now },
  ],
  network_contacts: [{ id: 'n1', name: 'Garage Connu', phone: '+33 3 87 11 22 33', role: 'vendeur', source: 'manuel', country: 'FR' }],
  transactions_admin: [], contacts: [], agent_runs: [], agent_journal: [], agent_threads: [], agent_messages: [], email_suppressions: [], intra_showcase: [],
};
// Ce que rend agents_dealer_lots() (forme du SQL du 17/10), un garage ou tous.
const lotRows = [
  { dealer: { id: 'f1', name: 'TECHNIC AUTO', country: 'FR', phone: '+33387000000' }, brand: 'TOYOTA', model: 'Yaris Cross', year: 2023, count: 5, price_min: 22_900, price_max: 24_500, km_min: 15_000, km_max: 30_000,
    first_seen_at: daysAgo(40), markets: [{ market: 'NL', n: 12, median: 27_900, gap: 4200 }, { market: 'DK', n: 4, median: 25_000, gap: 1300 }], prospect: null },
  { dealer: { id: 'g1', name: 'TOYOTA NANTERRE - AUTOSPHERE', country: 'FR', phone: '+33141000000' }, brand: 'PEUGEOT', model: '208', year: 2022, count: 4, price_min: 15_900, price_max: 16_800, km_min: 20_000, km_max: 26_000,
    first_seen_at: daysAgo(10), markets: [], prospect: null },
  { dealer: { id: 'k1', name: 'GARAGE CONNU', country: 'FR', phone: '0387112233' }, brand: 'TOYOTA', model: 'Aygo X', year: 2023, count: 9, price_min: 13_900, price_max: 14_900, km_min: 5_000, km_max: 9_000, first_seen_at: daysAgo(5), markets: [], prospect: null },
  { dealer: { id: 'q1', name: 'DÉJÀ FICHÉ', country: 'BE', phone: null }, brand: 'KIA', model: 'Niro', year: 2022, count: 8, price_min: 21_000, price_max: 22_000, km_min: 20_000, km_max: 40_000, first_seen_at: daysAgo(5), markets: [], prospect: { id: 'x' } },
  { dealer: { id: 't9', name: 'TOUT JUSTE CONFIÉ', country: 'DE', phone: null }, brand: 'VW', model: 'Golf', year: 2022, count: 7, price_min: 19_000, price_max: 21_000, km_min: 20_000, km_max: 40_000, first_seen_at: daysAgo(5), markets: [], prospect: null },
];
const rpcArgs: Array<Record<string, unknown>> = [];
setSharedSupabase(fakeSupabase(db, {
  agents_dealer_lots: (args) => { rpcArgs.push(args); return { data: args.p_dealer ? lotRows.filter((r) => r.dealer.id === args.p_dealer) : lotRows, error: null }; },
}) as never);
(dns as unknown as { resolveMx: (d: string) => Promise<unknown[]> }).resolveMx = async (d: string) => (['technic-auto.fr', 'autosphere.fr'].includes(d) ? [{ exchange: `mx.${d}`, priority: 10 }] : []);

const aiOut = (o: Partial<QualifyOutput>): QualifyOutput => ({
  site_web: null, raison_sociale: null, groupe: null, nb_sites: null, type: 'independant_multimarque', marques_officielles: [], emails: [], contacts: [],
  meilleur_contact: { nom: null, fonction: null, email: null, linkedin: null, pourquoi: '' }, langue: 'fr', grand_compte: false, ajustement: 0, exclure: false, motif_exclusion: null, resume: '', ...o,
});
const SOPHIE = 'https://fr.linkedin.com/in/sophie-martin-vo-8b1a2c';
let base = '';
const calls: Array<{ model: string; system: string; user: string; tools?: unknown[] }> = [];
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const send = (code: number, body: string, type = 'text/html') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  if (req.url === '/technic') return send(200, `<html><body>${'Technic Auto, négoce de véhicules récents à Forbach. '.repeat(30)}<a href="/technic/contact">Contact</a></body></html>`);
  if (req.url === '/technic/contact') return send(200, `<html><body>${'Contactez notre service VO. '.repeat(40)}<a href="mailto:vo@technic-auto.fr">vo@technic-auto.fr</a></body></html>`);
  if (req.url === '/autosphere') return send(200, `<html><body>${'Toyota Nanterre, groupe Autosphere. '.repeat(40)} Service VO : vo.nanterre@autosphere.fr</body></html>`);
  if (req.url?.startsWith('/v1/messages') && req.method === 'POST') {
    let raw = '';
    for await (const ch of req) raw += ch;
    const body = JSON.parse(raw) as { model: string; system: Array<{ text: string }>; messages: Array<{ content: unknown }>; tools?: unknown[] };
    const user = String(body.messages[0].content);
    const system = body.system?.[0]?.text ?? '';
    calls.push({ model: body.model, system, user, tools: body.tools });
    const usage = { input_tokens: 6000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: body.tools ? 1 : 0, web_fetch_requests: 0 } };
    const reply = (content: unknown[]) => send(200, JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content, stop_reason: 'end_turn', stop_sequence: null, usage }), 'application/json');
    if (body.model === HAIKU) {
      if (user.includes('TECHNIC AUTO')) {
        return reply([{ type: 'text', text: JSON.stringify(aiOut({
          site_web: `${base}/technic`, type: 'negociant_vo', ajustement: 5,
          emails: [{ email: 'vo@technic-auto.fr', nature: 'vo', source: `${base}/technic/contact` }],
          contacts: [{ nom: 'Karim Benali', fonction: 'responsable VO', email: null, linkedin: null, source: `${base}/technic/contact` }],
          meilleur_contact: { nom: 'Karim Benali', fonction: 'responsable VO', email: 'vo@technic-auto.fr', linkedin: null, pourquoi: 'Il vend le stock VO.' },
          resume: 'Négociant de véhicules récents à Forbach, souvent plusieurs modèles identiques.',
        })) }]);
      }
      // Le site du groupe : une recherche web, dont un résultat montre le profil de la directrice VO.
      return reply([
        { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'Autosphere directeur VO' } },
        { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: `${SOPHIE}?trk=public_profile`, title: 'Sophie Martin – Directrice VO – Autosphere | LinkedIn', encrypted_content: 'x', page_age: null }] },
        { type: 'text', text: JSON.stringify(aiOut({
          site_web: `${base}/autosphere`, type: 'groupe', groupe: 'Autosphere', nb_sites: 40, grand_compte: true, ajustement: 10, marques_officielles: ['Toyota'],
          emails: [{ email: 'vo.nanterre@autosphere.fr', nature: 'vo', source: `${base}/autosphere` }],
          contacts: [
            { nom: 'Sophie Martin', fonction: 'directrice VO du groupe', email: null, linkedin: SOPHIE, source: 'résultat de recherche' },
            { nom: 'Paul Durand', fonction: 'remarketing', email: null, linkedin: 'https://www.linkedin.com/in/paul-durand-autosphere', source: 'supposé' },
          ],
          meilleur_contact: { nom: 'Sophie Martin', fonction: 'directrice VO du groupe', email: null, linkedin: SOPHIE, pourquoi: 'Elle décide des cessions de stock du groupe.' },
          resume: 'Site Toyota du groupe Autosphere (une quarantaine de sites).',
        })) },
      ]);
    }
    // Opus 5.5 : le grand compte (préparé pour Channing), sinon le mail d'achat de Dana.
    return reply([{ type: 'text', text: JSON.stringify(/GRAND COMPTE/.test(system) ? keyOut : goodDana) }]);
  }
  send(404, 'introuvable');
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
(db.market_dealers[0] as Row).website = `${base}/technic`;
(db.market_dealers[1] as Row).website = `${base}/autosphere`;
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = base;

const { qualifyDealer, nextLotCandidates } = await import('../worker/agents/qualify');
const { draftFirstMail, nextDraftCandidates } = await import('../worker/agents/firstMail');
const dana = {
  agent: 'dana', mailbox: 'dana@mc-export.com', signature: 'Dana\nMC Export — achats', daily_budget_usd: 3, map_auto_add: true, map_min_score: 40,
  targets: { minLot: 3, markets: ['NL', 'DK', 'BE', 'DE'] }, instructions: '', daily_first_contact_cap: 10, auto_qualify_per_day: 20, auto_draft_per_day: 5,
} as never;
const ctx = { agent: dana, taskId: 't1', role: 'dana' as const, dana: { minLot: 3, markets: ['NL', 'DK', 'BE', 'DE'] }, targets: { countries: [], brands: [], vanBrands: [], multibrand: true }, targetCountries: [], offers: [] };

const next = await nextLotCandidates(ctx as never, 10);
ok(JSON.stringify(next) === '["f1","g1"]', 'candidats de Dana : le plus gros lot et le meilleur écart d\'abord ; ni un contact connu de l\'équipe, ni un garage déjà fiché, ni un garage tout juste confié (la tâche d\'Ada ne compte pas)', next);
ok(rpcArgs[0]?.p_min === 3 && JSON.stringify(rpcArgs[0]?.p_markets) === '["NL","DK","BE","DE"]', 'candidats de Dana : taille de lot et pays de vente des réglages', rpcArgs[0]);

// 1. Le garage à lot de Forbach : un fournisseur possible (la France n'est pas écartée pour Dana).
const o1 = await qualifyDealer('f1', ctx as never);
const p1 = db.agent_prospects.find((p) => p.dealer_id === 'f1') as (Row & { lots: unknown[]; best_contact: { email: string | null }; fit_parts: Array<{ label: string }> }) | undefined;
const c1 = calls[0];
ok(o1.status === 'qualifie' && p1?.agent === 'dana' && p1.stage === 'qualifie' && p1.key_account === false && p1.lots.length === 1, 'Dana qualifie un garage français à lot (fiche de Dana, petit compte, son lot gardé)', { o1, p1 });
ok(c1?.model === HAIKU && c1.system.startsWith('Tu es Dana') && c1.user.includes('Lots de véhicules identiques vus par Dana : 5 × Toyota Yaris Cross 2023') && /écart brut \+4\s200 €/.test(c1.user) && !c1.tools,
  'appel : consigne de Dana, son lot avec l\'écart (pour elle), sans recherche web (site connu, pas un groupe)', c1 && { system: c1.system.slice(0, 40), tools: c1.tools });
ok(o1.score === 22 + 25 + 10 + 8 + 4 + 5 && p1?.best_contact.email === 'vo@technic-auto.fr', 'score fournisseur : lot de 5, écart NL, 40 jours en ligne, e-mail, interlocuteur, avis de Dana (+5)', { score: o1.score, parts: p1?.fit_parts });
const n1 = db.network_contacts.find((n) => n.name === 'TECHNIC AUTO') as Row | undefined;
ok(n1?.role === 'vendeur' && n1.source === 'dana' && n1.kind === 'trader' && /Lot vu : 5 × Toyota Yaris Cross 2023/.test(String(n1.comment)) && !String(n1.comment).includes('€'),
  'carte : vendeur, badge Dana, négociant, le lot cité sans prix', n1);

// 2. Le site d'un groupe : grand compte ; la directrice VO et son profil LinkedIn, vu dans un résultat.
const o2 = await qualifyDealer('g1', ctx as never);
const p2 = db.agent_prospects.find((p) => p.dealer_id === 'g1') as (Row & { best_contact: { nom: string; email: string | null; linkedin: string | null }; people: Array<{ nom: string; linkedin: string | null }> }) | undefined;
const c2 = calls[1];
ok(o2.status === 'qualifie' && p2?.key_account === true && p2.account_kind === 'groupe' && p2.group_name === 'Autosphere', 'grand compte : un site de groupe (« … - AUTOSPHERE »)', p2 && { key: p2.key_account, kind: p2.account_kind });
ok(!!c2?.tools?.length && /Grand compte probable/.test(c2.user), 'grand compte : recherche web de la personne qui décide pour le groupe', c2 && c2.user.split('\n').slice(-1));
ok(p2?.best_contact.linkedin === 'https://www.linkedin.com/in/sophie-martin-vo-8b1a2c' && p2.best_contact.email === 'vo.nanterre@autosphere.fr', 'grand compte : profil LinkedIn vu gardé (adresse propre), e-mail VO publié et vérifié', p2?.best_contact);
ok(p2?.people.find((x) => x.nom === 'Paul Durand')?.linkedin === null, 'grand compte : un profil LinkedIn supposé (jamais vu) est écarté', p2?.people);

// 3. Les premiers contacts d'office : le grand compte et le petit compte ; l'autre site du groupe, non.
const cand = await nextDraftCandidates(dana, 5);
ok(JSON.stringify(cand) === JSON.stringify([p1?.id, p2?.id]), 'premiers contacts : petit compte (e-mail vérifié) et grand compte ; l\'autre site du groupe attend le groupe', { cand, p1: p1?.id, p2: p2?.id });
const candSmall = await nextDraftCandidates(dana, 5, { small: true, big: false });
ok(JSON.stringify(candSmall) === JSON.stringify([p1?.id]), 'premiers contacts : « Pour vous » plein → plus de grand compte, et toujours pas de mail à part pour un site du groupe', candSmall);

// 4. Le petit compte : le mail d'achat de Dana, sans prix, à valider, depuis dana@.
const d1 = await draftFirstMail(String(p1?.id), dana, 't2');
const c3 = calls[2];
const m1 = db.agent_messages.find((m) => (m.to_emails as string[]).includes('vo@technic-auto.fr')) as (Row & { body_text: string; ai_notes: { alertes: string[] } }) | undefined;
ok(d1.status === 'redige' && m1?.status === 'a_valider' && m1.mailbox === 'dana@mc-export.com' && m1.author === 'dana' && m1.channel === 'mail', 'petit compte : mail de Dana, à valider, depuis dana@', { d1, m1 });
ok(c3?.model === OPUS && c3.system.startsWith('Tu es Dana, de l\'équipe achats') && c3.user.includes('Lot : 5 × Toyota Yaris Cross 2023') && !c3.user.includes('€'), 'appel : consigne d\'achat de Dana, le lot relu à l\'instant, aucun prix dans le matériel', c3 && c3.user);
ok(m1?.body_text.endsWith('\n\nDana\nMC Export — achats') === true && m1?.ai_notes.alertes.length === 0, 'petit compte : signature de Dana, rien à signaler', m1?.ai_notes);

// 5. Le grand compte : préparé pour Channing — le mail (e-mail publié), la note LinkedIn, la fiche d'appel.
const d2 = await draftFirstMail(String(p2?.id), dana, 't2');
const c4 = calls[3];
const th2 = db.agent_threads.find((t) => t.prospect_id === p2?.id) as Row | undefined;
const ms2 = db.agent_messages.filter((m) => m.thread_id === th2?.id) as Array<Row & { body_text: string; to_emails: string[]; ai_notes: { grand_compte?: boolean; fiche_appel?: { questions: string[] } | null; linkedin_url?: string | null } }>;
const mail2 = ms2.find((m) => m.channel === 'mail');
const li2 = ms2.find((m) => m.channel === 'linkedin');
ok(d2.status === 'redige' && /GRAND COMPTE/.test(c4?.system ?? '') && (c4?.user ?? '').startsWith('Prépare la prise de contact de Channing') && (c4?.user ?? '').includes('Sophie Martin, directrice VO du groupe (profil LinkedIn trouvé)'),
  'grand compte : consigne pour Channing, avec la directrice VO et son profil', c4 && c4.user.split('\n')[0]);
ok(mail2?.status === 'pour_channing' && mail2.to_emails.join() === 'vo.nanterre@autosphere.fr' && mail2.body_text === keyOut.corps && mail2.ai_notes.grand_compte === true && (mail2.ai_notes.fiche_appel?.questions.length ?? 0) === 3,
  'grand compte : le mail « pour vous », sans signature d\'agente, avec la fiche d\'appel', mail2);
ok(li2?.status === 'pour_channing' && li2.body_text === keyOut.linkedin && li2.to_emails.length === 0 && li2.ai_notes.linkedin_url === 'https://www.linkedin.com/in/sophie-martin-vo-8b1a2c',
  'grand compte : la note d\'invitation LinkedIn « pour vous », avec le profil de Sophie Martin', li2);
ok(th2?.counterpart_email === 'vo.nanterre@autosphere.fr' && (db.agent_prospects.find((p) => p.id === p2?.id) as Row).stage === 'a_contacter'
  && db.agent_journal.some((j) => j.kind === 'grand_compte' && /préparé pour vous/.test(String(j.summary))), 'grand compte : fil rattaché, prospect « à contacter », journal');

// 6. L'autre site du même groupe : pas de mail à part.
const d3 = await draftFirstMail('g2p', dana, 't2');
ok(d3.status === 'ignore' && /groupe Groupe Autosphère déjà approché/.test(d3.detail) && calls.length === 4, 'garde-fou : un autre site du même groupe n\'a pas de mail à part (aucun appel)', d3);
// Une fiche d'Ada n'est jamais rédigée par Dana.
db.agent_prospects.push({ id: 'ada1', agent: 'ada', dealer_id: 'f1', name: 'TECHNIC AUTO', country: 'NL', stage: 'qualifie', best_contact: { email: 'vo@technic-auto.fr' }, emails: [{ email: 'vo@technic-auto.fr', mx: true }] });
const d4 = await draftFirstMail('ada1', dana, 't2');
ok(d4.status === 'ignore' && /fiche d'Ada/.test(d4.detail) && calls.length === 4, 'garde-fou : la fiche d\'Ada n\'est pas rédigée par Dana', d4);

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

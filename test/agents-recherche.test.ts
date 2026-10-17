/**
 * La recherche de comptes (17/10, étape 2 ; Channing : « les retours leasing,
 * loueurs, les acheteurs / vendeurs des gros groupes de concessions, les
 * fleet managers, les revendeurs B2B… il y a tous les pays à travailler »).
 * La partie pure (types de comptes, consigne, contrôle des entreprises
 * rendues, rotation, score d'un compte, consignes de qualification et de
 * mail), puis le parcours du worker avec un faux serveur Claude, un faux
 * internet et une base simulée : Dana cherche des sociétés de leasing en
 * Belgique — les entreprises inventées, déjà connues ou invérifiables sont
 * écartées —, qualifie Arval (la personne qui décide et son profil LinkedIn
 * vu dans un résultat), le grand compte est préparé pour Channing ; un
 * négociant B2B reçoit le mail de Dana, un revendeur néerlandais celui
 * d'Ada avec nos offres du moment ; Ada ne cherche jamais en France.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as dns } from 'node:dns';
import {
  SEGMENTS, segmentOf, webKey, acceptedAccounts, nameTokens, siteNamesCompany, researchPrompt, researchSystem, researchPairs, nextResearchPair,
  sizeNumber, accountFitScore, accountScoreHelp, RESEARCH_SCHEMA, RESEARCH_COUNTRIES, type ResearchOutput,
} from '../src/lib/agents/research';
import { qualifyPrompt, REACH_SCORE_HELP, type QualifyOutput } from '../src/lib/agents/qualification';
import { firstMailPrompt, danaFirstMailPrompt, type FirstMailOutput, type KeyAccountOutput } from '../src/lib/agents/firstMail';
import { HAIKU, OPUS } from '../src/lib/agents/aiCost';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

console.log('\n=== ADA ET DANA : LA RECHERCHE DE COMPTES ===\n');

// --- Les types de comptes ---------------------------------------------------------------------
ok(SEGMENTS.dana.map((s) => s.key).join() === 'leasing,loueur,flotte,groupe,negociant_b2b' && SEGMENTS.ada.map((s) => s.key).join() === 'groupe,revendeur,flotte',
  'types : Dana (leasing, loueurs, flottes, groupes, négociants B2B), Ada (groupes, revendeurs, flottes qui renouvellent)');
ok(segmentOf('dana', 'leasing')?.keyAccount === true && segmentOf('dana', 'negociant_b2b')?.keyAccount === false && segmentOf('ada', 'revendeur')?.keyAccount === false && segmentOf('ada', 'leasing') === null,
  'types : leasing, loueur, flotte, groupe = grands comptes ; négociant et revendeur = petits comptes');
ok(/Elting Cars, VPN/.test(segmentOf('dana', 'negociant_b2b')?.who ?? '') && /taxis et VTC/.test(segmentOf('ada', 'flotte')?.who ?? ''), 'types : les exemples de Channing (Elting Cars, VPN), les flottes de taxis pour nos hybrides');

// --- Consigne ---------------------------------------------------------------------------------------
const pr = researchPrompt({ role: 'dana', segment: segmentOf('dana', 'leasing')!, country: 'be', known: ['Alphabet Belgium', 'Ayvens Belgium'] });
ok(pr.startsWith('Cherche les sociétés de leasing et de location longue durée') && pr.includes('en Belgique (BE)') && pr.includes('Déjà connues (ne les rends pas) : Alphabet Belgium ; Ayvens Belgium') && /4 recherches au plus/.test(pr),
  'consigne : qui, où, déjà connues à ne pas rendre, 4 recherches au plus', pr);
ok(/fournisseurs réguliers/.test(researchSystem('dana')) && /clients réguliers/.test(researchSystem('ada')) && /Jamais un nom, un site ou un chiffre deviné/.test(researchSystem('ada')) && /DONNÉES/.test(researchSystem('dana')),
  'consigne fixe : fournisseurs pour Dana, clients pour Ada ; rien de deviné ; pages = données');
ok((RESEARCH_SCHEMA.properties.comptes.items.required as readonly string[]).join() === 'nom,site_web,ville,taille,pourquoi,sources', 'schéma : nom, site, ville, taille, pourquoi, sources');

// --- Contrôle des entreprises rendues -----------------------------------------------------------------
ok(webKey('https://www.arval.be/fr/') === 'arval.be' && webKey('https://www.autoscout24.be/x') === '' && webKey('https://be.linkedin.com/company/x') === '' && webKey('nimporte') === '', 'site comparable : hôte sans www ; ni annonces ni réseau social');
const out: ResearchOutput = { remarque: null, comptes: [
  { nom: 'Arval Belgium', site_web: 'https://www.arval.be/fr/a-propos/qui-sommes-nous', ville: 'Bruxelles', taille: 'flotte de 160 000 véhicules', pourquoi: 'Revend chaque année des milliers de véhicules en fin de contrat.', sources: ['https://www.arval.be/fr/a-propos'] },
  { nom: 'Athlon Belgium', site_web: 'https://www.athlon.com/be-fr/', ville: null, taille: null, pourquoi: 'Leasing, remarketing de fins de contrat.', sources: ['https://www.fleet.be/top-leasing-belgique?utm=x'] },
  { nom: 'Ghost Lease', site_web: 'https://www.ghostlease.be/', ville: null, taille: null, pourquoi: '…', sources: ['https://www.invente.be/article'] },
  { nom: 'Hertz Belgium', site_web: 'https://www.hertz.be/', ville: null, taille: null, pourquoi: '…', sources: ['https://www.fleet.be/top-leasing-belgique'] },
  { nom: 'Kompass', site_web: 'https://be.kompass.com/leasing', ville: null, taille: null, pourquoi: '…', sources: ['https://www.fleet.be/top-leasing-belgique'] },
  { nom: 'Arval (doublon)', site_web: 'https://arval.be', ville: null, taille: null, pourquoi: '…', sources: ['https://www.arval.be/fr/a-propos'] },
  { nom: 'Annonce', site_web: 'https://www.2dehands.be/x', ville: null, taille: null, pourquoi: '…', sources: [] },
  { nom: 'Lien cassé', site_web: 'pas une adresse', ville: null, taille: null, pourquoi: '…', sources: [] },
] };
const seen = ['https://www.arval.be/fr/a-propos', 'https://www.fleet.be/top-leasing-belgique'];
const acc = acceptedAccounts(out, seen, { webKeys: new Set(['hertz.be']), nameKeys: new Set() });
ok(acc.kept.map((k) => k.name).join() === 'Arval Belgium,Athlon Belgium', 'contrôle : seules les entreprises vues et inconnues sont gardées', acc);
ok(acc.kept[0].website === 'https://www.arval.be/fr/' && acc.kept[0].siteSeen && acc.kept[1].website === 'https://www.athlon.com/be-fr/' && !acc.kept[1].siteSeen && acc.kept[1].sources[0] === 'https://www.fleet.be/top-leasing-belgique?utm=x',
  'contrôle : l\'accueil ou la page de la filiale du pays (jamais une page profonde) ; site lu ou à vérifier ; sources vues', acc.kept);
const why = Object.fromEntries(acc.dropped.map((d) => [d.name, d.reason]));
ok(why['Ghost Lease'] === 'jamais vue dans les résultats' && why['Hertz Belgium'] === 'déjà connue' && why.Kompass === 'pas un site d\'entreprise' && why['Arval (doublon)'] === 'en double'
  && why.Annonce === 'pas un site d\'entreprise' && why['Lien cassé'] === 'site illisible', 'contrôle : inventée, déjà connue, annuaire, doublon, site d\'annonces, adresse illisible — écartées', why);
ok(nameTokens('VPN Autos').join() === 'vpn' && nameTokens('Arval Belgium').join() === 'arval' && siteNamesCompany('<title>Athlon | Leasing</title>', 'Athlon Belgium') && !siteNamesCompany('<title>Domain for sale</title>', 'Athlon Belgium'),
  'site à vérifier : il doit porter le nom de l\'entreprise');

// --- Rotation des recherches automatiques -------------------------------------------------------------
const dp = researchPairs('dana', RESEARCH_COUNTRIES);
ok(dp.length === RESEARCH_COUNTRIES.length * 5 && dp[0].country === 'FR' && dp[0].segment === 'leasing' && dp[4].segment === 'negociant_b2b' && dp[5].country === 'BE', 'rotation de Dana : toute l\'Europe, la France d\'abord, les cinq types pays après pays');
const ap = researchPairs('ada', ['fr', 'NL', 'DK', 'xx1']);
ok(ap.length === 6 && !ap.some((p) => p.country === 'FR') && ap[0].country === 'NL', 'rotation d\'Ada : ses pays d\'export, jamais la France', ap);
const two = [{ segment: 'leasing', country: 'BE' }, { segment: 'loueur', country: 'BE' }];
ok(JSON.stringify(nextResearchPair(two, [{ params: { segment: 'leasing', country: 'be' }, created_at: daysAgo(2) }])) === '{"segment":"loueur","country":"BE"}', 'rotation : la recherche jamais faite d\'abord');
ok(nextResearchPair(two, [{ params: two[0], created_at: daysAgo(2) }, { params: two[1], created_at: daysAgo(5) }]) === null, 'rotation : tout fait il y a moins de 30 jours → rien');
ok(JSON.stringify(nextResearchPair(two, [{ params: two[0], created_at: daysAgo(31) }, { params: two[1], created_at: daysAgo(45) }])) === JSON.stringify(two[1]), 'rotation : au bout de 30 jours, la plus ancienne');

// --- Score d'un compte ----------------------------------------------------------------------------------
ok(sizeNumber('flotte de 12 000 véhicules') === 12_000 && sizeNumber('1,2 million de véhicules') === 1_200_000 && sizeNumber('depuis 1985, 250 agences') === 250 && sizeNumber('25 concessions') === 25 && sizeNumber(null) === null,
  'taille : « 12 000 », « 1,2 million », sans les années');
const f1 = accountFitScore({ role: 'dana', segment: segmentOf('dana', 'leasing'), country: 'FR', targetCountries: [], size: 'flotte de 160 000 véhicules', hasEmail: true, hasNamedContact: true, hasLinkedin: true });
ok(f1.score === 40 + 10 + 15 + 8 + 4 + 5, 'score : leasing, en France, grande flotte, e-mail, interlocuteur, LinkedIn', f1);
ok(accountFitScore({ role: 'ada', segment: segmentOf('ada', 'flotte'), country: 'NL', targetCountries: ['NL'], size: null, hasEmail: false, hasNamedContact: false, hasLinkedin: false }).score === 50
  && accountFitScore({ role: 'ada', segment: segmentOf('ada', 'flotte'), country: 'SE', targetCountries: ['NL'], size: null, hasEmail: false, hasNamedContact: false, hasLinkedin: false }).score === 30,
  'score d\'Ada : un pays cible compte (+20)');

// Le « i » des Réglages dit vrai : chaque barème affiché est celui du calcul, pour Ada comme pour Dana.
for (const role of ['ada', 'dana'] as const) {
  const base = { role, segment: null, country: null, targetCountries: ['NL'], size: null, hasEmail: false, hasNamedContact: false, hasLinkedin: false };
  const only = (x: Partial<typeof base> & { segment?: ReturnType<typeof segmentOf> }) => accountFitScore({ ...base, ...x }).score;
  const list = (xs: number[]) => xs.map((p) => `+${p}`).join(', ');
  const help = accountScoreHelp(role);
  const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  // Chaque type de compte est sur une ligne au barème du calcul (les types de même barème regroupés).
  const typesOk = SEGMENTS[role].every((s) => help.some(([l, p]) => l.split(', ').includes(lcFirst(s.label)) && p === `+${only({ segment: s })}`));
  const shown = help.slice(new Set(SEGMENTS[role].map((s) => s.points)).size).map(([, p]) => p);
  const computed = [
    role === 'ada' ? list([only({ country: 'NL' })]) : list([only({ country: 'FR' }), only({ country: 'DE' })]),
    list(['50 salariés', '150 véhicules', '1 200 véhicules'].map((size) => only({ size }))),
    list([only({ hasLinkedin: true })]),
  ];
  const reach = [only({ hasEmail: true }), only({ hasNamedContact: true })].map((p) => `+${p}`);
  ok(typesOk && shown.join(' | ') === computed.join(' | ') && REACH_SCORE_HELP.map(([, p]) => p).join() === reach.join(),
    `la note d'un compte ${role === 'ada' ? 'd\'Ada' : 'de Dana'} expliquée (le « i » des Réglages) : les barèmes affichés sont ceux du calcul`, { shown, computed, reach });
}

// --- Qualification et mails d'un compte ----------------------------------------------------------------
const qp = qualifyPrompt({
  role: 'dana', decisionSearch: true, account: { segment: 'Sociétés de leasing', roles: 'responsable remarketing', size: 'flotte de 160 000 véhicules', why: 'Fins de contrat.' },
  dealer: { name: 'Arval Belgium', country: 'BE', city: 'Bruxelles', zip: null, street: null, phone: null, contactName: null, sources: ['Recherche web'] },
  fit: f1, stock: { listings: 0, brands: [], vans: 0, medianPrice: null, opportunities: [] }, page: null, emailsFound: [], pages: [], webSearch: false,
});
ok(qp.startsWith('Entreprise : Arval Belgium — Bruxelles, BE') && qp.includes('Trouvée par une recherche web : Sociétés de leasing — flotte de 160 000 véhicules') && !qp.includes('Annonces vues sur') && !qp.includes('Stock vu')
  && qp.includes('Compte trouvé par recherche : cherche sur le web (2 ou 3 recherches au plus) la personne qui décide (responsable remarketing), pour ce pays'),
  'consigne de qualification : l\'entreprise, son type et sa taille, la personne qui décide selon son type', qp.split('\n'));
const accountFacts = { segment: 'Négociants B2B', size: '400 véhicules en stock', why: 'Revend des véhicules récents aux professionnels.' };
const dm = danaFirstMailPrompt({ company: 'Auto Grossiste NV', country: 'BE', city: 'Gand', language: 'nl', contact: { name: null, role: null }, kind: 'negociant_vo', group: null, summary: null, stock: { listings: 0, byBrand: [] }, lots: [], account: accountFacts, instructions: '' });
ok(dm.includes('Trouvée par une recherche web : Négociants B2B — 400 véhicules en stock') && dm.includes('(entreprise trouvée par une recherche web : ADA ne suit pas ses annonces)') && !dm.includes('Lot :'), 'mail de Dana pour un compte : son type et sa taille, pas de stock inventé');
const am = firstMailPrompt({ company: 'Taxi Centrale', country: 'NL', city: 'Utrecht', language: 'nl', contact: { name: null, role: null }, kind: 'flotte_entreprise', group: null, officialBrands: [], summary: null, stock: { listings: 0, byBrand: [], models: [] }, account: { segment: 'Flottes qui renouvellent', size: '120 taxis', why: null }, gaps: [], offers: [{ title: 'Toyota Corolla Touring Sports 1.8 Hybrid', year: 2022, km: 45_000, priceHt: 18_500, withVat: 22_385 }], instructions: '' });
ok(am.includes('Trouvée par une recherche web : Flottes qui renouvellent — 120 taxis') && am.includes('Toyota Corolla Touring Sports 1.8 Hybrid'), 'mail d\'Ada pour une flotte : son type, nos offres du moment');

// --- Le parcours du worker -------------------------------------------------------------------------------
type Row = Record<string, unknown>;
const db: FakeDb = {
  agent_accounts: [
    { id: 'acc-alpha', agent: 'dana', segment: 'leasing', country: 'BE', name: 'Alphabet Belgium', website: 'https://www.alphabet.be/', status: 'ecarte', sources: [], found_at: daysAgo(3) },
    // Un négociant B2B déjà qualifié (petit compte), et un revendeur néerlandais d'Ada.
    { id: 'acc-b2b', agent: 'dana', segment: 'negociant_b2b', country: 'BE', name: 'Auto Grossiste NV', website: 'https://www.autogrossiste.be/', city: 'Gand', size_hint: '400 véhicules en stock', why: 'Revend des véhicules récents aux professionnels.', status: 'qualifie', sources: [], found_at: daysAgo(2) },
    { id: 'acc-nl', agent: 'ada', segment: 'revendeur', country: 'NL', name: 'Hybride Centrum Utrecht', website: 'https://www.hybridecentrum.nl/', city: 'Utrecht', size_hint: null, why: 'Spécialiste des hybrides d\'occasion.', status: 'qualifie', sources: [], found_at: daysAgo(2) },
  ],
  agent_prospects: [
    { id: 'p-b2b', agent: 'dana', account_id: 'acc-b2b', dealer_id: null, name: 'Auto Grossiste NV', country: 'BE', city: 'Gand', group_name: null, kind: 'negociant_vo', language: 'nl', summary: 'Grossiste B2B à Gand.', stage: 'qualifie', score: 66, key_account: false,
      network_contact_id: null, brands_official: [], people: [], lots: [], best_contact: { nom: 'Pieter De Smet', fonction: 'zaakvoerder', email: 'pieter@autogrossiste.be' }, emails: [{ email: 'pieter@autogrossiste.be', mx: true }] },
    { id: 'p-nl', agent: 'ada', account_id: 'acc-nl', dealer_id: null, name: 'Hybride Centrum Utrecht', country: 'NL', city: 'Utrecht', group_name: null, kind: 'independant_multimarque', language: 'nl', summary: 'Spécialiste des hybrides.', stage: 'qualifie', score: 71, key_account: false,
      network_contact_id: null, brands_official: [], people: [], lots: [], best_contact: { nom: null, fonction: 'inkoop', email: 'inkoop@hybridecentrum.nl' }, emails: [{ email: 'inkoop@hybridecentrum.nl', mx: true }] },
  ],
  network_contacts: [{ id: 'n1', name: 'Hertz Belgium', website: 'https://www.hertz.be/', phone: null, role: 'vendeur', source: 'manuel', country: 'BE' }],
  intra_showcase: [{ id: 'o1', vehicle: { brand: 'Toyota', model: 'Corolla Touring Sports', year: 2022, km: 45_000 }, price_ht: 18_500, title: 'Toyota Corolla Touring Sports 1.8 Hybrid' }],
  transactions_admin: [], contacts: [], agent_tasks: [], agent_runs: [], agent_journal: [], agent_threads: [], agent_messages: [], email_suppressions: [], market_dealers: [], market_dealer_listings: [],
};
setSharedSupabase(fakeSupabase(db) as never);
(dns as unknown as { resolveMx: (d: string) => Promise<unknown[]> }).resolveMx = async (d: string) => (['arval.be', 'autogrossiste.be', 'hybridecentrum.nl'].includes(d) ? [{ exchange: `mx.${d}`, priority: 10 }] : []);

const aiOut = (o: Partial<QualifyOutput>): QualifyOutput => ({
  site_web: null, raison_sociale: null, groupe: null, nb_sites: null, type: 'autre', marques_officielles: [], emails: [], contacts: [],
  meilleur_contact: { nom: null, fonction: null, email: null, linkedin: null, pourquoi: '' }, langue: 'fr', grand_compte: false, ajustement: 0, exclure: false, motif_exclusion: null, resume: '', ...o,
});
const SOPHIE = 'https://be.linkedin.com/in/sophie-peeters-remarketing';
const keyOut: KeyAccountOutput = {
  objet: 'Vos fins de contrat en Belgique',
  corps: 'Bonjour Madame Peeters,\n\nArval Belgium gère une flotte de 160 000 véhicules, et une partie revient chaque mois en fin de contrat. Je suis Channing, de MC Export : nous achetons des véhicules récents en lots pour l\'export, partout en Europe, et nous cherchons des partenaires de leasing avec qui travailler dans la durée.\n\nQui suit la revente de vos véhicules aux professionnels ?\n\nSi ce n\'est pas un sujet pour vous, dites-le-moi et je ne reviendrai pas vers vous.',
  linkedin: 'Bonjour Sophie, je suis Channing, de MC Export : nous achetons des véhicules récents en lots dans toute l\'Europe. Ravi d\'échanger sur vos fins de contrat.',
  fiche_appel: { interlocuteur: 'Sophie Peeters, responsable remarketing', pourquoi: 'Elle revend les véhicules en fin de contrat.', accroche: 'Je vous appelle au sujet de vos fins de contrat.', points: ['Flotte de 160 000 véhicules'], questions: ['Quels volumes par mois ?', 'Quels modèles ?', 'Vendez-vous en lots ?'] },
  traduction_fr: null, faits: [{ fait: 'flotte de 160 000 véhicules', source: 'fiche' }],
};
const mail: FirstMailOutput = {
  objet: 'Uw jonge occasions',
  corps: 'Goedemiddag,\n\nIk zag dat Auto Grossiste NV jonge occasions aan professionals verkoopt. Ik ben Dana, van de inkoop bij MC Export, een Franse exporteur van jonge occasions. We zoeken partners die regelmatig recente wagens kunnen leveren, per stuk of per partij.\n\nStaat u open voor een eerste gesprek over uw aanbod?\n\nAls dit niets voor u is, laat het me weten, dan stuur ik geen herinnering.',
  traduction_fr: 'Bonjour, …', faits: [{ fait: 'vend des véhicules récents aux professionnels', source: 'fiche' }],
};
let base = '';
let noCredit = false;
const calls: Array<{ model: string; system: string; user: string; tools?: Array<{ name: string; max_uses?: number }> }> = [];
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!(req.url?.startsWith('/v1/messages') && req.method === 'POST')) { res.writeHead(404); res.end(); return; }
  let raw = '';
  for await (const ch of req) raw += ch;
  const body = JSON.parse(raw) as { model: string; system: Array<{ text: string }>; messages: Array<{ content: unknown }>; tools?: Array<{ name: string; max_uses?: number }> };
  const system = body.system?.[0]?.text ?? '';
  const user = String(body.messages[0].content);
  calls.push({ model: body.model, system, user, tools: body.tools });
  if (noCredit) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }));
    return;
  }
  const usage = { input_tokens: 9000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: body.tools ? 2 : 0, web_fetch_requests: 0 } };
  const reply = (content: unknown[]) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content, stop_reason: 'end_turn', stop_sequence: null, usage })); };
  const results = (urls: string[]) => [
    { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'x' } },
    { type: 'web_search_tool_result', tool_use_id: 'srv1', content: urls.map((url) => ({ type: 'web_search_result', url, title: url, encrypted_content: 'x', page_age: null })) },
  ];
  if (/Tu cherches sur le web des entreprises réelles/.test(system)) {
    return reply([...results(seen), { type: 'text', text: JSON.stringify({ ...out, comptes: [...out.comptes, { nom: 'LeasePlan Fake', site_web: 'https://www.leaseplan-fake.be/', ville: null, taille: null, pourquoi: '…', sources: ['https://www.fleet.be/top-leasing-belgique'] }] }) }]);
  }
  if (/Ton travail ici : qualifier/.test(system)) {
    return reply([...results([`${SOPHIE}?trk=x`]), { type: 'text', text: JSON.stringify(aiOut({
      site_web: 'https://www.arval.be/fr/', type: 'loueur_ou_leasing', groupe: 'BNP Paribas', grand_compte: true, ajustement: 10,
      emails: [{ email: 'remarketing@arval.be', nature: 'vo', source: 'https://www.arval.be/fr/' }],
      contacts: [{ nom: 'Sophie Peeters', fonction: 'responsable remarketing', email: null, linkedin: SOPHIE, source: 'résultat de recherche' }],
      meilleur_contact: { nom: 'Sophie Peeters', fonction: 'responsable remarketing', email: null, linkedin: SOPHIE, pourquoi: 'Elle revend les fins de contrat.' },
      resume: 'Société de leasing (BNP Paribas), une très grande flotte en Belgique.',
    })) }]);
  }
  return reply([{ type: 'text', text: JSON.stringify(/GRAND COMPTE/.test(system) ? keyOut : mail) }]);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = base;
// Faux internet : les sites des entreprises (pas de vraie requête sortante).
const realFetch = globalThis.fetch;
const pages: Record<string, string> = {
  'https://www.athlon.com/be-fr/': `<html><title>Athlon | Leasing en Belgique</title><body>${'Athlon, leasing pour les entreprises. '.repeat(40)}</body></html>`,
  'https://www.leaseplan-fake.be/': `<html><title>Domain for sale</title><body>${'Ce domaine est à vendre. '.repeat(60)}</body></html>`,
  'https://www.arval.be/fr/': `<html><title>Arval Belgium</title><body>${'Arval, location longue durée. '.repeat(40)} Remarketing : <a href="mailto:remarketing@arval.be">remarketing@arval.be</a></body></html>`,
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  if (pages[u]) return new Response(pages[u], { headers: { 'content-type': 'text/html' } });
  if (u.startsWith('https://nominatim.openstreetmap.org/')) return new Response(JSON.stringify([{ lat: '50.85', lon: '4.35' }]), { headers: { 'content-type': 'application/json' } });
  if (u.startsWith(base)) return realFetch(input, init);
  return new Response('introuvable', { status: 404 });
}) as typeof fetch;

const { researchAccounts } = await import('../worker/agents/research');
const { qualifyAccount, nextAccountCandidates } = await import('../worker/agents/qualify');
const { draftFirstMail } = await import('../worker/agents/firstMail');
const dana = { agent: 'dana', mailbox: 'dana@mc-export.com', signature: 'Dana\nMC Export — achats', daily_budget_usd: 3, map_auto_add: true, map_min_score: 60, targets: { minLot: 3, markets: ['NL', 'DK', 'BE', 'DE'] }, instructions: '', daily_first_contact_cap: 10 } as never;
const ada = { agent: 'ada', mailbox: 'ada@mc-export.com', signature: 'Ada\nMC Export', daily_budget_usd: 3, map_auto_add: false, map_min_score: 70, targets: { countries: ['NL'] }, instructions: '', daily_first_contact_cap: 10 } as never;
const ctx = { agent: dana, taskId: 'tr1', role: 'dana' as const, dana: { minLot: 3, markets: ['NL', 'DK', 'BE', 'DE'] }, targets: { countries: [], brands: [], vanBrands: [], multibrand: true }, targetCountries: [], offers: [] };

// 1. La recherche : sociétés de leasing en Belgique.
const r1 = await researchAccounts('tr1', { segment: 'leasing', country: 'be' }, dana);
const c1 = calls[0];
const found = db.agent_accounts.filter((a) => a.task_id === 'tr1') as Array<Row & { sources: string[] }>;
ok(c1?.model === HAIKU && /Tu es Dana, de l'équipe achats/.test(c1.system) && c1.user.includes('Déjà connues (ne les rends pas) : Alphabet Belgium')
  && c1.tools?.find((t) => t.name === 'web_search')?.max_uses === 4 && c1.tools?.find((t) => t.name === 'web_fetch')?.max_uses === 2,
  'recherche : Haiku 5.5, consigne de Dana, comptes déjà trouvés cités (même écartés), 4 recherches et 2 pages au plus', c1 && { tools: c1.tools });
ok(found.map((a) => a.name).join() === 'Arval Belgium,Athlon Belgium' && found.every((a) => a.segment === 'leasing' && a.country === 'BE' && a.agent === 'dana'),
  'recherche : Arval (site lu) et Athlon (site vérifié : il répond et porte son nom) gardés', found.map((a) => a.name));
ok(r1.result.gardes === 2 && r1.result.deja === 2 && r1.result.ecartes === 5 && r1.result.details.some((d) => d === 'LeasePlan Fake : site invérifiable') && r1.result.details.some((d) => d === 'Hertz Belgium : déjà connue'),
  'recherche : connues de l\'équipe (carte) et doublons écartés ; inventée, annuaire, annonces, site invérifiable aussi', r1.result);
ok(/^Recherche sociétés de leasing · Belgique : 2 comptes trouvés, 2 déjà connus, 5 écartés \(invérifiables\) — /.test(r1.summary), 'recherche : le résumé du journal', r1.summary);
ok((found[0]?.sources ?? []).join() === 'https://www.arval.be/fr/a-propos' && found[0]?.size_hint === 'flotte de 160 000 véhicules', 'recherche : sources vues et taille gardées', found[0]);
let refusedFr = '';
try { await researchAccounts('tr2', { segment: 'groupe', country: 'FR' }, ada); } catch (e) { refusedFr = e instanceof Error ? e.message : String(e); }
ok(/Ada vend à l'export/.test(refusedFr) && calls.length === 1, 'Ada ne cherche jamais d\'acheteurs en France (aucun appel)', refusedFr);

// 2. Les comptes trouvés passent avant l'annuaire.
const cand = await nextAccountCandidates(ctx as never, 10);
const arvalId = String(found.find((a) => a.name === 'Arval Belgium')?.id);
ok(cand.length === 2 && cand.includes(arvalId) && !cand.includes('acc-alpha') && !cand.includes('acc-b2b'), 'candidats : les comptes à qualifier de Dana (ni écartés, ni déjà qualifiés)', cand);

// 3. La qualification d'Arval : grand compte, la personne qui décide et son profil LinkedIn.
const q = await qualifyAccount(arvalId, ctx as never);
const c2 = calls[1];
const p = db.agent_prospects.find((x) => x.account_id === arvalId) as (Row & { best_contact: { nom: string; email: string | null; linkedin: string | null }; fit_parts: Array<{ label: string; points: number }> }) | undefined;
const arval = db.agent_accounts.find((a) => a.id === arvalId) as Row | undefined;
ok(c2?.user.includes('Trouvée par une recherche web : Sociétés de leasing — flotte de 160 000 véhicules') && /la personne qui décide \(responsable remarketing/.test(c2.user) && !!c2.tools?.length,
  'qualification : l\'entreprise trouvée, et la recherche de la personne qui décide selon son type', c2?.user.split('\n').slice(-1));
ok(q.status === 'qualifie' && p?.agent === 'dana' && p.dealer_id === null && p.key_account === true && p.account_kind === 'loueur_ou_leasing', 'qualification : fiche de Dana rattachée au compte, grand compte', p && { key: p.key_account, kind: p.account_kind, dealer: p.dealer_id });
ok(p?.best_contact.email === 'remarketing@arval.be' && p.best_contact.linkedin === 'https://www.linkedin.com/in/sophie-peeters-remarketing', 'qualification : e-mail publié et vérifié, profil LinkedIn vu (adresse propre)', p?.best_contact);
ok(q.score === 40 + 5 + 15 + 8 + 4 + 5 + 10 && p?.fit_parts.some((x) => x.label === 'sociétés de leasing' && x.points === 40), 'score : leasing, Europe, flotte de 160 000, e-mail, interlocuteur, LinkedIn, avis de Dana (+10)', { score: q.score, parts: p?.fit_parts });
ok(arval?.status === 'qualifie' && arval.prospect_id === p?.id, 'le compte passe « qualifié », relié à sa fiche', arval);
const n2 = db.network_contacts.find((x) => x.name === 'Arval Belgium') as Row | undefined;
ok(n2?.role === 'vendeur' && n2.kind === 'loueur' && n2.source === 'dana', 'carte : Arval comme vendeur (loueur), badge Dana', n2);
ok(db.agent_journal.some((j) => /^Arval Belgium \(BE · sociétés de leasing\) : fiche prête, \d+\/100 — Sophie Peeters/.test(String(j.summary))), 'journal : le compte, son type, son score, la personne');

// 4. Le grand compte : préparé pour Channing, avec ce que la recherche a appris.
const d1 = await draftFirstMail(String(p?.id), dana, 'tm1');
const c3 = calls[2];
const ms = db.agent_messages.filter((m) => (db.agent_threads.find((t) => t.prospect_id === p?.id) as Row | undefined)?.id === m.thread_id);
ok(d1.status === 'redige' && /GRAND COMPTE/.test(c3?.system ?? '') && (c3?.user ?? '').includes('Trouvée par une recherche web : Sociétés de leasing — flotte de 160 000 véhicules') && (c3?.user ?? '').includes('ADA ne suit pas ses annonces'),
  'grand compte : préparé pour Channing, avec le type et la taille du compte (pas de stock inventé)', c3?.user.split('\n').slice(0, 12));
ok(ms.length === 2 && ms.every((m) => m.status === 'pour_channing') && ms.some((m) => m.channel === 'linkedin' && (m.ai_notes as { linkedin_url?: string }).linkedin_url === 'https://www.linkedin.com/in/sophie-peeters-remarketing'),
  'grand compte : mail et note LinkedIn « pour vous »', ms.map((m) => [m.channel, m.status]));

// 5. Un petit compte de Dana (négociant B2B) : le mail d'achat, sans lot, à valider.
const d2 = await draftFirstMail('p-b2b', dana, 'tm1');
const c4 = calls[3];
const m2 = db.agent_messages.find((m) => (m.to_emails as string[]).includes('pieter@autogrossiste.be')) as Row | undefined;
ok(d2.status === 'redige' && m2?.status === 'a_valider' && m2.mailbox === 'dana@mc-export.com' && /^Tu es Dana, de l'équipe achats/.test(c4?.system ?? '') && (c4?.user ?? '').includes('Trouvée par une recherche web : Négociants B2B — 400 véhicules en stock') && !(c4?.user ?? '').includes('Lot :'),
  'petit compte (négociant B2B) : mail de Dana à valider, sans lot (pas écarté faute de lot)', d2);

// 6. Un revendeur d'Ada trouvé par recherche : nos offres du moment, sans annonces suivies.
const d3 = await draftFirstMail('p-nl', ada, 'tm1');
const c5 = calls[4];
ok(d3.status === 'redige' && /^Tu es Ada/.test(c5?.system ?? '') && (c5?.user ?? '').includes('Trouvée par une recherche web : Revendeurs multimarques ou spécialisés') && (c5?.user ?? '').includes('Toyota Corolla Touring Sports 1.8 Hybrid'),
  'revendeur d\'Ada : son type et nos offres du moment', c5?.user.split('\n'));
ok(db.agent_runs.length === 5 && db.agent_runs[0].purpose === 'recherche_comptes' && db.agent_runs[1].purpose === 'qualification' && db.agent_runs[2].purpose === 'grand_compte' && db.agent_runs[2].model === OPUS,
  'appels inscrits : recherche, qualification, grand compte, premiers mails', db.agent_runs.map((r) => r.purpose));

// 7. Plus de crédits : un message clair ; le travail automatique attend, une tâche lancée à la main réessaie tout de suite.
const { clearCreditPause } = await import('../worker/agents/claude');
const before = calls.length;
noCredit = true;
const fail = async (id: string) => { try { await researchAccounts(id, { segment: 'loueur', country: 'NL' }, dana); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const e1 = await fail('tc1');
const e2 = await fail('tc2');
ok(/crédits API Anthropic épuisés : ajoutez-en dans la console Anthropic/.test(e1) && /reprend seul dans l'heure/.test(e2) && calls.length === before + 1,
  'plus de crédits : message clair, puis le travail automatique attend (aucun nouvel appel)', { e1, e2, appels: calls.length - before });
noCredit = false;
clearCreditPause();
const r5 = await researchAccounts('tc3', { segment: 'loueur', country: 'NL' }, dana);
ok(calls.length === before + 2 && r5.result.trouves > 0, 'crédits ajoutés : une tâche lancée à la main réessaie tout de suite', r5.summary);

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

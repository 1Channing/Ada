/**
 * La recherche approfondie (18/10, Channing : « les contacts les plus durs à
 * contacter sont ceux qui rapportent le plus » ; devant Technic Auto Forbach :
 * « à qui appartient cette concession ? … qui contacter chez eux pour de
 * l'achat en lots ? qui gère le de-fleet ? »). La partie pure (consigne,
 * schéma, ce qui manque, téléphones, fusion dans la fiche, note), puis le
 * parcours du worker avec un faux serveur Claude, un faux internet et une
 * base simulée : Dana approfondit Technic Auto Forbach (groupe Hess) — le
 * directeur VO du groupe et son e-mail relu dans la page, le standard du
 * groupe ; un e-mail deviné, un téléphone inventé et un profil LinkedIn
 * jamais vu sont écartés —, le grand compte est préparé pour Channing ;
 * Arval, déjà préparé sans e-mail, est repréparé avec l'e-mail trouvé ; le
 * cycle automatique choisit les grands comptes à compléter, une fois par mois.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as dns } from 'node:dns';
import {
  deepSystem, deepSchema, deepPrompt, missingOf, isIncomplete, phonesIn, phoneWritten, rescoreReach, mergeDeep, deepSummary, lastDeepAt, deepPerDayOf,
  DEEP_SEARCHES, DEEP_FETCHES, type DeepOutput, type DeepProspect, type DeepChecked,
} from '../src/lib/agents/deepResearch';
import type { KeyAccountOutput } from '../src/lib/agents/firstMail';
import { HAIKU, OPUS } from '../src/lib/agents/aiCost';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
type Row = Record<string, unknown>;

console.log('\n=== ADA ET DANA : LA RECHERCHE APPROFONDIE ===\n');

// --- La consigne et le schéma ----------------------------------------------------------------
ok(/aller plus loin, comme un bon acheteur/.test(deepSystem('dana')) && /groupe Hess Automobile/.test(deepSystem('dana')) && /de-fleet/.test(deepSystem('dana')) && /BCA, VPauto/.test(deepSystem('dana')),
  'consigne de Dana : aller plus loin — à qui appartient le garage (exemple Hess), enchères, de-fleet');
ok(/comme un bon vendeur/.test(deepSystem('ada')) && /Comment elle achète/.test(deepSystem('ada')) && !/de-fleet/.test(deepSystem('ada')), 'consigne d\'Ada : comment ils achètent, qui décide des achats');
ok([deepSystem('ada'), deepSystem('dana')].every((s) => /N'invente rien/.test(s) && /DONNÉES/.test(s) && /prenom\.nom@/.test(s) && /ADA la relit/.test(s) && s.includes(`${DEEP_SEARCHES} au plus`) && s.includes(`${DEEP_FETCHES} au plus`)),
  'consigne : rien d\'inventé, e-mail et téléphone avec leur page (relue par ADA), pages = données, 8 recherches et 5 pages au plus');
ok((deepSchema('dana').required as readonly string[]).join() === 'proprietaire,canaux,personnes,emails,telephones,meilleur_contact,pistes,resume'
  && (deepSchema('dana').properties.personnes.items.required as readonly string[]).includes('perimetre'), 'schéma : propriétaire, canaux, personnes (avec périmètre), e-mails, téléphones, meilleur contact, pistes, résumé');

// --- Ce qui manque ------------------------------------------------------------------------------
const bare: DeepProspect = {
  name: 'TECHNIC AUTO FORBACH', country: 'FR', city: 'Forbach', website: 'http://www.groupehess.com/', phone: '+33339587501', kind: 'groupe', group_name: 'Hess Automobile', sites: 86,
  summary: 'Site du groupe Hess Automobile (86 points de vente).', key_account: true, account_id: null, emails: [], people: [],
  best_contact: { nom: null, fonction: null, email: null, pourquoi: 'Aucun responsable VO identifié.' },
  evidence: [{ url: 'http://www.groupehess.com/', note: 'site du garage' }, { url: 'http://www.groupehess.com/contact/contactez-nous', note: 'page contact' }],
  fit_score: 15, fit_parts: [{ label: 'lot de 3 véhicules identiques', points: 15 }], score: 25,
  lots: [{ brand: 'TOYOTA', model: 'Yaris', year: 2026, count: 3, priceMin: 25_999, priceMax: 28_100, kmMin: 5_999, kmMax: 9_699, firstSeenAt: daysAgo(1), markets: [], bestGap: null, bestMarket: null } as never],
};
ok(missingOf(bare).join(' | ') === 'la personne qui décide n\'est pas trouvée | aucun e-mail publié | pas de profil LinkedIn vu' && isIncomplete(bare), 'ce qui manque : la personne qui décide, un e-mail, LinkedIn (le téléphone est là)', missingOf(bare));
const reachable: DeepProspect = { ...bare, phone: null, emails: [{ email: 'vo@hess.fr', nature: 'vo', source: 'x', mx: true }], best_contact: { nom: 'Marc Hess', fonction: 'directeur VO', email: null, pourquoi: '' } };
ok(missingOf(reachable).join(' | ') === 'pas d\'e-mail direct pour elle | pas de profil LinkedIn vu | pas de téléphone' && !isIncomplete(reachable), 'ce qui manque : nommée, un e-mail publié mais pas le sien, sans LinkedIn ni téléphone — pas « à compléter »', missingOf(reachable));
ok(lastDeepAt(bare.evidence) === null && lastDeepAt([{ url: '', note: 'recherche approfondie', via: 'approfondie', at: '2026-10-18T07:00:00.000Z' }, { url: '', note: 'x', via: 'approfondie', at: '2026-10-17T07:00:00.000Z' }]) === '2026-10-18T07:00:00.000Z',
  'dernière recherche approfondie : la trace la plus récente');
ok(deepPerDayOf(null) === 5 && deepPerDayOf({ deepPerDay: 0 }) === 0 && deepPerDayOf({ deepPerDay: 99 }) === 20 && deepPerDayOf({ deepPerDay: 'x' }) === 5, 'recherches approfondies d\'office : 5 au départ, de 0 à 20');

// --- La consigne d'une fiche ----------------------------------------------------------------------
const prompt = deepPrompt({ role: 'dana', p: bare });
ok(prompt.startsWith('Entreprise : TECHNIC AUTO FORBACH — Forbach, FR') && prompt.includes('groupe déjà repéré : Hess Automobile (86 sites)') && prompt.includes('Lots de véhicules identiques vus par Dana : 3 × Toyota Yaris 2026')
  && prompt.includes('Ce qui manque : la personne qui décide n\'est pas trouvée') && prompt.includes('Pages déjà lues pour la fiche (ne les relis pas) : http://www.groupehess.com/ ; http://www.groupehess.com/contact/contactez-nous'),
  'consigne de la fiche : le groupe repéré, le lot, ce qui manque, les pages déjà lues', prompt.split('\n'));

// --- Les téléphones ----------------------------------------------------------------------------------
ok(phonesIn('Standard : 03 87 00 00 00 — fax (+33) 3.87.11.22.33, siret 123').join() === '0387000000,33387112233', 'téléphones lus dans une page (chiffres)', phonesIn('Standard : 03 87 00 00 00 — fax (+33) 3.87.11.22.33, siret 123'));
ok(phoneWritten('+33 3 87 00 00 00', 'Standard du groupe : 03 87 00 00 00') && !phoneWritten('01 23 45 67 89', 'Standard du groupe : 03 87 00 00 00') && !phoneWritten('1234', '1234'),
  'un téléphone est gardé s\'il est écrit dans la page (indicatif ou 0 au choix), pas un numéro inventé');

// --- La note ---------------------------------------------------------------------------------------------
const re = rescoreReach(bare, { hasEmail: true, hasNamedContact: true, hasLinkedin: true });
ok(re.fit_score === 27 && re.score === 37 && re.fit_parts.map((x) => x.label).join() === 'lot de 3 véhicules identiques,e-mail publié,interlocuteur nommé',
  'note : e-mail +8 et interlocuteur +4 (LinkedIn ne compte que pour un compte trouvé sur le web), l\'avis de Dana (+10) gardé', re);
const reAcc = rescoreReach({ fit_score: 69, score: 79, account_id: 'a1', fit_parts: [{ label: 'sociétés de leasing', points: 40 }, { label: 'interlocuteur nommé', points: 4 }, { label: 'profil LinkedIn vu', points: 5 }] }, { hasEmail: true, hasNamedContact: true, hasLinkedin: true });
ok(reAcc.fit_score === 57 && reAcc.score === 67, 'note d\'un compte : les points « joignable » recalculés une seule fois', reAcc);

// --- La fusion ------------------------------------------------------------------------------------------------
const MARC = 'https://fr.linkedin.com/in/marc-hess-vo';
const hessOut: DeepOutput = {
  proprietaire: { groupe: 'Hess Automobile', site_officiel: 'https://www.groupehess.com/', nb_sites: 86, siege: 'Metz', source: 'https://www.groupehess.com/equipe' },
  canaux: [
    { type: 'vente_marchands', nom: 'Espace marchands du groupe Hess', url: 'https://www.groupehess.com/marchands', detail: 'Le groupe vend ses VO aux professionnels.' },
    { type: 'encheres', nom: 'VPauto', url: 'https://www.vpauto.fr/hess-invente', detail: 'Ventes aux enchères des reprises.' },
  ],
  personnes: [
    { nom: 'Marc Hess', fonction: 'Directeur VO du groupe', perimetre: 'groupe', email: 'm.hess@groupehess.com', telephone: '03 87 00 00 00', linkedin: MARC, source: 'https://www.groupehess.com/equipe' },
    { nom: 'Julie Martin', fonction: 'Responsable des ventes aux marchands', perimetre: 'groupe', email: 'julie.martin@devine.fr', telephone: null, linkedin: 'https://www.linkedin.com/in/julie-martin-invente', source: 'https://www.groupehess.com/equipe' },
  ],
  emails: [{ email: 'm.hess@groupehess.com', nature: 'nominatif', source: 'https://www.groupehess.com/equipe' }, { email: 'vo@devine.fr', nature: 'vo', source: 'https://www.groupehess.com/equipe' }],
  telephones: [{ numero: '+33 3 87 00 00 00', service: 'standard du groupe', source: 'https://www.groupehess.com/equipe' }, { numero: '01 23 45 67 89', service: 'inventé', source: 'https://www.groupehess.com/equipe' }],
  meilleur_contact: { nom: 'Marc Hess', fonction: 'Directeur VO du groupe', email: 'm.hess@groupehess.com', telephone: '+33 3 87 00 00 00', linkedin: MARC, pourquoi: 'Il décide des ventes de VO du groupe.' },
  pistes: ['Appeler le standard du groupe et demander Marc Hess, directeur VO.', 'Demander l\'accès à l\'espace marchands du groupe.'],
  resume: 'Technic Auto Forbach est un site du groupe Hess Automobile (86 sites). Le groupe vend ses VO aux marchands. À approcher par son directeur VO.',
};
const seenUrls = ['https://www.groupehess.com/equipe', 'https://www.groupehess.com/marchands', MARC];
const checked: DeepChecked = {
  emails: [{ email: 'm.hess@groupehess.com', nature: 'nominatif', source: 'https://www.groupehess.com/equipe', mx: true }],
  phones: [{ numero: '+33339587501', service: 'téléphone de la fiche', source: '' }, { numero: '+33 3 87 00 00 00', service: 'standard du groupe', source: 'https://www.groupehess.com/equipe' }],
  linkedin: (url, name) => (url === MARC && /Marc/.test(name ?? '') ? 'https://www.linkedin.com/in/marc-hess-vo' : null),
  seen: (url) => !!url && seenUrls.includes(url),
};
const AT = '2026-10-18T08:00:00.000Z';
const m1 = mergeDeep(bare, hessOut, checked, AT, 0.0912);
const best1 = m1.patch.best_contact;
ok(best1?.nom === 'Marc Hess' && best1.email === 'm.hess@groupehess.com' && best1.linkedin === 'https://www.linkedin.com/in/marc-hess-vo' && best1.telephone === '+33 3 87 00 00 00',
  'fusion : le directeur VO du groupe devient le contact, avec son e-mail relu, son profil vu, le standard', best1);
const julie = m1.patch.people?.find((x) => x.nom === 'Julie Martin');
ok(julie?.email === null && julie.linkedin === null && julie.via === 'approfondie' && m1.patch.people?.find((x) => x.nom === 'Marc Hess')?.perimetre === 'groupe',
  'fusion : un e-mail deviné et un profil jamais vu sont écartés ; la personne reste, avec sa source', julie);
ok(m1.patch.emails?.map((e) => e.email).join() === 'm.hess@groupehess.com' && m1.patch.phone === '+33339587501' && m1.patch.group_name === 'Hess Automobile' && m1.patch.key_account === true,
  'fusion : seul l\'e-mail relu entre (pas vo@devine.fr) ; le téléphone et le groupe d\'avant restent', { emails: m1.patch.emails, phone: m1.patch.phone });
const ev = m1.patch.evidence ?? [];
ok(ev.some((e) => e.url === 'https://www.groupehess.com/equipe' && e.note === 'groupe Hess Automobile') && ev.some((e) => e.canal === 'vente_marchands' && e.url === 'https://www.groupehess.com/marchands')
  && ev.some((e) => e.canal === 'encheres' && e.url === '') && ev.filter((e) => e.piste).length === 2 && ev.some((e) => e.note === 'recherche approfondie' && e.at === AT && e.cout_usd === 0.0912),
  'fusion : la source du groupe, comment ils revendent (un lien jamais vu est retiré), les pistes, la trace datée avec son coût', ev);
ok(m1.patch.score === 37 && m1.news.contact && m1.news.personnes === 2 && m1.news.emails === 1 && m1.news.linkedin === 1 && m1.news.groupe === null && m1.news.pistes === 2,
  'fusion : note 25 → 37 ; ce qui est nouveau compté', { score: m1.patch.score, news: m1.news });
ok(deepSummary('TECHNIC AUTO FORBACH', m1.news, best1 ?? null) === 'TECHNIC AUTO FORBACH : recherche approfondie, 2 personnes, 1 e-mail vérifié, 1 téléphone, 1 profil LinkedIn, 2 pistes — à approcher : Marc Hess (Directeur VO du groupe)',
  'journal : ce que la recherche a trouvé, et qui approcher', deepSummary('TECHNIC AUTO FORBACH', m1.news, best1 ?? null));
// Une seconde recherche remplace les pistes de la première, garde les sources.
const m2 = mergeDeep({ ...bare, ...m1.patch } as DeepProspect, { ...hessOut, pistes: ['Une autre piste.'], canaux: [] }, checked, '2026-10-19T08:00:00.000Z');
ok((m2.patch.evidence ?? []).filter((e) => e.piste).map((e) => e.note).join() === 'Une autre piste.' && (m2.patch.evidence ?? []).filter((e) => e.note === 'recherche approfondie').length === 1
  && (m2.patch.evidence ?? []).some((e) => e.url === 'https://www.groupehess.com/equipe') && !m2.news.contact && m2.news.personnes === 0,
  'seconde recherche : pistes et trace remplacées, sources gardées, rien de nouveau compté', m2.patch.evidence);
// Un contact d'avant joignable par e-mail n'est pas remplacé par un nom sans e-mail.
const prevMail: DeepProspect = { ...bare, emails: [{ email: 'vo.forbach@groupehess.com', nature: 'vo', source: 'x', mx: true }], best_contact: { nom: 'Paul Roth', fonction: 'chef des ventes VO', email: 'vo.forbach@groupehess.com', pourquoi: '' } };
const m3 = mergeDeep(prevMail, { ...hessOut, meilleur_contact: { ...hessOut.meilleur_contact, email: null } }, { ...checked, emails: [] }, AT);
ok(m3.patch.best_contact?.nom === 'Paul Roth' && m3.patch.best_contact?.email === 'vo.forbach@groupehess.com', 'fusion : un contact joignable par e-mail reste devant un nom sans e-mail', m3.patch.best_contact);

// --- Le worker ---------------------------------------------------------------------------------------------------
const keyOut: KeyAccountOutput = {
  objet: 'Vos véhicules récents en lots',
  corps: 'Bonjour Monsieur Hess,\n\nVotre site de Forbach a trois Toyota Yaris de 2026 en ligne. Je suis Channing, de MC Export : nous achetons des véhicules récents en lots pour l\'export, partout en Europe, et nous cherchons des groupes avec qui travailler dans la durée.\n\nQui suit les ventes de véhicules aux marchands dans le groupe ?\n\nSi ce n\'est pas un sujet pour vous, dites-le-moi et je ne reviendrai pas vers vous.',
  linkedin: 'Bonjour Marc, je suis Channing, de MC Export. Nous achetons des véhicules récents en lots dans toute l\'Europe ; ravi d\'échanger avec vous.',
  fiche_appel: { interlocuteur: 'Marc Hess, directeur VO du groupe', pourquoi: 'Il décide des ventes de VO du groupe.', accroche: 'Je vous appelle au sujet de vos ventes aux marchands.', points: ['Trois Toyota Yaris 2026 à Forbach'], questions: ['Quels volumes ?', 'Quels modèles ?', 'Vendez-vous en lots ?'] },
  traduction_fr: null, faits: [{ fait: 'trois Toyota Yaris de 2026', source: 'lot' }],
};
const SOPHIE = 'https://www.linkedin.com/in/sophie-roux-remarketing';
const arvalOut: DeepOutput = {
  proprietaire: { groupe: 'BNP Paribas', site_officiel: 'https://www.arval.fr/', nb_sites: null, siege: 'Rueil-Malmaison', source: 'https://www.arval.fr/remarketing' },
  canaux: [{ type: 'plateforme_b2b', nom: 'Arval Remarketing', url: 'https://www.arval.fr/remarketing', detail: 'Plateforme de vente aux professionnels.' }],
  personnes: [{ nom: 'Sophie Roux', fonction: 'Directrice remarketing', perimetre: 'pays', email: 'sophie.roux@arval.fr', telephone: null, linkedin: SOPHIE, source: 'https://www.arval.fr/remarketing' }],
  emails: [{ email: 'sophie.roux@arval.fr', nature: 'nominatif', source: 'https://www.arval.fr/remarketing' }],
  telephones: [],
  meilleur_contact: { nom: 'Sophie Roux', fonction: 'Directrice remarketing', email: 'sophie.roux@arval.fr', telephone: null, linkedin: SOPHIE, pourquoi: 'Elle dirige la revente des fins de contrat.' },
  pistes: ['S\'inscrire comme acheteur professionnel sur Arval Remarketing.'],
  resume: 'Arval France, filiale de BNP Paribas, revend ses fins de contrat aux professionnels.',
};
const calls: Array<{ model: string; system: string; user: string; tools?: Array<{ name: string; max_uses?: number }> }> = [];
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!(req.url?.startsWith('/v1/messages') && req.method === 'POST')) { res.writeHead(404); res.end(); return; }
  let raw = '';
  for await (const ch of req) raw += ch;
  const body = JSON.parse(raw) as { model: string; system: Array<{ text: string }>; messages: Array<{ content: unknown }>; tools?: Array<{ name: string; max_uses?: number }> };
  const system = body.system?.[0]?.text ?? '';
  const user = String(body.messages[0].content);
  calls.push({ model: body.model, system, user, tools: body.tools });
  const usage = { input_tokens: 30_000, output_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: body.tools ? 6 : 0, web_fetch_requests: body.tools ? 2 : 0 } };
  const reply = (content: unknown[]) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content, stop_reason: 'end_turn', stop_sequence: null, usage })); };
  const results = (urls: string[]) => [
    { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'x' } },
    { type: 'web_search_tool_result', tool_use_id: 'srv1', content: urls.map((url) => ({ type: 'web_search_result', url, title: url, encrypted_content: 'x', page_age: null })) },
  ];
  if (/aller plus loin/.test(system)) {
    if (user.includes('TECHNIC AUTO FORBACH')) return reply([...results(seenUrls), { type: 'text', text: JSON.stringify(hessOut) }]);
    if (user.includes('Arval France')) return reply([...results(['https://www.arval.fr/remarketing', SOPHIE]), { type: 'text', text: JSON.stringify(arvalOut) }]);
    return reply([{ type: 'text', text: JSON.stringify({ ...hessOut, proprietaire: { groupe: null, site_officiel: null, nb_sites: null, siege: null, source: null }, canaux: [], personnes: [], emails: [], telephones: [], meilleur_contact: { nom: null, fonction: null, email: null, telephone: null, linkedin: null, pourquoi: 'rien' }, pistes: [], resume: '' }) }]);
  }
  return reply([{ type: 'text', text: JSON.stringify(keyOut) }]);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = base;
// Faux internet : les pages que la recherche cite, relues par ADA.
const realFetch = globalThis.fetch;
const pad = (t: string) => `<html><body>${t} ${'Le groupe, ses marques et ses sites. '.repeat(40)}</body></html>`;
const pages: Record<string, string> = {
  'https://www.groupehess.com/equipe': pad('Marc Hess, directeur VO du groupe : <a href="mailto:m.hess@groupehess.com">m.hess@groupehess.com</a>. Standard du groupe : 03 87 00 00 00. Julie Martin, ventes aux marchands.'),
  'https://www.groupehess.com/marchands': pad('Espace marchands : nos VO pour les professionnels.'),
  'https://www.arval.fr/remarketing': pad('Arval Remarketing — Sophie Roux, directrice remarketing : sophie.roux@arval.fr'),
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  if (pages[u]) return new Response(pages[u], { headers: { 'content-type': 'text/html' } });
  if (u.startsWith(base)) return realFetch(input, init);
  return new Response('introuvable', { status: 404 });
}) as typeof fetch;
(dns as unknown as { resolveMx: (d: string) => Promise<unknown[]> }).resolveMx = async (d: string) => (['groupehess.com', 'arval.fr'].includes(d) ? [{ exchange: `mx.${d}`, priority: 10 }] : []);

const dana = {
  agent: 'dana', display_name: 'Dana', mailbox: 'dana@mc-export.com', signature: 'Dana\nMC Export — achats', daily_budget_usd: 3, map_auto_add: true, map_min_score: 70,
  targets: { minLot: 3, markets: ['NL', 'DK', 'BE', 'DE'], brands: ['Toyota'] }, instructions: '', daily_first_contact_cap: 10, auto_qualify_per_day: 20, auto_draft_per_day: 5,
};
const prospect = (id: string, o: Partial<DeepProspect> & Row): Row => ({
  id, agent: 'dana', dealer_id: null, stage: 'qualifie', language: 'fr', network_contact_id: null, qualified_at: daysAgo(1), qualify_cost_usd: 0.01, ...bare, ...o,
});
const db: FakeDb = {
  agent_settings: [dana as unknown as Row],
  agent_prospects: [
    prospect('p-hess', {}),
    prospect('p-arval', {
      name: 'Arval France', city: 'Rueil-Malmaison', kind: 'loueur_ou_leasing', group_name: null, sites: null, website: 'https://www.arval.fr/', phone: null, account_id: 'acc-arval', lots: [],
      people: [{ nom: 'Sophie Roux', fonction: 'directrice remarketing', email: null, source: 'résultat', linkedin: SOPHIE }],
      best_contact: { nom: 'Sophie Roux', fonction: 'directrice remarketing', email: null, linkedin: SOPHIE, pourquoi: 'Elle revend les fins de contrat.' },
      evidence: [], fit_score: 69, score: 79, fit_parts: [{ label: 'sociétés de leasing', points: 40 }, { label: 'en France (notre pays d\'achat)', points: 10 }, { label: 'taille', points: 10 }, { label: 'interlocuteur nommé', points: 4 }, { label: 'profil LinkedIn vu', points: 5 }],
    }),
    prospect('p-kinto', { name: 'KINTO France', score: 67, group_name: null, evidence: [] }),
    prospect('p-panne', { name: 'Fast Lease', score: 60, group_name: null, evidence: [] }),
    prospect('p-mois', { name: 'Déjà vue ce mois', score: 90, group_name: null }),
    prospect('p-petit', { name: 'Petit garage', key_account: false, score: 95, group_name: null }),
    prospect('p-ada', { agent: 'ada', name: 'Groupe Ada', score: 99, group_name: null }),
  ],
  agent_accounts: [{ id: 'acc-arval', agent: 'dana', segment: 'leasing', size_hint: 'flotte de 120 000 véhicules', why: null }],
  agent_threads: [{ id: 'th-arval', agent: 'dana', mailbox: 'dana@mc-export.com', prospect_id: 'p-arval', subject: 'Arval France', counterpart_email: null }],
  agent_messages: [{ id: 'm-arval-li', thread_id: 'th-arval', agent: 'dana', channel: 'linkedin', direction: 'out', status: 'pour_channing', kind: 'premier_contact', to_emails: [], body_text: 'Bonjour Sophie…' }],
  agent_tasks: [
    { id: 'td-mois', agent: 'dana', kind: 'qualification', status: 'terminee', params: { prospect_ids: ['p-mois'], approfondie: true }, created_by: null, created_at: daysAgo(10) },
    { id: 'td-panne', agent: 'dana', kind: 'qualification', status: 'echec', params: { prospect_ids: ['p-panne'], approfondie: true, auto: true }, created_by: null, created_at: daysAgo(0.01) },
  ],
  agent_journal: [], agent_runs: [], email_suppressions: [], network_contacts: [], market_dealers: [], market_dealer_listings: [], intra_showcase: [],
};
setSharedSupabase(fakeSupabase(db) as never);
const { runNextTask, autoDeep } = await import('../worker/agents/tasks');
const { keepDeep } = await import('../worker/agents/qualify');

// 1. À la main : Dana approfondit Technic Auto Forbach, puis prépare le grand compte pour Channing.
db.agent_tasks.push({ id: 'tp1', agent: 'dana', kind: 'qualification', status: 'en_attente', params: { prospect_ids: ['p-hess'], approfondie: true }, created_by: 'channing', created_at: new Date().toISOString() });
await runNextTask();
const hess = db.agent_prospects.find((p) => p.id === 'p-hess') as Row & DeepProspect;
const c1 = calls[0];
ok(c1?.model === HAIKU && /aller plus loin/.test(c1.system) && c1.tools?.find((t) => t.name === 'web_search')?.max_uses === 8 && c1.tools?.find((t) => t.name === 'web_fetch')?.max_uses === 5 && c1.user.includes('groupe déjà repéré : Hess Automobile'),
  'appel : Haiku 5.5, consigne approfondie, 8 recherches et 5 pages, la fiche telle qu\'elle est', c1 && { model: c1.model, tools: c1.tools });
ok(hess.best_contact?.nom === 'Marc Hess' && hess.best_contact?.email === 'm.hess@groupehess.com' && hess.emails.length === 1 && hess.emails[0].mx && hess.score === 37,
  'fiche : le directeur VO du groupe, son e-mail relu dans la page (domaine qui reçoit), note 37', { best: hess.best_contact, emails: hess.emails, score: hess.score });
const th = db.agent_threads.find((t) => t.prospect_id === 'p-hess') as Row | undefined;
const ms = db.agent_messages.filter((m) => m.thread_id === th?.id);
ok(calls[1]?.model === OPUS && /GRAND COMPTE/.test(calls[1]?.system ?? '') && ms.length === 2 && ms.every((m) => m.status === 'pour_channing') && ms.some((m) => m.channel === 'mail' && (m.to_emails as string[]).join() === 'm.hess@groupehess.com'),
  'lancée à la main : le grand compte est préparé pour Channing, le mail au directeur VO trouvé', ms.map((m) => [m.channel, m.status, m.to_emails]));
const tp1 = db.agent_tasks.find((t) => t.id === 'tp1') as Row & { result: { enrichies: number; preparees: number; cout_usd: number; live?: unknown } };
ok(tp1.status === 'terminee' && tp1.result.enrichies === 1 && tp1.result.preparees === 1 && !tp1.result.live
  && db.agent_journal.some((j) => j.kind === 'recherche_approfondie' && /^TECHNIC AUTO FORBACH : recherche approfondie, 2 personnes, 1 e-mail vérifié/.test(String(j.summary)))
  && db.agent_journal.some((j) => j.kind === 'recherche_approfondie_serie' && /^Recherche approfondie de 1 fiche : 1 complétée, 1 préparée pour vous — /.test(String(j.summary))),
  'tâche terminée, journal : ce qui a été trouvé, la série', { status: tp1.status, result: tp1.result, journal: db.agent_journal.map((j) => j.summary) });

// 2. Refaire la fiche ne perd pas la recherche approfondie.
const contacts = [{ nom: 'Paul Roth', fonction: 'vendeur', email: null, source: 'fiche AutoScout24', linkedin: null }];
const emails: Array<{ email: string; nature: string; source: string; mx: boolean }> = [];
const evidence: Array<{ url: string; note: string }> = [{ url: 'http://www.groupehess.com/', note: 'site du garage' }];
const best = { nom: null as string | null, fonction: null as string | null, email: null as string | null, linkedin: null as string | null, pourquoi: '' };
const kept = keepDeep({ id: 'p-hess', stage: 'qualifie', network_contact_id: null, dealer_id: 'd1', people: hess.people, emails: hess.emails, evidence: hess.evidence, best_contact: hess.best_contact } as never, contacts, emails, evidence, best);
ok(contacts.some((c) => c.nom === 'Marc Hess') && emails.some((e) => e.email === 'm.hess@groupehess.com') && evidence.some((e) => (e as { piste?: boolean }).piste) && best.nom === 'Marc Hess' && kept.hasEmail && kept.keyAccount,
  'refaire la fiche : les personnes, e-mails, pistes et le contact de la recherche approfondie restent', { contacts, best, kept });

// 3. Automatique : Arval, déjà préparé sans e-mail, est repréparé avec l'e-mail trouvé.
db.agent_tasks.push({ id: 'tp2', agent: 'dana', kind: 'qualification', status: 'en_attente', params: { prospect_ids: ['p-arval'], approfondie: true, auto: true }, created_by: null, created_at: new Date().toISOString() });
await runNextTask();
const arval = db.agent_prospects.find((p) => p.id === 'p-arval') as Row & DeepProspect;
const th2 = db.agent_threads.filter((t) => t.prospect_id === 'p-arval') as Row[];
const ms2 = db.agent_messages.filter((m) => m.thread_id === th2[0]?.id);
ok(arval.best_contact?.email === 'sophie.roux@arval.fr' && arval.score === 87 && th2.length === 1 && th2[0].id !== 'th-arval' && !db.agent_messages.some((m) => m.id === 'm-arval-li')
  && ms2.some((m) => m.channel === 'mail' && (m.to_emails as string[]).join() === 'sophie.roux@arval.fr'),
  'grand compte déjà préparé, rien d\'envoyé : repréparé avec l\'e-mail trouvé (note 79 → 87 : e-mail publié +8), le mail ajouté', { best: arval.best_contact, score: arval.score, threads: th2.map((t) => t.id), msgs: ms2.map((m) => m.channel) });

// 4. Le cycle : les grands comptes à compléter, les mieux notés d'abord, une fois par mois ; une recherche en échec est reprise.
// (La base pose « en_attente » à l'insertion ; la base simulée, non.)
const queued = () => { for (const t of db.agent_tasks) if (!t.status) t.status = 'en_attente'; };
await autoDeep({ ...dana } as never);
queued();
const auto = db.agent_tasks.find((t) => !t.created_by && (t.params as { approfondie?: boolean; auto?: boolean }).approfondie && t.status === 'en_attente' && t.id !== 'tp2') as Row & { params: { prospect_ids: string[] } } | undefined;
ok(auto?.params.prospect_ids.join() === 'p-kinto,p-panne', 'cycle : KINTO puis Fast Lease (reprise après une panne) ; ni la fiche faite ce mois-ci, ni un petit compte, ni une fiche d\'Ada, ni les fiches complètes', auto?.params);
const before = db.agent_tasks.length;
await autoDeep({ ...dana } as never);
ok(db.agent_tasks.length === before, 'cycle : une recherche approfondie à la fois');
await runNextTask();
await autoDeep({ ...dana, targets: { ...dana.targets, deepPerDay: 3 } } as never);
ok(db.agent_tasks.length === before, 'cycle : le nombre du jour atteint (3 : Arval, KINTO, Fast Lease), plus rien ce jour-là', db.agent_tasks.length - before);
const kinto = db.agent_prospects.find((p) => p.id === 'p-kinto') as Row & DeepProspect;
ok(kinto.evidence.some((e) => e.note === 'recherche approfondie') && kinto.best_contact?.nom === null && db.agent_journal.some((j) => /^KINTO France : recherche approfondie, rien de plus de sûr$/.test(String(j.summary))),
  'rien trouvé : la fiche garde sa trace (pas de nouvelle recherche avant un mois), le journal le dit', db.agent_journal.map((j) => j.summary));

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

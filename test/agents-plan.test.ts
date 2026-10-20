/**
 * Le plan préparé (20/10, Channing sur Agilauto : « elle me propose un plan d'actions mais n'a pas
 * préparé les mails — elle est censée devenir autonome : qu'elle prépare tout le plan, qu'on n'ait plus
 * qu'à valider »). La fiche suit celle de TEST, personnes et adresses inventées : le contact retenu
 * joignable seulement par l'adresse du SAV, qui traite et qui décide (du groupe) avec une adresse
 * probable, un aiguilleur avec son adresse publiée.
 * La partie pure : les personnes du plan, une note LinkedIn par personne (demandée, relue), l'ancien
 * format (une seule note). Puis le worker, avec un faux serveur Claude, de fausses pages et une base
 * simulée :
 * A. le grand compte préparé en entier : l'aiguillage (à valider), le mail à l'adresse probable de
 *    celle qui traite (marqué : un administrateur seul l'envoie), une note LinkedIn par personne du
 *    plan avec son profil, la fiche d'appel ;
 * B. « Chercher plus loin » trouve l'adresse de celle qui traite : un aiguillage corrigé à la main
 *    n'est pas jeté ; sinon la préparation est refaite — le mail à sa vraie adresse, plus d'aiguillage ;
 * C. un petit compte : la recherche lancée à la main prépare son premier mail, à valider ; lancée
 *    d'office, rien ;
 * D. « Refaire le plan » : la nouvelle préparation d'abord, l'ancienne laisse la place ensuite — rien
 *    de perdu au plafond du jour, rien de refait sur un brouillon corrigé, un message validé entre-temps
 *    reste.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as dns } from 'node:dns';
import { planPeople, keyAccountPrompt, notesOf, checkKeyAccount, KEY_ACCOUNT_SCHEMA, type KeyAccountOutput } from '../src/lib/agents/firstMail';
import { addressKind } from '../src/lib/agents/qualification';
import type { DeepOutput } from '../src/lib/agents/deepResearch';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
type Row = Record<string, unknown>;
type Notes = {
  aiguillage?: { routeur: string | null; cible: string | null }; personne?: string | null; adresse_probable?: string; motif_adresse?: string; alertes?: string[];
  linkedin_url?: string | null; linkedin_recherche?: string | null; texte_initial?: string | null; grand_compte?: boolean; fiche_appel?: unknown;
};
const notesOfRow = (m: Row | undefined) => (m?.ai_notes ?? {}) as Notes;

console.log('\n=== ADA ET DANA : LE PLAN PRÉPARÉ, TOUT PRÊT À VALIDER ===\n');

// --- La fiche ------------------------------------------------------------------------------------
const LI = (slug: string) => `https://www.linkedin.com/in/${slug}`;
const motif = 'même format que jgervais@ca-agilauto.fr (initiale du prénom + nom)';
const agilPeople = (): Row[] => [
  { nom: 'Thierry Fabre', fonction: 'Responsable stratégie remarketing et opérations', niveau: 'autre', email: null, email_probable: 'tfabre@ca-agilauto.fr', motif, linkedin: LI('thierry-fabre-essai'), source: 'https://www.agilauto.fr/actualites' },
  { nom: 'Mathieu Dalmas', fonction: 'Gestionnaire des ventes de véhicules d\'occasion', niveau: 'demarrer', email: null, email_probable: 'mdalmas@ca-agilauto.fr', motif, linkedin: LI('mathieu-dalmas-essai'), source: 'https://www.agilauto.fr/actualites' },
  { nom: 'Antoine Garel', fonction: 'Directeur remarketing du groupe', niveau: 'decider', perimetre: 'groupe', email: null, email_probable: 'agarel@ca-agilauto.fr', motif, linkedin: LI('antoine-garel-essai'), source: 'https://presse.example/nomination' },
  { nom: 'Jean-Marc Bastide', fonction: 'Directeur général', niveau: null, email: null, email_probable: 'jbastide@ca-agilauto.fr', motif, linkedin: LI('jean-marc-bastide-essai'), source: 'https://www.agilauto.fr/actualites' },
  { nom: 'Julien Gervais', fonction: 'Directeur commercial', niveau: 'aiguilleur', perimetre: 'inconnu', email: 'jgervais@ca-agilauto.fr', linkedin: LI('julien-gervais-essai'), source: 'https://www.agilauto.fr/presse', via: 'approfondie' },
  { nom: 'Sophie Guérin', fonction: 'Responsable développement LLD (canal intermédié)', niveau: 'aiguilleur', perimetre: 'inconnu', email: null, email_probable: 'sguerin@ca-agilauto.fr', motif, linkedin: LI('sophie-guerin-essai'), source: 'https://www.agilauto.fr/presse', via: 'approfondie' },
  { nom: 'Agnès de Vernay', fonction: 'Directrice des achats automobiles du groupe', niveau: 'autre', perimetre: 'groupe', email: null, email_probable: 'adevernay@ca-agilauto.fr', motif, linkedin: null, source: 'https://presse.example/achats', via: 'approfondie' },
];
const agilEmails = () => [
  { email: 'sav-agilauto-lld@ca-cf.fr', nature: 'autre', source: 'https://www.agilauto.fr/contact', mx: true },
  { email: 'jgervais@ca-agilauto.fr', nature: 'nominatif', source: 'https://www.agilauto.fr/presse', mx: true },
];
const agilBest = () => ({ nom: 'Thierry Fabre', fonction: 'Responsable stratégie remarketing et opérations', email: 'sav-agilauto-lld@ca-cf.fr', linkedin: LI('thierry-fabre-essai'), pourquoi: 'Il pilote la revente des véhicules restitués.', telephone: null });

// --- Les personnes du plan ------------------------------------------------------------------------
const plan = planPeople(agilPeople() as never, agilBest(), agilEmails(), addressKind);
ok(plan.map((x) => `${x.role}:${x.nom}`).join() === 'demarrer:Mathieu Dalmas,decider:Antoine Garel,retenu:Thierry Fabre',
  'le plan : qui traite, qui décide, le contact retenu — ni l\'aiguilleur (son mail est l\'aiguillage), ni le directeur général', plan.map((x) => `${x.role}:${x.nom}`));
ok(plan.every((x) => x.email === null && !!x.linkedin) && plan[0].probable?.email === 'mdalmas@ca-agilauto.fr' && plan[2].probable?.email === 'tfabre@ca-agilauto.fr' && plan[1].groupe && !plan[0].groupe && !plan[2].groupe,
  'chacun : pas d\'adresse à lui (celle du SAV n\'est pas la sienne), son adresse probable, son profil ; le directeur du groupe marqué', plan);
const withOwn = planPeople(agilPeople().map((x) => (x.nom === 'Thierry Fabre' ? { ...x, email: 'tfabre@ca-agilauto.fr' } : x)) as never, agilBest(),
  [...agilEmails(), { email: 'tfabre@ca-agilauto.fr', nature: 'nominatif', source: 'https://www.agilauto.fr/actualites', mx: true }], addressKind);
ok(withOwn.find((x) => x.role === 'retenu')?.email === 'tfabre@ca-agilauto.fr' && withOwn.find((x) => x.role === 'retenu')?.probable === null,
  'le contact retenu, noté avec l\'adresse du SAV : son adresse à lui, publiée et vérifiée, sert', withOwn);
const knownPlan = planPeople(agilPeople().map((x) => (x.nom === 'Mathieu Dalmas' ? { ...x, connu: true } : x.nom === 'Antoine Garel' ? { ...x, email: 'jgervais@ca-agilauto.fr' } : x)) as never, agilBest(), agilEmails(), addressKind);
ok(knownPlan.map((x) => x.nom).join() === 'Antoine Garel,Thierry Fabre' && knownPlan[0].email === null && knownPlan[0].probable?.email === 'agarel@ca-agilauto.fr',
  'jamais une personne que l\'équipe connaît ; l\'adresse d\'un collègue n\'est pas la sienne', knownPlan);

// --- Les notes LinkedIn demandées, relues --------------------------------------------------------
const base = 'Écris le premier mail en français.\nEntreprise : Agilauto';
const kl = keyAccountPrompt(base, [{ nom: 'Thierry Fabre', fonction: 'Responsable stratégie remarketing et opérations', linkedin: LI('thierry-fabre-essai') }], plan.map((x) => ({ nom: x.nom, fonction: x.fonction, role: x.role }))).split('\n');
ok(kl[0] === 'Prépare la prise de contact de Channing en français : le mail, les notes d\'invitation LinkedIn, et la fiche d\'appel en français.'
  && kl.includes('Notes LinkedIn à écrire (une par ligne, dans cet ordre) :')
  && kl.includes('- Mathieu Dalmas, Gestionnaire des ventes de véhicules d\'occasion — pour démarrer : celle qui traite au quotidien')
  && kl.includes('- Antoine Garel, Directeur remarketing du groupe — pour décider')
  && kl.includes('- Thierry Fabre, Responsable stratégie remarketing et opérations — le contact retenu'),
'consigne : une note par personne du plan, dans l\'ordre, avec son rôle', kl);
ok(keyAccountPrompt(base, [], []).includes('- une seule, pour la personne qui décide de ces sujets (son nom n\'est pas connu : la note ne nomme personne)'), 'sans personne nommée : une seule note, qui ne nomme personne');
ok((KEY_ACCOUNT_SCHEMA.required as readonly string[]).includes('notes_linkedin') && !(KEY_ACCOUNT_SCHEMA.required as readonly string[]).includes('linkedin'), 'schéma : les notes (plus la note unique)');
ok(JSON.stringify(notesOf({ notes_linkedin: [{ nom: ' Mathieu Dalmas ', note: ' Bonjour Mathieu ' }, { nom: 'Vide', note: '  ' }] })) === JSON.stringify([{ nom: 'Mathieu Dalmas', note: 'Bonjour Mathieu' }])
  && JSON.stringify(notesOf({ notes_linkedin: undefined as never, linkedin: 'Bonjour' }, 'Thierry Fabre')) === JSON.stringify([{ nom: 'Thierry Fabre', note: 'Bonjour' }]) && notesOf({ notes_linkedin: [] }).length === 0,
'les notes : une note vide écartée ; une préparation d\'avant le 20/10 (une seule note) reste lue');
const sheet = { interlocuteur: 'Mathieu Dalmas', pourquoi: 'Il traite au quotidien.', accroche: 'Nous reprenons vos véhicules restitués en lots.', points: ['Enlèvement en une fois'], questions: ['Qui reçoit les listes ?'] };
const mailOk = { objet: 'Vos véhicules restitués', corps: 'Bonjour Monsieur Dalmas,\n\nMC Export reprend vos véhicules d\'occasion récents en lots, enlevés en une fois : une solution simple pour les restitutions. Qui suit ces sujets chez vous ? Si ce n\'est pas pour vous, dites-le-moi.', traduction_fr: null, faits: [] };
const kc = checkKeyAccount({ ...mailOk, fiche_appel: sheet, notes_linkedin: [
  { nom: 'Mathieu Dalmas', note: 'Bonjour Mathieu, je reprends des véhicules récents en lots : est-ce vous qui recevez ces sujets ?' },
  { nom: 'Antoine Garel', note: 'Bonjour Antoine, nos prix de reprise vous intéresseront : www.mc-export.com' },
  { nom: 'Thierry Fabre', note: `Bonjour Thierry, ${'nous reprenons des lots entiers. '.repeat(10)}` },
] } as KeyAccountOutput, 'matériel', 'dana');
ok(kc.warnings.includes('Note LinkedIn (Antoine Garel) : parle de prix (Dana n\'en cite jamais).') && kc.warnings.includes('Note LinkedIn (Antoine Garel) avec un lien : LinkedIn la refuse souvent.')
  && kc.warnings.some((w) => /^Note LinkedIn \(Thierry Fabre\) trop longue \(\d+ caractères, 300 au plus\)\.$/.test(w)) && !kc.warnings.some((w) => w.includes('Mathieu Dalmas')),
'contrôle : chaque note relue, l\'alerte dit laquelle', kc.warnings);

// --- Le worker -------------------------------------------------------------------------------------
const deepAgil: DeepOutput = {
  proprietaire: { groupe: null, site_officiel: 'https://www.agilauto.fr/', nb_sites: null, siege: null, source: null },
  canaux: [],
  personnes: [{ nom: 'Mathieu Dalmas', fonction: 'Gestionnaire des ventes de véhicules d\'occasion', niveau: 'demarrer', perimetre: 'inconnu', email: 'mdalmas@ca-agilauto.fr', telephone: null, linkedin: null, source: 'https://www.agilauto.fr/equipe-remarketing', date_source: '2026', confirme_recent: true }],
  emails: [{ email: 'mdalmas@ca-agilauto.fr', nature: 'nominatif', source: 'https://www.agilauto.fr/equipe-remarketing' }],
  telephones: [],
  meilleur_contact: { nom: 'Thierry Fabre', fonction: 'Responsable stratégie remarketing et opérations', niveau: 'autre', email: null, telephone: null, linkedin: null, pourquoi: 'Il pilote la revente des véhicules restitués.' },
  pistes: ['Écrire à Mathieu Dalmas, qui traite les ventes de véhicules d\'occasion aux professionnels.'], resume: 'La location longue durée du groupe ; les véhicules restitués revendus aux professionnels.',
};
const deepNegoce: DeepOutput = {
  proprietaire: { groupe: null, site_officiel: 'https://www.negoce-atlantique.fr/', nb_sites: 1, siege: 'Nantes', source: 'https://www.negoce-atlantique.fr/' },
  canaux: [],
  personnes: [{ nom: 'Claire Martin', fonction: 'Responsable des ventes aux professionnels', niveau: 'demarrer', perimetre: 'inconnu', email: 'c.martin@negoce-atlantique.fr', telephone: null, linkedin: null, source: 'https://www.negoce-atlantique.fr/equipe', date_source: '2026', confirme_recent: true }],
  emails: [{ email: 'c.martin@negoce-atlantique.fr', nature: 'nominatif', source: 'https://www.negoce-atlantique.fr/equipe' }],
  telephones: [],
  meilleur_contact: { nom: 'Claire Martin', fonction: 'Responsable des ventes aux professionnels', niveau: 'demarrer', email: 'c.martin@negoce-atlantique.fr', telephone: null, linkedin: null, pourquoi: 'Elle vend aux professionnels.' },
  pistes: [], resume: 'Négociant de véhicules récents pour les professionnels.',
};
const empty: DeepOutput = { proprietaire: { groupe: null, site_officiel: null, nb_sites: null, siege: null, source: null }, canaux: [], personnes: [], emails: [], telephones: [], meilleur_contact: { nom: null, fonction: null, email: null, telephone: null, linkedin: null, pourquoi: '' }, pistes: [], resume: '' };

/** La préparation d'un grand compte : une note par ligne demandée — la première avec le nom écrit autrement (« M. Dalmas »). */
const keyOut = (user: string): KeyAccountOutput => {
  const lines: string[] = [];
  const i = user.indexOf('Notes LinkedIn à écrire');
  if (i >= 0) for (const l of user.slice(i).split('\n').slice(1)) { if (!l.startsWith('- ')) break; lines.push(l.slice(2)); }
  const names = lines.map((l) => (l.startsWith('une seule') ? 'Responsable remarketing' : l.split(/, | — /)[0]));
  const to = /Personne : ([^,\n]+)/.exec(user)?.[1] ?? '';
  return {
    objet: 'Vos véhicules restitués',
    corps: `Bonjour Monsieur ${to.split(' ').pop()},\n\nMC Export reprend vos véhicules d'occasion récents en lots, enlevés en une fois et réglés par virement : une solution simple pour les restitutions. Qui suit ces sujets chez vous ? Si ce n'est pas pour vous, dites-le-moi.`,
    notes_linkedin: names.map((n) => ({ nom: n === 'Mathieu Dalmas' ? 'M. Dalmas' : n, note: `Bonjour ${n.split(' ')[0]}, MC Export reprend des véhicules d'occasion récents en lots. Ravi d'échanger avec vous sur ces sujets.` })),
    fiche_appel: { ...sheet, interlocuteur: to },
    traduction_fr: null, faits: [],
  };
};
const calls: Array<{ system: string; user: string }> = [];
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!(req.url?.startsWith('/v1/messages') && req.method === 'POST')) { res.writeHead(404); res.end(); return; }
  let raw = '';
  for await (const ch of req) raw += ch;
  const body = JSON.parse(raw) as { model: string; system: Array<{ text: string }>; messages: Array<{ content: unknown }> };
  const system = body.system?.[0]?.text ?? '';
  const user = String(body.messages[0].content);
  calls.push({ system, user });
  let out: unknown;
  if (/aller plus loin/.test(system)) out = user.includes('Agilauto') ? deepAgil : user.includes('Négoce Atlantique') ? deepNegoce : empty;
  else if (/MAIL D'AIGUILLAGE/.test(system)) out = { objet: 'Votre interlocuteur pour le remarketing ?', corps: 'Bonjour Monsieur Gervais,\n\nJe cherche la personne qui revend vos véhicules restitués aux professionnels : pourriez-vous me donner son contact direct ?\n\nMerci beaucoup.', traduction_fr: null };
  else if (/GRAND COMPTE/.test(system)) out = keyOut(user);
  else if (/PREMIER mail/.test(system)) out = { objet: 'Vos véhicules récents', corps: 'Bonjour Madame Martin,\n\nMC Export achète des véhicules d\'occasion récents en lots, enlevés en une fois et réglés par virement. Seriez-vous ouverte à une offre pour vos prochains lots ? Si ce n\'est pas pour vous, dites-le-moi.', traduction_fr: null, faits: [] };
  else out = {};
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = baseUrl;
const realFetch = globalThis.fetch;
const pad = (t: string) => `<html><body>${t} ${'Nos offres de location et nos véhicules. '.repeat(40)}</body></html>`;
const pages: Record<string, string> = {
  'https://www.agilauto.fr/equipe-remarketing': pad('Mathieu Dalmas, ventes de véhicules d\'occasion aux professionnels : mdalmas@ca-agilauto.fr'),
  'https://www.negoce-atlantique.fr/equipe': pad('Claire Martin, responsable des ventes aux professionnels : c.martin@negoce-atlantique.fr'),
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  if (pages[u]) return new Response(pages[u], { headers: { 'content-type': 'text/html' } });
  if (u.startsWith(baseUrl)) return realFetch(input, init);
  return new Response('introuvable', { status: 404 });
}) as typeof fetch;
(dns as unknown as { resolveMx: (d: string) => Promise<unknown[]> }).resolveMx = async (d: string) => (['ca-agilauto.fr', 'ca-cf.fr', 'negoce-atlantique.fr'].includes(d) ? [{ exchange: `mx.${d}`, priority: 10 }] : []);

const dana = { agent: 'dana', display_name: 'Dana', mailbox: 'dana@mc-export.com', signature: 'Dana\nMC Export', daily_budget_usd: 5, instructions: '', targets: { minLot: 3 }, auto_draft_per_day: 5, daily_first_contact_cap: 10, map_min_score: 70 };
const agil = (): Row => ({
  id: 'p-agil', agent: 'dana', name: 'Agilauto', country: 'FR', city: null, website: 'https://www.agilauto.fr/', phone: null, kind: 'loueur_ou_leasing', group_name: null, sites: null,
  summary: 'La location longue durée du groupe ; revend aux professionnels les véhicules restitués.', key_account: true, account_id: 'acc-agil', stage: 'a_contacter', score: 82, fit_score: 70, fit_parts: [],
  language: 'fr', network_contact_id: null, dealer_id: null, lots: [], emails: agilEmails(), people: agilPeople(), best_contact: agilBest(), evidence: [],
});
const negoce = (id: string, name: string): Row => ({
  id, agent: 'dana', name, country: 'FR', city: 'Nantes', website: 'https://www.negoce-atlantique.fr/', phone: null, kind: 'negociant_vo', group_name: null, sites: null,
  summary: 'Négociant de véhicules récents pour les professionnels.', key_account: false, account_id: 'acc-negoce', stage: 'qualifie', score: 70, fit_score: 60, fit_parts: [],
  language: 'fr', network_contact_id: null, dealer_id: null, lots: [], emails: [], people: [], best_contact: null, evidence: [],
});
const db: FakeDb = {
  agent_settings: [dana as unknown as Row],
  network_contacts: [], contacts: [], transactions_admin: [], supplier_offers: [],
  agent_accounts: [
    { id: 'acc-agil', agent: 'dana', segment: 'leasing', size_hint: null, why: 'La location longue durée d\'un grand groupe bancaire.' },
    { id: 'acc-negoce', agent: 'dana', segment: 'negociant_b2b', size_hint: null, why: 'Un négociant B2B.' },
  ],
  agent_prospects: [agil(), negoce('p-negoce', 'Négoce Atlantique VO'), negoce('p-negoce2', 'Négoce Atlantique Sud')],
  agent_threads: [], agent_messages: [], agent_tasks: [], agent_journal: [], agent_runs: [], email_suppressions: [], agent_lessons: [], profiles: [{ id: 'u-channing', is_admin: true }],
  market_dealers: [], market_dealer_listings: [], intra_showcase: [],
};
setSharedSupabase(fakeSupabase(db) as never);
const { draftFirstMail } = await import('../worker/agents/firstMail');
const { deepResearch } = await import('../worker/agents/deep');
const inThread = (id: string | undefined) => db.agent_messages.filter((m) => m.thread_id === id);

// A. Agilauto : tout le plan préparé.
const a = await draftFirstMail('p-agil', dana as never, null);
// Deux conversations : l'aiguillage (à Julien Gervais) dans son fil, le mail (à Mathieu Dalmas) et les notes dans un autre.
const threadsA = db.agent_threads.filter((t) => t.prospect_id === 'p-agil') as Array<Row & { id: string }>;
const msgsA = threadsA.flatMap((t) => inThread(t.id));
const routingA = msgsA.find((m) => notesOfRow(m).aiguillage);
const mailA = msgsA.find((m) => m.channel === 'mail' && m.status === 'pour_channing');
const notesA = msgsA.filter((m) => m.channel === 'linkedin');
ok(a.status === 'redige' && routingA?.status === 'a_valider' && (routingA.to_emails as string[]).join() === 'jgervais@ca-agilauto.fr' && notesOfRow(routingA).aiguillage?.routeur === 'Julien Gervais'
  && notesOfRow(routingA).aiguillage?.cible === 'Thierry Fabre — Responsable stratégie remarketing et opérations' && String(routingA.body_text).endsWith('Dana\nMC Export'),
'A. l\'aiguillage : à Julien Gervais (son adresse publiée), pour joindre le contact retenu — à valider', routingA && { to: routingA.to_emails, notes: notesOfRow(routingA).aiguillage });
ok(!!mailA && (mailA.to_emails as string[]).join() === 'mdalmas@ca-agilauto.fr' && notesOfRow(mailA).personne === 'Mathieu Dalmas' && notesOfRow(mailA).adresse_probable === 'mdalmas@ca-agilauto.fr'
  && notesOfRow(mailA).motif_adresse === motif && /seul un administrateur l'envoie/.test(notesOfRow(mailA).alertes?.[0] ?? '') && notesOfRow(mailA).grand_compte === true && !!notesOfRow(mailA).fiche_appel
  && String(mailA.body_text).startsWith('Bonjour Monsieur Dalmas') && !String(mailA.body_text).includes('Dana\nMC Export'),
'A. le mail : à celle qui traite (Mathieu Dalmas), à son adresse probable — marqué, un administrateur seul l\'envoie ; pas au directeur du groupe (agarel@ : le format est celui de la filiale)', mailA && { to: mailA.to_emails, notes: notesOfRow(mailA) });
ok(notesA.map((m) => notesOfRow(m).personne).join() === 'Mathieu Dalmas,Antoine Garel,Thierry Fabre'
  && notesA.map((m) => notesOfRow(m).linkedin_url).join() === [LI('mathieu-dalmas-essai'), LI('antoine-garel-essai'), LI('thierry-fabre-essai')].join()
  && notesA.every((m) => m.status === 'pour_channing' && !notesOfRow(m).linkedin_recherche && notesOfRow(m).texte_initial === m.body_text && String(m.body_text).length <= 300),
'A. une note LinkedIn par personne du plan, avec son profil (« M. Dalmas » rattaché par son rang) ; son texte d\'origine est la note', notesA.map((m) => ({ p: notesOfRow(m).personne, url: notesOfRow(m).linkedin_url })));
const keyCall = calls.find((c) => /GRAND COMPTE/.test(c.system));
ok(!!keyCall && keyCall.user.includes('Personne : Mathieu Dalmas, Gestionnaire des ventes de véhicules d\'occasion') && keyCall.user.includes('Adresse : mdalmas@ca-agilauto.fr — la sienne : salue-la par son nom.')
  && keyCall.user.includes('- Antoine Garel, Directeur remarketing du groupe — pour décider') && /tout le plan d'approche, prêt à valider/.test(keyCall.system),
'A. la consigne : le mail pour Mathieu Dalmas, et les notes à écrire', keyCall?.user.split('\n').filter((l) => /^(Personne|Adresse|- )/.test(l)));
const jA = db.agent_journal.find((j) => j.kind === 'aiguillage');
ok(/^Grand compte Agilauto \(FR\) préparé pour vous : aiguillage à Julien Gervais \(Directeur commercial\), mail à Mathieu Dalmas \(mdalmas@ca-agilauto\.fr, adresse probable\), 3 notes LinkedIn \(Mathieu Dalmas, Antoine Garel, Thierry Fabre\), fiche d'appel/.test(String(jA?.summary))
  && (db.agent_threads.find((t) => t.id === a.threadId) as Row).counterpart_email === 'jgervais@ca-agilauto.fr',
'A. le journal dit tout ce qui est prêt', jA?.summary);
const planThread = threadsA.find((t) => t.id === mailA?.thread_id);
ok(threadsA.length === 2 && inThread(a.threadId).length === 1 && routingA?.thread_id === a.threadId && planThread?.counterpart_email === 'mdalmas@ca-agilauto.fr'
  && planThread.subject === 'Vos véhicules restitués' && mailA?.subject === 'Vos véhicules restitués' && notesA.every((m) => m.thread_id === planThread.id),
'A. deux conversations : l\'aiguillage dans son fil ; le mail à Mathieu Dalmas, avec son propre objet, et les notes dans un autre (envoyé dans le fil de l\'aiguillage, il partirait en réponse au mail à Julien Gervais)',
threadsA.map((t) => ({ to: t.counterpart_email, subject: t.subject, n: inThread(t.id).length })));

// B. « Chercher plus loin » trouve l'adresse de Mathieu Dalmas.
const routingBody = String(routingA?.body_text);
routingA!.body_text = 'Bonjour Julien,\n\nÀ qui dois-je m\'adresser pour reprendre vos véhicules restitués ? Merci d\'avance.\n\nDana\nMC Export';
const b1 = await deepResearch('p-agil', dana as never, null, true);
const pAfter = db.agent_prospects.find((p) => p.id === 'p-agil') as Row & { people: Row[]; best_contact: Row };
const allA = () => threadsA.flatMap((t) => inThread(t.id));
ok(b1.status === 'enrichi' && !b1.prepared && allA().length === 5 && threadsA.every((t) => db.agent_threads.includes(t)) && String(allA().find((m) => m.id === routingA!.id)?.body_text).startsWith('Bonjour Julien,'),
  'B. l\'aiguillage corrigé à la main : la préparation n\'est pas refaite (la correction n\'est pas jetée)', { prepared: b1.prepared, messages: allA().length });
ok(pAfter.people.find((x) => x.nom === 'Mathieu Dalmas')?.email === 'mdalmas@ca-agilauto.fr' && pAfter.best_contact.nom === 'Mathieu Dalmas',
  'B. la fiche : son adresse vérifiée (la page, le domaine) ; joignable directement, il devient le contact retenu', pAfter.best_contact);
// Sans la correction : la fiche d'avant la recherche, l'aiguillage tel que Dana l'a écrit.
const pa = db.agent_prospects.find((p) => p.id === 'p-agil') as Row;
for (const k of Object.keys(pa)) delete pa[k];
Object.assign(pa, agil());
routingA!.body_text = routingBody;
const b2 = await deepResearch('p-agil', dana as never, null, true);
const threadB = db.agent_threads.find((t) => t.prospect_id === 'p-agil') as Row | undefined;
const msgsB = inThread(threadB?.id as string | undefined);
const mailB = msgsB.find((m) => m.channel === 'mail');
ok(b2.prepared && !threadsA.some((t) => db.agent_threads.includes(t)) && allA().length === 0 && db.agent_threads.filter((t) => t.prospect_id === 'p-agil').length === 1,
  'B. rien d\'envoyé, rien de corrigé : la préparation d\'avant laisse la place (ses deux fils, l\'aiguillage à valider compris)', { prepared: b2.prepared, old: allA().length });
ok(!!mailB && mailB.status === 'pour_channing' && (mailB.to_emails as string[]).join() === 'mdalmas@ca-agilauto.fr' && !notesOfRow(mailB).adresse_probable && notesOfRow(mailB).personne === 'Mathieu Dalmas'
  && !msgsB.some((m) => m.status === 'a_valider') && threadB?.counterpart_email === 'mdalmas@ca-agilauto.fr',
'B. la nouvelle préparation : le mail à sa vraie adresse — plus d\'adresse probable, plus d\'aiguillage', msgsB.map((m) => ({ s: m.status, c: m.channel, to: m.to_emails, p: notesOfRow(m).personne })));
ok(msgsB.filter((m) => m.channel === 'linkedin').map((m) => notesOfRow(m).personne).join() === 'Mathieu Dalmas,Antoine Garel'
  && /^Grand compte Agilauto \(FR\) préparé pour vous : mail à Mathieu Dalmas \(mdalmas@ca-agilauto\.fr\), 2 notes LinkedIn \(Mathieu Dalmas, Antoine Garel\), fiche d'appel/.test(String(db.agent_journal.find((j) => j.kind === 'grand_compte')?.summary)),
'B. une note pour qui traite et pour qui décide ; le journal', db.agent_journal.find((j) => j.kind === 'grand_compte')?.summary);

// C. Un petit compte : la recherche lancée à la main prépare son premier mail ; lancée d'office, rien.
const c1 = await deepResearch('p-negoce', dana as never, null, true);
const mailC = db.agent_messages.find((m) => (m.to_emails as string[] | undefined)?.includes('c.martin@negoce-atlantique.fr'));
ok(c1.prepared && mailC?.status === 'a_valider' && mailC.channel === 'mail' && mailC.kind === 'premier_contact' && String(mailC.body_text).endsWith('Dana\nMC Export') && !notesOfRow(mailC).aiguillage
  && db.agent_journal.some((j) => j.kind === 'premier_mail' && /^Premier mail rédigé pour Négoce Atlantique VO \(FR\) → c\.martin@negoce-atlantique\.fr, à valider/.test(String(j.summary))),
'C. un petit compte, recherche lancée à la main : son premier mail à Claire Martin, à valider (signé Dana)', mailC && { s: mailC.status, to: mailC.to_emails });
const c2 = await deepResearch('p-negoce2', dana as never, null, false);
ok(c2.status === 'enrichi' && !c2.prepared && !db.agent_threads.some((t) => t.prospect_id === 'p-negoce2'), 'C. lancée d\'office : la fiche complétée, rien de préparé', { status: c2.status, prepared: c2.prepared });

// D. « Refaire le plan » (la tâche que pose le bouton) : la nouvelle préparation d'abord, l'ancienne laisse la place ensuite.
const { runNextTask } = await import('../worker/agents/tasks');
const { dropPrepared } = await import('../worker/agents/prepared');
const task = (o: Row) => { db.agent_tasks.push({ id: `t${db.agent_tasks.length + 1}`, agent: 'dana', status: 'en_attente', created_by: 'u-channing', created_at: new Date().toISOString(), ...o }); };
type TaskRow = Row & { status: string; error?: string; result?: { rediges?: number; ignores?: number; details?: string[] } };
const lastTask = () => db.agent_tasks[db.agent_tasks.length - 1] as TaskRow;
const agilThreads = () => db.agent_threads.filter((t) => t.prospect_id === 'p-agil').map((t) => t.id as string);
const prevThread = threadB?.id as string;
const settings = db.agent_settings[0] as Row;
settings.daily_budget_usd = 0;
task({ kind: 'premier_mail', params: { prospect_ids: ['p-agil'], refaire: true } });
await runNextTask();
ok(lastTask().status === 'echec' && /plafond du jour/.test(String(lastTask().error)) && agilThreads().join() === prevThread && inThread(prevThread).length === 3,
  'D. le plafond du jour atteint : rien n\'est effacé avant que la nouvelle préparation soit enregistrée — la fiche garde son plan', { status: lastTask().status, error: lastTask().error, threads: agilThreads() });
settings.daily_budget_usd = 5;
const mailPrev = inThread(prevThread).find((m) => m.channel === 'mail') as Row;
const mailText = String(mailPrev.body_text);
mailPrev.body_text = 'Bonjour Monsieur Dalmas,\n\nUn mot de Channing : nous reprenons volontiers vos véhicules restitués, en une fois. Avez-vous un moment cette semaine ?';
task({ kind: 'premier_mail', params: { prospect_ids: ['p-agil'], refaire: true } });
await runNextTask();
ok(lastTask().status === 'terminee' && lastTask().result?.ignores === 1 && /Agilauto : un message est parti, ou un brouillon a été corrigé à la main — rien de refait/.test(String(lastTask().result?.details?.[0]))
  && agilThreads().join() === prevThread && String(mailPrev.body_text).includes('Un mot de Channing'),
'D. un mail corrigé à la main : rien de refait, la correction reste', lastTask().result);
mailPrev.body_text = mailText;
const nCalls = calls.length;
task({ kind: 'premier_mail', params: { prospect_ids: ['p-agil'], refaire: true } });
await runNextTask();
const redone = agilThreads();
const msgsD = inThread(redone[0]);
ok(lastTask().status === 'terminee' && lastTask().result?.rediges === 1 && redone.length === 1 && redone[0] !== prevThread && inThread(prevThread).length === 0
  && msgsD.map((m) => `${m.channel}:${notesOfRow(m).personne}`).join() === 'mail:Mathieu Dalmas,linkedin:Mathieu Dalmas,linkedin:Antoine Garel' && calls.length === nCalls + 1,
'D. sinon : le plan refait avec la fiche telle qu\'elle est (une seule préparation, sans nouvelle recherche), l\'ancien effacé ensuite', msgsD.map((m) => `${m.channel}:${notesOfRow(m).personne}`));
// Entre-temps (le temps que l'IA écrive), quelqu'un valide un message de l'ancienne préparation : il reste.
db.agent_threads.push({ id: 'th-old', agent: 'dana', prospect_id: 'p-agil', subject: 'x' });
db.agent_messages.push({ id: 'm-old', thread_id: 'th-old', agent: 'dana', direction: 'out', channel: 'mail', status: 'valide', author: 'dana', body_text: 'x', ai_notes: { texte_initial: 'x' } });
ok(await dropPrepared(['th-old']) === 0 && db.agent_threads.some((t) => t.id === 'th-old') && db.agent_messages.some((m) => m.id === 'm-old'), 'D. un message validé entre-temps : son fil n\'est pas effacé');

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

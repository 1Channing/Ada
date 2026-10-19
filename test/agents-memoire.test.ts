/**
 * Affûter Ada et Dana (19/10, après le test DMD : Florent Jabouille était sur
 * la carte — « MUSTIÈTE AUTOMOBILES » — et Mustière dans le Workflow ; Dana
 * avait retenu le directeur de la plateforme, joignable par contact@).
 * La partie pure : la mémoire de l'équipe (mots distinctifs, faute de frappe,
 * domaines, pays), l'adresse probable (format prouvé), qui contacter (pour
 * démarrer, pour décider, l'aiguilleur, la fraîcheur), l'aiguillage, les
 * chiffres du prospect, le contact donné, les leçons. Puis le worker, avec un
 * faux serveur Claude, de fausses pages et une base simulée :
 * A. DMD : la recherche approfondie lit ce que l'équipe sait (carte, Workflow),
 *    met Florent sur la fiche, déduit l'adresse probable du directeur ; pas de
 *    premier mail d'office (l'équipe connaît déjà quelqu'un) ;
 * B. un groupe sans adresse directe : un aiguillage au commercial d'un site ;
 *    sa réponse donne le contact → la fiche, puis le vrai premier mail ;
 * C. « Le bon contact est… » : la fiche, et une leçon proposée sans nom ;
 * D. une copie de l'équipe : les contacts appris, la fiche complétée ;
 * E. les brouillons refusés ou corrigés : des leçons proposées ;
 * F. sans la table des leçons (SQL pas collé) : rien d'appelé ni de perdu.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as dns } from 'node:dns';
import { distinctiveTokens, similarNames, editDistance, companyKeys, teamMatchesFor, teamPromptLines, teamPeople, withTeamPeople, teamKnownOf, hostOf, type TeamRecord } from '../src/lib/agents/teamMemory';
import { patternsOf, splitName, provenFormats, probableEmail, withProbableEmails } from '../src/lib/agents/emailPattern';
import { rolesForKind, localTitles, staleSource, methodText, rolesPromptLines, startTitle, linkedinPeopleSearch } from '../src/lib/agents/roles';
import { preferStart, deepSchema, type DeepPerson, type DeepEmail, type DeepOutput } from '../src/lib/agents/deepResearch';
import { pickRouter, routingPrompt, checkRouting, theirFigures, checkFirstMail, routingWanted, DANA_FIRST_MAIL_SYSTEM, FIRST_MAIL_SYSTEM } from '../src/lib/agents/firstMail';
import { givenContact, type ReplyOutput } from '../src/lib/agents/reply';
import { lessonsFor, lessonLines, cleanLesson, lessonPrompt, type Lesson } from '../src/lib/agents/lessons';
import { acceptedAccounts } from '../src/lib/agents/research';
import { addressKind } from '../src/lib/agents/qualification';
import { forwardedSender } from '../worker/agents/copies';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
type Row = Record<string, unknown>;

console.log('\n=== ADA ET DANA : MÉMOIRE DE L\'ÉQUIPE, QUI CONTACTER, AIGUILLAGE, LEÇONS ===\n');

// --- La mémoire de l'équipe ------------------------------------------------------------------
ok(distinctiveTokens('Centre VO@PRO (Groupe DMD – Mustière Automobiles)').join() === 'dmd,mustiere', 'mots distinctifs : ni « centre », ni « groupe », ni « automobiles »', distinctiveTokens('Centre VO@PRO (Groupe DMD – Mustière Automobiles)'));
ok(distinctiveTokens('Toyota Nantes', 'Nantes').length === 0 && distinctiveTokens('Garage Martin SARL').join() === 'martin', 'ni une marque, ni la ville, ni la forme juridique');
ok(editDistance('mustiere', 'mustiete') === 1 && similarNames(['mustiere'], ['mustiete']) && !similarNames(['martin'], ['martel']) && similarNames(['dmd'], ['dmd']),
  'nom proche : la faute de frappe de la carte (une lettre) ; un mot court doit être exact');
ok(hostOf('https://www.groupe-dmd.fr/resultats-voiture-occasion') === 'groupe-dmd.fr' && hostOf('pas un site') === '', 'le site sans www');
const records: TeamRecord[] = [
  { source: 'carte', ref: 'c-dmd', company: 'MUSTIÈTE AUTOMOBILES', country: 'FR', person: 'FLORENT JABOUILLE', role: null, email: 'fjabouille@groupe-dmd.fr', phone: '+33789298712', website: 'https://www.groupe-dmd.fr/resultats-voiture-occasion', relation: 'vendeur sur la carte' },
  { source: 'workflow', ref: 'w-must', company: 'MUSTIÈRE AUTOMOBILES', country: 'FR', person: null, role: null, email: null, phone: null, website: null, relation: 'client : 5 ventes' },
  { source: 'carte', ref: 'c-be', company: 'Mustière Belgique', country: 'BE', person: 'Jan Peeters', role: null, email: 'jan@mustiere.be', phone: null, website: null, relation: 'acheteur sur la carte' },
  { source: 'mail', ref: 'm1', company: null, country: null, person: 'Luc', role: null, email: 'luc@gmail.com', phone: null, website: null, relation: 'a écrit à Dana' },
];
const keysDmd = companyKeys({ name: 'Centre VO@PRO (Groupe DMD – Mustière Automobiles)', website: 'https://www.centrevoapro.com/', emails: ['contact@centrevoapro.com', 'luc@gmail.com'], city: 'Malville', country: 'FR' });
const matches = teamMatchesFor(keysDmd, records);
ok(matches.map((m) => `${m.ref}:${m.why}`).join() === 'c-dmd:nom,w-must:nom', 'DMD : la carte (faute de frappe) et le Workflow, par le nom ; pas la Belgique (autre pays), pas gmail', matches.map((m) => `${m.ref}:${m.why}`));
const byDomain = teamMatchesFor(companyKeys({ name: 'Centre VO@PRO', website: 'https://www.centrevoapro.com/', sites: ['https://www.groupe-dmd.fr/le-groupe-dmd'], country: 'FR' }), records);
ok(byDomain.some((m) => m.ref === 'c-dmd' && m.why === 'domaine'), 'par le domaine : le site du groupe vu par la recherche approfondie suffit', byDomain.map((m) => `${m.ref}:${m.why}`));
const lines = teamPromptLines(matches);
ok(lines[0] === '<ce_que_l_equipe_sait_deja>' && lines.some((l) => l.includes('FLORENT JABOUILLE') && l.includes('fjabouille@groupe-dmd.fr') && l.includes('vendeur sur la carte') && l.includes('nom proche')) && lines.some((l) => l.includes('client : 5 ventes'))
  && /DÉJÀ connus de l'équipe/.test(lines[lines.length - 1]), 'consigne : ce que l\'équipe sait, et quoi en faire', lines);
const known = teamPeople(matches);
ok(known.length === 1 && known[0].nom === 'FLORENT JABOUILLE' && known[0].via === 'carte' && known[0].connu === true, 'les personnes connues : celles qui ont un nom', known);
const merged = withTeamPeople([{ nom: 'Florent Jabouille', fonction: 'commercial', email: null, source: 'https://x' }], known);
ok(merged.length === 1 && merged[0].connu === true && merged[0].email === 'fjabouille@groupe-dmd.fr', 'la même personne une fois, complétée et marquée connue', merged);
ok(teamKnownOf([{ nom: 'A', via: 'carte' }, { nom: 'B', via: 'aiguillage' }, { nom: 'C', via: 'approfondie' }, { nom: 'D', connu: true }]).map((x) => x.nom).join() === 'A,D',
  'connu de l\'équipe : la carte, une personne marquée connue — pas le contact obtenu par un aiguillage, pas une page lue');

// --- L'adresse probable ------------------------------------------------------------------------
ok(patternsOf('FLORENT JABOUILLE', 'fjabouille@groupe-dmd.fr').join() === 'in' && patternsOf('Paul Martin', 'paul.martin@x.fr').join() === 'p.n' && patternsOf('Paul Martin', 'pdupont@x.fr').length === 0,
  'le format d\'une vraie adresse : initiale + nom, prénom.nom ; une adresse qui ne va pas avec le nom ne prouve rien');
ok(JSON.stringify(splitName('DELTEIL Christophe')) === JSON.stringify({ first: ['christophe'], last: ['delteil'] }) && JSON.stringify(splitName('Jean-Pierre de la Tour')) === JSON.stringify({ first: ['jean-pierre'], last: ['de', 'la', 'tour'] }),
  'prénom et nom : « NOM Prénom » reconnu ; un nom composé gardé');
const formats = provenFormats([{ name: 'FLORENT JABOUILLE', email: 'fjabouille@groupe-dmd.fr', source: 'carte' }, { name: 'Service VO', email: 'vo@groupe-dmd.fr', source: 'page' }, { name: 'Luc', email: 'luc@gmail.com', source: 'mail' }]);
ok(formats.length === 1 && formats[0].domain === 'groupe-dmd.fr' && formats[0].pattern === 'in', 'format prouvé : une vraie adresse nominative suffit ; ni une adresse de service, ni gmail', formats);
ok(provenFormats([{ name: 'Paul Martin', email: 'p.martin@x.fr', source: 'page' }, { name: 'Anne Roy', email: 'aroy@x.fr', source: 'page' }]).length === 0, 'deux adresses qui se contredisent : pas de format');
ok(provenFormats([{ name: 'Paul Martin', email: 'paul@x.fr', source: 'page' }]).length === 0 && provenFormats([{ name: 'Paul Martin', email: 'paul@x.fr', source: 'a' }, { name: 'Anne Roy', email: 'anne@x.fr', source: 'b' }])[0]?.pattern === 'p',
  '« prénom seul » : il faut deux adresses pour le prouver');
const prob = probableEmail('Christophe Delteil', formats[0]);
ok(prob?.email === 'cdelteil@groupe-dmd.fr' && prob.motif === 'même format que fjabouille@groupe-dmd.fr (initiale du prénom + nom)', 'adresse probable : cdelteil@groupe-dmd.fr, avec son motif', prob);
const withProb = withProbableEmails([{ nom: 'Christophe Delteil', email: null }, { nom: 'Paul Martin', email: 'pmartin@groupe-dmd.fr' }, { nom: 'Bloqué Nom', email: null }], formats, ['centrevoapro.com', 'groupe-dmd.fr'], (e) => e === 'bnom@groupe-dmd.fr');
ok(withProb[0].email_probable === 'cdelteil@groupe-dmd.fr' && !withProb[1].email_probable && !withProb[2].email_probable && withProbableEmails([{ nom: 'Christophe Delteil', email: null }], formats, ['centrevoapro.com'])[0].email_probable === undefined,
  'seulement sans adresse, seulement sur un domaine de l\'entreprise, jamais une adresse sur « ne plus contacter »', withProb);

// --- Qui contacter --------------------------------------------------------------------------------
ok(/commercial VO marchands/.test(rolesForKind('dana', 'groupe').start) && /directeur VO du groupe/.test(rolesForKind('dana', 'groupe').decide) && /acheteur VO/.test(rolesForKind('ada', null).start),
  'Dana, groupe : pour démarrer le commercial VO marchands, pour décider le directeur VO ; Ada : l\'acheteur VO');
ok(localTitles('dana', 'BE').map((x) => x.lang).join() === 'fr,nl,en' && startTitle('dana', 'DE') === 'Händlerverkauf' && linkedinPeopleSearch('Groupe DMD', 'dana', 'FR').endsWith(encodeURIComponent('commercial VO marchands Groupe DMD')),
  'les intitulés par langue (la Belgique en français et en néerlandais) ; la recherche LinkedIn toute prête');
const oct = new Date('2026-10-19T10:00:00Z');
ok(staleSource('2024', false, oct) && !staleSource('2025', false, oct) && staleSource('mars 2025', false, oct) && !staleSource('mars 2026', false, oct) && !staleSource('2024', true, oct) && !staleSource(null, false, oct) && staleSource('2025-03-10', false, oct),
  'à confirmer : plus d\'un an (au mois près s\'il est écrit), sauf confirmé récemment');
const mt = methodText('dana');
ok(/POUR DÉMARRER/.test(mt) && /POUR DÉCIDER/.test(mt) && /aiguilleur/i.test(mt) && /plus d'un an/.test(mt) && /« équipe » ou « contact » de CHAQUE site/.test(mt), 'la méthode : deux personnes, les pages de chaque site, la fraîcheur, l\'aiguilleur');
ok(rolesPromptLines('dana', rolesForKind('dana', 'groupe'), 'FR')[0].startsWith('Pour démarrer (qui traite au quotidien) : commercial VO marchands'), 'consigne : qui chercher');
const sch = deepSchema('dana') as unknown as { properties: { personnes: { items: { required: string[] } }; meilleur_contact: { required: string[] } } };
ok(sch.properties.personnes.items.required.includes('niveau') && sch.properties.personnes.items.required.includes('date_source') && sch.properties.meilleur_contact.required.includes('niveau'), 'schéma : le niveau et la date de chaque personne');

const mails: DeepEmail[] = [
  { email: 'contact@centrevoapro.com', nature: 'generique', source: 'x', mx: true },
  { email: 'pmartin@groupe-dmd.fr', nature: 'nominatif', source: 'x', mx: true },
  { email: 's.bernard@x.fr', nature: 'nominatif', source: 'x', mx: true },
];
const decider = { nom: 'Christophe Delteil', fonction: 'directeur', email: 'contact@centrevoapro.com', pourquoi: '', niveau: 'decider' as const };
const startPerson: DeepPerson = { nom: 'Sophie Bernard', fonction: 'ventes aux marchands', email: 's.bernard@x.fr', source: 'x', niveau: 'demarrer' };
ok(preferStart(decider, [startPerson], mails)?.nom === 'Sophie Bernard', 'la personne qui traite d\'abord, si elle est joignable directement');
ok(preferStart({ ...decider, email: 's.bernard@x.fr', nom: 'Sophie Bernard' }, [{ ...startPerson, email: null, nom: 'Autre Personne' }], mails)?.nom === 'Sophie Bernard', 'qui décide, joignable directement, reste — « déjà excellent »');
ok(preferStart(decider, [{ ...startPerson, connu: true }], mails)?.nom === 'Christophe Delteil', 'jamais une personne connue de l\'équipe (pas de mail à froid)');
const pm: DeepPerson = { nom: 'Paul Martin', fonction: 'commercial VO, Rezé', email: 'pmartin@groupe-dmd.fr', source: 'x', niveau: 'aiguilleur', perimetre: 'site' };
ok(pickRouter([pm, { nom: 'Christophe Delteil', fonction: 'directeur', email: null, source: 'x', niveau: 'decider' }], mails, decider, addressKind)?.email === 'pmartin@groupe-dmd.fr', 'l\'aiguilleur : un commercial d\'un site, avec son adresse');
ok(pickRouter([], mails.filter((e) => e.nature === 'generique'), decider, addressKind)?.address === 'generique' && pickRouter([], [], decider, addressKind) === null
  && pickRouter([{ ...pm, email: 'contact@centrevoapro.com', nom: 'Christophe Delteil' }], mails.slice(0, 1), decider, addressKind)?.name === null,
  'sinon le service, sinon l\'adresse générale, sinon personne — jamais la personne cherchée elle-même');
const fernau = { nom: 'Andreas Fernau', fonction: 'Geschäftsführer', email: null, source: 'x', niveau: 'decider' as const };
const autexx: DeepEmail[] = [{ email: 's.heitmann@autexx.de', nature: 'nominatif', source: 'x', mx: true }, { email: 'info@autexx.de', nature: 'generique', source: 'x', mx: true }];
const viaColleague = pickRouter([fernau], autexx, fernau, addressKind);
ok(viaColleague?.email === 's.heitmann@autexx.de' && viaColleague.address === 'personne' && viaColleague.name === null
  && routingPrompt({ role: 'dana', company: 'Autexx', country: 'DE', language: 'de', router: viaColleague, target: { name: 'Andreas Fernau', role: 'Geschäftsführer' }, wanted: 'vend aux marchands', instructions: '' }).includes('un collègue, à son adresse (s.heitmann@autexx.de)'),
  'l\'adresse d\'un collègue sans son nom (s.heitmann@ pour Andreas Fernau) : l\'aiguillage passe par elle, plutôt que par info@');

// --- Les mails ---------------------------------------------------------------------------------------
ok(/Droit au but/.test(DANA_FIRST_MAIL_SYSTEM) && /Ne lui récite pas son entreprise ni ses propres chiffres/.test(DANA_FIRST_MAIL_SYSTEM) && !/part d'un FAIT VRAI qui le concerne/.test(DANA_FIRST_MAIL_SYSTEM)
  && /Droit au but/.test(FIRST_MAIL_SYSTEM) && /bonne nouvelle/.test(FIRST_MAIL_SYSTEM), 'les consignes des mails : droit au but, une bonne nouvelle, pas de récitation des chiffres du prospect');
const figs = theirFigures(['Groupe de 53 concessions, 10 900 VO vendus en 2024 ; 3 500 aux marchands.'], ['4 × Toyota C-HR 2021, 45 000 km']);
ok(figs.join() === '10900,3500', 'ses chiffres : ceux de sa fiche, pas l\'année, pas ceux de ses lots', figs);
const recited = checkFirstMail({ objet: 'Vos lots', corps: 'Bonjour,\n\nVos 3 500 VO vendus aux marchands nous intéressent. Nous pouvons reprendre des lots entiers, enlevés en une fois. Seriez-vous ouvert à une offre ? Si ce n\'est pas pour vous, dites-le-moi.', traduction_fr: null, faits: [] }, 'matériel 3 500', figs);
ok(recited.warnings.some((w) => /Récite ses propres chiffres \(3500\)/.test(w)), 'contrôle : un mail qui récite ses chiffres est signalé', recited.warnings);
const rp = routingPrompt({ role: 'dana', company: 'Groupe DMD', country: 'FR', language: 'fr', router: { name: 'Paul Martin', role: 'commercial VO', email: 'pmartin@groupe-dmd.fr', address: 'personne', site: 'Rezé' }, target: { name: null, role: null }, wanted: routingWanted('dana', 'groupe'), instructions: '' });
ok(rp.includes('À qui tu écris : Paul Martin, commercial VO (Rezé) — son adresse') && rp.includes('On cherche : la personne qui vend les véhicules d\'occasion aux marchands (lots, négoce B2B)'), 'aiguillage : à qui on écrit, qui on cherche', rp.split('\n'));
ok(checkRouting({ objet: 'x', corps: 'Bonjour, pouvez-vous me donner son contact ? Nous avons 3 500 véhicules : https://x.fr', traduction_fr: null }, 'dana').warnings.length === 2
  && checkRouting({ objet: 'x', corps: 'Bonjour, pouvez-vous me donner son contact ? Merci.', traduction_fr: null }, 'dana').warnings.length === 0, 'contrôle d\'un aiguillage : ni lien, ni chiffres');
const reply = (c: ReplyOutput['contact_donne']): ReplyOutput => ({ corps: 'Merci', langue: 'fr', traduction_fr: null, resume: '', intention: 'autre', appel: false, alertes: [], faits: [], contact_donne: c });
ok(givenContact(reply({ nom: 'Sophie Bernard', fonction: null, email: 'S.Bernard@x.fr', telephone: null }), 'C\'est Sophie : s.bernard@x.fr')?.email === 's.bernard@x.fr'
  && givenContact(reply({ nom: 'Sophie Bernard', fonction: null, email: 'sophie.bernard@x.fr', telephone: null }), 'C\'est Sophie : s.bernard@x.fr') === null, 'le contact donné : seulement une adresse écrite dans son mail');
ok(forwardedSender('---------- Forwarded message ---------\nDe : Florent Jabouille <fjabouille@groupe-dmd.fr>\nDate : …')?.email === 'fjabouille@groupe-dmd.fr'
  && forwardedSender('De : Channing <channing@mc-export.com>') === null, 'un mail transféré : l\'expéditeur extérieur, jamais l\'équipe');

// --- Les leçons -------------------------------------------------------------------------------------
const L = (o: Partial<Lesson>): Lesson => ({ id: 'l', agent: 'dana', status: 'validee', scope: 'recherche', segment: null, country: null, text: 'x', source: 'manuel', details: null, created_at: '2026-10-19', ...o });
const all = [L({ id: 'a', text: 'Pour tous' }), L({ id: 'b', segment: 'groupe', country: 'FR', text: 'Groupes en France' }), L({ id: 'c', segment: 'leasing', text: 'Leasing' }), L({ id: 'd', scope: 'mail', text: 'Mails' }), L({ id: 'e', status: 'proposee', text: 'Proposée' }), L({ id: 'f', country: 'DE', text: 'Allemagne' })];
ok(lessonsFor(all, 'recherche', { segment: 'groupe', country: 'FR' }).map((l) => l.id).sort().join() === 'a,b' && lessonsFor(all, 'mail', {}).map((l) => l.id).join() === 'd',
  'les leçons qui s\'appliquent : validées, la bonne portée, le bon type, le bon pays');
ok(lessonLines(lessonsFor(all, 'recherche', { segment: 'groupe', country: 'FR' }))[0] === '<lecons_de_l_equipe>' && lessonLines([]).length === 0, 'consigne : les leçons, ou rien');
const cl = cleanLesson({ utile: true, lecon: 'Demander le commercial VO marchands ; écrire à fjabouille@groupe-dmd.fr ou appeler le 07 89 29 87 12.', portee: 'recherche', type_entreprise: 'groupe', pays: 'fr' });
ok(cl?.text === 'Demander le commercial VO marchands ; écrire à [adresse] ou appeler le [téléphone].' && cl.country === 'FR' && cleanLesson({ utile: false, lecon: 'x', portee: 'tout', type_entreprise: null, pays: null }) === null,
  'une leçon : jamais une adresse ni un téléphone ; rien si elle n\'apprend rien', cl);
ok(!/Florent|Jabouille/.test(lessonPrompt({ source: 'bon_contact', agent: 'dana', company: 'Centre VO@PRO', country: 'FR', segment: 'groupe', segmentLabel: 'Groupes', had: 'Directeur commercial, adresse générale', right: 'commercial VO marchands (pour démarrer)', how: 'un commercial d\'une concession nous l\'a donné' })),
  'la proposition d\'une leçon ne reçoit pas le nom du bon contact');

// --- La recherche : une entreprise que l'équipe connaît (nom proche, domaine) -----------------------------
const ra = acceptedAccounts({ comptes: [
  { nom: 'Mustière Automobiles', site_web: 'https://www.mustiere-auto.fr/', ville: 'Nantes', taille: null, pourquoi: 'x', sources: ['https://www.mustiere-auto.fr/'] },
  { nom: 'Groupe Neuf', site_web: 'https://www.groupe-neuf.fr/', ville: null, taille: null, pourquoi: 'x', sources: ['https://www.groupe-neuf.fr/'] },
], remarque: null }, ['https://www.mustiere-auto.fr/', 'https://www.groupe-neuf.fr/'], {
  webKeys: new Set(), nameKeys: new Set(), similar: (name) => similarNames(distinctiveTokens(name), distinctiveTokens('MUSTIÈTE AUTOMOBILES')),
});
ok(ra.kept.map((k) => k.name).join() === 'Groupe Neuf' && ra.dropped.some((d) => d.name === 'Mustière Automobiles' && d.reason === 'déjà connue'), 'recherche : une entreprise que l\'équipe connaît (même mal orthographiée) n\'est pas rendue comme nouvelle', ra);

// --- Le worker ---------------------------------------------------------------------------------------
const deepOut = (who: 'dmd' | 'leclerc'): DeepOutput => who === 'dmd' ? {
  proprietaire: { groupe: 'Groupe DMD', site_officiel: 'https://www.groupe-dmd.fr/', nb_sites: 53, siege: 'Saint-Herblain', source: 'https://www.groupe-dmd.fr/le-groupe-dmd' },
  canaux: [{ type: 'plateforme_b2b', nom: 'Centre VO@PRO', url: 'https://www.centrevoapro.com/', detail: 'vente aux marchands' }],
  personnes: [
    { nom: 'Christophe Delteil', fonction: 'Directeur commercial de VO@Pro', niveau: 'decider', perimetre: 'groupe', email: null, telephone: null, linkedin: null, source: 'https://journalauto.example/article', date_source: '2024', confirme_recent: false },
    { nom: 'Paul Martin', fonction: 'Commercial VO, concession de Rezé', niveau: 'aiguilleur', perimetre: 'site', email: 'pmartin@groupe-dmd.fr', telephone: null, linkedin: null, source: 'https://www.groupe-dmd.fr/concessions/reze', date_source: null, confirme_recent: true },
  ],
  emails: [{ email: 'contact@centrevoapro.com', nature: 'generique', source: 'https://www.centrevoapro.com/contact' }],
  telephones: [],
  meilleur_contact: { nom: 'Christophe Delteil', fonction: 'Directeur commercial de VO@Pro', niveau: 'decider', email: 'contact@centrevoapro.com', telephone: null, linkedin: null, pourquoi: 'Il dirige la plateforme.' },
  pistes: ['Demander à Paul Martin le contact du commercial qui vend aux marchands.'], resume: 'La plateforme B2B du groupe DMD.',
} : { proprietaire: { groupe: null, site_officiel: null, nb_sites: null, siege: null, source: null }, canaux: [], personnes: [], emails: [], telephones: [], meilleur_contact: { nom: null, fonction: null, email: null, telephone: null, linkedin: null, pourquoi: '' }, pistes: [], resume: '' };
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
  if (/aller plus loin/.test(system)) out = deepOut(user.includes('Centre VO@PRO') ? 'dmd' : 'leclerc');
  else if (/MAIL D'AIGUILLAGE/.test(system)) out = { objet: 'Votre interlocuteur pour les ventes aux marchands ?', corps: 'Bonjour Monsieur Dupont,\n\nDana, aux achats chez MC Export. Je me permets de vous écrire car je cherche la personne qui vend vos véhicules d\'occasion aux marchands : pourriez-vous me donner son contact direct ?\n\nMerci beaucoup.', traduction_fr: null };
  else if (/a répondu à un mail de MC Export/.test(system)) out = { corps: 'Bonjour Monsieur Dupont,\n\nMerci beaucoup, j\'écris directement à Mme Bernard.', langue: 'fr', traduction_fr: null, resume: 'Il donne le contact de Sophie Bernard.', intention: 'autre', appel: false, alertes: [], faits: [], contact_donne: { nom: 'Sophie Bernard', fonction: 'responsable des ventes aux marchands', email: 's.bernard@garage-leclerc-auto.fr', telephone: null } };
  else if (/PREMIER mail/.test(system)) out = { objet: 'Vos véhicules récents', corps: 'Bonjour Madame Bernard,\n\nNous achetons vos véhicules récents, en lots, enlevés en une fois — vos 3 500 VO nous intéressent. Seriez-vous ouverte à une offre ? Si ce n\'est pas pour vous, dites-le-moi.', traduction_fr: null, faits: [] };
  else if (/apprendre des corrections/.test(system)) out = { utile: true, lecon: 'Dans un groupe de concessions en France, le premier contact est le commercial VO qui vend aux marchands ; si son nom n\'est pas public, le demander à un commercial d\'une concession du groupe.', portee: 'recherche', type_entreprise: 'groupe', pays: 'FR' };
  else if (/Tu lis un mail que l'équipe/.test(system)) out = { contacts: [{ nom: 'Sophie Bernard', fonction: 'Responsable ventes marchands', entreprise: 'Garage Leclerc Automobiles', email: 's.bernard@garage-leclerc-auto.fr', telephone: '06 12 34 56 78' }, { nom: 'Inventé', fonction: null, entreprise: null, email: 'invente@garage-leclerc-auto.fr', telephone: null }], sujet: 'echange', resume: 'Channing écrit à Sophie Bernard.' };
  else out = {};
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = base;
const realFetch = globalThis.fetch;
const pad = (t: string) => `<html><body>${t} ${'Nos concessions et nos véhicules. '.repeat(40)}</body></html>`;
const pages: Record<string, string> = {
  'https://www.groupe-dmd.fr/concessions/reze': pad('Paul Martin, commercial VO : pmartin@groupe-dmd.fr'),
  'https://www.centrevoapro.com/contact': pad('Écrivez-nous : contact@centrevoapro.com'),
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  if (pages[u]) return new Response(pages[u], { headers: { 'content-type': 'text/html' } });
  if (u.startsWith(base)) return realFetch(input, init);
  return new Response('introuvable', { status: 404 });
}) as typeof fetch;
(dns as unknown as { resolveMx: (d: string) => Promise<unknown[]> }).resolveMx = async (d: string) => (['groupe-dmd.fr', 'centrevoapro.com', 'garage-leclerc-auto.fr'].includes(d) ? [{ exchange: `mx.${d}`, priority: 10 }] : []);

const today = new Date().toISOString();
const dana = { agent: 'dana', display_name: 'Dana', mailbox: 'dana@mc-export.com', signature: 'Dana\nMC Export', daily_budget_usd: 5, instructions: '', targets: { minLot: 3 }, auto_draft_per_day: 5, daily_first_contact_cap: 10, map_min_score: 70 };
const db: FakeDb = {
  agent_settings: [dana as unknown as Row],
  network_contacts: [
    { id: 'c-dmd', name: 'MUSTIÈTE AUTOMOBILES', country: 'FR', city: 'Nantes', website: 'https://www.groupe-dmd.fr/resultats-voiture-occasion', phone: '+33789298712', email: 'fjabouille@groupe-dmd.fr', contact_name: 'FLORENT JABOUILLE', role: 'vendeur', source: 'manuel', people: [] },
    { id: 'c-ia', name: 'Centre VO@PRO', country: 'FR', city: 'Malville', website: 'https://www.centrevoapro.com/', phone: null, email: 'contact@centrevoapro.com', contact_name: 'Christophe Delteil', role: 'vendeur', source: 'dana', people: [] },
  ],
  contacts: [{ id: 'w-must', company_name: 'MUSTIÈRE AUTOMOBILES', first_name: null, last_name: null, email: null, phone: null, country: 'FR', category: 'pro', type: 'client' }],
  transactions_admin: [1, 2, 3, 4, 5].map((i) => ({ id: `tx${i}`, buyer_contact_id: 'w-must' })),
  supplier_offers: [],
  agent_accounts: [{ id: 'acc-leclerc', agent: 'dana', segment: 'groupe', size_hint: '5 concessions', why: 'Groupe régional.' }],
  agent_prospects: [
    { id: 'p-dmd', agent: 'dana', name: 'Centre VO@PRO (Groupe DMD – Mustière Automobiles)', country: 'FR', city: 'Malville', website: 'https://www.centrevoapro.com/', phone: null, kind: 'groupe', group_name: null, sites: null,
      summary: 'Plateforme B2B du groupe DMD.', key_account: true, account_id: null, stage: 'qualifie', score: 80, fit_score: 70, fit_parts: [], language: 'fr', network_contact_id: null, dealer_id: null, lots: [],
      emails: [{ email: 'contact@centrevoapro.com', nature: 'generique', source: 'https://www.centrevoapro.com/contact', mx: true }],
      people: [{ nom: 'Christophe Delteil', fonction: 'Directeur commercial de VO@Pro', email: null, source: 'https://journalauto.example/article' }],
      best_contact: { nom: 'Christophe Delteil', fonction: 'Directeur commercial de VO@Pro', email: 'contact@centrevoapro.com', pourquoi: 'Il dirige la plateforme.' }, evidence: [] },
    { id: 'p-leclerc', agent: 'dana', name: 'Garage Leclerc Automobiles', country: 'FR', city: 'Angers', website: 'https://www.garage-leclerc-auto.fr/', phone: null, kind: 'groupe', group_name: 'Groupe Leclerc', sites: 5,
      summary: 'Groupe de 5 concessions, 3 500 VO vendus aux marchands en 2023.', key_account: false, account_id: 'acc-leclerc', stage: 'qualifie', score: 85, fit_score: 75, fit_parts: [], language: 'fr', network_contact_id: null, dealer_id: null, lots: [],
      emails: [{ email: 'contact@garage-leclerc-auto.fr', nature: 'generique', source: 'https://www.garage-leclerc-auto.fr/contact', mx: true }, { email: 'j.dupont@garage-leclerc-auto.fr', nature: 'nominatif', source: 'https://www.garage-leclerc-auto.fr/saumur', mx: true }],
      people: [
        { nom: 'Marc Leclerc', fonction: 'Directeur VO du groupe', email: null, source: 'https://www.garage-leclerc-auto.fr/equipe', niveau: 'decider' },
        { nom: 'Julien Dupont', fonction: 'Commercial VO, site de Saumur', email: 'j.dupont@garage-leclerc-auto.fr', source: 'https://www.garage-leclerc-auto.fr/saumur', niveau: 'aiguilleur', perimetre: 'site' },
      ],
      best_contact: { nom: 'Marc Leclerc', fonction: 'Directeur VO du groupe', email: 'contact@garage-leclerc-auto.fr', pourquoi: 'Il décide.', niveau: 'decider' }, evidence: [] },
  ],
  agent_threads: [], agent_messages: [], agent_tasks: [], agent_journal: [], agent_runs: [], email_suppressions: [], agent_lessons: [], profiles: [{ id: 'u-channing', is_admin: true }],
  market_dealers: [], market_dealer_listings: [], intra_showcase: [],
};
setSharedSupabase(fakeSupabase(db) as never);
const { deepResearch } = await import('../worker/agents/deep');
const { runNextTask } = await import('../worker/agents/tasks');
const { queueReplyDraft } = await import('../worker/agents/reply');
const { autoLessons, forgetLessons } = await import('../worker/agents/lessons');
const task = (o: Row) => { db.agent_tasks.push({ id: `t${db.agent_tasks.length + 1}`, agent: 'dana', status: 'en_attente', created_by: null, created_at: new Date().toISOString(), ...o }); };
// Les défauts de la base pour les tâches posées par le worker lui-même (statut « en attente »).
const settle = () => { for (const t of db.agent_tasks) { t.status ??= 'en_attente'; t.created_at ??= new Date().toISOString(); } };

// A. DMD : la mémoire de l'équipe, l'adresse probable, pas de mail d'office.
const o = await deepResearch('p-dmd', dana as never, null, false);
const deepCall = calls.find((c) => /aller plus loin/.test(c.system));
ok(o.status === 'enrichi' && !!deepCall && deepCall.user.includes('<ce_que_l_equipe_sait_deja>') && deepCall.user.includes('FLORENT JABOUILLE') && deepCall.user.includes('client : 5 ventes')
  && !deepCall.user.includes('Christophe Delteil — contact de') && deepCall.user.includes('Pour démarrer (qui traite au quotidien) : commercial VO marchands') && /POUR DÉMARRER/.test(deepCall.system),
  'A. la recherche approfondie lit ce que l\'équipe sait (la carte malgré la faute, le Workflow), et qui chercher', deepCall?.user.split('\n'));
ok(!(deepCall?.user ?? '').includes('Centre VO@PRO — Christophe') && !(db.network_contacts.find((c) => c.id === 'c-ia') && (deepCall?.user ?? '').includes('carte du réseau — Centre VO@PRO')), 'A. une fiche que Dana a mise elle-même sur la carte n\'est pas « ce que l\'équipe sait »');
const pd = db.agent_prospects.find((p) => p.id === 'p-dmd') as Row & { people: DeepPerson[]; best_contact: Row };
const florent = pd.people.find((x) => /jabouille/i.test(x.nom));
const delteil = pd.people.find((x) => x.nom === 'Christophe Delteil');
const paul = pd.people.find((x) => x.nom === 'Paul Martin');
ok(florent?.connu === true && florent.via === 'carte' && florent.email === 'fjabouille@groupe-dmd.fr', 'A. Florent Jabouille entre sur la fiche, « connu de l\'équipe (carte) »', florent);
ok(delteil?.niveau === 'decider' && delteil.a_confirmer === true && delteil.date_source === '2024' && delteil.email_probable === 'cdelteil@groupe-dmd.fr' && /fjabouille@groupe-dmd\.fr/.test(delteil.motif ?? ''),
  'A. le directeur : pour décider, à confirmer (source 2024), adresse probable cdelteil@groupe-dmd.fr (format prouvé par Florent)', delteil);
ok(paul?.niveau === 'aiguilleur' && paul.email === 'pmartin@groupe-dmd.fr' && (pd.best_contact as { nom?: string }).nom === 'Christophe Delteil', 'A. l\'aiguilleur relevé, son adresse vérifiée ; le contact retenu reste le directeur', { paul, best: pd.best_contact });
task({ kind: 'premier_mail', params: { prospect_ids: ['p-dmd'], auto: true } });
await runNextTask();
ok(db.agent_messages.length === 0 && /déjà connue de l'équipe : FLORENT JABOUILLE \(carte du réseau\)/.test(String((db.agent_tasks[0].result as { details?: string[] })?.details?.[0] ?? '')),
  'A. pas de premier mail d\'office : l\'équipe connaît déjà quelqu\'un ici', db.agent_tasks[0].result);

// B. Le groupe sans adresse directe : l'aiguillage, la réponse, le vrai premier mail.
task({ kind: 'premier_mail', params: { prospect_ids: ['p-leclerc'], auto: true } });
await runNextTask();
const rm = db.agent_messages.find((m) => (m.ai_notes as { aiguillage?: unknown } | null)?.aiguillage) as (Row & { ai_notes: { aiguillage: { cible: string; routeur: string }; texte_initial: string } }) | undefined;
const routingCall = calls.find((c) => /MAIL D'AIGUILLAGE/.test(c.system));
ok(!!rm && rm.status === 'a_valider' && rm.kind === 'premier_contact' && (rm.to_emails as string[]).join() === 'j.dupont@garage-leclerc-auto.fr' && rm.ai_notes.aiguillage.cible === 'Marc Leclerc — Directeur VO du groupe'
  && rm.ai_notes.aiguillage.routeur === 'Julien Dupont' && !!rm.ai_notes.texte_initial && String(rm.body_text).endsWith('Dana\nMC Export'),
  'B. sans adresse directe : un aiguillage au commercial du site, à valider, marqué', rm && { to: rm.to_emails, notes: rm.ai_notes });
ok(!!routingCall && routingCall.user.includes('À qui tu écris : Julien Dupont, Commercial VO, site de Saumur — son adresse') && routingCall.user.includes('On cherche : Marc Leclerc, Directeur VO du groupe'), 'B. l\'aiguillage dit à qui on écrit et qui on cherche', routingCall?.user.split('\n'));
ok(!calls.some((c) => /PREMIER mail/.test(c.system)), 'B. pas de présentation envoyée dans le vide (aucun premier mail rédigé)');
// La réponse de Julien Dupont donne le contact.
rm!.status = 'envoye'; rm!.sent_at = new Date(Date.now() - 3600_000).toISOString();
const th = rm!.thread_id as string;
db.agent_messages.push({ id: 'in1', thread_id: th, agent: 'dana', mailbox: 'dana@mc-export.com', channel: 'mail', direction: 'in', status: 'recu', kind: 'recu', author: 'systeme', from_email: 'j.dupont@garage-leclerc-auto.fr', from_name: 'Julien Dupont',
  to_emails: ['dana@mc-export.com'], cc_emails: [], subject: 'Re: Votre interlocuteur pour les ventes aux marchands ?', body_text: 'Bonjour, c\'est Sophie Bernard qui gère les ventes aux marchands : s.bernard@garage-leclerc-auto.fr. Bonne journée', body_new: 'Bonjour, c\'est Sophie Bernard qui gère les ventes aux marchands : s.bernard@garage-leclerc-auto.fr. Bonne journée',
  attachments: [], classification: null, auto_reply: false, received_at: new Date(Date.now() + 1000).toISOString(), created_at: new Date(Date.now() + 1000).toISOString() });
await queueReplyDraft('dana', th, 'in1', new Date());
settle();
await runNextTask();
const pl = db.agent_prospects.find((p) => p.id === 'p-leclerc') as Row & { people: DeepPerson[]; best_contact: Row; emails: DeepEmail[] };
const replyCall = calls.find((c) => /a répondu à un mail de MC Export/.test(c.system));
ok(!!replyCall && replyCall.user.includes('<aiguillage>Notre premier mail lui demandait le contact direct de Marc Leclerc — Directeur VO du groupe'), 'B. la réponse sait que c\'était un aiguillage', replyCall?.user.split('\n').slice(-6));
ok((pl.best_contact as { nom?: string; email?: string }).email === 's.bernard@garage-leclerc-auto.fr' && pl.people.some((x) => x.nom === 'Sophie Bernard' && x.via === 'aiguillage') && pl.emails.some((e) => e.email === 's.bernard@garage-leclerc-auto.fr' && e.mx),
  'B. le contact donné entre sur la fiche comme contact retenu (vérifié : le domaine reçoit du courrier)', pl.best_contact);
const thanks = db.agent_messages.find((m) => m.kind === 'reponse') as Row & { ai_notes: { contact_donne: { email: string } } } | undefined;
ok(thanks?.status === 'a_valider' && thanks.ai_notes.contact_donne.email === 's.bernard@garage-leclerc-auto.fr', 'B. le merci à Julien Dupont, à valider, avec le contact donné');
settle();
await runNextTask();
const first = db.agent_messages.find((m) => m.kind === 'premier_contact' && (m.to_emails as string[]).includes('s.bernard@garage-leclerc-auto.fr')) as (Row & { ai_notes: { alertes: string[]; aiguillage?: unknown } }) | undefined;
ok(!!first && first.status === 'a_valider' && !first.ai_notes.aiguillage && first.thread_id !== th && first.ai_notes.alertes.some((w) => /Récite ses propres chiffres \(3500\)/.test(w)),
  'B. le vrai premier mail à Sophie Bernard, dans un nouveau fil, à valider (et le contrôle signale qu\'il récite leurs chiffres)', first && { to: first.to_emails, alertes: first.ai_notes.alertes });

// C. « Le bon contact est… » sur DMD : la fiche, la leçon proposée (sans nom).
task({ kind: 'qualification', params: { bon_contact: { prospect_id: 'p-dmd', nom: 'Florent Jabouille', fonction: 'commercial VO marchands', email: 'fjabouille@groupe-dmd.fr', telephone: null, comment: 'un commercial d\'une concession nous l\'a donné', niveau: 'demarrer' } }, created_by: 'u-channing' });
await runNextTask();
const pd2 = db.agent_prospects.find((p) => p.id === 'p-dmd') as Row & { people: DeepPerson[]; best_contact: Row };
const lessonCall = calls.find((c) => /apprendre des corrections/.test(c.system));
ok((pd2.best_contact as { nom?: string; niveau?: string }).nom === 'Florent Jabouille' && (pd2.best_contact as { niveau?: string }).niveau === 'demarrer' && pd2.people.some((x) => x.nom === 'Christophe Delteil') && pd2.people.filter((x) => /jabouille/i.test(x.nom)).length === 1,
  'C. le bon contact devient le contact retenu ; ce que Dana avait trouvé reste ; pas de doublon', pd2.best_contact);
ok(!!lessonCall && !/Florent|Jabouille/i.test(lessonCall.user) && lessonCall.user.includes('un commercial d\'une concession nous l\'a donné') && db.agent_lessons.length === 1 && db.agent_lessons[0].status === 'proposee' && db.agent_lessons[0].segment === 'groupe' && db.agent_lessons[0].country === 'FR',
  'C. une leçon proposée, générale (le nom n\'est pas transmis), pour les groupes en France', { lessons: db.agent_lessons, prompt: lessonCall?.user.split('\n') });
ok(db.agent_journal.some((j) => j.kind === 'bon_contact' && /le bon contact est Florent Jabouille/.test(String(j.summary)) && /Dana avait retenu Christophe Delteil/.test(String(j.summary))) && db.agent_journal.some((j) => j.kind === 'lecon_proposee'),
  'C. le journal : le bon contact, et la leçon à valider', db.agent_journal.filter((j) => j.kind === 'bon_contact' || j.kind === 'lecon_proposee').map((j) => j.summary));

// D. Une copie de l'équipe : les contacts appris, la fiche complétée, aucune réponse.
db.agent_threads.push({ id: 'th-copie', agent: 'dana', mailbox: 'dana@mc-export.com', subject: 'Nos besoins', prospect_id: null });
db.agent_messages.push({ id: 'copie1', thread_id: 'th-copie', agent: 'dana', mailbox: 'dana@mc-export.com', channel: 'mail', direction: 'in', status: 'recu', kind: 'recu', author: 'systeme', from_email: 'channing@mc-export.com', from_name: 'Channing',
  to_emails: ['s.bernard@garage-leclerc-auto.fr'], cc_emails: ['dana@mc-export.com'], subject: 'Nos besoins', body_text: 'Bonjour Sophie,\n…\n--\nSophie Bernard\nResponsable ventes marchands\nGarage Leclerc Automobiles\ns.bernard@garage-leclerc-auto.fr\n06 12 34 56 78',
  attachments: [], classification: 'copie', auto_reply: false, received_at: today, created_at: today, ai_notes: null });
task({ kind: 'qualification', params: { copie: 'copie1', auto: true } });
const nReplies = db.agent_messages.filter((m) => m.kind === 'reponse').length;
await runNextTask();
const cm = db.agent_messages.find((m) => m.id === 'copie1') as Row & { ai_notes: { contacts: Array<{ nom: string; email: string | null }> } };
const pl2 = db.agent_prospects.find((p) => p.id === 'p-leclerc') as Row & { people: DeepPerson[] };
ok(cm.ai_notes.contacts.length === 1 && cm.ai_notes.contacts[0].email === 's.bernard@garage-leclerc-auto.fr', 'D. les contacts écrits dans la copie (un contact inventé, dont l\'adresse n\'est pas dans le mail, est écarté)', cm.ai_notes.contacts);
ok(pl2.people.some((x) => x.nom === 'Sophie Bernard' && x.connu === true) && (db.agent_threads.find((t) => t.id === 'th-copie') as Row).prospect_id === 'p-leclerc' && db.agent_messages.filter((m) => m.kind === 'reponse').length === nReplies,
  'D. la fiche de l\'entreprise : Sophie Bernard connue de l\'équipe, le fil rattaché ; aucune réponse préparée');

// E. Les brouillons refusés avec un motif, ou corrigés avant l'envoi : des leçons proposées.
db.agent_threads.push({ id: 'th-e', agent: 'dana', mailbox: 'dana@mc-export.com', subject: 'x', prospect_id: 'p-leclerc' });
db.agent_messages.push(
  { id: 'r1', thread_id: 'th-e', agent: 'dana', direction: 'out', status: 'refuse', author: 'dana', subject: 'Vos VO', body_text: 'Bonjour, vous avez vendu 3 500 VO…', refused_reason: 'Il récite leurs chiffres : droit au but.', updated_at: today, ai_notes: { texte_initial: 'Bonjour, vous avez vendu 3 500 VO…' } },
  { id: 'r2', thread_id: 'th-e', agent: 'dana', direction: 'out', status: 'envoye', author: 'dana', subject: 'Vos VO', body_text: 'Bonjour Madame, nous achetons vos véhicules récents en lots, enlevés en une fois. Une offre vous intéresse ?', refused_reason: null, updated_at: today, ai_notes: { texte_initial: 'Bonjour, MC Export est un exportateur… vous avez 53 concessions et 10 900 VO… nous voudrions… ?' } },
  { id: 'r3', thread_id: 'th-e', agent: 'dana', direction: 'out', status: 'envoye', author: 'dana', subject: 'x', body_text: 'Texte identique.', refused_reason: null, updated_at: today, ai_notes: { texte_initial: 'Texte identique.' } },
);
const before = db.agent_lessons.length;
await autoLessons(dana as never);
ok(db.agent_lessons.length === before + 2 && ['r1', 'r2'].every((id) => !!((db.agent_messages.find((m) => m.id === id) as Row).ai_notes as { lecon?: string }).lecon) && !((db.agent_messages.find((m) => m.id === 'r3') as Row).ai_notes as { lecon?: string }).lecon,
  'E. un refus motivé et une vraie correction : deux leçons proposées ; un texte inchangé : rien', db.agent_lessons.map((l) => l.source));
await autoLessons(dana as never);
ok(db.agent_lessons.length === before + 2, 'E. chaque correction une fois');

// F. Le SQL agents_lecons pas encore collé : pas d'appel à Haiku, la correction n'est pas marquée — elle sert une fois la table créée.
const real = fakeSupabase(db);
const noTable = { select: () => ({ limit: async () => ({ data: null, error: { message: 'relation "public.agent_lessons" does not exist' } }) }) };
setSharedSupabase({ ...real, from: (t: string) => (t === 'agent_lessons' ? noTable : real.from(t)) } as never);
forgetLessons();
db.agent_messages.push({ id: 'r4', thread_id: 'th-e', agent: 'dana', direction: 'out', status: 'refuse', author: 'dana', subject: 'Vos VO', body_text: 'Bonjour, votre groupe compte 12 sites…', refused_reason: 'Trop long, va droit au but.', updated_at: today, ai_notes: { texte_initial: 'Bonjour, votre groupe compte 12 sites…' } });
const nCalls = calls.length;
await autoLessons(dana as never);
const r4 = () => ((db.agent_messages.find((m) => m.id === 'r4') as Row).ai_notes as { lecon?: string });
ok(calls.length === nCalls && !r4().lecon && db.agent_lessons.length === before + 2, 'F. sans la table des leçons : aucun appel, la correction attend', { appels: calls.length - nCalls, lecon: r4().lecon });
setSharedSupabase(real as never);
forgetLessons();
await autoLessons(dana as never);
ok(!!r4().lecon && r4().lecon !== 'aucune' && db.agent_lessons.length === before + 3, 'F. la table créée : la correction devient une leçon proposée', r4());

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

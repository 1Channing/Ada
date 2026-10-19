/**
 * Le banc d'essai (19/10, Channing : « on voulait voir à quel point Dana
 * était efficace […] elle s'en est bien sortie mais on veut mieux ! »). La
 * partie pure : qui entre au banc (les contacts de la carte saisis par
 * l'équipe, avec un nom et une adresse nominative d'entreprise, du côté de
 * l'agente), la fiche « à blanc » (rien de la personne), le verdict face au
 * contact connu, le bilan. Puis le worker avec un faux serveur Claude, de
 * fausses pages et une carte simulée : Dana passe trois entreprises — elle
 * retrouve la personne chez l'une, un directeur avec une adresse générale
 * chez l'autre (le cas DMD), rien chez la troisième ; rien n'est écrit sur
 * une fiche ; le banc ne compte pas dans son budget du jour et s'arrête à sa
 * limite.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as dns } from 'node:dns';
import { benchCandidates, benchProspect, benchVerdict, benchTally, benchWebsite, VERDICT_POINTS, type BenchContact, type BenchTrial } from '../src/lib/agents/bench';
import { samePerson, emailDomain, isWebmail, personTokens } from '../src/lib/agents/people';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';
import type { DeepOutput } from '../src/lib/agents/deepResearch';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
type Row = Record<string, unknown>;

console.log('\n=== ADA ET DANA : LE BANC D\'ESSAI ===\n');

// --- Les personnes et les adresses ------------------------------------------------------------
ok(samePerson('FLORENT JABOUILLE', 'Florent Jabouille') && samePerson('Jabouille Florent', 'M. Florent Jabouille') && !samePerson('Florent Martin', 'Florent Jabouille') && !samePerson('Florent', 'Florent Jabouille'),
  'la même personne : les mêmes mots, dans n\'importe quel ordre ; un prénom seul ne suffit pas');
ok(personTokens('Jean-Pierre de la Tour') .join() === 'jean,pierre,tour', 'les mots d\'un nom, sans particules', personTokens('Jean-Pierre de la Tour'));
ok(emailDomain('FJabouille@Groupe-DMD.fr') === 'groupe-dmd.fr' && emailDomain('pas une adresse') === '', 'le domaine d\'une adresse');
ok(isWebmail('gmail.com') && isWebmail('orange.fr') && isWebmail('yahoo.co.uk') && isWebmail('t-online.de') && !isWebmail('groupe-dmd.fr') && !isWebmail('mail.groupe-dmd.fr'),
  'une messagerie grand public ne dit rien de l\'entreprise (gmail, orange, yahoo.co.uk, t-online) ; groupe-dmd.fr, si');

// --- Qui entre au banc ---------------------------------------------------------------------------
const map: BenchContact[] = [
  { id: 'c-dmd', name: 'MUSTIÈTE AUTOMOBILES', country: 'FR', city: 'Nantes', website: 'https://www.groupe-dmd.fr/resultats-voiture-occasion', role: 'vendeur', kind: 'concession', contact_name: 'FLORENT JABOUILLE', email: 'fjabouille@groupe-dmd.fr', source: 'manuel' },
  { id: 'c-ia', name: 'Garage ajouté par Dana', country: 'FR', city: 'Lyon', website: null, role: 'vendeur', kind: 'concession', contact_name: 'Paul Durand', email: 'p.durand@garage-ia.fr', source: 'dana' },
  { id: 'c-gmail', name: 'Garage Gmail', country: 'FR', city: 'Angers', website: null, role: 'vendeur', kind: 'concession', contact_name: 'Luc Petit', email: 'luc.petit@gmail.com', source: 'manuel' },
  { id: 'c-contact', name: 'Garage Contact', country: 'FR', city: 'Tours', website: null, role: 'vendeur', kind: 'concession', contact_name: 'Marie Blanc', email: 'contact@garage-contact.fr', source: 'manuel' },
  { id: 'c-nl', name: 'Autobedrijf De Vries', country: 'NL', city: 'Utrecht', website: 'devries-auto.nl', role: 'acheteur', kind: 'concession', contact_name: 'Jan de Vries', email: 'jan@devries-auto.nl', source: 'manuel' },
  { id: 'c-fr-acheteur', name: 'Acheteur France', country: 'FR', city: 'Paris', website: null, role: 'acheteur', kind: 'trader', contact_name: 'Anne Roy', email: 'anne.roy@acheteur-fr.fr', source: 'manuel' },
  { id: 'c-deux', name: 'Les Deux BV', country: 'NL', city: 'Breda', website: null, role: 'les_deux', kind: 'trader', contact_name: 'Kees Bakker', email: 'k.bakker@lesdeux.nl', source: null },
  { id: 'c-dmd2', name: 'DMD Rezé', country: 'FR', city: 'Rezé', website: null, role: 'vendeur', kind: 'concession', contact_name: 'Autre Personne', email: 'apersonne@groupe-dmd.fr', source: 'manuel' },
];
const forDana = benchCandidates(map, 'dana');
ok(forDana.map((c) => c.id).join() === 'c-dmd,c-deux', 'Dana : les vendeurs saisis par l\'équipe, avec une adresse nominative d\'entreprise — pas ceux de l\'IA, pas gmail, pas contact@ ; une entreprise par domaine (celle qui a un site d\'abord)', forDana.map((c) => c.id));
ok(benchCandidates(map, 'ada').map((c) => c.id).join() === 'c-nl,c-deux', 'Ada : les acheteurs hors de France (et « les deux »)', benchCandidates(map, 'ada').map((c) => c.id));
const blank = benchProspect(map[0]);
ok(blank.name === 'MUSTIÈTE AUTOMOBILES' && blank.website === 'https://www.groupe-dmd.fr/resultats-voiture-occasion' && blank.phone === null && blank.people.length === 0 && blank.emails.length === 0 && blank.best_contact === null,
  'la fiche à blanc : le nom, le pays, la ville et le site — rien de la personne', blank);
ok(benchWebsite(map[4]) === 'https://devries-auto.nl' && benchWebsite({ ...map[1], website: null, email: 'p.durand@garage-ia.fr' }) === 'https://garage-ia.fr' && benchWebsite({ ...map[2] }) === null,
  'le site de départ : celui de la carte, sinon le domaine de l\'adresse de l\'entreprise — jamais gmail');

// --- Le verdict -----------------------------------------------------------------------------------
const known = { name: 'FLORENT JABOUILLE', email: 'fjabouille@groupe-dmd.fr' };
const mail = (email: string, nature = 'autre', mx = true) => ({ email, nature, source: 'https://x', mx });
ok(benchVerdict(known, { best: { nom: 'Florent Jabouille', fonction: 'commercial VO marchands', email: null, pourquoi: '' }, people: [], emails: [] }).verdict === 'meme_personne', 'verdict : son nom → la même personne');
ok(benchVerdict(known, { best: null, people: [], emails: [mail('fjabouille@groupe-dmd.fr', 'nominatif')] }).verdict === 'meme_personne', 'verdict : son adresse exacte → la même personne');
ok(benchVerdict(known, { best: null, people: [], emails: [], probable: [{ nom: 'F. Jabouille', email: 'fjabouille@groupe-dmd.fr' }] }).detail.includes('adresse probable'), 'verdict : son adresse probable (format prouvé) → la même personne, dit comme tel');
ok(benchVerdict(known, { best: { nom: 'Julie Martin', fonction: 'ventes aux marchands', email: 'julie.martin@groupe-dmd.fr', pourquoi: '' }, people: [], emails: [mail('julie.martin@groupe-dmd.fr', 'nominatif')] }).verdict === 'autre_direct', 'verdict : une autre personne avec son adresse directe');
const dmd = benchVerdict(known, { best: { nom: 'Christophe Delteil', fonction: 'Directeur commercial de VO@Pro', email: 'contact@centrevoapro.com', pourquoi: '' }, people: [], emails: [mail('contact@centrevoapro.com', 'generique')] });
ok(dmd.verdict === 'nomme_general' && dmd.detail === 'Christophe Delteil — contact@centrevoapro.com', 'verdict : le cas DMD — un directeur nommé, seulement une adresse générale', dmd);
ok(benchVerdict(known, { best: { nom: 'Christophe Delteil', fonction: 'directeur', email: 'vo@groupe-dmd.fr', pourquoi: '' }, people: [], emails: [mail('vo@groupe-dmd.fr', 'vo')] }).verdict === 'nomme_service', 'verdict : une personne nommée et l\'adresse de son service');
ok(benchVerdict(known, { best: null, people: [], emails: [mail('vo@groupe-dmd.fr', 'vo')] }).verdict === 'service' && benchVerdict(known, { best: null, people: [], emails: [mail('contact@groupe-dmd.fr', 'generique')] }).verdict === 'general'
  && benchVerdict(known, { best: null, people: [], emails: [mail('contact@groupe-dmd.fr', 'generique', false)] }).verdict === 'rien', 'verdict : une adresse de service, une adresse générale, rien (une adresse dont le domaine ne reçoit pas de courrier ne compte pas)');
const trials = (['meme_personne', 'nomme_general', 'rien'] as const).map((v, i) => ({ contact_id: `c${i}`, entreprise: 'x', pays: 'FR', connu: { nom: '', email: '' }, trouve: { nom: null, fonction: null, email: null }, verdict: v, detail: '', points: VERDICT_POINTS[v], cout_usd: 0.1 })) as BenchTrial[];
const tally = benchTally(trials);
ok(tally.n === 3 && tally.note === 47 && tally.par_verdict.meme_personne === 1 && tally.par_verdict.nomme_general === 1 && tally.par_verdict.rien === 1 && Math.abs(tally.cout_usd - 0.3) < 1e-9,
  'bilan : 3 essais, note moyenne 47/100, un de chaque, 0,30 $', tally);

// --- Le worker -----------------------------------------------------------------------------------
const outFor = (who: 'trouve' | 'directeur' | 'rien'): DeepOutput => ({
  proprietaire: { groupe: who === 'directeur' ? 'Groupe DMD' : null, site_officiel: null, nb_sites: null, siege: null, source: null },
  canaux: [],
  personnes: who === 'trouve' ? [{ nom: 'Kees Bakker', fonction: 'inkoper', perimetre: 'site', email: 'k.bakker@lesdeux.nl', telephone: null, linkedin: null, source: 'https://www.lesdeux.nl/team' }]
    : who === 'directeur' ? [{ nom: 'Christophe Delteil', fonction: 'Directeur commercial de VO@Pro', perimetre: 'groupe', email: null, telephone: null, linkedin: null, source: 'https://journal.example/article' }] : [],
  emails: who === 'directeur' ? [{ email: 'contact@centrevoapro.com', nature: 'generique', source: 'https://www.centrevoapro.com/contact' }] : who === 'trouve' ? [{ email: 'k.bakker@lesdeux.nl', nature: 'nominatif', source: 'https://www.lesdeux.nl/team' }] : [],
  telephones: [],
  meilleur_contact: who === 'directeur' ? { nom: 'Christophe Delteil', fonction: 'Directeur commercial de VO@Pro', email: 'contact@centrevoapro.com', telephone: null, linkedin: null, pourquoi: 'Il dirige la plateforme.' }
    : who === 'trouve' ? { nom: 'Kees Bakker', fonction: 'inkoper', email: 'k.bakker@lesdeux.nl', telephone: null, linkedin: null, pourquoi: 'Il achète.' }
      : { nom: null, fonction: null, email: null, telephone: null, linkedin: null, pourquoi: 'rien' },
  pistes: [], resume: 'x',
});
const calls: string[] = [];
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!(req.url?.startsWith('/v1/messages') && req.method === 'POST')) { res.writeHead(404); res.end(); return; }
  let raw = '';
  for await (const ch of req) raw += ch;
  const body = JSON.parse(raw) as { model: string; messages: Array<{ content: unknown }> };
  const user = String(body.messages[0].content);
  calls.push(user);
  const who = user.includes('MUSTIÈTE') ? 'directeur' : user.includes('Les Deux') ? 'trouve' : 'rien';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(outFor(who)) }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 400_000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 6, web_fetch_requests: 2 } } }));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = base;
const realFetch = globalThis.fetch;
const pad = (t: string) => `<html><body>${t} ${'Notre équipe et nos véhicules. '.repeat(40)}</body></html>`;
const pages: Record<string, string> = {
  'https://www.lesdeux.nl/team': pad('Kees Bakker, inkoper : k.bakker@lesdeux.nl'),
  'https://www.centrevoapro.com/contact': pad('Écrivez-nous : contact@centrevoapro.com'),
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  if (pages[u]) return new Response(pages[u], { headers: { 'content-type': 'text/html' } });
  if (u.startsWith(base)) return realFetch(input, init);
  return new Response('introuvable', { status: 404 });
}) as typeof fetch;
(dns as unknown as { resolveMx: (d: string) => Promise<unknown[]> }).resolveMx = async (d: string) => (['lesdeux.nl', 'centrevoapro.com', 'groupe-dmd.fr'].includes(d) ? [{ exchange: `mx.${d}`, priority: 10 }] : []);

const dana = { agent: 'dana', display_name: 'Dana', mailbox: 'dana@mc-export.com', signature: 'Dana', daily_budget_usd: 0.01, targets: { minLot: 3 }, instructions: '' };
const today = new Date().toISOString();
const db: FakeDb = {
  agent_settings: [dana as unknown as Row],
  network_contacts: [
    ...map.map((c) => ({ ...c })),
    { id: 'c-rien', name: 'Garage Introuvable', country: 'FR', city: 'Nevers', website: 'https://garage-introuvable.fr', role: 'vendeur', kind: 'concession', contact_name: 'Hugo Leroy', email: 'h.leroy@garage-introuvable.fr', source: 'manuel' },
  ] as unknown as Row[],
  agent_prospects: [], agent_tasks: [
    // Le budget du jour de Dana est déjà dépassé : le banc passe quand même (il a sa propre limite).
    { id: 'tb1', agent: 'dana', kind: 'qualification', status: 'en_attente', params: { banc: true, n: 5 }, created_by: 'u-channing', created_at: today },
  ],
  agent_journal: [], agent_runs: [{ id: 'r0', agent: 'dana', purpose: 'qualification', cost_usd: 5, created_at: today }], email_suppressions: [],
};
setSharedSupabase(fakeSupabase(db) as never);
const { runNextTask } = await import('../worker/agents/tasks');
await runNextTask();
const t = db.agent_tasks[0];
if (t.status !== 'terminee') console.error('tâche :', t.status, t.error);
const res = (t.result ?? {}) as { essais?: BenchTrial[]; note?: number; par_verdict?: Record<string, number>; methode?: string; modele?: string; arret?: string | null };
const v = Object.fromEntries((res.essais ?? []).map((e) => [e.entreprise, e.verdict]));
ok(t.status === 'terminee' && (res.essais ?? []).length === 3 && res.modele === 'haiku' && /^v\d/.test(res.methode ?? ''), 'le banc passe : 3 entreprises de Dana (la carte), Haiku, la méthode notée', { status: t.status, error: t.error, res });
ok(v['Les Deux BV'] === 'meme_personne' && v['MUSTIÈTE AUTOMOBILES'] === 'nomme_general' && v['Garage Introuvable'] === 'rien', 'verdicts : la même personne ; le cas DMD ; rien', v);
ok(calls.length === 3 && calls.every((u) => !/JABOUILLE|fjabouille|Kees|k\.bakker|Leroy/i.test(u)) && calls.some((u) => u.includes('MUSTIÈTE AUTOMOBILES') && u.includes('groupe-dmd.fr')), 'la fiche à blanc : ni le nom, ni l\'adresse du contact connu dans ce qu\'on demande à l\'IA — le site, oui');
ok(db.agent_prospects.length === 0 && db.agent_threads === undefined || (db.agent_threads ?? []).length === 0, 'rien n\'est écrit : ni fiche, ni fil');
ok(db.agent_runs.filter((r) => r.purpose === 'banc_essai').length === 3, 'chaque appel est inscrit « banc_essai » (hors budget du jour)', db.agent_runs.map((r) => r.purpose));
ok(db.agent_journal.some((j) => j.kind === 'banc_essai' && /^Banc d'essai \(Haiku 5\.5\) : 3 entreprises, note 47\/100, 1 fois la même personne/.test(String(j.summary))), 'journal : le bilan du banc', db.agent_journal.map((j) => j.summary));

// La limite du banc : une limite minuscule arrête après la première entreprise.
db.agent_tasks.push({ id: 'tb2', agent: 'dana', kind: 'qualification', status: 'en_attente', params: { banc: true, n: 5, limite_usd: 0.001 }, created_by: 'u-channing', created_at: new Date().toISOString() });
await runNextTask();
const t2 = db.agent_tasks.find((x) => x.id === 'tb2') as Row;
const r2 = (t2.result ?? {}) as { essais?: BenchTrial[]; arret?: string | null };
ok(t2.status === 'terminee' && (r2.essais ?? []).length === 1 && /limite de 0,00 \$ atteinte|limite de/.test(String(r2.arret)), 'limite du banc : il s\'arrête et le dit', r2);

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

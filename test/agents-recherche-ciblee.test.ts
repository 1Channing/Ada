/**
 * La recherche ciblée et le bilan à qui l'a lancée (18/10, Channing :
 * « lancer une recherche ciblée sur une entreprise donnée — type, pays, et
 * des notes (Opus 5.5 lorsqu'il y a des notes), une limite de dépense en
 * option ; un bilan par mail au compte qui l'a lancée ; si elle n'aboutit
 * pas faute de budget, proposer d'augmenter le budget ou de finir soi-même,
 * c'est gratuit »). La partie pure (consigne, schéma, texte du mail), puis le
 * worker avec un faux serveur Claude, un faux Google et une base simulée :
 * 1. une limite atteinte dès la recherche — le bilan dit ce qui reste, avec
 *    les recherches toutes prêtes ;
 * 2. sans limite, une entreprise déjà connue visée par les notes — sa fiche
 *    est approfondie avec les notes en consigne, sur Opus 5.5 ;
 * 3. un lancement de deux recherches sans notes — un seul bilan, à la fin.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { targetedPrompt, targetedSchema, segmentOf, TARGETED_SEARCHES, TARGETED_FETCHES } from '../src/lib/agents/research';
import { researchMail } from '../src/lib/agents/researchMail';
import { OPUS } from '../src/lib/agents/aiCost';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
type Row = Record<string, unknown>;

console.log('\n=== ADA ET DANA : LA RECHERCHE CIBLÉE ===\n');

// --- La consigne, le schéma, le mail -----------------------------------------------------------------
const groupe = segmentOf('dana', 'groupe');
const loueur = segmentOf('dana', 'loueur');
const NOTES = 'Le groupe Hess et ses concessions en Moselle : qui gère la revente des VO et le de-fleet ?';
const tp = targetedPrompt({ role: 'dana', segments: [groupe!, loueur!], country: 'FR', notes: NOTES, known: ['Hess Automobile'] });
ok(tp.includes(`<notes_de_channing>\n${NOTES}\n</notes_de_channing>`) && tp.includes('(« groupe »)') && tp.includes('(« loueur »)') && tp.includes('trouve-le lui-même')
  && tp.includes('Déjà connues de l\'équipe : Hess Automobile — n\'en rends une que si les notes la visent nommément.') && tp.includes(`${TARGETED_SEARCHES} recherches au plus`) && tp.includes(`${TARGETED_FETCHES} pages au plus`),
  'consigne ciblée : les notes d\'abord, les types visés, les entreprises connues seulement si les notes les visent', tp.split('\n'));
const sch = targetedSchema(['groupe', 'loueur']) as unknown as { properties: { comptes: { items: { required: string[]; properties: { type: { enum: string[] } } } } } };
ok(sch.properties.comptes.items.required.includes('type') && sch.properties.comptes.items.properties.type.enum.join() === 'groupe,loueur', 'schéma ciblé : chaque entreprise avec son type, parmi ceux cochés');
const m0 = researchMail({
  agent: 'dana', name: 'Dana', ask: { types: ['Groupes de distribution'], country: 'France', notes: NOTES, limit: 1 },
  companies: [{ name: 'Garage Rauch', city: 'Metz', type: 'Groupes de distribution', fiche: null }, { name: 'Hess Automobile', city: null, type: null, known: true, fiche: { score: 58, key: true, contact: 'Marc Hess, directeur VO du groupe', email: 'm.hess@groupehess.com', phone: null, missing: ['pas de téléphone'], leads: ['Appeler le standard du groupe.'] } }],
  dropped: 2, cost: 1.04, stopped: { reason: 'limite', detail: 'la limite de 1,00 $ est atteinte (1,04 $ dépensés)' },
  todo: [{ what: 'Garage Rauch : trouver qui décide', links: [{ label: 'Google', url: 'https://www.google.com/search?q=Garage%20Rauch' }] }], link: 'https://ada-ui-test.up.railway.app/agents?agente=dana&onglet=comptes',
});
ok(m0.subject === 'Dana — votre recherche : « Le groupe Hess et ses concessions en Moselle : qui gère l… » (France) — arrêtée avant la fin'
  && m0.body.includes('• Entreprises trouvées : 1 (et 1 déjà connue de l\'équipe) — 2 écartées (site invérifiable ou hors sujet)')
  && m0.body.includes('    fiche 58/100 · grand compte · à contacter : Marc Hess, directeur VO du groupe — m.hess@groupehess.com')
  && m0.body.includes('• Dépense IA : 1,04 $ (limite 1,00 $)') && m0.body.includes('1. La relancer avec une limite plus haute : https://ada-ui-test.up.railway.app/agents?agente=dana&onglet=comptes')
  && m0.body.includes('2. La finir vous-même, gratuitement — ce qui reste :\n   – Garage Rauch : trouver qui décide\n     Google : https://www.google.com/search?q=Garage%20Rauch'),
  'mail : ce qui était demandé, les entreprises et leur fiche, la dépense, et l\'arrêt — relancer avec plus, ou finir soi-même', { subject: m0.subject, body: m0.body.split('\n') });

// --- Le worker ------------------------------------------------------------------------------------
const calls: Array<{ model: string; system: string; user: string; tools?: Array<{ name: string; max_uses?: number }> }> = [];
const RAUCH = 'https://www.garage-rauch.fr/';
const HESS = 'https://www.groupehess.com/';
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!(req.url?.startsWith('/v1/messages') && req.method === 'POST')) { res.writeHead(404); res.end(); return; }
  let raw = '';
  for await (const ch of req) raw += ch;
  const body = JSON.parse(raw) as { model: string; system: Array<{ text: string }>; messages: Array<{ content: unknown }>; tools?: Array<{ name: string; max_uses?: number }> };
  const system = body.system?.[0]?.text ?? '';
  const user = String(body.messages[0].content);
  calls.push({ model: body.model, system, user, tools: body.tools });
  const usage = { input_tokens: 60_000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 } };
  const reply = (content: unknown[]) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content, stop_reason: 'end_turn', stop_sequence: null, usage })); };
  const results = (urls: string[]) => [
    { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'x' } },
    { type: 'web_search_tool_result', tool_use_id: 'srv1', content: urls.map((url) => ({ type: 'web_search_result', url, title: url, encrypted_content: 'x', page_age: null })) },
  ];
  // La fiche (Haiku 5.5) d'une entreprise trouvée.
  if (raw.includes('raison_sociale')) {
    return reply([{ type: 'text', text: JSON.stringify({ site_web: RAUCH, raison_sociale: 'Garage Rauch', groupe: null, nb_sites: 3, type: 'groupe', marques_officielles: [], emails: [], contacts: [],
      meilleur_contact: { nom: null, fonction: null, email: null, linkedin: null, pourquoi: '' }, langue: 'fr', grand_compte: true, ajustement: 0, exclure: false, motif_exclusion: null, resume: 'Trois concessions en Moselle.' }) }]);
  }
  if (/aller plus loin/.test(system)) {
    return reply([{ type: 'text', text: JSON.stringify({ proprietaire: { groupe: null, site_officiel: null, nb_sites: null, siege: null, source: null }, canaux: [], personnes: [], emails: [], telephones: [], meilleur_contact: { nom: null, fonction: null, email: null, telephone: null, linkedin: null, pourquoi: 'rien de plus' }, pistes: [], resume: '' }) }]);
  }
  // 20/10 : les recherches LinkedIn (par poste, puis par nom) qui suivent la recherche approfondie — rien de vu ici, hors sujet pour ce test (sans jetons).
  if (/QUI occupe certains postes|profil LinkedIn public d'une personne/.test(system)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(/QUI occupe/.test(system) ? { profils: [] } : { linkedin: null, titre: null, entreprise_vue: false, source: null }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } } }));
    return;
  }
  // La recherche (ciblée ou non) : sans notes, une entreprise différente à chaque recherche.
  const plain = ['Leasing Est', 'Loueur Est'][calls.filter((c) => !c.user.includes('<notes_de_channing>') && !/aller plus loin|QUI occupe certains postes|profil LinkedIn public/.test(c.system)).length - 1] ?? 'Autre Est';
  const comptes = user.includes('<notes_de_channing>')
    ? [
      { nom: 'Garage Rauch', site_web: RAUCH, ville: 'Metz', taille: null, pourquoi: 'Concession du secteur.', sources: [RAUCH], type: 'groupe' },
      { nom: 'Hess Automobile', site_web: HESS, ville: 'Forbach', taille: '86 sites', pourquoi: 'Le groupe visé par les notes.', sources: [HESS], type: 'groupe' },
    ]
    : [{ nom: plain, site_web: `https://www.${plain.toLowerCase().replace(' ', '-')}.fr/`, ville: 'Nancy', taille: null, pourquoi: 'x', sources: [], type: undefined }];
  const urls = comptes.map((c) => c.site_web);
  return reply([...results(urls), { type: 'text', text: JSON.stringify({ comptes, remarque: null }) }]);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = base;
process.env.ADA_APP_URL = 'https://ada-ui-test.up.railway.app';
// Gmail et Google simulés (le bilan part de la boîte de Dana, en-tête interne).
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'ada@projet.iam.gserviceaccount.com', client_id: '123', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const sent: Array<{ from: string; to: string; subject: string; body: string; interne: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'jeton' }));
  if (u === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
    const raw = Buffer.from(JSON.parse(String(init?.body)).raw, 'base64url').toString();
    const header = (k: string) => raw.match(new RegExp(`^${k}: (.*)$`, 'm'))?.[1] ?? '';
    const subject = header('Subject').split(' ').map((w) => w.replace(/^=\?UTF-8\?B\?(.*)\?=$/, (_, b) => Buffer.from(b, 'base64').toString())).join('');
    const b64 = raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1]?.split('\r\n--')[0] ?? '';
    sent.push({ from: header('From'), to: header('To'), subject, body: Buffer.from(b64.replace(/\r\n/g, ''), 'base64').toString(), interne: header('X-ADA-Interne') });
    return new Response(JSON.stringify({ id: `m${sent.length}`, threadId: 't' }));
  }
  if (u.startsWith(base)) return realFetch(input, init);
  return new Response('<html><body>Leasing Est, Loueur Est, location et leasing à Nancy.</body></html>', { headers: { 'content-type': 'text/html' } });
}) as typeof fetch;

const dana = { agent: 'dana', display_name: 'Dana', mailbox: 'dana@mc-export.com', signature: 'Dana\nMC Export', daily_budget_usd: 50, instructions: '', map_auto_add: false, map_min_score: 70, targets: { minLot: 3, markets: ['NL'], brands: ['Toyota'] } };
const db: FakeDb = {
  agent_settings: [dana as unknown as Row],
  agent_prospects: [{
    id: 'p-hess', agent: 'dana', name: 'Hess Automobile', website: HESS, country: 'FR', city: 'Forbach', stage: 'qualifie', key_account: true, score: 58, account_id: null, dealer_id: null,
    emails: [], people: [], evidence: [], fit_parts: [], fit_score: 40, phone: null, kind: 'groupe', group_name: 'Hess Automobile', summary: 'Groupe de concessions.', language: 'fr',
    best_contact: { nom: 'Marc Hess', fonction: 'directeur VO du groupe', email: null, pourquoi: '' },
  }],
  agent_accounts: [], agent_tasks: [], agent_runs: [], agent_journal: [], app_config: [], network_contacts: [], transactions_admin: [], email_suppressions: [], agent_threads: [], agent_messages: [],
  profiles: [{ id: 'u-channing', organisation: 'MC Export', blocked: false }],
};
const users = [{ id: 'u-channing', email: 'channing@mc-export.com' }];
setSharedSupabase({ ...fakeSupabase(db), auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } } } as never);
const { runNextTask } = await import('../worker/agents/tasks');
const task = (o: Row) => db.agent_tasks.push({ status: 'en_attente', created_at: new Date().toISOString(), created_by: 'u-channing', agent: 'dana', kind: 'recherche_comptes', ...o });

// 1. Une limite atteinte dès la recherche.
task({ id: 'tc1', params: { segment: 'groupe', segments: ['groupe', 'loueur'], country: 'FR', notes: NOTES, limite_usd: 0.01 } });
await runNextTask();
const t1 = db.agent_tasks.find((t) => t.id === 'tc1') as Row & { result: Row };
const c1 = calls[0];
ok(c1?.model === OPUS && c1.user.includes(`<notes_de_channing>\n${NOTES}`) && c1.tools?.find((x) => x.name === 'web_search')?.max_uses === TARGETED_SEARCHES && c1.tools?.find((x) => x.name === 'web_fetch')?.max_uses === TARGETED_FETCHES,
  'recherche ciblée : Opus 5.5, les notes, 6 recherches et 4 pages au plus', c1 && { model: c1.model, tools: c1.tools });
ok(t1.status === 'terminee' && t1.result.ciblee === true && t1.result.gardes === 1 && t1.result.deja === 1 && t1.result.fiches === 0 && t1.result.approfondies === 0 && /limite de 0,01 \$ est atteinte/.test(String(t1.result.arret)) && calls.length === 1,
  'limite atteinte après la recherche : une entreprise nouvelle (Garage Rauch, son type), Hess déjà connue, rien de plus (pas de fiche, pas d\'autre appel)', t1.result);
ok(db.agent_accounts.length === 1 && db.agent_accounts[0].name === 'Garage Rauch' && db.agent_accounts[0].segment === 'groupe', 'compte enregistré avec le type rendu', db.agent_accounts);
const mail1 = sent[0];
ok(sent.length === 1 && mail1.to === 'channing@mc-export.com' && mail1.from === 'Dana (ADA) <dana@mc-export.com>' && mail1.interne === 'recherche' && /— arrêtée avant la fin$/.test(mail1.subject)
  && mail1.body.includes('1. La relancer avec une limite plus haute : https://ada-ui-test.up.railway.app/agents?agente=dana&onglet=comptes')
  && mail1.body.includes('   – Garage Rauch : trouver qui décide') && mail1.body.includes('     Google : https://www.google.com/search?q=') && mail1.body.includes('     LinkedIn : https://www.linkedin.com/search/results/people/'),
  'bilan à Channing, depuis la boîte de Dana (en-tête interne) : arrêtée, relancer avec plus, ou finir soi-même avec les recherches prêtes', mail1 && { subject: mail1.subject, body: mail1.body.split('\n') });

// 2. Sans limite, la même recherche : Garage Rauch (trouvé la première fois, encore sans fiche) a sa fiche ; la fiche connue de Hess
//    et la nouvelle sont approfondies avec les notes en consigne, sur Opus 5.5.
task({ id: 'tc2', params: { segment: 'groupe', segments: ['groupe'], country: 'FR', notes: NOTES } });
const before = calls.length;
await runNextTask();
const t2 = db.agent_tasks.find((t) => t.id === 'tc2') as Row & { result: Row };
const deepCalls = calls.slice(before).filter((c) => /aller plus loin/.test(c.system));
ok(t2.status === 'terminee' && t2.result.gardes === 0 && t2.result.deja === 1 && t2.result.fiches === 1 && t2.result.approfondies === 2 && t2.result.arret === null
  && deepCalls.length === 2 && deepCalls.every((c) => c.model === OPUS && c.user.includes(`<consigne_de_channing>\n${NOTES}\n</consigne_de_channing>`)) && deepCalls[0].user.includes('Entreprise : Hess Automobile'),
  'sans limite : la fiche de Garage Rauch (déjà trouvé, sans fiche), puis Hess et Rauch approfondis avec les notes, sur Opus 5.5', { result: t2.result, deep: deepCalls.map((c) => c.model) });
const mail2 = sent[1];
ok(sent.length === 2 && !/arrêtée/.test(mail2.subject) && mail2.body.includes('  – Garage Rauch (Metz) · Groupes de concessions · déjà connue') && mail2.body.includes('  – Hess Automobile (Forbach) · déjà connue')
  && /fiche \d+\/100 · grand compte · à contacter : Marc Hess, directeur VO du groupe/.test(mail2.body) && !mail2.body.includes('La finir vous-même'),
  'bilan sans arrêt : les deux entreprises, leur fiche, qui contacter', mail2 && mail2.body.split('\n'));

// 3. Un lancement de deux recherches sans notes : un seul bilan, quand la dernière est finie.
task({ id: 'tl1', params: { segment: 'leasing', country: 'FR', lot: 'lot-1' } });
task({ id: 'tl2', params: { segment: 'loueur', country: 'FR', lot: 'lot-1' } });
await runNextTask();
ok(sent.length === 2 && db.agent_tasks.find((t) => t.id === 'tl1')?.status === 'terminee', 'première recherche du lancement finie : pas encore de bilan');
await runNextTask();
const mail3 = sent[2];
ok(sent.length === 3 && mail3.subject.startsWith('Dana — votre recherche : Sociétés de leasing, Loueurs') && mail3.body.includes('• Entreprises trouvées : 2'),
  'dernière recherche finie : un seul bilan pour le lancement, les deux types', mail3 && { subject: mail3.subject, body: mail3.body.split('\n') });
ok(db.app_config.some((c) => c.key === 'recherche_bilan:lot-1'), 'verrou du lancement : le bilan ne part qu\'une fois');

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

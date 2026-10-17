/**
 * Ada, phase 2.3 (17/10) : le premier mail. Le contrôle du brouillon
 * (longueur, lien, question, chiffres absents des données), la consigne,
 * puis le parcours du worker avec un faux serveur Claude et une base
 * simulée : brouillon « à valider » dans un fil neuf rattaché au prospect,
 * traduction, signature, garde-fous (déjà en conversation, « ne plus
 * contacter », e-mail non vérifié), repli serveur demandé pour Opus 5.5.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { numbersIn, checkFirstMail, firstMailPrompt, withAgentSignature, type FirstMailOutput } from '../src/lib/agents/firstMail';
import { OPUS } from '../src/lib/agents/aiCost';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== ADA : LE PREMIER MAIL ===\n');

// --- Contrôle du brouillon ---------------------------------------------------------------
ok(JSON.stringify(numbersIn('Leur C-HR 2021 à 23 900 €, 38.000 km, environ 8 % de moins')) === '["2021","23900","38000"]', 'chiffres : années, prix et km reconnus (le « 8 % » n\'est pas contrôlé)', numbersIn('Leur C-HR 2021 à 23 900 €, 38.000 km, environ 8 % de moins'));
const material = 'Ford Transit Custom 2021 (85 000 km) prix MC Export 19 500 € HT ; leur Transit Custom 2021 affiché 27 900 € TTC';
const good: FirstMailOutput = {
  objet: 'Uw Transit Customs',
  corps: 'Goedemiddag meneer Kuhn,\n\nIk zag dat Busvan acht Ford Transit Customs van 2021 aanbiedt. Ik ben Ada, van MC Export, een Franse exporteur van jonge occasions. We hebben nu een Transit Custom 2021 met 85 000 km, ongeveer 15 % onder uw vraagprijzen voor vergelijkbare modellen, geleverd binnen één tot tweeënhalve week.\n\nZal ik u de fiche sturen?\n\nAls dit niets voor u is, laat het me weten, dan stuur ik u geen herinnering.',
  traduction_fr: '…', faits: [{ fait: 'Transit Custom 2021, 85 000 km', source: 'offre' }],
};
ok(checkFirstMail(good, material).warnings.length === 0, 'contrôle : un bon brouillon passe sans remarque', checkFirstMail(good, material));
const bad = checkFirstMail({ ...good, corps: 'Bonjour, voici nos véhicules sur www.mc-export.com à 12 500 €. Contactez-nous.' }, material);
ok(bad.warnings.some((w) => w.includes('lien')) && bad.warnings.some((w) => w.includes('question')) && bad.warnings.some((w) => w.includes('12500')) && bad.warnings.some((w) => w.includes('court')),
  'contrôle : lien, absence de question, chiffre inconnu et brièveté signalés', bad.warnings);
const prompt = firstMailPrompt({
  company: 'Busvan', country: 'NL', city: 'Raamsdonksveer', language: 'nl', contact: { name: 'Thomas Kuhn', role: 'Verkoop' }, kind: 'utilitaires', group: null, officialBrands: [],
  summary: 'Spécialiste des utilitaires.', stock: { listings: 22, byBrand: [{ brand: 'Ford', n: 8 }], models: ['Ford Transit Custom (8)'] },
  gaps: ['leur Ford Transit Custom 2021 affiché 27 900 € TTC'], offers: [{ title: 'Ford Transit Custom', year: 2021, km: 85_000, priceHt: 19_500, withVat: 23_595 }], instructions: '',
});
ok(prompt.startsWith('Écris le premier mail en néerlandais.') && prompt.includes('<nos_offres>') && /19\s500 € HT/.test(prompt) && prompt.includes('ne promets aucune condition'),
  'consigne : langue, offres avec leur prix HT, et sans consignes → aucune condition promise');
ok(withAgentSignature('Bonjour,\n\nCorps.\n', 'Ada\nMC Export') === 'Bonjour,\n\nCorps.\n\nAda\nMC Export', 'signature ajoutée après le corps');

// --- Le parcours du worker ------------------------------------------------------------------
const now = new Date().toISOString();
const prospect = (id: string, email: string, o: Record<string, unknown> = {}) => ({
  id, agent: 'ada', dealer_id: 'd1', name: `Garage ${id}`, country: 'NL', city: 'Raamsdonksveer', group_name: null, kind: 'utilitaires', brands_official: [], language: 'nl',
  summary: 'Spécialiste des utilitaires.', stage: 'qualifie', score: 82, network_contact_id: null,
  best_contact: { nom: 'Thomas Kuhn', fonction: 'Verkoop', email }, emails: [{ email, mx: true }], ...o,
});
const db: FakeDb = {
  agent_prospects: [
    prospect('p1', 'verkoop@busvan.nl'),
    prospect('p2', 'info@garage-x.nl'),
    prospect('p3', 'info@mort.nl', { emails: [{ email: 'info@mort.nl', mx: false }] }),
    prospect('p4', 'vente@garage-y.nl', { score: 90 }),
    prospect('p5', 'contact@garage-z.nl', { score: 60 }),
    // Qualifié avant le 17/10 alors qu'il est en France (pays d'achat) : jamais un premier mail d'Ada.
    prospect('p6', 'vo@garage-lyon.fr', { country: 'FR', score: 95 }),
  ],
  market_dealer_listings: Array.from({ length: 8 }, (_, i) => ({ dealer_id: 'd1', listing_url: `v${i}`, brand: 'FORD', model: 'Transit Custom', year: 2021, mileage: 90_000, price_eur: 27_900, title: '', last_seen_at: now })),
  intra_showcase: [{ id: 'o1', vehicle: { brand: 'Ford', model: 'Transit Custom', year: 2021, km: 85_000 }, price_ht: 19_500, title: 'Ford Transit Custom' }],
  email_suppressions: [{ email: '@garage-x.nl' }],
  agent_threads: [], agent_messages: [], agent_journal: [], agent_runs: [],
};
setSharedSupabase(fakeSupabase(db) as never);

const calls: Array<{ body: Record<string, unknown>; beta: string }> = [];
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  let raw = '';
  for await (const ch of req) raw += ch;
  const body = JSON.parse(raw || '{}') as Record<string, unknown> & { messages: Array<{ content: string }> };
  calls.push({ body, beta: String(req.headers['anthropic-beta'] ?? '') });
  const forY = String(body.messages[0].content).includes('Garage p4');
  const out: FirstMailOutput = forY ? { ...good, corps: `${good.corps}\nZie www.mc-export.com, vanaf 12 500 €.` } : good;
  const usage = { input_tokens: 3000, output_tokens: 900, cache_creation_input_tokens: 1500, cache_read_input_tokens: 0, server_tool_use: null };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: OPUS, content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage }));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const { draftFirstMail, nextDraftCandidates } = await import('../worker/agents/firstMail');
const agent = { agent: 'ada', mailbox: 'ada@mc-export.com', signature: 'Ada\nMC Export', daily_budget_usd: 3, map_min_score: 70, instructions: '', daily_first_contact_cap: 10 } as never;

ok(JSON.stringify(await nextDraftCandidates(agent, 10)) === '["p4","p1"]', 'candidats : au-dessus du seuil, e-mail vérifié, pas sur « ne plus contacter », hors de France, le meilleur score d\'abord', await nextDraftCandidates(agent, 10));

const o1 = await draftFirstMail('p1', agent, 't1');
const thread = db.agent_threads[0] as Record<string, unknown> | undefined;
const msg = db.agent_messages[0] as (Record<string, unknown> & { ai_notes: { alertes: string[]; faits: unknown[] }; body_text: string; to_emails: string[] }) | undefined;
ok(o1.status === 'redige' && thread?.prospect_id === 'p1' && thread?.counterpart_email === 'verkoop@busvan.nl' && thread?.counterpart_name === 'Thomas Kuhn', 'brouillon : fil neuf rattaché au prospect', { o1, thread });
ok(msg?.status === 'a_valider' && msg.kind === 'premier_contact' && msg.author === 'ada' && msg.to_emails.join() === 'verkoop@busvan.nl', 'brouillon : « à valider », premier contact, rédigé par Ada, vers l\'e-mail vérifié', msg);
ok(msg?.body_text.endsWith('\n\nAda\nMC Export') === true && msg?.translation_fr === '…' && msg?.subject === 'Uw Transit Customs', 'brouillon : signature d\'Ada, traduction française, objet', msg?.body_text);
ok(msg?.ai_notes.alertes.length === 0 && msg?.ai_notes.faits.length === 1, 'brouillon : faits cités, rien à signaler', msg?.ai_notes);
ok((db.agent_prospects[0] as Record<string, unknown>).stage === 'a_contacter', 'prospect : passe « à contacter »');
const c0 = calls[0];
ok(c0?.body.model === OPUS && c0.body.fallbacks === 'default' && c0.beta.includes('server-side-fallback-2026-07-01') && (c0.body.output_config as { effort?: string }).effort === 'medium',
  'appel : Opus 5.5, effort moyen, repli serveur demandé', { model: c0?.body.model, fallbacks: c0?.body.fallbacks, beta: c0?.beta });
ok(db.agent_runs.length === 1 && db.agent_runs[0].purpose === 'premier_mail' && Number(db.agent_runs[0].cost_usd) > 0, 'appel inscrit avec son coût', db.agent_runs[0]);
ok(db.agent_journal.some((j) => String(j.summary).startsWith('Premier mail rédigé pour Garage p1')), 'journal');

const again = await draftFirstMail('p1', agent, 't1');
ok(again.status === 'ignore' && /conversation|étape/.test(again.detail) && calls.length === 1, 'garde-fou : pas de second premier mail au même garage', again);
const sup = await draftFirstMail('p2', agent, 't1');
ok(sup.status === 'ignore' && sup.detail.includes('ne plus contacter') && calls.length === 1, 'garde-fou : domaine sur « ne plus contacter »', sup);
const dead = await draftFirstMail('p3', agent, 't1');
ok(dead.status === 'ignore' && dead.detail.includes('vérifié') && calls.length === 1, 'garde-fou : e-mail dont le domaine ne reçoit pas de courrier', dead);

const fr = await draftFirstMail('p6', agent, 't1');
ok(fr.status === 'ignore' && /France/.test(fr.detail) && calls.length === 1, 'garde-fou : un garage en France n\'est pas un acheteur (aucun brouillon)', fr);

const o4 = await draftFirstMail('p4', agent, 't1');
const m4 = db.agent_messages.find((m) => (m.to_emails as string[]).includes('vente@garage-y.nl')) as { ai_notes: { alertes: string[] } } | undefined;
ok(o4.status === 'redige' && (m4?.ai_notes.alertes ?? []).some((w) => w.includes('lien')) && (m4?.ai_notes.alertes ?? []).some((w) => w.includes('12500')), 'contrôle : lien et chiffre inventé signalés au validateur', m4?.ai_notes);

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

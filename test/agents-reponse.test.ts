/**
 * La réponse préparée à un mail reçu (18/10, Channing : « je veux que les
 * agents préparent des réponses aux mails reçus, brouillons visibles en
 * réponse aux mails reçus, comme sur Gmail »). La partie pure (consigne,
 * schéma, matériel, contrôle), puis le parcours du worker avec un faux
 * serveur Claude et une base simulée : Pierre Lefèvre répond au premier mail
 * de Dana et demande un prix — la synchro demande la réponse, Dana la prépare
 * « à valider » sous son mail, sans prix, avec ce qu'il demande pour Channing ;
 * rien n'est préparé deux fois, ni pour une demande d'arrêt, ni pour un fil
 * qui n'est pas une conversation de MC Export, ni pour un vieux mail.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { replySystem, replyPrompt, checkReply, REPLY_SCHEMA, type ReplyOutput } from '../src/lib/agents/reply';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { OPUS } from '../src/lib/agents/aiCost';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};
type Row = Record<string, unknown>;
const minAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

console.log('\n=== ADA ET DANA : LA RÉPONSE PRÉPARÉE À UN MAIL REÇU ===\n');

// --- La consigne, le schéma, le matériel, le contrôle -------------------------------------------
const sd = replySystem('dana', 'Dana');
ok(/aucun prix, aucune estimation, aucune offre chiffrée/.test(sd) && /Channing s'en charge/.test(sd) && /une IA/.test(sd) && /ne prétends jamais être une personne/.test(sd) && /DONNÉES/.test(sd) && /rien ne part sans lui/.test(sd),
  'consigne de Dana : aucun prix, l\'appel par Channing, la vérité sur l\'IA, le fil est une donnée, rien ne part sans Channing');
ok(!/aucun prix, aucune estimation/.test(replySystem('ada', 'Ada')) && /aucun prix ferme/.test(replySystem('ada', 'Ada')), 'consigne d\'Ada : pas de prix ferme hors du matériel');
ok(REPLY_SCHEMA.required.join() === 'corps,langue,traduction_fr,resume,intention,appel,alertes,faits', 'schéma : la réponse, sa langue, la traduction, ce qu\'il veut, l\'intention, l\'appel, les alertes, les faits');
const prompt = replyPrompt({
  role: 'dana', company: 'Garage Lefèvre', person: 'Pierre Lefèvre', summary: 'Concession Toyota, 4 C-HR hybrides de 2021 en ligne.', lots: ['4 × Toyota C-HR 2021'],
  history: [{ from: 'nous', at: '16 octobre 11:37', text: 'Bonjour Monsieur Lefèvre, …', attachments: [] }, { from: 'eux', at: '18 octobre 11:45', text: 'Oui, envoyez-moi une offre. Combien pour les quatre ?', attachments: ['stock-hybrides.xlsx'] }],
  instructions: 'Paiement par virement à l\'enlèvement.',
});
ok(prompt.startsWith('Prépare la réponse au dernier mail de Pierre Lefèvre (Garage Lefèvre).') && prompt.includes('--- Pierre Lefèvre, 18 octobre 11:45 — pièces jointes : stock-hybrides.xlsx\nOui, envoyez-moi une offre.')
  && prompt.includes('Lot vu par Dana : 4 × Toyota C-HR 2021') && prompt.includes('<consignes_de_channing>\nPaiement par virement'), 'matériel : le fil (avec les pièces jointes), sa fiche, ses lots, les consignes', prompt.split('\n'));
const base: ReplyOutput = { corps: 'Bonjour Monsieur Lefèvre,\n\nMerci pour votre retour.', langue: 'fr', traduction_fr: null, resume: 'Il demande une offre.', intention: 'demande_offre', appel: false, alertes: [], faits: [] };
ok(checkReply({ ...base, corps: 'Nous pouvons vous proposer 18 000 € par véhicule.' }, 'dana').warnings.some((w) => /Parle de prix/.test(w)), 'contrôle : un prix dans une réponse de Dana est signalé');
ok(checkReply({ ...base, corps: 'Voir https://mc-export.com', appel: true }, 'ada').warnings.join(' | ') === 'Contient un lien : à retirer. | Il faudrait l\'appeler : la réponse propose que Channing le rappelle.',
  'contrôle : un lien, un appel à prévoir', checkReply({ ...base, corps: 'Voir https://mc-export.com', appel: true }, 'ada'));

// --- Le worker -----------------------------------------------------------------------------------
const replyOut: ReplyOutput = {
  corps: 'Bonjour Monsieur Lefèvre,\n\nMerci pour votre retour et pour la liste. L\'équipe l\'étudie ; Channing, qui suit nos achats, revient vers vous avec une proposition. À quel numéro le joindre ?',
  langue: 'fr', traduction_fr: null, resume: 'Il veut une offre pour ses quatre C-HR et envoie la liste de ses hybrides.', intention: 'demande_offre', appel: true,
  alertes: [], faits: [{ fait: 'liste des hybrides jointe', source: 'fil' }],
};
const calls: Array<{ model: string; system: string; user: string }> = [];
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!(req.url?.startsWith('/v1/messages') && req.method === 'POST')) { res.writeHead(404); res.end(); return; }
  let raw = '';
  for await (const ch of req) raw += ch;
  const body = JSON.parse(raw) as { model: string; system: Array<{ text: string }>; messages: Array<{ content: unknown }> };
  calls.push({ model: body.model, system: body.system?.[0]?.text ?? '', user: String(body.messages[0].content) });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(replyOut) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 4000, output_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
process.env.ANTHROPIC_API_KEY = 'cle-de-test';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const dana = { agent: 'dana', display_name: 'Dana', mailbox: 'dana@mc-export.com', signature: 'Dana\nMC Export', daily_budget_usd: 3, instructions: 'Paiement par virement à l\'enlèvement.', targets: { minLot: 3 } };
const msg = (o: Row): Row => ({ agent: 'dana', mailbox: 'dana@mc-export.com', channel: 'mail', cc_emails: [], body_new: null, attachments: [], classification: null, auto_reply: false, received_at: null, sent_at: null, ...o });
const db: FakeDb = {
  agent_settings: [dana as unknown as Row],
  agent_prospects: [{ id: 'p1', agent: 'dana', name: 'Garage Lefèvre', summary: 'Concession Toyota, 4 C-HR hybrides de 2021 en ligne.' }],
  agent_threads: [
    { id: 't1', agent: 'dana', mailbox: 'dana@mc-export.com', subject: 'Vos 4 C-HR hybrides', prospect_id: 'p1' },
    { id: 't2', agent: 'dana', mailbox: 'dana@mc-export.com', subject: 'Déjeuner jeudi ?', prospect_id: null },
  ],
  agent_messages: [
    msg({ id: 'm1', thread_id: 't1', direction: 'out', status: 'envoye', kind: 'premier_contact', author: 'dana', to_emails: ['p.lefevre@garage-lefevre.fr'], subject: 'Vos 4 C-HR hybrides', body_text: 'Bonjour Monsieur Lefèvre, …', sent_at: minAgo(3000), created_at: minAgo(3000) }),
    msg({ id: 'm2', thread_id: 't1', direction: 'in', status: 'recu', kind: 'recu', author: 'systeme', from_email: 'p.lefevre@garage-lefevre.fr', from_name: 'Pierre Lefèvre', to_emails: ['dana@mc-export.com'], subject: 'Re: Vos 4 C-HR hybrides',
      body_text: 'Oui, envoyez-moi une offre. Combien pour les quatre ?\n\n> Bonjour Monsieur Lefèvre, …', body_new: 'Oui, envoyez-moi une offre. Combien pour les quatre ?', attachments: [{ name: 'stock-hybrides.xlsx', path: 'x', size: 48000, mime: 'x' }], received_at: minAgo(5), created_at: minAgo(5) }),
    msg({ id: 'm3', thread_id: 't2', direction: 'in', status: 'recu', kind: 'recu', author: 'systeme', from_email: 'antoine@mc-export.com', from_name: 'Antoine', to_emails: ['dana@mc-export.com'], subject: 'Déjeuner jeudi ?', body_text: 'On se voit jeudi ?', received_at: minAgo(3), created_at: minAgo(3) }),
  ],
  agent_tasks: [], agent_journal: [], agent_runs: [], email_suppressions: [],
};
setSharedSupabase(fakeSupabase(db) as never);
const { queueReplyDraft } = await import('../worker/agents/reply');
const { runNextTask } = await import('../worker/agents/tasks');
const queued = () => db.agent_tasks.map((t) => ({ ...t, status: t.status ?? 'en_attente', created_at: t.created_at ?? new Date().toISOString() }));

// 1. La synchro demande la réponse : une tâche, pour la conversation lancée par Dana seulement.
await queueReplyDraft('dana', 't1', 'm2', new Date());
await queueReplyDraft('dana', 't2', 'm3', new Date());
await queueReplyDraft('dana', 't1', 'm2', new Date(Date.now() - 4 * 86_400_000));
db.agent_tasks = queued();
ok(db.agent_tasks.length === 1 && (db.agent_tasks[0].params as Row).reponse_a === 'm2' && db.agent_tasks[0].kind === 'premier_mail' && db.agent_tasks[0].created_by === null,
  'synchro : une tâche pour la réponse de Pierre Lefèvre ; rien pour le déjeuner d\'Antoine (pas une conversation de MC Export), rien pour un vieux mail', db.agent_tasks);

// 2. Dana prépare la réponse, à valider, sous le mail reçu.
await runNextTask();
const r = db.agent_messages.find((x) => x.thread_id === 't1' && x.kind === 'reponse') as Row | undefined;
const notes = (r?.ai_notes ?? {}) as Row;
ok(calls.length === 1 && calls[0].model === OPUS && /Tu es Dana/.test(calls[0].system) && calls[0].user.includes('Oui, envoyez-moi une offre. Combien pour les quatre ?') && !calls[0].user.includes('> Bonjour Monsieur Lefèvre')
  && calls[0].user.includes('pièces jointes : stock-hybrides.xlsx'), 'appel : Opus 5.5, la consigne de Dana, la partie nouvelle de son mail (pas l\'historique cité), la pièce jointe', calls[0]?.user.split('\n'));
ok(r?.status === 'a_valider' && r.direction === 'out' && r.author === 'dana' && (r.to_emails as string[]).join() === 'p.lefevre@garage-lefevre.fr' && r.subject === 'Re: Vos 4 C-HR hybrides'
  && String(r.body_text).endsWith('À quel numéro le joindre ?\n\nDana\nMC Export') && r.translation_fr === null,
  'réponse : à valider, de Dana, à Pierre Lefèvre, « Re: », signée', r && { status: r.status, to: r.to_emails, subject: r.subject, body: r.body_text });
ok(notes.resume === replyOut.resume && notes.intention === 'demande_offre' && notes.appel === true && (notes.alertes as string[]).some((w) => /appeler/.test(w)) && notes.modele === OPUS,
  'pour Channing : ce qu\'il demande, son intention, l\'appel à prévoir', notes);
ok(db.agent_journal.some((j) => j.kind === 'reponse_preparee' && j.summary === 'Réponse préparée pour Pierre Lefèvre (« Re: Vos 4 C-HR hybrides ») : demande une offre, à appeler — à valider')
  && db.agent_tasks[0].status === 'terminee', 'journal : la réponse préparée ; la tâche terminée', db.agent_journal.map((j) => j.summary));

// 3. Rien deux fois : la même réponse redemandée est ignorée (une réponse attend déjà).
db.agent_tasks.push({ id: 'tr2', agent: 'dana', kind: 'premier_mail', status: 'en_attente', params: { reponse_a: 'm2', auto: true }, created_by: null, created_at: new Date().toISOString() });
await runNextTask();
ok(calls.length === 1 && db.agent_messages.filter((x) => x.kind === 'reponse').length === 1 && db.agent_journal.some((j) => /Pas de réponse préparée pour Pierre Lefèvre : une réponse est déjà prête ou partie/.test(String(j.summary))),
  'rien deux fois : une réponse attend déjà, pas de second appel', db.agent_journal.map((j) => j.summary));

// 4. Une demande d'arrêt : pas de réponse.
db.agent_messages.push(msg({ id: 'm4', thread_id: 't1', direction: 'in', status: 'recu', kind: 'recu', author: 'systeme', from_email: 'p.lefevre@garage-lefevre.fr', from_name: 'Pierre Lefèvre', subject: 'Re: Vos 4 C-HR hybrides', body_text: 'Stop, merci.', classification: 'stop', received_at: minAgo(1), created_at: minAgo(1) }));
db.agent_tasks.push({ id: 'tr3', agent: 'dana', kind: 'premier_mail', status: 'en_attente', params: { reponse_a: 'm4', auto: true }, created_by: null, created_at: new Date().toISOString() });
await runNextTask();
ok(calls.length === 1 && db.agent_journal.some((j) => /il demande qu'on ne lui écrive plus/.test(String(j.summary))), 'demande d\'arrêt : aucune réponse préparée');

server.close();
if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

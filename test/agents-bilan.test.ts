/**
 * Le bilan du jour (18/10, Channing : « envoyer un mail à l'organisation MC
 * Export (tous les utilisateurs MC Export), lorsqu'une agente a fini ses
 * recherches du jour, avec un petit détail sur les statistiques »). Le moment
 * (dès qu'elle a fini, sinon à la fin de ses heures, jamais avant 7 h, une
 * fois par jour), le texte, puis l'envoi par le worker avec une base simulée
 * et un faux Google : à chaque compte MC Export (pas une autre organisation,
 * pas un compte bloqué), depuis la boîte de l'agente — ou de sa propre
 * adresse si Google refuse cette boîte —, une seule fois par jour.
 */
import { generateKeyPairSync } from 'node:crypto';
import { recapDue, recapEndMinutes, recapMail, recapToOf, RECAP_ALL_DAY_AT, type RecapDueInput } from '../src/lib/agents/recap';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== ADA ET DANA : LE BILAN DU JOUR ===\n');

// --- Le moment ----------------------------------------------------------------------------------
const dana = { send_days: [1, 2, 3, 4, 5, 7], send_from: '00:00', send_to: '18:00' };
ok(recapEndMinutes(dana) === 18 * 60 && recapEndMinutes({ ...dana, send_to: '00:00' }) === RECAP_ALL_DAY_AT && recapEndMinutes({ ...dana, send_from: '08:30', send_to: '00:00' }) === 24 * 60,
  'fin de journée : 18 h ; 20 h pour une agente qui travaille toute la journée ; minuit si elle finit à minuit');
// Dimanche 18 octobre 2026 : 05:10 UTC = 7 h 10 à Paris.
const at = (iso: string) => new Date(iso);
const base: RecapDueInput = {
  now: at('2026-10-18T05:10:00Z'), window: dana, worked: true, pending: 0, lastActivityAt: '2026-10-18T02:00:00Z',
  researchQuota: 2, researchToday: 2, discoveryOn: false, discoveryQuota: 8, discoveryToday: 0, budgetReached: false,
};
ok(recapDue(base), 'dû : ses recherches du jour faites, plus rien depuis une heure, 7 h 10');
ok(!recapDue({ ...base, now: at('2026-10-18T03:00:00Z') }), 'pas avant 7 h : un travail fini dans la nuit attend 7 h');
ok(!recapDue({ ...base, pending: 1 }) && !recapDue({ ...base, now: at('2026-10-18T16:30:00Z'), pending: 1 }), 'pas tant qu\'une tâche attend ou tourne (même après la fin de ses heures)');
ok(!recapDue({ ...base, lastActivityAt: '2026-10-18T04:40:00Z' }), 'pas avant une heure de calme');
ok(!recapDue({ ...base, researchToday: 1 }) && recapDue({ ...base, researchToday: 1, now: at('2026-10-18T16:00:00Z') }), 'recherches pas finies : à la fin de ses heures (18 h)');
ok(!recapDue({ ...base, discoveryOn: true, discoveryToday: 3 }), 'relevés d\'annonces d\'office pas finis : pas encore');
ok(recapDue({ ...base, researchToday: 0, budgetReached: true }), 'budget du jour atteint : elle a fini');
ok(!recapDue({ ...base, now: at('2026-10-17T10:00:00Z') }) && !recapDue({ ...base, worked: false }), 'pas un jour de travail (samedi), ou rien fait : pas de bilan');

// --- Le texte ------------------------------------------------------------------------------------
const m = recapMail({
  agent: 'dana', name: 'Dana', now: at('2026-10-18T05:10:00Z'), hours: 'du lundi au vendredi et dimanche, 0 h-18 h',
  research: [{ label: 'sociétés de leasing · France', found: 5 }, { label: 'loueurs courte durée · France', found: 6 }],
  discoveries: 0, listings: 0, fiches: 8, keyFiches: 7, top: [{ name: 'Ayvens France', score: 92 }, { name: 'Arval France', score: 87 }],
  deep: { done: 3, enriched: 2, found: ['TECHNIC AUTO FORBACH → Marc Hess (Directeur VO du groupe)'] },
  prepared: ['Ayvens France', 'Agilauto'], drafts: 0, map: 2, spent: 0.6234, budget: 3,
  waiting: { forYou: 5, toComplete: 2, toValidate: 0 }, link: 'https://ada.mc-export.com/agents?agente=dana&onglet=valider',
});
ok(m.subject === 'Dana — bilan du dimanche 18 octobre', 'objet : l\'agente et le jour', m.subject);
const lines = m.body.split('\n');
ok(lines.includes('• Recherches sur le web : 2 — 11 entreprises trouvées (sociétés de leasing · France : 5 ; loueurs courte durée · France : 6)')
  && lines.includes('• Fiches préparées : 8, dont 7 grands comptes — les mieux notées : Ayvens France 92 · Arval France 87')
  && lines.includes('• Recherches approfondies : 3 — 2 fiches complétées (TECHNIC AUTO FORBACH → Marc Hess (Directeur VO du groupe))')
  && lines.includes('• Préparé pour Channing (grands comptes) : 2 — Ayvens France, Agilauto') && lines.includes('• Dépense IA : 0,62 $ sur 3,00 $')
  && lines.includes('À traiter dans ADA : 5 grands comptes « Pour vous », 2 grands comptes à compléter.') && lines.includes('Ouvrir : https://ada.mc-export.com/agents?agente=dana&onglet=valider')
  && /rien n'est envoyé à l'extérieur sans validation/.test(m.body),
  'texte : recherches, fiches, recherches approfondies, préparé pour Channing, dépense, ce qui attend, le lien', lines);

// --- L'envoi ---------------------------------------------------------------------------------------
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'ada@projet.iam.gserviceaccount.com', client_id: '123', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
process.env.ADA_APP_URL = 'https://ada-ui-test.up.railway.app/';
const refused = new Set<string>();
const sent: Array<{ from: string; to: string; subject: string; body: string; interne: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u === 'https://oauth2.googleapis.com/token') {
    const jwt = new URLSearchParams(String(init?.body)).get('assertion') ?? '';
    const sub = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub as string;
    if (refused.has(sub)) return new Response(JSON.stringify({ error: 'unauthorized_client', error_description: 'Client is unauthorized' }), { status: 401 });
    return new Response(JSON.stringify({ access_token: `jeton:${sub}` }));
  }
  if (u === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
    const raw = Buffer.from(JSON.parse(String(init?.body)).raw, 'base64url').toString();
    const header = (k: string) => raw.match(new RegExp(`^${k}: (.*)$`, 'm'))?.[1] ?? '';
    const subject = header('Subject').replace(/^=\?UTF-8\?B\?(.*)\?=$/, (_, b) => Buffer.from(b, 'base64').toString());
    const b64 = raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1]?.split('\r\n--')[0] ?? '';
    sent.push({ from: header('From'), to: header('To'), subject, body: Buffer.from(b64.replace(/\r\n/g, ''), 'base64').toString(), interne: header('X-ADA-Interne') });
    return new Response(JSON.stringify({ id: `m${sent.length}`, threadId: 't' }));
  }
  return realFetch(input, init);
}) as typeof fetch;

const T = (h: string) => `2026-10-18T${h}:00Z`;
const db: FakeDb = {
  profiles: [
    { id: 'u-channing', organisation: 'MC Export', blocked: false }, { id: 'u-equipe', organisation: null, blocked: false }, { id: 'u-vente', organisation: '', blocked: false },
    { id: 'u-autre', organisation: 'Garage Partenaire', blocked: false }, { id: 'u-bloque', organisation: 'MC Export', blocked: true },
    { id: 'u-test', organisation: 'MC Export', blocked: false }, { id: 'u-dana', organisation: 'MC Export', blocked: false },
  ],
  // Le compte de test sans boîte Gmail a rebondi (18/10) ; le compte ADA de Dana a l'adresse de sa boîte.
  email_suppressions: [{ email: 'ada-test@mc-export.com', reason: 'rebond' }],
  agent_settings: [{ agent: 'ada', mailbox: 'ada@mc-export.com' }, { agent: 'dana', mailbox: 'Dana@mc-export.com' }],
  app_config: [],
  agent_tasks: [
    { agent: 'dana', kind: 'recherche_comptes', status: 'terminee', params: { segment: 'leasing', country: 'FR', auto: true }, result: { gardes: 5 }, created_by: null, created_at: T('00:00'), finished_at: T('00:02') },
    { agent: 'dana', kind: 'recherche_comptes', status: 'terminee', params: { segment: 'loueur', country: 'FR', auto: true }, result: { gardes: 6 }, created_by: null, created_at: T('01:30'), finished_at: T('01:32') },
    { agent: 'dana', kind: 'qualification', status: 'terminee', params: { prospect_ids: ['p1', 'p2'], approfondie: true, auto: true }, result: { fiches: 2, enrichies: 1 }, created_by: null, created_at: T('01:40'), finished_at: T('02:00') },
    { agent: 'dana', kind: 'recherche_comptes', status: 'echec', params: { segment: 'flotte', country: 'FR', auto: true }, result: null, created_by: null, created_at: '2026-10-17T21:00:00Z', finished_at: null },
  ],
  agent_runs: [{ agent: 'dana', cost_usd: 0.4, created_at: T('00:01') }, { agent: 'dana', cost_usd: 0.2234, created_at: T('01:41') }],
  agent_prospects: [
    { id: 'p1', agent: 'dana', name: 'Ayvens France', score: 92, key_account: true, network_contact_id: 'n1', stage: 'a_contacter', qualified_at: T('00:10') },
    { id: 'p2', agent: 'dana', name: 'TECHNIC AUTO FORBACH', score: 37, key_account: true, network_contact_id: null, stage: 'qualifie', qualified_at: T('00:20') },
    { id: 'p3', agent: 'dana', name: 'Petit garage', score: 40, key_account: false, network_contact_id: null, stage: 'ecarte', qualified_at: T('00:30') },
  ],
  agent_threads: [{ id: 'th1', agent: 'dana', prospect_id: 'p1' }],
  agent_messages: [
    { agent: 'dana', thread_id: 'th1', status: 'pour_channing', kind: 'premier_contact', created_at: T('00:40'), thread: { prospect: { name: 'Ayvens France' } } },
    { agent: 'dana', thread_id: 'th1', status: 'pour_channing', kind: 'premier_contact', created_at: T('00:40'), thread: { prospect: { name: 'Ayvens France' } } },
  ],
  agent_journal: [{ agent: 'dana', kind: 'recherche_approfondie', at: T('01:50'), summary: 'TECHNIC AUTO FORBACH : recherche approfondie, 1 personne — à approcher : Marc Hess (Directeur VO du groupe)' }],
};
const users = [
  { id: 'u-channing', email: 'channing@mc-export.com' }, { id: 'u-equipe', email: 'Equipe@MC-Export.com' }, { id: 'u-vente', email: 'vente@mc-export.com' },
  { id: 'u-autre', email: 'contact@partenaire.fr' }, { id: 'u-bloque', email: 'ancien@mc-export.com' },
  { id: 'u-test', email: 'ada-test@mc-export.com' }, { id: 'u-dana', email: 'dana@mc-export.com' },
];
setSharedSupabase({ ...fakeSupabase(db), auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } } } as never);
const { maybeSendRecap, mcExportEmails, recapRecipients } = await import('../worker/agents/recap');

const agentDana = {
  agent: 'dana', display_name: 'Dana', mailbox: 'dana@mc-export.com', send_days: [1, 2, 3, 4, 5, 7], send_from: '00:00:00', send_to: '18:00:00',
  daily_budget_usd: 3, auto_research_per_day: 2, auto_discovery: false, targets: {},
};
ok((await mcExportEmails()).join() === 'ada-test@mc-export.com,channing@mc-export.com,dana@mc-export.com,equipe@mc-export.com,vente@mc-export.com', 'les comptes MC Export (organisation vide comprise), ni une autre organisation, ni un compte bloqué');
ok((await recapRecipients(agentDana)).join() === 'channing@mc-export.com,equipe@mc-export.com,vente@mc-export.com', 'destinataires du bilan (rien de choisi : toute l\'équipe) : ni la boîte d\'une agente, ni une adresse « ne plus contacter »', await recapRecipients(agentDana));
// Les comptes cochés dans les Réglages (18/10) ; une adresse morte cochée reste écartée.
ok(recapToOf({ recapTo: ['u-channing'] })?.join() === 'u-channing' && recapToOf({ deepPerDay: 5 }) === null && recapToOf(null) === null, 'les comptes choisis : la liste, ou null tant que rien n\'est choisi');
ok((await recapRecipients({ targets: { recapTo: ['u-channing', 'u-vente', 'u-test', 'u-autre'] } })).join() === 'channing@mc-export.com,vente@mc-export.com',
  'seulement les comptes cochés (jamais une adresse morte ni hors MC Export)');
ok(await maybeSendRecap({ ...agentDana, targets: { recapTo: [] } } as never, at('2026-10-18T05:10:00Z')) === 'personne' && sent.length === 0 && db.app_config.length === 0,
  'personne de coché : pas de bilan (ni envoi, ni verrou)');
ok(await maybeSendRecap(agentDana as never, at('2026-10-18T04:00:00Z')) === 'pas_encore' && sent.length === 0 && db.app_config.length === 0, '6 h : pas encore (rien envoyé, pas de verrou)');
const r1 = await maybeSendRecap(agentDana as never, at('2026-10-18T05:10:00Z'));
ok(r1 === 'envoye' && sent.length === 3 && sent.every((x) => x.from === 'Dana (ADA) <dana@mc-export.com>' && x.subject === 'Dana — bilan du dimanche 18 octobre'),
  '7 h 10 : envoyé aux trois comptes, depuis dana@mc-export.com', sent.map((x) => [x.from, x.to, x.subject]));
ok(sent.every((x) => x.interne === 'bilan'), 'en-tête interne : la synchro de la boîte le laisse dans Gmail (ni Messagerie ni « envoyés »)', sent.map((x) => x.interne));
const body = sent[0]?.body ?? '';
ok(body.includes('• Recherches sur le web : 2 — 11 entreprises trouvées (sociétés de leasing · France : 5 ; loueurs courte durée · France : 6)')
  && body.includes('• Fiches préparées : 2, dont 2 grands comptes — les mieux notées : Ayvens France 92 · TECHNIC AUTO FORBACH 37')
  && body.includes('• Recherches approfondies : 2 — 1 fiche complétée (TECHNIC AUTO FORBACH → Marc Hess (Directeur VO du groupe))')
  && body.includes('• Préparé pour Channing (grands comptes) : 1 — Ayvens France') && body.includes('• Ajoutés à la carte du réseau : 1') && body.includes('• Dépense IA : 0,62 $ sur 3,00 $')
  && body.includes('À traiter dans ADA : 1 grand compte « Pour vous », 1 grand compte à compléter.') && body.includes('Ouvrir : https://ada-ui-test.up.railway.app/agents?agente=dana&onglet=valider'),
  'le bilan : les chiffres de la journée (une fiche écartée ne compte pas), ce qui attend, le lien vers ADA', body.split('\n'));
const lock = db.app_config.find((c) => c.key === 'agents_bilan:dana:2026-10-18') as { value: { statut: string; envoyes: number } } | undefined;
ok(lock?.value.statut === 'envoye' && lock.value.envoyes === 3 && db.agent_journal.some((j) => j.kind === 'bilan_jour' && /^Bilan du jour envoyé à 3 personnes de MC Export$/.test(String(j.summary))),
  'verrou du jour posé, journal', { lock, journal: db.agent_journal.map((j) => j.summary) });
ok(await maybeSendRecap(agentDana as never, at('2026-10-18T07:00:00Z')) === 'deja' && sent.length === 3, 'une seule fois par jour');

// La boîte d'Ada refusée par Google (pas encore créée) : chacun reçoit le bilan de sa propre adresse.
refused.add('ada@mc-export.com');
db.agent_tasks.push({ agent: 'ada', kind: 'recherche_comptes', status: 'terminee', params: { segment: 'groupe', country: 'NL', auto: true }, result: { gardes: 4 }, created_by: null, created_at: T('07:00'), finished_at: T('07:02') });
const agentAda = { ...agentDana, agent: 'ada', display_name: 'Ada', mailbox: 'ada@mc-export.com', send_days: [1, 2, 3, 4, 5, 6, 7], send_from: '08:30:00', send_to: '18:00:00', auto_research_per_day: 1 };
const r2 = await maybeSendRecap(agentAda as never, at('2026-10-18T09:00:00Z'));
const adaMails = sent.slice(3);
ok(r2 === 'envoye' && adaMails.length === 3 && adaMails.every((x) => x.from === `Ada (ADA) <${x.to}>` && x.interne === 'bilan') && adaMails[0].subject === 'Ada — bilan du dimanche 18 octobre'
  && db.agent_journal.some((j) => j.kind === 'bilan_jour' && /3 depuis leur propre adresse/.test(String(j.summary))),
  'boîte de l\'agente refusée : chacun le reçoit de sa propre adresse, le journal le dit', adaMails.map((x) => [x.from, x.to]));

if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

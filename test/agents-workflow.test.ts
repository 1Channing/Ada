/**
 * Le Workflow (20/10, Channing : « à valider devient Workflow : Discussions en cours, Fiches, Brouillons —
 * éviter les doublons d'affichage, connecter la messagerie au reste »). La partie pure, sur des cas de TEST :
 * Autohaus Bleker (deux fiches, une contactée et une à compléter : une seule carte, en discussion), Flexicar
 * (trois fiches, un même site : une carte), Agilauto (le plan préparé : une fiche), un petit compte (son
 * premier mail à valider), un brouillon, une fiche mise de côté, un mail en attente sans fiche ; la fiche
 * d'un fil (l'adresse, sinon le domaine — jamais une messagerie grand public ni le nôtre).
 */
import { buildWorkflow, matchProspect, companyDomains, blockingOf, type WfProspect, type WfThread, type WfMessage } from '../src/lib/agents/workflow';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== ADA ET DANA : LE WORKFLOW ===\n');

const P = (o: Partial<WfProspect> & { id: string; name: string }): WfProspect => ({ stage: 'qualifie', score: 80, key_account: true, city: null, website: null, phone: null, emails: [], people: [], best_contact: null, ...o });
const mail = (email: string, nature = 'nominatif') => ({ email, mx: true, nature });
const prospects: WfProspect[] = [
  // Autohaus Bleker : deux concessions du même groupe, deux fiches.
  P({ id: 'bleker-1', name: 'Autohaus Bleker GmbH', stage: 'qualifie', website: 'https://www.bleker-gruppe.de/', best_contact: { nom: 'Janek Betz' }, score: 84 }),
  P({ id: 'bleker-2', name: 'Autohaus Bleker GmbH', stage: 'contacte', website: 'https://www.bleker-gruppe.de/', emails: [mail('info@bleker-gruppe.de', 'generique')], best_contact: { nom: 'Michael Bovenkerk', email: 'info@bleker-gruppe.de' }, score: 82 }),
  // Flexicar : trois fiches, un même site ; l'une complète.
  P({ id: 'flex-murcia', name: 'FLEXICAR MURCIA.', website: 'https://www.flexicar.es/murcia/', score: 95, best_contact: { nom: 'Pablo García Cabrera' } }),
  P({ id: 'flex-malaga', name: 'FLEXICAR MÁLAGA.', website: 'https://www.flexicar.es/malaga/', score: 95, emails: [mail('jcornago@flexicar.es')], best_contact: { nom: 'Jesus Cornago', email: 'jcornago@flexicar.es' } }),
  P({ id: 'flex-sevilla', name: 'GRUPO FLEXICAR SEVILLA.', website: 'https://flexicar.es', score: 87 }),
  // Agilauto : le plan préparé (aiguillage à valider, mail et notes pour Channing).
  P({ id: 'agil', name: 'Agilauto', stage: 'a_contacter', website: 'https://www.agilauto.fr/', emails: [mail('jgarnier@ca-agilauto.fr')], best_contact: { nom: 'Thomas François' } }),
  // Un petit compte : son premier mail à valider ; un autre, sans e-mail (brouillon).
  P({ id: 'petit', name: 'Garage Martin', key_account: false, score: 75, emails: [mail('paul.martin@gmail.com')], best_contact: { nom: 'Paul Martin', email: 'paul.martin@gmail.com' } }),
  P({ id: 'petit-2', name: 'Auto Sud', key_account: false, score: 72, best_contact: { nom: 'Luc Roux' } }),
  // Mise de côté (par l'équipe), écartée par l'IA, discussion terminée.
  P({ id: 'aside', name: 'OCASIONPLUS LA MAQUINISTA II', stage: 'ecarte', exclusion_reason: null }),
  P({ id: 'ia', name: 'Garage écarté', stage: 'ecarte', exclusion_reason: 'garage en France : fournisseur possible' }),
  P({ id: 'perdu', name: 'Europcar France', stage: 'perdu', website: 'https://www.europcar.fr/' }),
  P({ id: 'repondu', name: 'KINTO France', stage: 'repondu', website: 'https://www.kinto-mobility.fr/' }),
];
const threads: WfThread[] = [
  { id: 'th-bleker', prospect_id: 'bleker-2', last_message_at: '2026-10-20T09:00:00Z', last_direction: 'out', unread: false },
  { id: 'th-agil-r', prospect_id: 'agil', last_message_at: '2026-10-20T09:49:00Z', last_direction: 'out' },
  { id: 'th-agil-m', prospect_id: 'agil', last_message_at: '2026-10-20T09:49:00Z', last_direction: 'out' },
  { id: 'th-petit', prospect_id: 'petit', last_message_at: '2026-10-20T08:00:00Z', last_direction: 'out' },
  { id: 'th-perdu', prospect_id: 'perdu', last_message_at: '2026-10-18T08:00:00Z', last_direction: 'in' },
  { id: 'th-kinto', prospect_id: 'repondu', last_message_at: '2026-10-19T15:00:00Z', last_direction: 'in', unread: true },
  { id: 'th-libre', prospect_id: null, last_message_at: '2026-10-20T10:00:00Z', last_direction: 'in' },
  { id: 'th-aside', prospect_id: 'aside', last_message_at: '2026-10-19T10:00:00Z' },
];
const M = (id: string, thread_id: string, status: string, direction: 'in' | 'out' = 'out', created_at = '2026-10-20T09:00:00Z'): WfMessage => ({ id, thread_id, status, direction, created_at });
const messages: WfMessage[] = [
  M('m-bleker-mail', 'th-bleker', 'envoye'), M('m-bleker-li', 'th-bleker', 'pour_channing'),
  M('m-agil-r', 'th-agil-r', 'a_valider'), M('m-agil-mail', 'th-agil-m', 'pour_channing'), M('m-agil-li', 'th-agil-m', 'pour_channing'),
  M('m-petit', 'th-petit', 'a_valider'), M('m-perdu', 'th-perdu', 'recu', 'in'), M('m-kinto', 'th-kinto', 'recu', 'in'), M('m-kinto-rep', 'th-kinto', 'a_valider'),
  M('m-libre', 'th-libre', 'a_valider'), M('m-refuse', 'th-agil-r', 'refuse'), M('m-aside', 'th-aside', 'pour_channing'), M('m-perso', 'th-libre', 'brouillon'),
];
const wf = buildWorkflow({ prospects, threads, messages, minScore: 70 });
const names = (cards: Array<{ lead: WfProspect }>) => cards.map((c) => c.lead.id).join();

ok(names(wf.discussions) === 'repondu,bleker-2,perdu', 'discussions : la réponse non lue d\'abord, puis le dernier échange ; la terminée (perdu) à la fin', names(wf.discussions));
const bleker = wf.discussions.find((c) => c.lead.id === 'bleker-2');
ok(!!bleker && bleker.twins.map((x) => x.id).join() === 'bleker-1' && bleker.pending.map((m) => m.id).join() === 'm-bleker-li' && !names(wf.brouillons).includes('bleker') && !names(wf.fiches).includes('bleker'),
  'Autohaus Bleker : une seule carte, en discussion (la fiche contactée), l\'autre fiche dedans ; la note LinkedIn encore à envoyer y est — plus de doublon dans les brouillons', bleker && { twins: bleker.twins.map((x) => x.id), pending: bleker.pending.map((m) => m.id) });
ok(wf.discussions.find((c) => c.lead.id === 'repondu')?.unread === true && wf.discussions.find((c) => c.lead.id === 'repondu')?.pending.map((m) => m.id).join() === 'm-kinto-rep' && wf.discussions.find((c) => c.lead.id === 'perdu')?.ended === true,
  'une réponse non lue, la réponse préparée à valider dans la discussion ; « perdu » : terminée');
ok(names(wf.fiches) === 'agil,petit,flex-malaga', 'fiches : ce qui est préparé d\'abord (grand compte, puis petit compte), puis les fiches complètes', names(wf.fiches));
const agil = wf.fiches.find((c) => c.lead.id === 'agil');
ok(agil?.pending.map((m) => m.id).join() === 'm-agil-r,m-agil-mail,m-agil-li' && agil.threads.length === 2, 'Agilauto : tout le plan (aiguillage, mail, note ; pas le message refusé), sur ses deux fils', agil?.pending.map((m) => m.id));
const flex = wf.fiches.find((c) => c.lead.id === 'flex-malaga');
ok(!!flex && flex.twins.map((x) => x.id).sort().join() === 'flex-murcia,flex-sevilla' && !names(wf.brouillons).includes('flex'),
  'Flexicar : une seule carte (un même site), menée par la fiche complète (Málaga), les deux autres dedans', flex && flex.twins.map((x) => x.id));
ok(names(wf.brouillons) === 'petit-2' && wf.brouillons[0].missing.join() === 'aucun e-mail publié', 'brouillons : ce qui manque (ici : aucun e-mail publié)', wf.brouillons.map((c) => [c.lead.id, c.missing]));
ok(wf.aside.map((x) => x.id).join() === 'aside' && wf.orphans.map((m) => m.id).join() === 'm-libre', 'mise de côté à part (pas l\'écartée par l\'IA), sans ce qui lui était préparé ; un mail à valider sans fiche, à part (pas un brouillon pas encore soumis)', { aside: wf.aside.map((x) => x.id), orphans: wf.orphans.map((m) => m.id) });
ok(blockingOf(P({ id: 'x', name: 'x', score: 60, emails: [mail('a@b.fr')], best_contact: { nom: 'A B', email: 'a@b.fr' } }), 70).missing.join() === 'note 60, sous la note minimale (70)', 'brouillon aussi : une note sous la note minimale');

// --- La fiche d'un fil ---------------------------------------------------------------------------------
ok(companyDomains(P({ id: 'x', name: 'x', website: 'https://www.autoscout24.de/haendler/bleker', emails: [mail('info@gmail.com'), mail('equipe@mc-export.com'), mail('vo@bleker-gruppe.de')] })).join() === 'bleker-gruppe.de',
  'les domaines d\'une entreprise : ni un site d\'annonces, ni une messagerie grand public, ni le nôtre');
ok(matchProspect(['Paul.Martin@gmail.com'], prospects)?.id === 'petit' && matchProspect(['autre@gmail.com'], prospects) === null,
  'l\'adresse exacte d\'une fiche, même chez une messagerie grand public ; le domaine seul d\'une messagerie grand public : rien');
ok(matchProspect(['m.bovenkerk@bleker-gruppe.de'], prospects)?.id === 'bleker-2' && matchProspect(['dana@mc-export.com', 'channing@mc-export.com'], prospects) === null,
  'le domaine : la fiche la plus avancée de l\'entreprise (Bleker contactée) ; nos propres adresses : rien (le bilan à l\'équipe ne va sur aucune fiche)');
ok(matchProspect(['info@ocasionplus.com'], [P({ id: 'o', name: 'OcasionPlus', stage: 'ecarte', emails: [mail('info@ocasionplus.com')] })]) === null, 'une fiche écartée ne reçoit pas de fil');

// --- Le worker : le fil d'un mail envoyé (la Messagerie, Gmail) ou reçu rejoint sa fiche --------------------------
const { setSharedSupabase } = await import('../src/lib/supabaseShared');
const { fakeSupabase } = await import('./fakeSupabase');
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {
  agent_prospects: [
    ...prospects.map((p) => ({ ...p, agent: 'dana' }) as unknown as Row),
    { ...P({ id: 'autosud', name: 'Auto Sud', key_account: false, website: 'https://www.autosud.fr/' }), agent: 'dana' } as unknown as Row,
    { ...P({ id: 'ada-1', name: 'Autosud (Ada)', website: 'https://www.autosud.fr/' }), agent: 'ada' } as unknown as Row,
  ],
  agent_threads: [
    { id: 'th-equipe', agent: 'dana', prospect_id: null, subject: 'Vos VO récents' },
    { id: 'th-recu', agent: 'dana', prospect_id: null, subject: 'Re: lots' },
    { id: 'th-interne', agent: 'dana', prospect_id: null, subject: 'Dana — bilan' },
    { id: 'th-deja', agent: 'dana', prospect_id: 'agil', subject: 'Agilauto' },
  ],
};
setSharedSupabase(fakeSupabase(db) as never);
const { linkThread, forgetLinks } = await import('../worker/agents/link');
const { advanceProspect } = await import('../worker/agents/store');
const stageOf = (id: string) => (db.agent_prospects.find((p) => p.id === id) as Row).stage;
const threadOf = (id: string) => (db.agent_threads.find((t) => t.id === id) as Row).prospect_id;
forgetLinks();
ok(await linkThread('dana', 'dana@mc-export.com', 'th-equipe', ['contact@autosud.fr', 'channing@mc-export.com']) === 'autosud' && threadOf('th-equipe') === 'autosud',
  'un mail de l\'équipe (Messagerie) à contact@autosud.fr : le fil rejoint la fiche Auto Sud de Dana (pas celle d\'Ada)');
await advanceProspect('th-equipe', 'contacte');
ok(stageOf('autosud') === 'contacte', 'envoyé : la fiche passe « contactée » — elle arrive dans Discussions en cours');
ok(await linkThread('dana', 'dana@mc-export.com', 'th-recu', ['m.bovenkerk@bleker-gruppe.de']) === 'bleker-2' && threadOf('th-recu') === 'bleker-2',
  'une réponse reçue de bleker-gruppe.de : la fiche Bleker en discussion (la plus avancée des deux)');
ok(await linkThread('dana', 'dana@mc-export.com', 'th-interne', ['channing@mc-export.com', 'antoine@mc-export.com']) === null && threadOf('th-interne') === null, 'un mail à l\'équipe : sur aucune fiche');
ok(await linkThread('dana', 'dana@mc-export.com', 'th-deja', ['info@bleker-gruppe.de']) === 'agil' && threadOf('th-deja') === 'agil', 'un fil déjà rattaché le reste');

if (fails === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n❌ ${fails} TEST(S) FAILED`);
  process.exit(1);
}

/**
 * Les demandes du site mc-export.com dans la cloche d'ADA (25/10, Channing : « Je suis ok pour les alertes »).
 * Le rappel d'une demande (titre, note) ; le passage du worker : un rappel par demande, la cloche seule quand
 * le site a déjà envoyé son e-mail, l'e-mail de rappel sinon, ni l'historique ni les demandes traitées.
 */
import { leadReminder, leadKey, type SiteLead } from '../src/lib/siteLeads';
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== DEMANDES DU SITE DANS LA CLOCHE ===\n');

const lead = (o: Partial<SiteLead>): SiteLead => ({
  id: 'l1', created_at: '2026-10-25T08:12:00Z', kind: 'particulier', lang: 'fr', page: '/reprise-tesla', name: 'Jean', email: 'jean@example.com', phone: '0600000000',
  company: null, country: 'France', message: null, details: { gamme: 'Tesla', marque: 'Tesla', modele: 'Model Y', annee: '2022', km: 45000, code_postal: '49000', pays: 'FR', situation: "LOA (avec option d'achat)" },
  notified_at: null, ...o,
});

// --- Le rappel ------------------------------------------------------------------------------------
const r1 = leadReminder(lead({}));
ok(r1.title === 'Demande du site : rappeler Jean — Tesla Model Y, 2022, 45 000 km', 'particulier : qui rappeler et la voiture dans le titre', r1.title);
const lines = r1.note.split('\n');
ok(lines[0] === 'Rachat particulier · français · page /reprise-tesla' && lines[1] === 'Contact : Jean · 0600000000 · jean@example.com', 'la note : le profil, la langue, la page, puis le contact complet', lines.slice(0, 2));
ok(lines[2] === "Voiture : Tesla Model Y, 2022, 45 000 km · situation : LOA (avec option d'achat)" && lines[3] === 'Lieu : France, 49000', 'la voiture (sans répéter « tesla ») avec la situation, puis le lieu', lines.slice(2, 4));
ok(lines.at(-1) === 'Reçue le 25/10/2026 09:12, offre promise sous 24 h ouvrées.' && lines.length === 5, 'reçue à l\'heure de Paris (heure d\'hiver depuis la nuit), avec la promesse des 24 h ouvrées ; aucun autre champ', lines);
const hy = leadReminder(lead({ details: { gamme: 'Hybride', marque: 'Toyota', modele: 'Yaris Cross', annee: '2023', km: '30 000' } }));
ok(hy.note.includes('Voiture : Toyota Yaris Cross, 2023, 30 000 km (hybride)'), 'une hybride : la gamme quand le modèle ne la dit pas', hy.note);
const pro = leadReminder(lead({ kind: 'vendeur', page: '/', company: 'Garage Martin', name: 'Paul', details: { volume: '20 VO / mois', type: 'Concession' }, message: 'Lot de Clio à vendre', lang: 'nl' }));
ok(pro.title === 'Demande du site : vendeur professionnel, Garage Martin' && pro.note.includes('volume : 20 VO / mois') && pro.note.includes('type : Concession') && pro.note.includes('Message : Lot de Clio à vendre') && pro.note.includes('néerlandais') && !pro.note.includes('24 h ouvrées'),
  'un professionnel : la société, ses détails tels quels, son message, sans la promesse faite aux particuliers', pro);
const bare = leadReminder(lead({ name: null, email: null, phone: '+31612345678', page: null, country: null, details: {} }));
ok(bare.title === 'Demande du site : rappeler +31612345678' && !bare.note.includes('Voiture') && !bare.note.includes('Lieu') && !bare.note.includes('\n\n'), 'peu de champs : le téléphone pour titre, pas de ligne vide', bare);
const long = leadReminder(lead({ message: 'x'.repeat(5000), name: 'y'.repeat(300) }));
ok(long.title.length === 200 && long.note.length === 1500, 'au plus 200 caractères de titre et 1 500 de note (la cloche)', [long.title.length, long.note.length]);

// --- Le passage du worker ---------------------------------------------------------------------------
const NOW = new Date('2026-10-25T09:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const db: FakeDb = {
  profiles: [{ id: 'u-channing', organisation: 'MC Export', blocked: false }, { id: 'u-vente', organisation: 'MC Export', blocked: false }],
  site_leads: [
    { ...lead({ id: 'mailed', notified_at: ago(1) }), created_at: ago(1), status: 'nouvelle' },
    { ...lead({ id: 'silent', name: 'Marie' }), created_at: ago(2), status: 'nouvelle' },
    { ...lead({ id: 'old' }), created_at: ago(24 * 8), status: 'nouvelle' },
    { ...lead({ id: 'done' }), created_at: ago(3), status: 'traitee' },
    { ...lead({ id: 'known' }), created_at: ago(4), status: 'nouvelle' },
  ],
  user_tasks: [{ id: 't0', key: leadKey('known'), assignee_id: 'u-channing', title: 'déjà posé', status: 'open' }],
};
const users = [{ id: 'u-channing', email: 'Channing@MC-Export.com' }, { id: 'u-vente', email: 'vente@mc-export.com' }];
setSharedSupabase({ ...fakeSupabase(db), auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } } } as never);
const { siteLeadsTick } = await import('../worker/siteLeads');

const n1 = await siteLeadsTick(NOW);
const task = (id: string) => db.user_tasks.find((t) => t.key === leadKey(id));
ok(n1 === 2 && !!task('mailed') && !!task('silent'), 'deux rappels : les deux nouvelles demandes de la semaine', db.user_tasks.map((t) => t.key));
ok(!task('old') && !task('done') && db.user_tasks.filter((t) => t.key === leadKey('known')).length === 1, 'ni l\'historique (plus de 7 jours), ni une demande traitée, ni un second rappel');
ok(task('mailed')?.assignee_id === 'u-channing' && task('mailed')?.due_at === NOW.toISOString() && String(task('silent')?.title).includes('Marie'), 'pour Channing (adresse sans casse), à échéance immédiate, avec le titre de la demande', task('mailed'));
ok(task('mailed')?.notified_at === NOW.toISOString() && db.site_leads.find((l) => l.id === 'mailed')?.notified_at === ago(1), 'le site a déjà envoyé son e-mail : la cloche seule (le rappel est marqué notifié)', task('mailed'));
ok(task('silent')?.notified_at === null && db.site_leads.find((l) => l.id === 'silent')?.notified_at === NOW.toISOString(), 'l\'e-mail du site a manqué : le rappel partira par e-mail, la demande est marquée notifiée', [task('silent'), db.site_leads.find((l) => l.id === 'silent')]);
ok(await siteLeadsTick(NOW) === 0 && db.user_tasks.length === 3, 'un second passage ne pose rien de plus');
db.site_leads.push({ ...lead({ id: 'later', notified_at: NOW.toISOString() }), created_at: NOW.toISOString(), status: 'nouvelle' });
process.env.SITE_LEADS_OWNER = 'vente@mc-export.com';
ok(await siteLeadsTick(NOW) === 1 && task('later')?.assignee_id === 'u-vente', 'SITE_LEADS_OWNER : un autre compte MC Export reçoit les rappels', task('later'));
delete process.env.SITE_LEADS_OWNER;

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);

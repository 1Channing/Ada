/**
 * La pause d'une agente (25/10, Channing : « c'était pour les mettre en pause, faut un bouton pour ça… et la
 * possibilité de mettre 0 jours de travail »). Le cycle automatique du worker : une agente active pose son
 * relevé d'annonces dans ses heures ; en pause, ou sans aucun jour de travail, elle ne pose rien.
 */
import { setSharedSupabase } from '../src/lib/supabaseShared';
import { fakeSupabase, type FakeDb } from './fakeSupabase';
import { inSendWindow, nextWindowStart, workHoursLabel } from '../src/lib/agents/sendPolicy';

let fails = 0;
const ok = (cond: boolean, what: string, got?: unknown) => {
  if (cond) console.log(`✓ ${what}`);
  else { fails++; console.error(`✗ ${what}${got !== undefined ? ` — obtenu : ${JSON.stringify(got)}` : ''}`); }
};

console.log('\n=== ADA ET DANA : LA PAUSE ===\n');

// 0 jour de travail : jamais dans ses heures, pas de reprise prévue.
const none = { send_days: [] as number[], send_from: '08:30:00', send_to: '18:00:00' };
ok(!inSendWindow(new Date('2026-10-27T10:00:00Z'), none) && nextWindowStart(new Date('2026-10-27T10:00:00Z'), none) === null && workHoursLabel(none).startsWith('aucun jour'),
  'aucun jour coché : jamais au travail, pas de reprise, « aucun jour »');

const agent = (k: 'ada' | 'dana', status: 'pause' | 'active', days = [1, 2, 3, 4, 5, 6, 7]) => ({
  agent: k, display_name: k === 'ada' ? 'Ada' : 'Dana', mailbox: `${k}@mc-export.com`, status, send_days: days, send_from: '00:00:00', send_to: '00:00:00',
  daily_budget_usd: 3, auto_discovery: true, auto_qualify_per_day: 0, auto_draft_per_day: 0, auto_research_per_day: 0, map_auto_add: false, map_min_score: 70, owner_id: null,
  targets: k === 'ada' ? { countries: ['NL'], brands: ['Toyota'], vanBrands: [] } : { minLot: 3, markets: ['FR', 'NL'], brands: ['Toyota'], countries: ['FR'] },
});
const db: FakeDb = { agent_settings: [agent('ada', 'active'), agent('dana', 'pause')], agent_tasks: [], agent_journal: [], profiles: [] };
setSharedSupabase({ ...fakeSupabase(db), auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } } } as never);
const { autoCycle } = await import('../worker/agents/tasks');

const posed = (k: string) => db.agent_tasks.filter((t) => t.agent === k && t.kind === 'decouverte_concessions' && !t.created_by);
await autoCycle();
ok(posed('ada').length === 1, 'Ada active, dans ses heures : son relevé d\'annonces automatique est posé', db.agent_tasks);
ok(posed('dana').length === 0, 'Dana en pause : rien de posé', db.agent_tasks.filter((t) => t.agent === 'dana'));

// Reprendre Dana, mettre Ada en pause.
db.agent_settings = [agent('ada', 'pause'), agent('dana', 'active')];
db.agent_tasks = [];
await autoCycle();
ok(posed('ada').length === 0 && posed('dana').length === 1, 'les rôles inversés : Dana reprend, Ada s\'arrête', db.agent_tasks.map((t) => `${t.agent}/${t.kind}`));

// Active mais sans aucun jour de travail : rien non plus.
db.agent_settings = [agent('ada', 'active', []), agent('dana', 'pause')];
db.agent_tasks = [];
await autoCycle();
ok(db.agent_tasks.length === 0, 'active sans aucun jour coché : rien de posé', db.agent_tasks);

console.log(`\n${fails === 0 ? 'Tout est bon.' : `${fails} échec(s).`}`);
if (fails) process.exit(1);

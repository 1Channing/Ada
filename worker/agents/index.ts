/**
 * ADA ET DANA — le branchement dans le worker (16/10, Phase 1 : zéro IA).
 *
 * - GET /agents/oauth/callback : retour de l'écran Google quand un admin
 *   connecte ada@ ou dana@ depuis ADA (Agents → Réglages). Contrôles : état
 *   à usage unique créé par un admin (agents_oauth_begin), moins de 30 min,
 *   et la boîte qui donne son accord est BIEN celle attendue. Le jeton est
 *   chiffré avant d'entrer en base.
 * - Une boucle toutes les 30 s, SÉQUENTIELLE (jamais deux passages en même
 *   temps) : d'abord les envois validés, puis la synchro des boîtes (toutes
 *   les 2 min) — l'ordre évite qu'un mail qu'on vient d'envoyer soit archivé
 *   deux fois.
 * - Les tâches des agentes (découvertes de concessions, qualifications par
 *   l'IA, 17/10), une à la fois toutes les 20 s, et le cycle automatique
 *   toutes les 10 min (./tasks.ts) — sans besoin de Google.
 * Coupe-circuit : AGENTS_ENABLED=0. Sans AGENT_GOOGLE_CLIENT_ID / SECRET, les
 * boîtes ne tournent pas (le reste du worker n'est pas touché).
 */
import type { Express, Request, Response } from 'express';
import { exchangeCode, oauthClient, profileEmail, redirectUri, sealToken, forgetToken, GMAIL_SCOPE, NotConnected } from './google';
import { sb, loadAgents, journal } from './store';
import { syncMailbox, recordSyncError } from './sync';
import { sendDue } from './outbox';
import { runNextTask, autoCycle } from './tasks';

const TICK_MS = 30_000;
const SYNC_EVERY_MS = 2 * 60_000;
const STATE_TTL_MS = 30 * 60_000;
let running = false;
const lastSync = new Map<string, number>();

const enabled = () => process.env.AGENTS_ENABLED !== '0';
const appUrl = () => (process.env.ADA_APP_URL ?? 'https://ada.mc-export.com').replace(/\/+$/, '');

function back(res: Response, returnTo: string | null, params: Record<string, string>): void {
  const base = returnTo || `${appUrl()}/agents`;
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  res.redirect(302, u.toString());
}

async function oauthCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!enabled() || !oauthClient()) { res.status(503).send('Agents ADA désactivés sur ce worker.'); return; }
  if (!state) { res.status(400).send('Requête incomplète.'); return; }
  // L'état à usage unique : réservé d'un coup (deux retours simultanés → un seul passe).
  const { data: claimed } = await sb.from('agent_oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('state', state).is('used_at', null).gt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString())
    .select('agent, mailbox, created_by, return_to');
  const st = ((claimed ?? []) as Array<{ agent: string; mailbox: string; created_by: string; return_to: string | null }>)[0];
  if (!st) { back(res, null, { connexion: 'expiree' }); return; }
  if (typeof req.query.error === 'string' || !code) { back(res, st.return_to, { connexion: 'refusee', agente: st.agent }); return; }
  const redirect = redirectUri();
  if (!redirect) { back(res, st.return_to, { connexion: 'erreur', agente: st.agent }); return; }
  try {
    const t = await exchangeCode(code, redirect);
    if (!t.scope.split(/\s+/).includes(GMAIL_SCOPE)) { back(res, st.return_to, { connexion: 'droits', agente: st.agent }); return; }
    if (!t.refreshToken) { back(res, st.return_to, { connexion: 'sans-jeton', agente: st.agent }); return; }
    const email = await profileEmail(t.accessToken);
    if (email !== st.mailbox.toLowerCase()) {
      await journal({ agent: st.agent, actor: 'humain', actorId: st.created_by, kind: 'boite_refusee', summary: `Connexion refusée : ${email} n'est pas ${st.mailbox}` });
      back(res, st.return_to, { connexion: 'mauvaise-boite', agente: st.agent });
      return;
    }
    const { error: credErr } = await sb.from('agent_mail_credentials').upsert({
      mailbox: st.mailbox, refresh_token_enc: sealToken(t.refreshToken), scope: t.scope, google_email: email,
      connected_by: st.created_by, connected_at: new Date().toISOString(),
    }, { onConflict: 'mailbox' });
    if (credErr) throw new Error(`jeton non enregistré : ${credErr.message}`);
    forgetToken(st.mailbox);
    await sb.from('agent_settings').update({
      gmail_connected_email: email, gmail_connected_at: new Date().toISOString(), gmail_history_id: null, last_sync_error: null,
    }).eq('agent', st.agent);
    lastSync.delete(st.mailbox);
    await journal({ agent: st.agent, actor: 'humain', actorId: st.created_by, kind: 'boite_connectee', summary: `Boîte ${email} connectée à ADA` });
    back(res, st.return_to, { connexion: 'ok', agente: st.agent });
  } catch (e) {
    console.warn(`[AGENTS] connexion de ${st.mailbox} en échec : ${e instanceof Error ? e.message : String(e)}`);
    back(res, st.return_to, { connexion: 'erreur', agente: st.agent });
  }
}

/** La route de retour Google (posée avant le démarrage du serveur). */
export function registerAgentRoutes(app: Express): void {
  app.get('/agents/oauth/callback', (req, res) => { void oauthCallback(req, res); });
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const agents = await loadAgents();
    if (agents.length === 0) return;
    await sendDue(agents);
    const own = agents.map((a) => a.mailbox);
    for (const a of agents) {
      if (!a.gmail_connected_email) continue;
      const last = lastSync.get(a.mailbox) ?? 0;
      if (Date.now() - last < SYNC_EVERY_MS) continue;
      lastSync.set(a.mailbox, Date.now());
      try { await syncMailbox(a, own); }
      catch (e) { await recordSyncError(a, e); if (e instanceof NotConnected) lastSync.set(a.mailbox, Date.now() + 10 * 60_000); }
    }
  } catch (e) {
    console.warn(`[AGENTS] passage en échec : ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    running = false;
  }
}

/** Démarre les boîtes d'Ada et Dana (après setSharedSupabase). */
export function startAgents(): void {
  if (!enabled()) { console.log('[AGENTS] coupés (AGENTS_ENABLED=0)'); return; }
  // Le travail des agentes (découvertes, qualifications) : sans Google, une tâche à la fois.
  setInterval(() => void runNextTask(), 20_000);
  setTimeout(() => void runNextTask(), 15_000);
  setInterval(() => void autoCycle(), 10 * 60_000);
  setTimeout(() => void autoCycle(), 60_000);
  const client = oauthClient();
  if (!client) { console.log('[AGENTS] AGENT_GOOGLE_CLIENT_ID / AGENT_GOOGLE_CLIENT_SECRET absents — boîtes d\'Ada et Dana non branchées'); return; }
  const redirect = redirectUri();
  if (redirect) {
    void sb.from('agent_oauth_config').upsert({ redirect_uri: redirect, client_id: client.id, updated_at: new Date().toISOString() }, { onConflict: 'redirect_uri' })
      .then(({ error }: { error: { message: string } | null }) => { if (error && !/does not exist|schema cache/i.test(error.message)) console.warn(`[AGENTS] config Google non publiée : ${error.message}`); });
  } else {
    console.warn('[AGENTS] adresse publique du worker inconnue (RAILWAY_PUBLIC_DOMAIN ou AGENT_OAUTH_REDIRECT_URI) : connexion des boîtes impossible depuis ADA');
  }
  setInterval(() => void tick(), TICK_MS);
  setTimeout(() => void tick(), 20_000);
  console.log(`[AGENTS] boîtes d'Ada et Dana actives (envois validés toutes les 30 s, synchro toutes les 2 min)${redirect ? `, retour Google : ${redirect}` : ''}`);
}

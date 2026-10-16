/**
 * GOOGLE POUR ADA ET DANA (16/10) — un accès OAuth PROPRE À CHAQUE BOÎTE
 * (ada@ et dana@mc-export.com, portée gmail.modify : lire, classer, envoyer).
 * Jamais la délégation domaine du compte de service : elle ouvrirait toutes
 * les boîtes de mc-export.com, dont celle de Channing.
 *
 * Le jeton de rafraîchissement est CHIFFRÉ (AES-256-GCM) avant d'entrer en
 * base (table agent_mail_credentials, lisible par la clé service seule) ;
 * la clé vient d'AGENT_TOKEN_KEY, ou à défaut de WORKER_SECRET. Rien de tout
 * cela n'est jamais écrit dans les logs (worker_logs est lisible).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { sharedSupabase as supabase } from '../../src/lib/supabaseShared';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any };

/** Boîte pas (ou plus) connectée : on attend que l'admin la (re)branche, sans bruit. */
export class NotConnected extends Error {}
export class GmailError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function oauthClient(): { id: string; secret: string } | null {
  const id = process.env.AGENT_GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.AGENT_GOOGLE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

/** L'adresse de retour Google de CE worker (une par worker : TEST et production). */
export function redirectUri(): string | null {
  const explicit = process.env.AGENT_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return domain ? `https://${domain}/agents/oauth/callback` : null;
}

function key(): Buffer {
  const material = process.env.AGENT_TOKEN_KEY || process.env.WORKER_SECRET || '';
  if (!material) throw new Error('ni AGENT_TOKEN_KEY ni WORKER_SECRET : impossible de chiffrer le jeton Google');
  return createHash('sha256').update(`ada-agents:${material}`).digest();
}

export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

export function openToken(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new NotConnected('jeton Google illisible — reconnecter la boîte');
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    // Clé changée (WORKER_SECRET renouvelé) : le jeton ne s'ouvre plus.
    throw new NotConnected('jeton Google illisible (clé du worker changée) — reconnecter la boîte');
  }
}

/** Échange du code reçu au retour de Google contre les jetons. */
export async function exchangeCode(code: string, redirect: string): Promise<{ accessToken: string; refreshToken: string | null; scope: string }> {
  const c = oauthClient();
  if (!c) throw new Error('AGENT_GOOGLE_CLIENT_ID / AGENT_GOOGLE_CLIENT_SECRET absents sur le worker');
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google refuse l'échange : ${j.error ?? res.status} ${j.error_description ?? ''}`.trim());
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, scope: j.scope ?? '' };
}

/** L'adresse de la boîte qui vient de donner son accord (contrôle : la bonne boîte). */
export async function profileEmail(accessToken: string): Promise<string> {
  const res = await fetch(`${GMAIL_BASE}/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  const j = (await res.json().catch(() => ({}))) as { emailAddress?: string; error?: { message?: string } };
  if (!res.ok || !j.emailAddress) throw new Error(`Gmail refuse le profil : ${j.error?.message ?? res.status}`);
  return j.emailAddress.trim().toLowerCase();
}

const tokens = new Map<string, { value: string; expiresAt: number }>();

/** Jeton d'accès d'une boîte, rafraîchi au besoin. */
export async function accessToken(mailbox: string): Promise<string> {
  const hit = tokens.get(mailbox);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.value;
  const c = oauthClient();
  if (!c) throw new NotConnected('AGENT_GOOGLE_CLIENT_ID / SECRET absents sur le worker');
  const { data, error } = await sb.from('agent_mail_credentials').select('refresh_token_enc').eq('mailbox', mailbox).maybeSingle();
  if (error) throw new Error(`lecture du jeton impossible : ${error.message}`);
  if (!data) throw new NotConnected(`${mailbox} n'est pas connectée à ADA`);
  const refresh = openToken((data as { refresh_token_enc: string }).refresh_token_enc);
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refresh, client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token' }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    if (j.error === 'invalid_grant') throw new NotConnected('accès Google retiré ou expiré — reconnecter la boîte depuis ADA');
    throw new Error(`Google refuse le jeton : ${j.error ?? res.status} ${j.error_description ?? ''}`.trim());
  }
  tokens.set(mailbox, { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

export function forgetToken(mailbox: string): void { tokens.delete(mailbox); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Appel Gmail d'une boîte, avec reprise douce sur 429 / 5xx et un nouveau jeton sur 401. */
export async function gmail<T>(mailbox: string, path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number | string[] | undefined> } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) qs.append(k, String(one));
  }
  const url = `${GMAIL_BASE}${path}${qs.toString() ? `?${qs}` : ''}`;
  let renewed = false;
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(mailbox);
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 401 && !renewed) { forgetToken(mailbox); renewed = true; continue; }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await sleep(attempt === 0 ? 1500 : 5000); continue; }
    const text = await res.text();
    let j: unknown = {};
    try { j = text ? JSON.parse(text) : {}; } catch { j = { error: { message: text.slice(0, 200) } }; }
    if (!res.ok) {
      const msg = (j as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
      throw new GmailError(res.status, `Gmail ${res.status} : ${msg}`);
    }
    return j as T;
  }
}

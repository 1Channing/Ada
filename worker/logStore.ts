/**
 * Capture des warn/error de la console du worker vers Supabase (worker_logs).
 *
 * Complète la boîte noire métier (linkgen_error_dossiers) avec la couche
 * technique : crashs, erreurs réseau hors étude, blocages dans le temps.
 * Écriture par lots (10 s), rétention 14 jours purgée par le worker, et
 * surtout AUCUNE récursion : les échecs d'écriture du journal lui-même
 * passent par stderr brut, jamais par console.error.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const FLUSH_INTERVAL_MS = 10_000;
const MAX_QUEUE = 500;
const MAX_MESSAGE_LEN = 4_000;
const RETENTION_DAYS = 14;
const PURGE_INTERVAL_MS = 24 * 3600 * 1000;

type LogRow = { level: 'warn' | 'error'; message: string; created_at: string };

let client: SupabaseClient | null = null;
const queue: LogRow[] = [];
let flushing = false;

function fmt(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function enqueue(level: LogRow['level'], args: unknown[]): void {
  try {
    const message = args.map(fmt).join(' ').slice(0, MAX_MESSAGE_LEN);
    queue.push({ level, message, created_at: new Date().toISOString() });
    // Si Supabase est injoignable, on borne la mémoire : les plus vieux sautent.
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  } catch { /* le journal ne doit jamais faire tomber le worker */ }
}

async function flush(): Promise<void> {
  if (!client || flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, 100);
  try {
    const { error } = await client.from('worker_logs').insert(batch);
    if (error) process.stderr.write(`[LOG_STORE] insert failed: ${error.message}\n`);
  } catch (e) {
    process.stderr.write(`[LOG_STORE] flush crashed: ${(e as Error)?.message ?? e}\n`);
  } finally {
    flushing = false;
  }
}

async function purgeOld(): Promise<void> {
  if (!client) return;
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    await client.from('worker_logs').delete().lt('created_at', cutoff);
  } catch (e) {
    process.stderr.write(`[LOG_STORE] purge crashed: ${(e as Error)?.message ?? e}\n`);
  }
}

/** À appeler une fois au boot, avec le client service-role. Idempotent. */
export function initWorkerLogCapture(supabase: SupabaseClient): void {
  if (client) return;
  client = supabase;

  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...args: unknown[]) => { origWarn(...args); enqueue('warn', args); };
  console.error = (...args: unknown[]) => { origError(...args); enqueue('error', args); };

  const flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
  void purgeOld();
  const purgeTimer = setInterval(() => { void purgeOld(); }, PURGE_INTERVAL_MS);
  purgeTimer.unref?.();

  console.log('[LOG_STORE] Capture warn/error → worker_logs active (rétention 14 j)');
}

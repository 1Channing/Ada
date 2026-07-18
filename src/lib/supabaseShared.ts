/**
 * Shared Supabase client holder — dependency injection WITHOUT import.meta.env.
 *
 * Modules used by BOTH the browser and the Railway worker (linkgen/generator,
 * linkgen/ingestion, services/marketData, linkgen/campaignEngine) must not
 * import `lib/supabase` directly: that file reads import.meta.env, which only
 * exists under Vite. Instead they import `sharedSupabase` from here — a lazy
 * proxy resolved at CALL time:
 *   - browser: lib/supabase.ts calls setSharedSupabase(anon client) at startup
 *   - worker:  index.ts calls setSharedSupabase(service-role client) at boot
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

type Client = SupabaseClient<Database>;

let client: Client | null = null;

export function setSharedSupabase(c: Client): void {
  client = c;
}

function resolve(): Client {
  if (!client) {
    throw new Error(
      '[SUPABASE_SHARED] client not initialised — the entrypoint must call setSharedSupabase() first'
    );
  }
  return client;
}

/** Lazy proxy — safe to import at module load, resolved on first use. */
export const sharedSupabase: Client = new Proxy({} as Client, {
  get(_t, prop) {
    const c = resolve() as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});

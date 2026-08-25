import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { setSharedSupabase } from './supabaseShared';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

/**
 * Panne d'horloge PostgREST (24-25/08, récurrente) : le valideur du projet
 * Supabase DÉRIVE — un jeton de session émis à l'heure exacte est refusé
 * « JWT issued at future » pendant plusieurs minutes après chaque émission
 * (mesuré : iat à ±0,6 s de l'heure réelle, refus immédiat). Un redémarrage
 * du projet resynchronise puis ça re-dérive : panne infra Supabase, ticket
 * support requis. En attendant, CE fetch :
 *   1. rejoue quelques fois (2/4/8 s) toute requête refusée pour ce motif —
 *      un 401 signifie que RIEN n'a été exécuté, le rejeu est sûr même en
 *      écriture ; les micro-retards se résorbent ainsi sans que l'UI le voie ;
 *   2. si le retard persiste, traduit le message brut en explication
 *      actionnable — plus jamais un « JWT issued at future » nu en bandeau.
 * Ne touche à rien d'autre : toute autre erreur passe telle quelle.
 */
const CLOCK_LAG_RETRIES_MS = [2000, 4000, 8000];
const clockLagFetch: typeof fetch = async (input, init) => {
  let res = await fetch(input, init);
  for (const delay of CLOCK_LAG_RETRIES_MS) {
    if (res.status !== 401) return res;
    const body = await res.clone().text().catch(() => '');
    if (!/JWT issued at future/i.test(body)) return res;
    await new Promise((r) => setTimeout(r, delay));
    res = await fetch(input, init);
  }
  if (res.status === 401) {
    const body = await res.clone().text().catch(() => '');
    if (/JWT issued at future/i.test(body)) {
      console.warn('[SUPABASE] horloge du serveur en retard — requête refusée après rejeux ; remède : Supabase → Settings → General → Restart project (et ticket support si ça se répète)');
      return new Response(
        JSON.stringify({
          code: 'PGRST303',
          message: 'Horloge du serveur de données en retard (panne Supabase) — recharge dans quelques minutes, ou redémarre le projet Supabase (Settings → General → Restart project).',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
  return res;
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: { fetch: clockLagFetch },
});

// Shared holder so browser/worker-agnostic modules (linkgen, marketData…)
// reach this same client without importing import.meta.env code.
setSharedSupabase(supabase);

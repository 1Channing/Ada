// Taux de change côté front : app_config « fx_rates » (BCE, tenu à jour par le
// worker), repli sur les constantes de src/lib/fx.ts. Chargé une fois au
// démarrage (App.tsx) ; `currentFx()` est synchrone pour l'affichage.
import { supabase } from '../lib/supabase';
import { FALLBACK_FX, toEur as toEurWith, type FxRates } from '../lib/fx';
import { setFxRates } from '../lib/study-core/business-logic';

let current: FxRates = FALLBACK_FX;
let loaded: Promise<FxRates> | null = null;

export function currentFx(): FxRates { return current; }

export function loadFxRates(): Promise<FxRates> {
  if (loaded) return loaded;
  loaded = (async () => {
    try {
      const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data, error } = await untyped.from('app_config').select('value').eq('key', 'fx_rates').maybeSingle();
      const v = (data as { value?: { date?: string; rates?: Record<string, number> } } | null)?.value;
      if (!error && v?.date && v.rates && v.rates.DKK) {
        current = { date: v.date, rates: { EUR: 1, ...v.rates }, source: 'cache' };
      } else if (error) {
        console.warn('[FX] app_config fx_rates illisible — taux de repli du', FALLBACK_FX.date, ':', error.message);
      }
    } catch (e) {
      console.warn('[FX] taux de repli du', FALLBACK_FX.date, ':', e instanceof Error ? e.message : String(e));
    }
    setFxRates(current.rates);
    return current;
  })();
  return loaded;
}

/** Montant en euros avec les taux chargés ; null si devise inconnue. */
export function toEur(amount: number, currency: string | null | undefined): number | null {
  return toEurWith(amount, currency, current);
}

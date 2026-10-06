// Taux de change du worker : BCE une fois par jour, gardés dans app_config
// « fx_rates » pour le front, repli sur la dernière valeur en base puis sur
// les constantes de src/lib/fx.ts — et le bilan dit laquelle a servi.
import { sharedSupabase as supabase } from '../src/lib/supabaseShared';
import { ECB_DAILY_URL, FALLBACK_FX, parseEcbXml, type FxRates } from '../src/lib/fx';

const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000; // une lecture BCE par jour suffit (publication ~16h CET)
let memo: { fx: FxRates; fetchedAt: number } | null = null;

type Stored = { date?: string; rates?: Record<string, number>; fetched_at?: string };

async function readStored(): Promise<{ fx: FxRates; fetchedAt: number } | null> {
  try {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'fx_rates').maybeSingle();
    const v = (data as { value?: Stored } | null)?.value;
    if (!v?.date || !v.rates || !v.rates.DKK) return null;
    const fetchedAt = v.fetched_at ? Date.parse(v.fetched_at) : 0;
    return { fx: { date: v.date, rates: { EUR: 1, ...v.rates }, source: 'cache' }, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0 };
  } catch { return null; }
}

async function fetchEcb(): Promise<FxRates | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const r = await fetch(ECB_DAILY_URL, { signal: ctl.signal, headers: { 'User-Agent': 'ADA/1.0 (+mc-export)' } });
    clearTimeout(t);
    if (!r.ok) return null;
    return parseEcbXml(await r.text());
  } catch { return null; }
}

/** Taux du jour (1 EUR = x devise). Jamais d'échec : au pire les constantes, avec source = 'fallback'. */
export async function getFxRates(): Promise<FxRates> {
  const now = Date.now();
  if (memo && now - memo.fetchedAt < REFRESH_AFTER_MS) return memo.fx;
  const stored = await readStored();
  if (stored && now - stored.fetchedAt < REFRESH_AFTER_MS) { memo = stored; return stored.fx; }
  const fresh = await fetchEcb();
  if (fresh) {
    memo = { fx: fresh, fetchedAt: now };
    try {
      await supabase.from('app_config').upsert(
        { key: 'fx_rates', value: { date: fresh.date, rates: fresh.rates, fetched_at: new Date(now).toISOString(), source: 'ecb' }, updated_at: new Date(now).toISOString() } as never,
        { onConflict: 'key' },
      );
    } catch (e) { console.warn('[FX] app_config fx_rates non écrit :', e instanceof Error ? e.message : String(e)); }
    return fresh;
  }
  if (stored) { memo = { fx: stored.fx, fetchedAt: now - REFRESH_AFTER_MS + 60 * 60 * 1000 }; return stored.fx; } // réessai dans 1 h
  console.warn('[FX] BCE injoignable et aucun taux en base — taux de repli du', FALLBACK_FX.date);
  return FALLBACK_FX;
}

/** Montant en euros avec les taux du jour ; null si devise inconnue. */
export async function toEurToday(amount: number, currency: string | null | undefined): Promise<number | null> {
  const c = (currency ?? 'EUR').toUpperCase();
  if (c === 'EUR' || c === '') return amount;
  const fx = await getFxRates();
  const r = fx.rates[c];
  return r && r > 0 ? amount / r : null;
}

/**
 * TAUX DE CHANGE — un seul endroit (06/10, Channing : « adapte cette vitrine
 * ainsi que le taux de change », raevhede.dk en couronnes danoises).
 *
 * Source : la BCE (eurofxref-daily.xml, un taux par devise, « 1 EUR = x »),
 * lue par le worker une fois par jour et gardée dans app_config « fx_rates » ;
 * le front la lit au démarrage. Sans réseau ni base : les taux de repli
 * ci-dessous (BCE du 06/10/2026), et le code le DIT (source 'fallback').
 *
 * Convention : `rates[DEV]` = combien de DEV pour 1 EUR (forme BCE).
 */
export interface FxRates {
  /** Date de référence BCE (AAAA-MM-JJ). */
  date: string;
  /** 1 EUR = rates[devise] unités de devise. */
  rates: Record<string, number>;
  source: 'ecb' | 'cache' | 'fallback';
}

export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export const FALLBACK_FX: FxRates = {
  date: '2026-10-06',
  rates: { EUR: 1, DKK: 7.4747, SEK: 11.2425, NOK: 10.778, HUF: 364.95, PLN: 4.365, CZK: 24.405, CHF: 0.9359, GBP: 0.8488 },
  source: 'fallback',
};

/** Lit le XML BCE ; null si la forme n'est pas celle attendue (jamais de taux deviné). */
export function parseEcbXml(xml: string): FxRates | null {
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  if (!date) return null;
  const rates: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const r = Number(m[2]);
    if (Number.isFinite(r) && r > 0) rates[m[1]] = r;
  }
  return Object.keys(rates).length > 1 ? { date, rates, source: 'ecb' } : null;
}

/** Montant en euros ; null si la devise est inconnue (on n'invente pas). */
export function toEur(amount: number, currency: string | null | undefined, fx: FxRates = FALLBACK_FX): number | null {
  const c = (currency ?? 'EUR').toUpperCase();
  if (c === 'EUR' || c === '') return amount;
  const r = fx.rates[c];
  return r && r > 0 ? amount / r : null;
}

/** Libellé court d'un montant dans sa devise (« 192 900 kr », « 25 800 € »). */
export function fmtMoney(amount: number, currency: string | null | undefined): string {
  const c = (currency ?? 'EUR').toUpperCase();
  const n = Math.round(amount).toLocaleString('fr-FR');
  if (c === 'EUR' || c === '') return `${n} €`;
  if (c === 'DKK' || c === 'SEK' || c === 'NOK') return `${n} kr`;
  if (c === 'HUF') return `${n} Ft`;
  if (c === 'PLN') return `${n} zł`;
  if (c === 'CZK') return `${n} Kč`;
  if (c === 'GBP') return `£${n}`;
  return `${n} ${c}`;
}

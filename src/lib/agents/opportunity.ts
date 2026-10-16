/**
 * « ILS VENDENT CE QUE NOUS VENDONS, PLUS CHER » (17/10, Channing) — la
 * logique pure qui rapproche les annonces d'un garage de nos offres (la
 * vitrine des bonnes affaires, prix MC Export HT) : même marque, même
 * modèle, année à un an près, kilométrage comparable. Le prix affiché par
 * le garage est TTC ; on compare à notre HT + la TVA de son pays.
 * Aucun import : testée par test/agents-annuaire.test.ts.
 */

export interface OfferLite { id: string; brand: string; model: string; year: number | null; km: number | null; priceHt: number | null; title: string }
export interface DealerListingLite { listing_url: string; brand: string | null; model: string | null; year: number | null; mileage: number | null; price_eur: number | null; title: string | null }
export interface Opportunity { listing: DealerListingLite; offer: OfferLite; ourTtc: number; gap: number; gapPct: number }

/** Marque comparable : « Mercedes-Benz » = « MERCEDES BENZ » = « mercedes ». */
export function brandKey(b: string | null | undefined): string {
  const k = (b ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return k === 'MERCEDESBENZ' ? 'MERCEDES' : k === 'VW' ? 'VOLKSWAGEN' : k;
}

/** Modèle comparable : « C-HR » = « CHR » ; « Corolla Touring Sports » se rapproche de « Corolla ». */
export function modelKey(m: string | null | undefined): string {
  return (m ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function sameModel(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = modelKey(a);
  const y = modelKey(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y));
}

/** Même voiture à peu près : année à un an près, kilométrage à ±35 % (et 15 000 km de marge). */
export function comparable(l: DealerListingLite, o: OfferLite): boolean {
  if (brandKey(l.brand) !== brandKey(o.brand) || !sameModel(l.model, o.model)) return false;
  if (l.year != null && o.year != null && Math.abs(l.year - o.year) > 1) return false;
  if (l.mileage != null && o.km != null && Math.abs(l.mileage - o.km) > Math.max(15_000, o.km * 0.35)) return false;
  return true;
}

/** Les annonces du garage plus chères que notre offre comparable (prix TTC du pays), meilleur écart d'abord. */
export function opportunities(listings: DealerListingLite[], offers: OfferLite[], vatRate: number): Opportunity[] {
  const out: Opportunity[] = [];
  for (const l of listings) {
    if (!l.price_eur || l.price_eur <= 0) continue;
    let best: Opportunity | null = null;
    for (const o of offers) {
      if (!o.priceHt || o.priceHt <= 0 || !comparable(l, o)) continue;
      const ourTtc = Math.round(o.priceHt * (1 + vatRate));
      const gap = l.price_eur - ourTtc;
      if (gap <= 0) continue;
      if (!best || gap > best.gap) best = { listing: l, offer: o, ourTtc, gap, gapPct: Math.round((gap / l.price_eur) * 100) };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.gap - a.gap);
}

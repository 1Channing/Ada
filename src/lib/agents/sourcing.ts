/**
 * DANA — CE QU'ELLE SAIT ET CE QU'ELLE CHERCHE (17/10, Channing : « Ada &
 * Dana ne sont pas là pour faire le day to day business, mais pour le
 * scaler… des fournisseurs long termes, ceux qui ont les réelles
 * opportunités » ; « plusieurs véhicules identiques, c'est intéressant »).
 *
 * La partie pure du sourcing : les faits que Dana peut citer, son fournisseur
 * idéal, les lots d'un garage (véhicules identiques) et le score
 * d'adéquation d'un fournisseur, explicable ligne par ligne, sans IA ; et ce
 * qui fait un « grand compte » (préparé pour Channing, qui envoie lui-même).
 * Testée par test/agents-dana.test.ts.
 */
import { brandKey, modelKey } from './opportunity';
import type { Fit, ScoreLine } from './qualification';

/** Ce que Dana peut dire de MC Export comme ACHETEUR (rien d'autre). */
export const DANA_FACTS = `MC Export — 88 B avenue Jean Boutton, 49130 Les Ponts-de-Cé (près d'Angers), France. Société créée en juin 2024, commerce de voitures et de véhicules légers (NAF 45.11Z).
Métier : exportateur de véhicules d'occasion récents vers l'Europe (Pays-Bas, Danemark, Belgique, Allemagne et toute l'UE), pour des professionnels. Pour cela, MC Export achète des véhicules récents auprès de professionnels : concessions et groupes de distribution, loueurs, sociétés de leasing, flottes d'entreprise, négociants.
Ce que MC Export achète surtout : Toyota (beaucoup d'hybrides), Suzuki, Peugeot, Opel et d'autres marques courantes, récentes ; aussi des utilitaires (Ford, Mercedes-Benz…).`;

export const DANA_IDEAL_SELLER = `Le fournisseur idéal de Dana : un professionnel, dans n'importe quel pays d'Europe, qui a régulièrement des véhicules récents à céder, de préférence plusieurs identiques (retours de flotte ou de leasing, fins de location, stock d'un groupe) : concession ou groupe de distribution (son responsable VO ou des ventes aux marchands), loueur ou société de leasing (son remarketing), flotte d'entreprise (son gestionnaire de parc), négociant B2B. On cherche une relation durable et des lots réguliers, pas une voiture isolée ; un groupe de plusieurs sites, un loueur ou un leasing valent davantage.
Pas des fournisseurs pour Dana : les particuliers ; les garages sans véhicules récents à vendre ; les spécialistes du luxe, de la collection, des camping-cars, des poids lourds ou des motos ; les sites d'annonces eux-mêmes.`;

/** Les réglages de Dana (agent_settings.targets) : taille d'un lot, nos pays de vente, les marques de ses relevés d'annonces (18/10). */
export interface DanaTargets { minLot: number; markets: string[]; brands: string[] }
export const DEFAULT_DANA_TARGETS: DanaTargets = { minLot: 3, markets: ['NL', 'DK', 'BE', 'DE'], brands: ['Toyota', 'Suzuki', 'Peugeot', 'Opel'] };
export function normalizeDanaTargets(t: unknown): DanaTargets {
  const o = (t && typeof t === 'object' ? t : {}) as { minLot?: unknown; markets?: unknown; brands?: unknown };
  const min = Math.round(Number(o.minLot));
  const markets = Array.isArray(o.markets) ? o.markets.map((x) => String(x ?? '').trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)) : [];
  const brands = Array.isArray(o.brands) ? o.brands.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 40) : null;
  return {
    minLot: Number.isFinite(min) && min >= 2 ? Math.min(20, min) : DEFAULT_DANA_TARGETS.minLot,
    markets: markets.length ? [...new Set(markets)] : DEFAULT_DANA_TARGETS.markets,
    brands: brands ? [...new Map(brands.map((b) => [brandKey(b), b])).values()] : DEFAULT_DANA_TARGETS.brands,
  };
}
/** Les pays des relevés d'annonces de Dana : la France d'abord, puis le reste de l'Europe (ceux dont ADA sait lire les sites). */
export const danaScanCountries = (siteCountries: string[]): string[] => ['FR', ...siteCountries.filter((c) => c !== 'FR')];

/** Un lot tel que Dana le lit : véhicules identiques chez un garage, et l'écart brut face à nos pays de vente. */
export interface LotFact {
  brand: string; model: string; year: number; count: number;
  priceMin: number | null; priceMax: number | null; kmMin: number | null; kmMax: number | null;
  firstSeenAt: string | null;
  /** Meilleur écart brut (prix médian du pays de vente − prix médian du lot), et ce pays. */
  bestGap: number | null; bestMarket: string | null;
}

/** Ce que rend agents_dealer_lots() → les faits d'un lot. */
export function lotFactOf(l: {
  brand: string; model: string; year: number; count: number; price_min?: number | null; price_max?: number | null; km_min?: number | null; km_max?: number | null;
  first_seen_at?: string | null; markets?: Array<{ market: string; gap: number }> | null;
}): LotFact {
  const best = [...(l.markets ?? [])].sort((a, b) => b.gap - a.gap)[0];
  return {
    brand: l.brand, model: l.model, year: l.year, count: l.count, priceMin: l.price_min ?? null, priceMax: l.price_max ?? null,
    kmMin: l.km_min ?? null, kmMax: l.km_max ?? null, firstSeenAt: l.first_seen_at ?? null, bestGap: best ? best.gap : null, bestMarket: best ? best.market : null,
  };
}

/** Les lots d'un stock (repli sans la base) : même marque, même modèle, même année, à partir de `min`. */
export function lotsFromListings(listings: Array<{ brand: string | null; model: string | null; year: number | null; mileage: number | null; price_eur: number | null }>, min = 3): LotFact[] {
  const groups = new Map<string, typeof listings>();
  for (const l of listings) {
    if (!l.brand || !l.model || !l.year) continue;
    const k = `${brandKey(l.brand)}|${modelKey(l.model)}|${l.year}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(l);
  }
  const out: LotFact[] = [];
  for (const g of groups.values()) {
    if (g.length < min) continue;
    const prices = g.map((x) => x.price_eur).filter((x): x is number => x != null);
    const kms = g.map((x) => x.mileage).filter((x): x is number => x != null);
    out.push({
      brand: g[0].brand as string, model: g[0].model as string, year: g[0].year as number, count: g.length,
      priceMin: prices.length ? Math.min(...prices) : null, priceMax: prices.length ? Math.max(...prices) : null,
      kmMin: kms.length ? Math.min(...kms) : null, kmMax: kms.length ? Math.max(...kms) : null, firstSeenAt: null, bestGap: null, bestMarket: null,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

const n0 = (n: number) => Math.round(n).toLocaleString('fr-FR');
const daysSince = (iso: string | null, now = Date.now()) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 86_400_000)) : null);
const nice = (b: string) => b.charAt(0) + b.slice(1).toLowerCase();

/**
 * Une ligne de lot. `withPrices` : pour la qualification et Channing ; JAMAIS
 * dans le matériel d'un mail au vendeur (ni ses prix, ni nos écarts : la
 * négociation passe par Channing).
 */
export function lotLine(l: LotFact, withPrices: boolean, now = Date.now()): string {
  const km = l.kmMin != null && l.kmMax != null ? (l.kmMin === l.kmMax ? `${n0(l.kmMin)} km` : `de ${n0(l.kmMin)} à ${n0(l.kmMax)} km`) : null;
  const age = daysSince(l.firstSeenAt, now);
  const parts = [`${l.count} × ${nice(l.brand)} ${l.model} ${l.year}`, km];
  if (withPrices && l.priceMin != null && l.priceMax != null) parts.push(`affichés de ${n0(l.priceMin)} à ${n0(l.priceMax)} € TTC`);
  if (age != null && age >= 7) parts.push(`en ligne depuis au moins ${age} jours`);
  if (withPrices && l.bestGap != null && l.bestMarket) parts.push(`écart brut ${l.bestGap > 0 ? '+' : ''}${n0(l.bestGap)} € face aux annonces ${l.bestMarket}`);
  return parts.filter(Boolean).join(', ');
}

export interface DanaFitInput { lots: LotFact[]; listings: number; hasEmail: boolean; hasNamedContact: boolean }

/** Score d'adéquation d'un fournisseur 0-100, explicable ligne par ligne (aucune IA). */
export function danaFitScore(i: DanaFitInput, now = Date.now()): Fit {
  const parts: Fit['parts'] = [];
  const add = (label: string, points: number) => { if (points > 0) parts.push({ label, points: Math.round(points) }); };
  const biggest = Math.max(0, ...i.lots.map((l) => l.count));
  if (biggest > 0) add(`lot de ${biggest} véhicules identiques`, biggest >= 6 ? 30 : biggest >= 4 ? 22 : biggest >= 3 ? 15 : 8);
  if (i.lots.length >= 2) add(`${i.lots.length} lots`, 10);
  const gaps = i.lots.filter((l) => l.bestGap != null && l.bestGap > 0);
  if (gaps.length) {
    const best = gaps.sort((a, b) => (b.bestGap ?? 0) - (a.bestGap ?? 0))[0];
    const g = best.bestGap ?? 0;
    add(`écart brut +${n0(g)} € (${best.bestMarket})`, g >= 3000 ? 25 : g >= 1000 ? 18 : 10);
  }
  const oldest = Math.max(0, ...i.lots.map((l) => daysSince(l.firstSeenAt, now) ?? 0));
  if (oldest >= 30) add(`en stock depuis ${oldest} jours`, 10);
  add(`stock suivi : ${i.listings} annonce${i.listings > 1 ? 's' : ''}`, i.listings >= 50 ? 8 : i.listings >= 20 ? 5 : 0);
  if (i.hasEmail) add('e-mail publié', 8);
  if (i.hasNamedContact) add('interlocuteur nommé', 4);
  return { score: Math.min(100, parts.reduce((s, p) => s + p.points, 0)), parts };
}

/** La note d'un garage à lots de Dana, en clair (le « i » des Réglages) : à tenir à jour avec danaFitScore ci-dessus. */
export const DANA_SCORE_HELP: ScoreLine[] = [
  ['plus gros lot', '+8, +15, +22, +30', '2, 3, 4 ou 5, 6 véhicules identiques et plus'],
  ['deux lots ou plus', '+10'],
  ['écart de prix avec nos pays de revente', '+10, +18, +25', 'moins de 1 000 €, dès 1 000 €, dès 3 000 €'],
  ['en stock depuis 30 jours ou plus', '+10'],
  ['stock suivi', '+5, +8', '20, 50 annonces et plus'],
];

/** Les natures de compte qu'on traite en grand compte (Channing envoie lui-même). */
export const KEY_ACCOUNT_KINDS = ['groupe', 'loueur_ou_leasing', 'flotte_entreprise'];

/** Grand compte : l'IA le dit, ou c'est un groupe, un loueur, un leasing, une flotte, ou 3 sites et plus. */
export function isKeyAccount(aiSays: boolean | null | undefined, kind: string | null | undefined, sites: number | null | undefined): boolean {
  return aiSays === true || KEY_ACCOUNT_KINDS.includes(kind ?? '') || (sites ?? 0) >= 3;
}

/** Clé d'un groupe (« Groupe Autosphère » = « AUTOSPHERE ») : pour ne pas écrire deux fois au même groupe. */
export function groupKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(groupe?|gruppe|grupo|gruppo|groep|holding|sas|sa|bv|gmbh|ag|ltd|nv)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/** Un nom qui annonce un groupe (« TOYOTA NANTERRE - AUTOSPHERE », « Groupe Bernier », « Stern Groep »). */
export const looksLikeGroup = (name: string | null | undefined): boolean =>
  /\b(groupe?|gruppe|grupo|gruppo|groep|holding)\b/i.test(name ?? '') || /\s[-–]\s[A-Z0-9]{5,}$/.test((name ?? '').trim());

/**
 * COMPARER LE STOCK D'UN CONTACT (02/11, demande Channing) : « dans la carte, un onglet Comparer :
 * le stock de la vitrine du client face à deux choses au choix —
 *   • les VENTES PASSÉES de MC Export (on a nos prix d'achat et de vente) : si notre prix de vente
 *     est au plus LEUR prix moins 5 000 €, ça passe pour faire des ventes ;
 *   • les OFFRES de l'onglet Offres (fichiers déjà analysés, nos prix d'achat) : leur prix de vente
 *     moins notre prix d'achat, intéressant à partir de 7 000 €.
 * Marque / modèle équivalents, année STRICTEMENT égale, kilométrage ± 15 000 km. »
 * Deuxième passe (02/11) : « ajouter le carburant en correspondance (essence, hybride, diesel) et la
 * finition lorsque c'est possible » — énergie et finition comparées dès qu'elles sont connues DES DEUX
 * côtés (sinon non comparées, et dit tel quel sur la ligne).
 *
 * Sources, toutes déjà en base : network_stock_vehicles (dernier relevé, voitures encore en vente),
 * transactions_admin + vehicles_admin (ventes : prix, plaque, 1re immatriculation → année, km),
 * supplier_offers.vehicles (offres : prix fournisseur HT = notre prix d'achat, année, km).
 * Prix du contact convertis en euros par la devise du relevé. Fail-open : une source illisible
 * donne un message, jamais une liste inventée.
 */
import { supabase } from '../lib/supabase';
import { brandKey, refModelKey } from './marketData';
import { listStockVehicles, type StockVehicle } from './dealerStock';
import { listOffers } from './offers';
import { toEur } from './fxRates';
import { TRIM_WORDS } from '../lib/offers/parseSupplierFile';
import { powerFromText, samePower } from '../lib/powerText';

/** Famille d'énergie, lue dans n'importe quelle langue des sites (Kamux « Hybride rechargeable essence »,
 *  dvnl « Benzine », Bilbasen « benzin / el », nos offres « HYBRIDE RECHARGEABLE », ventes « RAV4 PLUG IN »). */
export type FuelFamily = 'phev' | 'hybrid' | 'electric' | 'diesel' | 'petrol' | 'gas';
export const FUEL_LABEL: Record<FuelFamily, string> = { phev: 'hybride rechargeable', hybrid: 'hybride', electric: 'électrique', diesel: 'diesel', petrol: 'essence', gas: 'gaz' };
export function fuelFamily(text: string | null | undefined): FuelFamily | null {
  const t = (text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (!t.trim()) return null;
  if (/plug[- ]?in|rechargeable|phev|e-?hybrid|\bplugin\b/.test(t)) return 'phev';
  if (/hybrid|hybride|hybridi|\bhev\b|mhev|e-tech|\bh\b|\d{2,3}h\b/.test(t)) return 'hybrid';
  if (/electri|elektr|sahko|\bev\b|\bbev\b|\bel\b|elettric|electric/.test(t)) return 'electric';
  if (/diesel|\btdi\b|\bhdi\b|\bdci\b|\bcdi\b|\bcrdi\b|\bd4d\b|bluehdi|\bgazole\b/.test(t)) return 'diesel';
  if (/essence|benzin|bensin|bensiini|petrol|gasolin|\btsi\b|\btfsi\b|\btce\b|puretech|\bvti\b/.test(t)) return 'petrol';
  if (/\bgpl\b|\blpg\b|\bcng\b|\bgnv\b|kaasu|\bgaz\b|\bgas\b/.test(t)) return 'gas';
  return null;
}

/** Finition lue dans une ligne libre (version d'offre, titre d'annonce, libellé de vente) : la première
 *  finition connue rencontrée, les composées d'abord (« GR SPORT » avant « GR », « GT LINE » avant « GT »). */
const TRIM_MULTI = ['GR SPORT', 'GT LINE', 'GT-LINE', 'N LINE', 'N-LINE', 'R-DESIGN', 'R DESIGN', 'S LINE', 'S-LINE', 'M SPORT', 'AMG LINE', 'ST-LINE', 'ST LINE', 'BLACK EDITION', 'FIRST EDITION', 'LAUNCH EDITION', 'PERFORMANCE LINE', 'LONG RANGE', 'LA PRIMA', 'DARK EDITION', 'X-LINE', 'XLINE', 'LOUNGE', 'TREKKING', 'COLLECTION', 'PREMIERE', 'DYNAMIC', 'TRAIL', 'GR', 'GT', 'RS', 'AMG', 'TI', 'VELOCE', 'COMPETIZIONE', 'TITANIUM X', 'VIGNALE', 'TEKNA', 'ACENTA', 'N-CONNECTA', 'VISIA', 'INTENSE', 'PLATINUM', 'LIMITED'];
export function trimOf(text: string | null | undefined): string | null {
  const t = ` ${(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[*]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (t.trim().length === 0) return null;
  for (const m of TRIM_MULTI) if (t.includes(` ${m} `)) return m.replace(/-/g, ' ');
  for (const w of t.trim().split(' ')) if (TRIM_WORDS.has(w)) return w;
  return null;
}

export const KM_TOLERANCE = 15_000;
export const SALES_THRESHOLD_EUR = 5_000;
export const OFFERS_THRESHOLD_EUR = 7_000;

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Une voiture de NOTRE côté : vente passée ou véhicule d'offre. */
export interface OurVehicle {
  kind: 'sale' | 'offer';
  id: string;
  label: string;            // « Toyota Yaris GR » / version d'offre
  brand: string;
  model: string;
  year: number | null;
  km: number | null;
  fuel: FuelFamily | null;
  trim: string | null;
  /** Puissance (ch) quand elle est connue (02/11). */
  power: number | null;
  /** Vente : notre prix de VENTE. Offre : notre prix d'ACHAT (HT fournisseur). */
  price: number;
  /** Vente : prix d'achat (pour information). */
  purchase?: number | null;
  /** Vente : date, plaque, statut. Offre : titre de l'offre, fournisseur. */
  detail: string;
  date: string | null;
  plate?: string | null;
  offerId?: string;
}

export interface CompareMatch {
  theirs: StockVehicle;
  theirsEur: number;
  ours: OurVehicle;
  /** Leur prix (€) − notre prix. */
  gap: number;
  /** gap ≥ seuil. */
  ok: boolean;
  /** Énergie / finition comparées (connues des deux côtés) ou non. */
  fuelCompared: boolean;
  trimCompared: boolean;
  powerCompared: boolean;
  theirsFuel: FuelFamily | null;
  theirsTrim: string | null;
  theirsPower: number | null;
  /** Les AUTRES de nos véhicules appariés à la même voiture du contact (02/11 : une ligne par voiture, la
   *  meilleure de nos offres en face, le reste replié), du meilleur au moins bon écart. */
  others: CompareMatch[];
}

export interface CompareResult {
  theirsTotal: number;
  theirsPriced: number;
  oursTotal: number;
  /** Une entrée par voiture du contact appariée : la meilleure correspondance, les autres dans `others`. */
  matches: CompareMatch[];
  /** Nombre total de paires (toutes nos offres/ventes confondues). */
  pairs: number;
  /** Voitures du contact avec au moins un match au-dessus du seuil. */
  theirsOk: number;
  warnings: string[];
}

const yearOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const y = Number(String(iso).slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : null;
};

/** Ventes passées de MC Export : un dossier = une voiture vendue (prix de vente connu). */
export async function loadOurSales(): Promise<{ rows: OurVehicle[]; error: string | null }> {
  const out: OurVehicle[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await untyped
      .from('transactions_admin')
      .select('id, reference, purchase_price, sale_price, transaction_date, status, notes, vehicle:vehicles_admin!transactions_admin_vehicle_id_fkey(plate_number, brand, model, commercial_name, type_variant_version, first_registration_date, mileage)')
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error) return { rows: out, error: error.message };
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of batch) {
      const v = (r.vehicle ?? null) as { plate_number?: string | null; brand?: string | null; model?: string | null; commercial_name?: string | null; type_variant_version?: string | null; first_registration_date?: string | null; mileage?: number | null } | null;
      const sale = Number(r.sale_price);
      if (!v || !v.brand || !v.model || !Number.isFinite(sale) || sale <= 0) continue;
      const status = String(r.status ?? '');
      // Énergie et finition : la fiche véhicule n'a pas de colonne énergie — lues dans le libellé du dossier
      // (« Véhicule : RAV4 PLUG IN », « YARIS CROSS GR 130H ») et le nom commercial.
      const sheetLabel = String(r.notes ?? '').match(/Véhicule : (.*)/)?.[1]?.trim() ?? '';
      const freeText = [sheetLabel, v.commercial_name ?? '', v.type_variant_version ?? ''].join(' ');
      out.push({
        kind: 'sale', id: String(r.id), label: `${v.brand} ${sheetLabel || v.commercial_name?.trim() || v.model}`.replace(/\s+/g, ' ').trim(),
        brand: String(v.brand), model: String(v.model), year: yearOf(v.first_registration_date), km: typeof v.mileage === 'number' ? v.mileage : null,
        fuel: fuelFamily(freeText), trim: trimOf(sheetLabel || v.commercial_name), power: powerFromText(freeText),
        price: sale, purchase: typeof r.purchase_price === 'number' ? r.purchase_price : null,
        detail: [r.reference ? `réf. ${r.reference}` : '', status === 'cloturee' ? 'clôturée' : status === 'en_cours' ? 'en cours' : status].filter(Boolean).join(' · '),
        date: (r.transaction_date as string | null) ?? null, plate: v.plate_number ?? null,
      });
    }
    if (batch.length < 1000) break;
  }
  return { rows: out, error: null };
}

/** Véhicules des offres fournisseurs analysées (prix d'achat HT connu). */
export async function loadOurOffers(): Promise<{ rows: OurVehicle[]; error: string | null }> {
  const { rows: offers, error } = await listOffers();
  if (error) return { rows: [], error };
  const out: OurVehicle[] = [];
  for (const o of offers) {
    for (const v of o.vehicles ?? []) {
      const buy = v.price_ht ?? (v.price_ttc != null ? Math.round(v.price_ttc / (1 + (v.vat_rate ?? 0.2))) : null);
      if (!v.brand || !v.model || buy == null || buy <= 0) continue;
      out.push({
        kind: 'offer', id: v.id, label: `${v.brand} ${v.model}${v.version ? ` · ${v.version}` : ''}`, brand: v.brand, model: v.model,
        year: v.year ?? yearOf(v.reg_date), km: v.km, price: buy,
        fuel: fuelFamily(v.fuel) ?? fuelFamily(v.version), trim: trimOf(v.version), power: v.power_ch ?? powerFromText(v.version),
        detail: [o.title || o.source_filename, o.supplier].filter(Boolean).join(' · '), date: o.updated_at ?? null, offerId: o.id,
      });
    }
  }
  return { rows: out, error: null };
}

/** Le stock EN VENTE du contact (dernier relevé, voitures non disparues). */
export async function loadTheirStock(contactId: string): Promise<{ rows: StockVehicle[]; error: string | null }> {
  const { vehicles, error } = await listStockVehicles(contactId);
  if (error) return { rows: [], error };
  return { rows: vehicles.filter((v) => !v.gone_at), error: null };
}

/** Règle d'appariement : même marque et modèle (clés du référentiel), même année, km à ± 15 000 ; énergie et
 *  finition égales quand elles sont connues des deux côtés. Rend ce qui a pu être comparé, ou null. */
export function sameSegment(
  a: { brand: string | null; model: string | null; year: number | null; km: number | null; fuel?: FuelFamily | null; trim?: string | null; power?: number | null },
  b: { brand: string; model: string; year: number | null; km: number | null; fuel?: FuelFamily | null; trim?: string | null; power?: number | null },
): { fuelCompared: boolean; trimCompared: boolean; powerCompared: boolean } | null {
  if (!a.brand || !a.model || a.year == null || b.year == null || a.year !== b.year) return null;
  if (a.km == null || b.km == null || Math.abs(a.km - b.km) > KM_TOLERANCE) return null;
  if (brandKey(a.brand) !== brandKey(b.brand)) return null;
  if (refModelKey(a.brand, a.model) !== refModelKey(b.brand, b.model)) return null;
  const fuelCompared = a.fuel != null && b.fuel != null;
  if (fuelCompared && a.fuel !== b.fuel) return null;
  const trimCompared = !!a.trim && !!b.trim;
  if (trimCompared && a.trim !== b.trim) return null;
  // Puissance (02/11) : équivalente à 10 % près quand elle est connue des deux côtés.
  const same = samePower(a.power, b.power);
  const powerCompared = same != null;
  if (same === false) return null;
  return { fuelCompared, trimCompared, powerCompared };
}
/** Énergie et finition d'une voiture du contact : colonne énergie du relevé, sinon le titre. */
export function theirsFuelTrim(t: StockVehicle): { fuel: FuelFamily | null; trim: string | null; power: number | null } {
  return { fuel: fuelFamily(t.fuel) ?? fuelFamily(t.title), trim: trimOf(t.title), power: t.power_ch ?? powerFromText(t.title) };
}

export function compareStock(theirs: StockVehicle[], ours: OurVehicle[], threshold: number): CompareResult {
  const matches: CompareMatch[] = [];
  const warnings: string[] = [];
  let priced = 0;
  let unknownCurrency = 0;
  let pairs = 0;
  const okIds = new Set<string>();
  for (const t of theirs) {
    if (t.price == null || t.price <= 0) continue;
    const eur = toEur(t.price, t.currency ?? 'EUR');
    if (eur == null) { unknownCurrency++; continue; }
    priced++;
    const tf = theirsFuelTrim(t);
    const mine: CompareMatch[] = [];
    for (const o of ours) {
      const seg = sameSegment({ ...t, ...tf }, o);
      if (!seg) continue;
      const gap = Math.round(eur - o.price);
      const ok = gap >= threshold;
      if (ok) okIds.add(t.id);
      mine.push({ theirs: t, theirsEur: Math.round(eur), ours: o, gap, ok, fuelCompared: seg.fuelCompared, trimCompared: seg.trimCompared, powerCompared: seg.powerCompared, theirsFuel: tf.fuel, theirsTrim: tf.trim, theirsPower: tf.power, others: [] });
    }
    if (mine.length === 0) continue;
    pairs += mine.length;
    // La MEILLEURE de nos offres en face (plus grand écart = notre prix le plus bas) ; à écart égal, celle qui
    // a pu être comparée sur l'énergie et la finition. Les autres repliées derrière.
    mine.sort((a, b) => b.gap - a.gap || Number(b.fuelCompared) + Number(b.trimCompared) + Number(b.powerCompared) - Number(a.fuelCompared) - Number(a.trimCompared) - Number(a.powerCompared));
    const best = mine[0];
    best.others = mine.slice(1);
    matches.push(best);
  }
  if (unknownCurrency > 0) warnings.push(`${unknownCurrency} voiture(s) du contact dans une devise sans taux connu — ignorées`);
  matches.sort((a, b) => b.gap - a.gap);
  return { theirsTotal: theirs.length, theirsPriced: priced, oursTotal: ours.length, matches, pairs, theirsOk: okIds.size, warnings };
}

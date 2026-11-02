/**
 * COMPARER LE STOCK D'UN CONTACT (02/11, demande Channing) : « dans la carte, un onglet Comparer :
 * le stock de la vitrine du client face à deux choses au choix —
 *   • les VENTES PASSÉES de MC Export (on a nos prix d'achat et de vente) : si notre prix de vente
 *     est au plus LEUR prix moins 5 000 €, ça passe pour faire des ventes ;
 *   • les OFFRES de l'onglet Offres (fichiers déjà analysés, nos prix d'achat) : leur prix de vente
 *     moins notre prix d'achat, intéressant à partir de 7 000 €.
 * Marque / modèle équivalents, année STRICTEMENT égale, kilométrage ± 15 000 km. »
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
}

export interface CompareResult {
  theirsTotal: number;
  theirsPriced: number;
  oursTotal: number;
  matches: CompareMatch[];
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
      .select('id, reference, purchase_price, sale_price, transaction_date, status, vehicle:vehicles_admin!transactions_admin_vehicle_id_fkey(plate_number, brand, model, commercial_name, first_registration_date, mileage)')
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error) return { rows: out, error: error.message };
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of batch) {
      const v = (r.vehicle ?? null) as { plate_number?: string | null; brand?: string | null; model?: string | null; commercial_name?: string | null; first_registration_date?: string | null; mileage?: number | null } | null;
      const sale = Number(r.sale_price);
      if (!v || !v.brand || !v.model || !Number.isFinite(sale) || sale <= 0) continue;
      const status = String(r.status ?? '');
      out.push({
        kind: 'sale', id: String(r.id), label: `${v.brand} ${v.commercial_name?.trim() || v.model}`.replace(/\s+/g, ' ').trim(),
        brand: String(v.brand), model: String(v.model), year: yearOf(v.first_registration_date), km: typeof v.mileage === 'number' ? v.mileage : null,
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

/** Règle d'appariement : même marque et modèle (clés du référentiel), même année, km à ± 15 000. */
export function sameSegment(a: { brand: string | null; model: string | null; year: number | null; km: number | null }, b: { brand: string; model: string; year: number | null; km: number | null }): boolean {
  if (!a.brand || !a.model || a.year == null || b.year == null || a.year !== b.year) return false;
  if (a.km == null || b.km == null || Math.abs(a.km - b.km) > KM_TOLERANCE) return false;
  if (brandKey(a.brand) !== brandKey(b.brand)) return false;
  return refModelKey(a.brand, a.model) === refModelKey(b.brand, b.model);
}

export function compareStock(theirs: StockVehicle[], ours: OurVehicle[], threshold: number): CompareResult {
  const matches: CompareMatch[] = [];
  const warnings: string[] = [];
  let priced = 0;
  let unknownCurrency = 0;
  const okIds = new Set<string>();
  for (const t of theirs) {
    if (t.price == null || t.price <= 0) continue;
    const eur = toEur(t.price, t.currency ?? 'EUR');
    if (eur == null) { unknownCurrency++; continue; }
    priced++;
    for (const o of ours) {
      if (!sameSegment(t, o)) continue;
      const gap = Math.round(eur - o.price);
      const ok = gap >= threshold;
      if (ok) okIds.add(t.id);
      matches.push({ theirs: t, theirsEur: Math.round(eur), ours: o, gap, ok });
    }
  }
  if (unknownCurrency > 0) warnings.push(`${unknownCurrency} voiture(s) du contact dans une devise sans taux connu — ignorées`);
  matches.sort((a, b) => b.gap - a.gap);
  return { theirsTotal: theirs.length, theirsPriced: priced, oursTotal: ours.length, matches, theirsOk: okIds.size, warnings };
}

/**
 * OFFRES FOURNISSEUR — persistance (table supplier_offers, document d'équipe).
 * Fail-open : table absente (SQL du 14/09 pas collé) → message explicite,
 * l'import et l'export restent possibles sans sauvegarde.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import type { ColumnMapping, OfferVehicle } from '../lib/offers/parseSupplierFile';
import type { OfferMarket } from '../lib/offers/marketCheck';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
export const OFFERS_SQL_HINT = 'Offres : SQL du 14/09 (supplier_offers) à coller pour enregistrer.';

export interface PriceRule { mode: 'margin' | 'fixed'; margin: number }

export interface SupplierOffer {
  id: string; user_id: string; title: string; supplier: string; source_filename: string; layout: string;
  mappings: ColumnMapping[]; vehicles: OfferVehicle[]; price_rule: PriceRule; countries: string[];
  /** Relevés « où vendre » : lot → pays → résultat (SQL du 15/09). */
  market?: OfferMarket;
  notes: string; status: 'draft' | 'sent' | 'closed'; created_at: string; updated_at: string;
}

const isMissing = (e: { message?: string } | null) => !!e && /does not exist|schema cache|relation/i.test(e.message ?? '');

export async function listOffers(): Promise<{ rows: SupplierOffer[]; error: string | null }> {
  const { data, error } = await sb.from('supplier_offers').select('*').order('updated_at', { ascending: false }).limit(200);
  if (error) return { rows: [], error: isMissing(error) ? OFFERS_SQL_HINT : error.message };
  return { rows: (data ?? []) as SupplierOffer[], error: null };
}

export async function saveOffer(o: Partial<SupplierOffer> & { id?: string }): Promise<{ id: string | null; error: string | null }> {
  const payload = {
    title: o.title ?? '', supplier: o.supplier ?? '', source_filename: o.source_filename ?? '', layout: o.layout ?? 'flat',
    mappings: o.mappings ?? [], vehicles: o.vehicles ?? [], price_rule: o.price_rule ?? { mode: 'margin', margin: 500 },
    countries: o.countries ?? [], notes: o.notes ?? '', status: o.status ?? 'draft', updated_at: new Date().toISOString(),
  };
  const withMarket = o.market ? { ...payload, market: o.market } : payload;
  if (o.id) {
    let { error } = await sb.from('supplier_offers').update(withMarket).eq('id', o.id);
    // Colonne market absente (SQL du 15/09 pas collé) : on enregistre le reste.
    if (error && o.market && /market|column|schema cache/i.test(error.message ?? '')) ({ error } = await sb.from('supplier_offers').update(payload).eq('id', o.id));
    return { id: error ? null : o.id, error: error ? (isMissing(error) ? OFFERS_SQL_HINT : error.message) : null };
  }
  const { data, error } = await sb.from('supplier_offers').insert({ ...payload, user_id: useAuth.getState().userId }).select('id').single();
  return { id: (data as { id?: string } | null)?.id ?? null, error: error ? (isMissing(error) ? OFFERS_SQL_HINT : error.message) : null };
}

export async function deleteOffer(id: string): Promise<string | null> {
  const { error } = await sb.from('supplier_offers').delete().eq('id', id);
  return error ? error.message : null;
}

/** Applique la règle de prix MC Export à chaque véhicule (HT fournisseur + marge, ou prix fixe) sans écraser un prix saisi à la main. */
export function applyPriceRule(vehicles: OfferVehicle[], rule: PriceRule, supplierHt: (v: OfferVehicle) => number | null, force = false): OfferVehicle[] {
  return vehicles.map((v) => {
    if (v.sale_price != null && !force) return v;
    const base = supplierHt(v);
    const price = rule.mode === 'fixed' ? rule.margin : base != null ? base + rule.margin : null;
    return { ...v, sale_price: price != null ? Math.round(price) : null };
  });
}

/** Pays où l'équipe vend — l'ordre est celui des menus. */
export const OFFER_COUNTRIES: Array<{ code: string; label: string }> = [
  { code: 'FR', label: 'France' }, { code: 'DE', label: 'Allemagne' }, { code: 'NL', label: 'Pays-Bas' }, { code: 'BE', label: 'Belgique' },
  { code: 'DK', label: 'Danemark' }, { code: 'SE', label: 'Suède' }, { code: 'ES', label: 'Espagne' }, { code: 'IT', label: 'Italie' },
  { code: 'LT', label: 'Lituanie' }, { code: 'HU', label: 'Hongrie' },
];

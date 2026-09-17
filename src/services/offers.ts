/**
 * OFFRES FOURNISSEUR — persistance (table supplier_offers, document d'équipe).
 * Fail-open : table absente (SQL du 14/09 pas collé) → message explicite,
 * l'import et l'export restent possibles sans sauvegarde.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import type { ColumnMapping, OfferVehicle } from '../lib/offers/parseSupplierFile';
import type { OfferMarket, LotCriteria } from '../lib/offers/marketCheck';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
export const OFFERS_SQL_HINT = 'Offres : SQL du 14/09 (supplier_offers) à coller pour enregistrer.';

export interface PriceRule { mode: 'margin' | 'fixed'; margin: number }

export interface SupplierOffer {
  id: string; user_id: string; title: string; supplier: string; source_filename: string; layout: string;
  mappings: ColumnMapping[]; vehicles: OfferVehicle[]; price_rule: PriceRule; countries: string[];
  /** Relevés « où vendre » : lot → pays → résultat (SQL du 15/09). */
  market?: OfferMarket;
  /** Critères de recherche réglés à la main par lot (SQL du 17/09). */
  lot_criteria?: Record<string, LotCriteria>;
  /** Grille brute du fichier fournisseur — correspondance des colonnes modifiable après réouverture (SQL du 17/09). */
  source_grid?: unknown[][] | null;
  notes: string; status: 'draft' | 'sent' | 'closed'; created_at: string; updated_at: string;
}

const isMissing = (e: { message?: string } | null) => !!e && /does not exist|schema cache|relation/i.test(e.message ?? '');

export async function listOffers(): Promise<{ rows: SupplierOffer[]; error: string | null }> {
  const { data, error } = await sb.from('supplier_offers').select('*').order('updated_at', { ascending: false }).limit(200);
  if (error) return { rows: [], error: isMissing(error) ? OFFERS_SQL_HINT : error.message };
  return { rows: (data ?? []) as SupplierOffer[], error: null };
}

/** Colonnes ajoutées après la table (SQL du 15/09 et du 17/09) : envoyées si présentes, retirées une à une si la base ne les a pas encore. */
const EXTRA_COLUMNS = ['market', 'lot_criteria', 'source_grid'] as const;

export async function saveOffer(o: Partial<SupplierOffer> & { id?: string }): Promise<{ id: string | null; error: string | null }> {
  const payload: Record<string, unknown> = {
    title: o.title ?? '', supplier: o.supplier ?? '', source_filename: o.source_filename ?? '', layout: o.layout ?? 'flat',
    mappings: o.mappings ?? [], vehicles: o.vehicles ?? [], price_rule: o.price_rule ?? { mode: 'margin', margin: 500 },
    countries: o.countries ?? [], notes: o.notes ?? '', status: o.status ?? 'draft', updated_at: new Date().toISOString(),
  };
  for (const c of EXTRA_COLUMNS) if (o[c] !== undefined) payload[c] = o[c];
  const missingColumn = (msg: string) => EXTRA_COLUMNS.find((c) => new RegExp(`\\b${c}\\b`).test(msg) && /column|schema cache/i.test(msg));
  // Une colonne absente (SQL pas encore collé) : on la retire et on réessaie — le reste s'enregistre.
  let insertedId: string | null = null;
  const run = async (): Promise<{ error: { message?: string } | null }> => {
    for (let i = 0; i <= EXTRA_COLUMNS.length; i++) {
      const r = o.id
        ? await sb.from('supplier_offers').update(payload).eq('id', o.id)
        : await sb.from('supplier_offers').insert({ ...payload, user_id: useAuth.getState().userId }).select('id').single();
      const col = r.error ? missingColumn(r.error.message ?? '') : undefined;
      if (!col || !(col in payload)) { if (!o.id && r.data) insertedId = (r.data as { id?: string }).id ?? null; return r; }
      delete payload[col];
    }
    return { error: { message: 'colonnes manquantes' } };
  };
  const { error } = await run();
  if (error) return { id: null, error: isMissing(error) ? OFFERS_SQL_HINT : error.message ?? 'enregistrement en échec' };
  return { id: o.id ?? insertedId, error: null };
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

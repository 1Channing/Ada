/**
 * INTRA — la vitrine des véhicules disponibles sur l'Accueil de TOUS les
 * utilisateurs d'ADA, toutes organisations (12/10 soir, Channing : « ce
 * n'est pas pour l'équipe MC Export, c'est pour tous les utilisateurs, géré
 * par les gars de MC Export »). L'équipe de gestion MC Export publie, depuis
 * l'onglet Intra d'une offre, les véhicules qu'elle veut montrer ; chacun
 * voit la vitrine sur son Accueil ; l'étude de marché complète reste à ceux
 * qui ont l'onglet Offres.
 *
 * Chaque ligne est une PHOTOGRAPHIE prise à la publication (véhicule, prix
 * MC Export HT, relevé de marché du lot) : la vitrine ne bouge pas si
 * l'offre est retravaillée ; republier rafraîchit. Fail-open : table absente
 * (SQL 20261012230000 pas collé) → vitrine vide, message explicite.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import type { OfferVehicle } from '../lib/offers/parseSupplierFile';
import type { CountryResult } from '../lib/offers/marketCheck';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
export const INTRA_SQL_HINT = 'Intra : SQL du 12/10 (intra_vitrine) à coller.';
const missing = (m: string) => /does not exist|schema cache|relation/i.test(m);

/** Ce que la vitrine garde d'un véhicule — jamais le prix fournisseur. */
export interface IntraVehicle {
  vin: string | null; brand: string; model: string; version: string; engine: string | null;
  reg_date: string | null; year: number | null; km: number | null; color: string | null; fuel: string | null;
  power_ch: number | null; gearbox: string | null; damages: number | null; report_url: string | null; quantity: number;
  vat_recoverable: boolean | null;
}
export const snapshotVehicle = (v: OfferVehicle): IntraVehicle => ({
  vin: v.vin ?? null, brand: v.brand, model: v.model, version: v.version, engine: v.engine ?? null,
  reg_date: v.reg_date ?? null, year: v.year ?? null, km: v.km ?? null, color: v.color ?? null, fuel: v.fuel ?? null,
  power_ch: v.power_ch ?? null, gearbox: v.gearbox ?? null, damages: v.damages ?? null, report_url: v.report_url ?? null,
  quantity: Math.max(1, v.quantity ?? 1), vat_recoverable: v.vat_recoverable ?? null,
});

export interface IntraItem {
  id: string; offer_id: string | null; offer_title: string; vehicle_id: string; lot_key: string | null;
  vehicle: IntraVehicle; price_ht: number | null;
  /** Relevé du lot à la publication : pays → résultat (sites, prix d'attaque, médiane, concurrentes). */
  market: Record<string, CountryResult> | null;
  note: string; published_by: string | null; published_by_name: string; published_at: string;
}
export type IntraDraft = Omit<IntraItem, 'id' | 'published_by' | 'published_at' | 'published_by_name'>;

/** Visible par TOUS les utilisateurs d'ADA (toutes organisations) ; le nom de l'auteur vit dans la ligne. */
export async function listShowcase(): Promise<{ rows: IntraItem[]; error: string | null }> {
  const { data, error } = await sb.from('intra_showcase').select('*').order('published_at', { ascending: false }).limit(200);
  if (error) return { rows: [], error: missing(error.message) ? INTRA_SQL_HINT : error.message };
  return { rows: ((data ?? []) as IntraItem[]).map((r) => ({ ...r, published_by_name: (r.published_by_name ?? '').trim() || 'équipe MC Export' })), error: null };
}

/** Publie (ou republie : même offre + même véhicule = remplacé) un ou plusieurs véhicules — équipe MC Export avec l'onglet Offres. */
export async function publishToShowcase(items: IntraDraft[]): Promise<string | null> {
  if (items.length === 0) return null;
  const { userId, displayName } = useAuth.getState();
  const { error } = await sb.from('intra_showcase')
    .upsert(items.map((i) => ({ ...i, published_by: userId, published_by_name: (displayName ?? '').trim(), published_at: new Date().toISOString() })), { onConflict: 'offer_id,vehicle_id' });
  if (!error) return null;
  return missing(error.message) ? INTRA_SQL_HINT : /row-level security/i.test(error.message) ? "Publication refusée par la base : réservé à l'équipe MC Export avec l'onglet Offres." : error.message;
}

export async function unpublishFromShowcase(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const { data, error } = await sb.from('intra_showcase').delete().in('id', ids).select('id');
  if (error) return missing(error.message) ? INTRA_SQL_HINT : error.message;
  if (!data || (data as unknown[]).length === 0) return 'Retrait refusé par la base (réservé à l’équipe MC Export avec l’onglet Offres).';
  return null;
}

export async function setShowcaseNote(id: string, note: string): Promise<string | null> {
  const { error } = await sb.from('intra_showcase').update({ note }).eq('id', id);
  return error ? error.message : null;
}

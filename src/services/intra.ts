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
  /** Photos (URL publiques du bucket intra-photos), 13/10 — montrées sur l'Accueil et sur le site mc-export.com. */
  photos?: string[];
  /** Titre libre (13/10) ; null ou vide = marque + modèle. Survit à une republication. */
  title?: string | null;
  /** Rang choisi à la main (29/10) : 1 = en tête ; null = non rangé (après les rangés, plus récentes d'abord). */
  position?: number | null;
}
export type IntraDraft = Omit<IntraItem, 'id' | 'published_by' | 'published_at' | 'published_by_name' | 'photos' | 'title'>;

/** Titre affiché d'une bonne affaire : le titre libre, sinon marque + modèle. */
export const showcaseTitle = (it: Pick<IntraItem, 'title' | 'vehicle'>) => (it.title ?? '').trim() || `${it.vehicle.brand} ${it.vehicle.model}`;

/** Prix MC Export HT publié (13/10, Channing : « modifier le prix si besoin ») — null = sur proposition. */
export async function setShowcasePrice(id: string, price_ht: number | null): Promise<string | null> {
  const { error } = await sb.from('intra_showcase').update({ price_ht }).eq('id', id);
  return error ? error.message : null;
}

/** Caractéristiques d'une bonne affaire corrigées à la main (14/10, Channing : « j'ai fait une erreur, modifier les critères ») — Accueil et site suivent. */
export async function setShowcaseVehicle(id: string, vehicle: IntraVehicle): Promise<string | null> {
  const { error } = await sb.from('intra_showcase').update({ vehicle }).eq('id', id);
  return error ? error.message : null;
}

export async function setShowcaseTitle(id: string, title: string): Promise<string | null> {
  const { error } = await sb.from('intra_showcase').update({ title: title.trim() || null }).eq('id', id);
  return error ? (missing(error.message) ? PHOTOS_SQL_HINT : error.message) : null;
}

/** PHOTOS D'UNE BONNE AFFAIRE (13/10, Channing : « ajouter la possibilité d'ajouter des photos dans l'Intra »).
 *  Bucket public intra-photos, chemin <id>/<horodatage>-<n>.<ext> ; la liste des URL vit dans la ligne.
 *  Fail-open : bucket absent (SQL 20261013200000 pas collé) → message explicite. */
const PHOTOS_BUCKET = 'intra-photos';
export const PHOTOS_SQL_HINT = 'Photos : SQL du 13/10 (bonnes_affaires_site) à coller.';
export async function addShowcasePhotos(item: IntraItem, files: File[]): Promise<{ photos: string[]; error: string | null }> {
  const photos = [...(item.photos ?? [])];
  const errors: string[] = [];
  for (const [i, f] of files.entries()) {
    const ext = (f.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${item.id}/${Date.now().toString(36)}-${i}.${ext}`;
    const up = await supabase.storage.from(PHOTOS_BUCKET).upload(path, f, { contentType: f.type || 'image/jpeg', cacheControl: '31536000' });
    if (up.error) { errors.push(/not found|bucket/i.test(up.error.message) ? PHOTOS_SQL_HINT : `${f.name} : ${up.error.message}`); continue; }
    photos.push(supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl);
  }
  if (photos.length !== (item.photos ?? []).length) {
    const { error } = await sb.from('intra_showcase').update({ photos }).eq('id', item.id);
    if (error) errors.push(missing(error.message) ? PHOTOS_SQL_HINT : error.message);
  }
  return { photos, error: errors.length ? [...new Set(errors)].join(' · ') : null };
}
export async function removeShowcasePhoto(item: IntraItem, url: string): Promise<string | null> {
  const photos = (item.photos ?? []).filter((p) => p !== url);
  const { error } = await sb.from('intra_showcase').update({ photos }).eq('id', item.id);
  if (error) return missing(error.message) ? PHOTOS_SQL_HINT : error.message;
  // Le fichier aussi, sans bloquer si la suppression échoue (l'URL n'est plus référencée).
  const m = url.match(/\/intra-photos\/(.+)$/);
  if (m) await supabase.storage.from(PHOTOS_BUCKET).remove([decodeURIComponent(m[1])]).catch(() => undefined);
  return null;
}

/** Visible par TOUS les utilisateurs d'ADA (toutes organisations) ; le nom de l'auteur vit dans la ligne. */
export async function listShowcase(): Promise<{ rows: IntraItem[]; error: string | null }> {
  // Ordre choisi à la main d'abord (position, SQL du 29/10), puis les plus récentes ; colonne absente → ordre d'avant.
  let { data, error } = await sb.from('intra_showcase').select('*').order('position', { ascending: true, nullsFirst: false }).order('published_at', { ascending: false }).limit(200);
  if (error && /position/.test(error.message)) ({ data, error } = await sb.from('intra_showcase').select('*').order('published_at', { ascending: false }).limit(200));
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

/** AJOUT DIRECT (14/10, Channing : « ajouter un véhicule en bonne affaire sans passer une liste ») :
 *  une ligne sans offre d'origine (offer_id null), saisie à la main ; photos, titre, mot et prix se règlent ensuite comme les autres. */
export async function addManualShowcase(input: { vehicle: IntraVehicle; price_ht: number | null; title: string; note: string }): Promise<{ id: string | null; error: string | null }> {
  const { userId, displayName } = useAuth.getState();
  const row = {
    offer_id: null, offer_title: 'Ajout direct', vehicle_id: `manual-${Date.now().toString(36)}`, lot_key: null,
    vehicle: input.vehicle, price_ht: input.price_ht, market: null, note: input.note.trim(), title: input.title.trim() || null,
    published_by: userId, published_by_name: (displayName ?? '').trim(), published_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from('intra_showcase').insert(row).select('id').maybeSingle();
  if (error) {
    if (/column "title"/i.test(error.message)) {
      // Colonne titre absente (SQL 20261013200000 pas collé) : on publie sans titre libre.
      const { title: _t, ...without } = row; void _t;
      const r2 = await sb.from('intra_showcase').insert(without).select('id').maybeSingle();
      return { id: (r2.data as { id: string } | null)?.id ?? null, error: r2.error ? r2.error.message : null };
    }
    return { id: null, error: missing(error.message) ? INTRA_SQL_HINT : /row-level security/i.test(error.message) ? "Ajout refusé par la base : réservé à l'équipe MC Export avec l'onglet Offres." : error.message };
  }
  return { id: (data as { id: string } | null)?.id ?? null, error: null };
}

/** ORDRE DES BONNES AFFAIRES (29/10, Channing : « modifier l'ordre des véhicules de la liste ») : la liste
 *  entière dans l'ordre voulu → position 1..n ; Accueil et site suivent. */
export async function reorderShowcase(idsInOrder: string[]): Promise<string | null> {
  for (const [i, id] of idsInOrder.entries()) {
    const { error } = await sb.from('intra_showcase').update({ position: i + 1 }).eq('id', id);
    if (error) return /position/.test(error.message) ? 'Ordre des bonnes affaires : SQL du 29/10 (bonnes_affaires_ordre) à coller.' : error.message;
  }
  return null;
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

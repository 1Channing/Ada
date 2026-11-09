/**
 * FYC — FIND YOUR CUSTOMER (10/11, Channing : « un outil d'analyse dans le Market Intelligence : une inspection
 * comparée en quelques clics à tout un marché et à un client cible »).
 *
 * Une ligne par inspection (table fyc_inspections, SQL du 10/11). Le worker télécharge le PDF du rapport
 * (statut queued → fetched, worker/fyc.ts) ; ici le navigateur en extrait les champs (pdfjs + src/lib/fycReport.ts)
 * et les enregistre (statut read). Nos prix (achat, attaque), les filtres MI retenus et le client cible sont
 * gardés sur la ligne : on les retrouve en revenant.
 */
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import { signedUrl } from './storageAccess';
import { pdfToLinesEx } from '../lib/pdfText';
import { parseFycReport, type FycReportFields } from '../lib/fycReport';
import type { MarketFilters } from './marketData';

export type FycStatus = 'queued' | 'fetched' | 'read' | 'failed';
export interface FycInspection extends FycReportFields {
  id: string; source_url: string; status: FycStatus; error: string | null; pdf_path: string | null;
  purchase_price: number | null; attack_price: number | null; notes: string;
  market_filters: MarketFilters; client_contact_id: string | null;
  created_by: string | null; created_by_name: string; created_at: string; updated_at: string;
}

const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);
export const FYC_SQL_HINT = 'FYC : colle le SQL du 10/11 (fyc_inspections).';

function normalize(r: Record<string, unknown>): FycInspection {
  const d = (r.damages ?? {}) as Partial<FycInspection['damages']>;
  return {
    ...(r as unknown as FycInspection),
    damages: { devaluation: Array.isArray(d.devaluation) ? d.devaluation : [], usage: Array.isArray(d.usage) ? d.usage : [] },
    raw_fields: (r.raw_fields ?? {}) as Record<string, string>,
    market_filters: (r.market_filters ?? {}) as MarketFilters,
    notes: typeof r.notes === 'string' ? r.notes : '',
    purchase_price: r.purchase_price == null ? null : Number(r.purchase_price),
    attack_price: r.attack_price == null ? null : Number(r.attack_price),
  };
}

export async function listInspections(): Promise<{ rows: FycInspection[]; error: string | null }> {
  const { data, error } = await untyped.from('fyc_inspections').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return { rows: [], error: missing(error.message) ? FYC_SQL_HINT : error.message };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(normalize), error: null };
}

/** Un lien par ligne ; les liens déjà présents ne sont pas redéposés (rendus dans `existing`). */
export async function addInspections(text: string): Promise<{ added: number; existing: number; error: string | null }> {
  const urls = [...new Set(text.split(/[\s,;]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];
  if (urls.length === 0) return { added: 0, existing: 0, error: 'Aucun lien reconnu (il faut une adresse commençant par http).' };
  const { data: have } = await untyped.from('fyc_inspections').select('source_url').in('source_url', urls);
  const seen = new Set(((have ?? []) as Array<{ source_url: string }>).map((r) => r.source_url));
  const fresh = urls.filter((u) => !seen.has(u));
  if (fresh.length === 0) return { added: 0, existing: urls.length, error: null };
  const { userId, displayName, email } = useAuth.getState();
  const { error } = await untyped.from('fyc_inspections').insert(fresh.map((u) => ({ source_url: u, status: 'queued', created_by: userId, created_by_name: displayName || email || '' })));
  if (error) return { added: 0, existing: urls.length - fresh.length, error: missing(error.message) ? FYC_SQL_HINT : error.message };
  return { added: fresh.length, existing: urls.length - fresh.length, error: null };
}

export async function updateInspection(id: string, patch: Partial<Pick<FycInspection, 'purchase_price' | 'attack_price' | 'notes' | 'market_filters' | 'client_contact_id' | 'brand' | 'model' | 'year' | 'km' | 'fuel' | 'gearbox'>>): Promise<string | null> {
  const { error } = await untyped.from('fyc_inspections').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

export async function deleteInspection(id: string): Promise<string | null> {
  const { error } = await untyped.from('fyc_inspections').delete().eq('id', id);
  return error ? error.message : null;
}

/** Relance le téléchargement d'un rapport en échec. */
export async function retryInspection(id: string): Promise<string | null> {
  const { error } = await untyped.from('fyc_inspections').update({ status: 'queued', error: null, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

/** Le PDF est dans le storage (worker) : le navigateur en lit les champs et les enregistre. */
export async function readInspection(row: FycInspection): Promise<string | null> {
  if (!row.pdf_path) return 'PDF absent';
  try {
    const res = await fetch(await signedUrl(row.pdf_path));
    if (!res.ok) throw new Error(`PDF illisible (HTTP ${res.status})`);
    const blob = await res.blob();
    const { lines } = await pdfToLinesEx(blob);
    const fields = parseFycReport(lines.map((l) => l.text));
    if (!fields.brand && !fields.vin) throw new Error('rapport lu mais sans marque ni VIN : format inconnu');
    const { error } = await untyped.from('fyc_inspections').update({ ...fields, status: 'read', error: null, updated_at: new Date().toISOString() }).eq('id', row.id);
    return error ? error.message : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await untyped.from('fyc_inspections').update({ status: 'failed', error: msg.slice(0, 800), updated_at: new Date().toISOString() }).eq('id', row.id);
    return msg;
  }
}

/** Filtres MI proposés depuis le rapport : marque, modèle, énergie, boîte, année ± 1, km jusqu'à 1,5 ×. */
export function filtersFromInspection(r: FycInspection, country?: string): MarketFilters {
  const fuel = fuelTokenOf(r.fuel);
  const gb = /auto|dsg|dct|cvt/i.test(r.gearbox ?? '') ? 'automatique' : /manu|schalt|handgesch/i.test(r.gearbox ?? '') ? 'manuelle' : undefined;
  return {
    country: country || undefined,
    brand: r.brand ? r.brand.toUpperCase() : undefined,
    model: r.model ? r.model.toUpperCase() : undefined,
    fuel: fuel || undefined,
    gearbox: gb,
    yearMin: r.year != null ? r.year - 1 : null,
    yearMax: r.year != null ? r.year + 1 : null,
    mileageMax: r.km != null ? Math.round((r.km * 1.5) / 1000) * 1000 : null,
  };
}

export function fuelTokenOf(raw: string | null | undefined): MarketFilters['fuel'] {
  const s = (raw ?? '').toLowerCase();
  if (!s) return '';
  if (/plug|recharge|phev/.test(s)) return 'phev';
  if (/hybr/.test(s)) return 'hybrid';
  if (/elec|élec|strom/.test(s)) return 'electric';
  if (/diesel|gasoil|gazole/.test(s)) return 'diesel';
  if (/petrol|essence|benzin|gasolin/.test(s)) return 'petrol';
  if (/gpl|lpg/.test(s)) return 'lpg';
  if (/cng|gnv/.test(s)) return 'cng';
  return '';
}

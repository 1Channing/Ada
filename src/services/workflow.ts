import { supabase } from '../lib/supabase';
import { useAuth } from './auth';
import { getRefWindowsCached } from './vehicleRef';
import { brandKey, canonKey } from './marketData';
import { generateSearchUrlsWithMemory } from '../lib/linkgen/generator';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import type { SiteKey } from '../lib/linkgen/types';

/**
 * Workflow personnel : études quotidiennes + nouvelles annonces + négociations.
 * Tout est filtré par le compte connecté (RLS côté base en double sécurité).
 */

export interface DailySearch {
  id: string;
  label: string;
  source_country: string;
  target_country: string;
  brand: string;
  model: string;
  year_min: number | null;
  year_max: number | null;
  fuel: string;
  trim: string;
  /** Finition ÉQUIVALENTE côté pays cible (les noms diffèrent par pays). */
  trim_target: string;
  mileage_max: number | null;
  price_gap_min: number;
  price_gap_max: number;
  run_hour: number;
  active: boolean;
  last_run_at: string | null;
}

// ── Sélecteurs sans faute de frappe ─────────────────────────────────────────

/** Marques + modèles du RÉFÉRENTIEL (libellés canoniques) pour les selects. */
export async function listRefBrandModels(): Promise<{ brands: string[]; modelsByBrand: Record<string, string[]> }> {
  const windows = await getRefWindowsCached();
  const modelsByBrand: Record<string, Set<string>> = {};
  for (const w of windows.values()) {
    const b = w.brandLabel.trim().toUpperCase();
    const m = w.modelLabel.trim().toUpperCase();
    if (!b || !m || !/[A-Z]/.test(b)) continue;
    (modelsByBrand[b] ??= new Set()).add(m);
  }
  const brands = Object.keys(modelsByBrand).sort((a, b) => a.localeCompare(b));
  return {
    brands,
    modelsByBrand: Object.fromEntries(brands.map((b) => [b, [...modelsByBrand[b]].sort((a, c) => a.localeCompare(c))])),
  };
}

/**
 * Finitions déjà VUES pour ce marque/modèle dans un pays (observations MI +
 * mémoire de mapping) — suggestions de saisie, le texte libre reste permis
 * (une finition est par nature du texte de site).
 */
export async function listKnownTrims(brand: string, model: string, country?: string): Promise<string[]> {
  const bk = brandKey(brand);
  const mk = canonKey(model);
  let q = supabase
    .from('market_listing_observations')
    .select('trim, brand, model')
    .neq('trim', '')
    .limit(4000);
  if (country) q = q.eq('country', country);
  const [{ data: obs }, { data: mem }] = await Promise.all([
    q,
    supabase.from('linkgen_mapping_memory').select('trim, brand, model').neq('trim', '').limit(2000),
  ]);
  const seen = new Map<string, string>(); // clé canonique → première graphie vue
  const take = (rows: Array<{ trim: string | null; brand: string | null; model: string | null }> | null) => {
    for (const r of rows ?? []) {
      const t = (r.trim ?? '').trim();
      if (!t || t.length < 2) continue;
      if (brandKey(r.brand ?? '') !== bk) continue;
      if (mk && canonKey(r.model ?? '') !== mk) continue;
      const key = canonKey(t);
      if (key && !seen.has(key)) seen.set(key, t);
    }
  };
  take(obs as never);
  take(mem as never);
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, 60);
}

export interface DailyHit {
  id: string;
  search_id: string;
  listing_url: string;
  title: string;
  price: number | null;
  previous_price: number | null;
  year: number | null;
  mileage: number | null;
  fuel: string;
  site: string;
  source_country: string;
  target_median: number | null;
  price_gap: number | null;
  kind: string;      // 'new' | 'price_drop' ('seed' jamais montré)
  status: string;    // 'inbox' | 'saved' | 'dismissed'
  first_seen_at: string;
  last_seen_at: string;
}

export interface Negotiation {
  id: string;
  title: string;
  listing_url: string;
  asking_price: number | null;
  negotiated_price: number | null;
  notes: string;
  status: string;    // 'open' | 'pushed_to_sale' | 'closed'
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

function uid(): string {
  const id = useAuth.getState().userId;
  if (!id) throw new Error('Session absente');
  return id;
}

// ── Couverture URL des deux pays ────────────────────────────────────────────

export interface UrlGap {
  site: string;
  country: string;
  side: 'source' | 'cible';
}

export interface StudyUrl extends UrlGap {
  url: string | null;
}

/**
 * Les URLs exactes de l'étude, site par site et des DEUX côtés (source =
 * la recherche quotidienne, cible = les données de comparaison) — celles que
 * le worker utilisera. Affichées dans les Résultats pour vérification
 * humaine ; url null = trou de mapping.
 */
export async function listStudyUrls(s: Pick<DailySearch,
  'source_country' | 'target_country' | 'brand' | 'model' | 'fuel' | 'trim' | 'trim_target' | 'year_min' | 'year_max'
> & Partial<Pick<DailySearch, 'mileage_max'>>): Promise<StudyUrl[]> {
  const out: StudyUrl[] = [];
  const sides: Array<{ country: string; side: UrlGap['side']; trim: string }> = [
    { country: s.source_country, side: 'source', trim: s.trim },
    { country: s.target_country, side: 'cible', trim: s.trim_target },
  ];
  for (const { country, side, trim } of sides) {
    const sites = allSiteAdapters().filter((a) => (a as { countryCode?: string }).countryCode === country);
    for (const site of sites) {
      let url: string | null = null;
      try {
        const gen = await generateSearchUrlsWithMemory({
          selectedSites: [site.key as SiteKey],
          brand: s.brand, model: s.model || '',
          fuel: s.fuel || undefined, trim: trim || undefined,
          yearFrom: s.year_min ? String(s.year_min) : undefined,
          yearTo: s.year_max ? String(s.year_max) : undefined,
          mileage: s.mileage_max ?? undefined,
        });
        url = gen[0]?.url && gen[0].url.length > 10 ? gen[0].url : null;
      } catch { url = null; }
      out.push({ site: site.key, country, side, url });
    }
  }
  return out;
}

/** Trous de couverture (panneau ⚠ des cartes d'étude) — dérivé de listStudyUrls. */
export async function checkSearchUrlCoverage(s: Parameters<typeof listStudyUrls>[0]): Promise<UrlGap[]> {
  return (await listStudyUrls(s)).filter((u) => !u.url).map(({ site, country, side }) => ({ site, country, side }));
}

// ── Études quotidiennes ─────────────────────────────────────────────────────

export async function listDailySearches(): Promise<DailySearch[]> {
  const { data, error } = await supabase
    .from('daily_searches')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DailySearch[];
}

export async function saveDailySearch(s: Partial<DailySearch> & { source_country: string; target_country: string; brand: string }): Promise<string | null> {
  const row = { ...s, user_id: uid(), updated_at: new Date().toISOString() };
  const { error } = s.id
    ? await supabase.from('daily_searches').update(row).eq('id', s.id)
    : await supabase.from('daily_searches').insert(row);
  return error ? error.message : null;
}

export async function deleteDailySearch(id: string): Promise<void> {
  await supabase.from('daily_searches').delete().eq('id', id);
}

// ── Nouvelles annonces (hits) ───────────────────────────────────────────────

/** Boîte de réception : nouveautés + baisses, jamais les seeds ni le trié. */
export async function listInboxHits(limit = 100): Promise<DailyHit[]> {
  const { data, error } = await supabase
    .from('daily_search_hits')
    .select('*')
    .eq('status', 'inbox')
    .neq('kind', 'seed')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DailyHit[];
}

/** Historique complet des trouvailles (page Résultats), seeds exclus. */
export async function listAllHits(limit = 400): Promise<DailyHit[]> {
  const { data, error } = await supabase
    .from('daily_search_hits')
    .select('*')
    .neq('kind', 'seed')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DailyHit[];
}

export async function dismissHit(id: string): Promise<void> {
  await supabase.from('daily_search_hits').update({ status: 'dismissed' }).eq('id', id);
}

/** Enregistrer : crée la négociation et marque le hit 'saved'. */
export async function saveHitToNegotiations(hit: DailyHit): Promise<string | null> {
  const { error } = await supabase.from('negotiations').insert({
    user_id: uid(),
    title: hit.title || hit.listing_url,
    listing_url: hit.listing_url,
    asking_price: hit.price,
  });
  if (error) return error.message;
  await supabase.from('daily_search_hits').update({ status: 'saved' }).eq('id', hit.id);
  return null;
}

// ── Négociations ────────────────────────────────────────────────────────────

export async function listNegotiations(): Promise<Negotiation[]> {
  const { data, error } = await supabase
    .from('negotiations')
    .select('*')
    .neq('status', 'closed')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Negotiation[];
}

export async function createNegotiation(title: string, listingUrl: string, askingPrice: number | null): Promise<string | null> {
  const { error } = await supabase.from('negotiations').insert({
    user_id: uid(), title, listing_url: listingUrl, asking_price: askingPrice,
  });
  return error ? error.message : null;
}

export async function updateNegotiation(id: string, patch: Partial<Negotiation>): Promise<void> {
  await supabase.from('negotiations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function deleteNegotiation(id: string): Promise<void> {
  await supabase.from('negotiations').delete().eq('id', id);
}

/** Pipeline : la négo devient une vente (transaction admin pré-remplie). */
export async function pushNegotiationToSale(n: Negotiation): Promise<{ transactionId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('transactions_admin')
    .insert({
      transaction_type: 'purchase',
      status: 'en_cours',
      notes: [n.title, n.listing_url, n.notes].filter(Boolean).join('\n'),
      purchase_price: n.negotiated_price ?? n.asking_price,
      owner_user_id: uid(),
    })
    .select('id')
    .single();
  if (error) return { transactionId: null, error: error.message };
  await updateNegotiation(n.id, { status: 'pushed_to_sale', transaction_id: data.id } as Partial<Negotiation>);
  return { transactionId: data.id, error: null };
}

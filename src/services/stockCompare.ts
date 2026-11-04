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
import { TRIM_WORDS, guessModel } from '../lib/offers/parseSupplierFile';

/** MODÈLE NORMALISÉ (02/11, constat Channing : Kamux écrit « EQC 400 » comme modèle → Leboncoin et La Centrale
 *  ne savent pas poser ce modèle, 0 annonce, alors qu'« EQC » en donne 7). Rapproché des modèles connus de la
 *  marque (référentiel + livres des sites, clés par marque canonique) : le plus long modèle connu qui commence
 *  le libellé gagne ; sans liste connue, le libellé est gardé tel quel. */
export type KnownModels = Record<string, string[]>;
export function normalizeModel(brand: string | null | undefined, model: string | null | undefined, known: KnownModels | null | undefined): string {
  const m = (model ?? '').trim();
  if (!brand || !m || !known) return m;
  const bk = brandKey(brand);
  const list = known[brand.toUpperCase()] ?? Object.entries(known).find(([k]) => brandKey(k) === bk)?.[1];
  if (!list || list.length === 0) return m;
  const g = guessModel(brand, m, list);
  return list.map((x) => x.toUpperCase()).includes(g) ? g : m;
}
import { powerFromText, samePower } from '../lib/powerText';
import { resolveSettings, supplierHtWith } from '../lib/offers/offerSettings';

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
  /** NOTRE prix mis en TTC du pays du contact (02/11, Channing : « à gauche des TTC finlandais à 25,5 %, à droite
   *  notre HT : normaliser notre prix en TTC selon le pays ») = prix HT × (1 + TVA du pays). */
  ourTtc: number;
  /** Leur prix TTC (€) − notre prix TTC du pays. */
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
  /** Les nôtres SANS année ou km (ventes sans dossier véhicule, 04/11) : comptées, jamais appariées. */
  oursUndated: number;
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
export async function loadOurSales(known: KnownModels | null = null): Promise<{ rows: OurVehicle[]; error: string | null }> {
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
      if (!Number.isFinite(sale) || sale <= 0) continue;
      const status = String(r.status ?? '');
      // Énergie et finition : la fiche véhicule n'a pas de colonne énergie — lues dans le libellé du dossier
      // (« Véhicule : RAV4 PLUG IN », « YARIS CROSS GR 130H ») et le nom commercial.
      const sheetLabel = String(r.notes ?? '').match(/Véhicule : (.*)/)?.[1]?.trim() ?? '';
      if (!v || !v.brand || !v.model) {
        // VENTE SANS DOSSIER VÉHICULE (04/11, constat Zeeuw & Zeeuw : 216 ventes sur 305 n'ont pas de dossier, donc
        // Comparer ne les voyait pas). Marque et modèle lus dans le libellé du tableur, km dans la ligne
        // « [Négociation] TOYOTA COROLLA … 44 200 km » quand elle existe ; l'année reste inconnue : la vente
        // compte dans « modèles en commun », jamais dans un appariement strict.
        const nego = String(r.notes ?? '').match(/\[Négociation\] (.*)/)?.[1]?.trim() ?? '';
        const bm = brandModelFromLabel(sheetLabel, known) ?? brandModelFromLabel(nego, known);
        if (!bm) continue;
        const km = nego.match(/(\d{1,3}(?:[\s  ]\d{3})+|\d{4,6})\s*km/i)?.[1]?.replace(/[\s  ]/g, '');
        out.push({
          kind: 'sale', id: String(r.id), label: `${bm.brand} ${sheetLabel || nego}`.replace(/\s+/g, ' ').trim(),
          brand: bm.brand, model: bm.model, year: null, km: km ? Number(km) : null,
          fuel: fuelFamily(`${sheetLabel} ${nego}`), trim: trimOf(sheetLabel || nego), power: powerFromText(`${sheetLabel} ${nego}`),
          price: sale, purchase: typeof r.purchase_price === 'number' ? r.purchase_price : null,
          detail: [r.reference ? `réf. ${r.reference}` : '', status === 'cloturee' ? 'clôturée' : status === 'en_cours' ? 'en cours' : status, 'sans dossier véhicule : année inconnue'].filter(Boolean).join(' · '),
          date: (r.transaction_date as string | null) ?? null, plate: null,
        });
        continue;
      }
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
    // PRIX EN EUROS HT PAR LA RÈGLE DE L'OFFRE (02/11, constat Channing : « des véhicules à plus de 100 000 €
    // alors que ce ne sont pas du tout ces prix dans mes offres » — liste suédoise « Mixed Brands » en
    // couronnes : le prix brut du fichier était pris pour des euros). Même calcul que l'onglet Offres :
    // devise du fichier (taux figé à l'import), base HT/TTC, TVA fournisseur.
    const st = resolveSettings(o.settings);
    for (const v of o.vehicles ?? []) {
      const buy = supplierHtWith(v, st);
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

export function compareStock(theirs: StockVehicle[], ours: OurVehicle[], threshold: number, vat = 0.2, known: KnownModels | null = null): CompareResult {
  const matches: CompareMatch[] = [];
  const warnings: string[] = [];
  let priced = 0;
  let unknownCurrency = 0;
  let pairs = 0;
  const okIds = new Set<string>();
  // INDEX DE NOS VÉHICULES par (marque, modèle normalisé, année) — 03/11, constat Channing : « la page Comparer
  // gèle » : la normalisation du modèle tournait DANS la boucle des paires (4 706 × 1 988 ≈ 9 millions de
  // rapprochements sur les listes de modèles). Chaque véhicule est normalisé UNE fois, et chaque voiture du
  // contact ne rencontre que nos véhicules de son segment.
  const normCache = new Map<string, string>();
  const norm = (brand: string | null, model: string | null): string => {
    const k = `${brand ?? ''}|${model ?? ''}`;
    let v = normCache.get(k);
    if (v == null) { v = normalizeModel(brand, model, known); normCache.set(k, v); }
    return v;
  };
  const segKey = (brand: string | null, model: string, year: number | null) => `${brandKey(brand ?? '')}|${refModelKey(brand ?? '', model)}|${year ?? '?'}`;
  const index = new Map<string, Array<{ o: OurVehicle; model: string }>>();
  for (const o of ours) {
    if (o.year == null) continue;
    const model = norm(o.brand, o.model);
    const k = segKey(o.brand, model, o.year);
    (index.get(k) ?? index.set(k, []).get(k)!).push({ o, model });
  }
  for (const t of theirs) {
    if (t.price == null || t.price <= 0) continue;
    const eur = toEur(t.price, t.currency ?? 'EUR');
    if (eur == null) { unknownCurrency++; continue; }
    priced++;
    if (!t.brand || !t.model || t.year == null) continue;
    const tModel = norm(t.brand, t.model);
    const candidates = index.get(segKey(t.brand, tModel, t.year));
    if (!candidates || candidates.length === 0) continue;
    const tf = theirsFuelTrim(t);
    const mine: CompareMatch[] = [];
    for (const { o, model } of candidates) {
      const seg = sameSegment({ ...t, ...tf, model: tModel }, { ...o, model });
      if (!seg) continue;
      const ourTtc = Math.round(o.price * (1 + vat));
      const gap = Math.round(eur - ourTtc);
      const ok = gap >= threshold;
      if (ok) okIds.add(t.id);
      mine.push({ theirs: t, theirsEur: Math.round(eur), ours: o, ourTtc, gap, ok, fuelCompared: seg.fuelCompared, trimCompared: seg.trimCompared, powerCompared: seg.powerCompared, theirsFuel: tf.fuel, theirsTrim: tf.trim, theirsPower: tf.power, others: [] });
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
  return { theirsTotal: theirs.length, theirsPriced: priced, oursTotal: ours.length, oursUndated: ours.filter((o) => o.year == null || o.km == null).length, matches, pairs, theirsOk: okIds.size, warnings };
}

/** MODÈLES EN COMMUN (04/11, Channing : « ils ont plein de Toyota et une Suzuki Ignis, on aurait pu leur proposer ce
 *  genre de modèles ») : par marque + modèle normalisé, ce qu'ils ont en stock face à ce que nous avons vendu (y
 *  compris les ventes sans dossier véhicule) et ce que nos offres fournisseurs contiennent — sans condition
 *  d'année ni de km. Ne garde que les modèles présents des deux côtés. */
export interface CommonModelRow {
  brand: string; model: string;
  theirs: number; theirsMinEur: number | null;
  sales: number; salesDated: number;
  offers: number; offersMinHt: number | null;
}
export function commonModels(theirs: StockVehicle[], sales: OurVehicle[], offers: OurVehicle[], known: KnownModels | null): CommonModelRow[] {
  const rows = new Map<string, CommonModelRow>();
  const keyOf = (brand: string, model: string) => `${brandKey(brand)}|${refModelKey(brand, normalizeModel(brand, model, known))}`;
  const row = (brand: string, model: string) => {
    const k = keyOf(brand, model);
    let r = rows.get(k);
    if (!r) { r = { brand: brand.toUpperCase(), model: normalizeModel(brand, model, known).toUpperCase(), theirs: 0, theirsMinEur: null, sales: 0, salesDated: 0, offers: 0, offersMinHt: null }; rows.set(k, r); }
    return r;
  };
  for (const t of theirs) {
    if (!t.brand || !t.model) continue;
    const r = row(t.brand, t.model);
    r.theirs++;
    const eur = t.price != null && t.price > 0 ? toEur(t.price, t.currency ?? 'EUR') : null;
    if (eur != null) r.theirsMinEur = r.theirsMinEur == null ? Math.round(eur) : Math.min(r.theirsMinEur, Math.round(eur));
  }
  for (const o of sales) { const r = row(o.brand, o.model); r.sales++; if (o.year != null && o.km != null) r.salesDated++; }
  for (const o of offers) { const r = row(o.brand, o.model); r.offers++; r.offersMinHt = r.offersMinHt == null ? Math.round(o.price) : Math.min(r.offersMinHt, Math.round(o.price)); }
  return [...rows.values()].filter((r) => r.theirs > 0 && (r.sales > 0 || r.offers > 0)).sort((a, b) => b.theirs - a.theirs || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

/** Marque et modèle d'un libellé de vente SANS dossier véhicule (« SUZUK IGNIS », « YARIS CROSS TRAIL »,
 *  « COROLLA TS GR SPORT 44* ») : la marque en tête si elle est connue (même tronquée : SUZUK → SUZUKI), sinon
 *  la marque dont un modèle connu commence le libellé (YARIS CROSS → TOYOTA). Null si rien n'est reconnu. */
export function brandModelFromLabel(label: string, known: KnownModels | null): { brand: string; model: string } | null {
  const up = label.toUpperCase().replace(/[*]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!up || !known) return null;
  const first = up.split(' ')[0];
  const brands = Object.keys(known);
  let brand = brands.find((b) => brandKey(b) === brandKey(first)) ?? (first.length >= 4 ? brands.find((b) => b.toUpperCase().startsWith(first)) : undefined);
  let rest = up;
  if (brand) rest = up.slice(first.length).trim();
  else {
    let best: { brand: string; model: string } | null = null;
    for (const [b, models] of Object.entries(known)) for (const m of models) {
      const mu = m.toUpperCase();
      if ((up === mu || up.startsWith(`${mu} `)) && (!best || mu.length > best.model.length)) best = { brand: b, model: mu };
    }
    if (!best) return null;
    brand = best.brand;
  }
  const model = normalizeModel(brand, rest || up, known);
  return model ? { brand, model } : null;
}

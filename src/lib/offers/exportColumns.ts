/**
 * OFFRES FOURNISSEUR — COLONNES DE L'OFFRE EXPORTÉE (11/10, demande Channing :
 * « pouvoir ajouter, modifier ou supprimer des colonnes présentes sur l'offre »).
 *
 * Une offre peut porter sa propre liste de colonnes (supplier_offers.export_columns) :
 * ordre, libellé, colonnes retirées, colonnes LIBRES remplies à la main
 * (valeur par véhicule dans vehicle.custom[id]). Le même réglage pilote
 * l'Excel et le PDF. Sans réglage, les deux exports gardent leur forme
 * historique (exportOfferXlsx / exportOfferPdf).
 *
 * Règle conservée (décision 22/09, « trop de vide ») : une colonne du
 * fichier vide pour TOUS les véhicules n'est pas exportée — sauf Véhicule,
 * Prix de vente et les colonnes libres, ajoutées exprès.
 */
import { supplierHt, type OfferVehicle } from './parseSupplierFile';
import type { ExportLang, PriceBasis } from './offerSettings';

/** Contexte d'export : langue, base des prix (notre prix est stocké HT), prix fournisseur selon les paramètres. */
export interface ExportContext {
  lang: ExportLang;
  basis: PriceBasis;
  saleVat: number;
  supplierHt?: (v: OfferVehicle) => number | null;
  /** Dommages en euros (fichier en couronnes, 13/10) ; absent = valeur du fichier. */
  damagesEur?: (v: OfferVehicle) => number | null;
}
export const DEFAULT_EXPORT_CONTEXT: ExportContext = { lang: 'fr', basis: 'ht', saleVat: 0.2 };

export type BuiltinColumnKey =
  | 'vin' | 'vehicle' | 'qty' | 'engine' | 'version' | 'body' | 'reg' | 'km' | 'color' | 'fuel'
  | 'power' | 'gearbox' | 'co2' | 'damages' | 'price' | 'supplier_price' | 'location' | 'report';

export interface ExportColumn {
  /** Clé de la colonne : la clé intégrée, ou `c_<id>` pour une colonne libre. */
  id: string;
  label: string;
  /** Absent = colonne libre (valeur saisie par véhicule). */
  builtin?: BuiltinColumnKey;
}

type Cell = string | number | null;

const BREAK_RE = /\b(avant|variant|touring|sports? ?tourer|break|estate|station ?wagon|shooting ?brake|sportbrake|kombi|combi|sw|st|rs\d? ?avant|allroad)\b/i;
const VAN_RE = /\b(fgn|fourgon|van|cargo|utilitaire|kasten(wagen)?|furgone|bestel(wagen)?|l[1-4]h[1-3]|transit(?! connect| courier)|trafic|vivaro|sprinter|crafter|ducato|boxer|jumper|master|movano|daily|tge|expert|jumpy|proace(?! city verso)|vito|nv[1-4]00|primastar|interstar)\b/i;
/** Carrosserie déduite de la ligne libre (mots entiers : « Avant » n'est pas un « van »). */
export const bodyOf = (v: OfferVehicle, lang: ExportLang = 'fr') => BREAK_RE.test(v.version) ? (lang === 'en' ? 'Estate' : 'Break') : VAN_RE.test(`${v.model} ${v.version}`) ? (lang === 'en' ? 'Van' : 'Utilitaire') : '';
export const labelOf = (v: OfferVehicle) => `${v.brand[0] ?? ''}${v.brand.slice(1).toLowerCase()} ${v.model}`.trim();
/** Motorisation telle que le fournisseur l'écrit (colonne Engine), sinon la ligne version d'origine. */
export const engineOf = (v: OfferVehicle) => (v.engine ?? '').trim() || (v.version ?? '').trim() || '—';
const FUEL_LABEL: Record<string, string> = {
  ESSENCE: 'Essence', DIESEL: 'Diesel', ELECTRIQUE: 'Électrique', HYBRIDE: 'Hybride', PLUG_IN_HYBRID: 'Hybride rechargeable',
  'HYBRIDE RECHARGEABLE': 'Hybride rechargeable', MILD_HYBRID: 'Micro-hybride', GPL: 'GPL', CNG: 'GNV',
};
const FUEL_LABEL_EN: Record<string, string> = {
  ESSENCE: 'Petrol', DIESEL: 'Diesel', ELECTRIQUE: 'Electric', HYBRIDE: 'Hybrid', PLUG_IN_HYBRID: 'Plug-in hybrid',
  'HYBRIDE RECHARGEABLE': 'Plug-in hybrid', MILD_HYBRID: 'Mild hybrid', GPL: 'LPG', CNG: 'CNG',
};
export const fuelLabel = (fuel: string | null | undefined, lang: ExportLang = 'fr') =>
  (fuel ? (lang === 'en' ? FUEL_LABEL_EN : FUEL_LABEL)[fuel.trim().toUpperCase()] ?? fuel : '—');
export const gearboxLabel = (g: string | null | undefined, lang: ExportLang = 'fr') =>
  (g === 'AUTOMATIQUE' ? (lang === 'en' ? 'Automatic' : 'Auto') : g === 'MANUELLE' ? (lang === 'en' ? 'Manual' : 'Manuelle') : g ?? '');

const LABEL_EN: Record<BuiltinColumnKey, string> = {
  vin: 'Chassis (VIN)', vehicle: 'Vehicle', qty: 'Units', engine: 'Engine', version: 'Version', body: 'Body', reg: 'First registration',
  km: 'Mileage (km)', color: 'Colour', fuel: 'Fuel', power: 'Power (hp)', gearbox: 'Gearbox', co2: 'CO₂ (g/km)', damages: 'Estimated damages (€)',
  price: 'Sale price excl. VAT (€)', supplier_price: 'Supplier price excl. VAT (€)', location: 'Storage location', report: 'Report',
};
/** Libellé par défaut d'une colonne intégrée, dans la langue et la base de prix de l'export. */
export function builtinLabel(k: BuiltinColumnKey, ctx: Pick<ExportContext, 'lang' | 'basis'>): string {
  if (k === 'price' && ctx.basis === 'ttc') return ctx.lang === 'en' ? 'Sale price incl. VAT (€)' : 'Prix de vente TTC (€)';
  return ctx.lang === 'en' ? LABEL_EN[k] : BUILTIN_COLUMNS[k].label;
}
/** Libellé exporté : celui saisi sur l'offre, ou le libellé par défaut traduit si la colonne n'a pas été renommée. */
export function displayLabel(c: ExportColumn, ctx: Pick<ExportContext, 'lang' | 'basis'>): string {
  return c.builtin && c.label === BUILTIN_COLUMNS[c.builtin].label ? builtinLabel(c.builtin, ctx) : c.label;
}

/** Colonnes intégrées : libellé par défaut, largeurs Excel (caractères) et PDF (mm, avant mise à l'échelle). */
export const BUILTIN_COLUMNS: Record<BuiltinColumnKey, { label: string; xlsxW: number; pdfW: number; numeric?: boolean; wrap?: boolean; always?: boolean }> = {
  vin: { label: 'Châssis (VIN)', xlsxW: 18, pdfW: 40 },
  vehicle: { label: 'Véhicule', xlsxW: 22, pdfW: 40, wrap: true, always: true },
  qty: { label: 'Unités', xlsxW: 8, pdfW: 14, numeric: true },
  engine: { label: 'Motorisation', xlsxW: 30, pdfW: 46, wrap: true },
  version: { label: 'Version', xlsxW: 40, pdfW: 46, wrap: true },
  body: { label: 'Carrosserie', xlsxW: 12, pdfW: 20 },
  reg: { label: '1re immatriculation', xlsxW: 16, pdfW: 22 },
  km: { label: 'Kilométrage', xlsxW: 12, pdfW: 22, numeric: true },
  color: { label: 'Couleur', xlsxW: 12, pdfW: 22, wrap: true },
  fuel: { label: 'Énergie', xlsxW: 20, pdfW: 24, wrap: true },
  power: { label: 'Puissance (ch)', xlsxW: 12, pdfW: 14, numeric: true },
  gearbox: { label: 'Boîte', xlsxW: 12, pdfW: 20 },
  co2: { label: 'CO₂ (g/km)', xlsxW: 10, pdfW: 14, numeric: true },
  damages: { label: 'Dommages chiffrés (€)', xlsxW: 16, pdfW: 26, numeric: true },
  price: { label: 'Prix de vente HT (€)', xlsxW: 18, pdfW: 30, numeric: true, always: true },
  supplier_price: { label: 'Prix fournisseur HT (€)', xlsxW: 18, pdfW: 30, numeric: true },
  location: { label: 'Lieu de stockage', xlsxW: 20, pdfW: 30, wrap: true },
  report: { label: 'Rapport', xlsxW: 40, pdfW: 28 },
};

/** Ordre de l'Excel historique ; prix fournisseur et lieu de stockage restent proposés à l'ajout. */
const DEFAULT_ORDER: BuiltinColumnKey[] = ['vin', 'vehicle', 'qty', 'engine', 'version', 'body', 'reg', 'km', 'color', 'fuel', 'power', 'gearbox', 'co2', 'damages', 'price', 'report'];
export const ALL_BUILTIN_KEYS = Object.keys(BUILTIN_COLUMNS) as BuiltinColumnKey[];

export function defaultExportColumns(): ExportColumn[] {
  return DEFAULT_ORDER.map((k) => ({ id: k, builtin: k, label: BUILTIN_COLUMNS[k].label }));
}

export function newCustomColumn(label: string): ExportColumn {
  return { id: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label: label.trim() || 'Nouvelle colonne' };
}

/** Valeur brute d'une cellule (Excel, aperçu) : nombre quand c'en est un, '' / null quand vide. */
export function cellValue(col: ExportColumn, v: OfferVehicle, ctx: ExportContext = DEFAULT_EXPORT_CONTEXT): Cell {
  if (!col.builtin) return v.custom?.[col.id] ?? '';
  switch (col.builtin) {
    case 'vin': return v.vin ?? '';
    case 'vehicle': return labelOf(v);
    case 'qty': return (v.quantity ?? 1) > 1 ? v.quantity! : null;
    case 'engine': return (v.engine ?? '').trim() || (v.version ?? '').trim() ? engineOf(v) : '';
    case 'version': return v.version ?? '';
    case 'body': return bodyOf(v, ctx.lang);
    case 'reg': return v.reg_date ?? '';
    case 'km': return v.km ?? null;
    case 'color': return v.color ?? '';
    case 'fuel': return v.fuel ? fuelLabel(v.fuel, ctx.lang) : '';
    case 'power': return v.power_ch ?? null;
    case 'gearbox': return gearboxLabel(v.gearbox, ctx.lang);
    case 'co2': return v.co2 ?? null;
    case 'damages': return ctx.damagesEur ? ctx.damagesEur(v) : v.damages ?? null;
    case 'price': return v.sale_price == null ? null : ctx.basis === 'ttc' ? Math.round(v.sale_price * (1 + ctx.saleVat)) : v.sale_price;
    case 'supplier_price': return (ctx.supplierHt ?? supplierHt)(v);
    case 'location': return v.location ?? '';
    case 'report': return v.report_url ?? '';
  }
}

const isEmpty = (x: Cell) => x === '' || x == null;

/**
 * Colonnes réellement exportées : l'ordre et les libellés de l'offre, sans
 * les prix pour une offre sans prix, sans les colonnes du fichier vides pour
 * tous les véhicules (Véhicule, Prix de vente et colonnes libres restent).
 */
export function effectiveColumns(cols: ExportColumn[], vehicles: OfferVehicle[], showPrices: boolean, ctx: ExportContext = DEFAULT_EXPORT_CONTEXT): ExportColumn[] {
  return cols.filter((c) => {
    if (!showPrices && (c.builtin === 'price' || c.builtin === 'supplier_price')) return false;
    if (!c.builtin || BUILTIN_COLUMNS[c.builtin].always) return true;
    return vehicles.some((v) => !isEmpty(cellValue(c, v, ctx)));
  });
}

/** Colonne du fichier vide pour tous les véhicules (affichée « non exportée » dans le réglage). */
export function isColumnEmpty(col: ExportColumn, vehicles: OfferVehicle[]): boolean {
  if (!col.builtin || BUILTIN_COLUMNS[col.builtin].always) return false;
  return !vehicles.some((v) => !isEmpty(cellValue(col, v)));
}

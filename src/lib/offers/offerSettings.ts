/**
 * OFFRES FOURNISSEUR — PARAMÈTRES D'UNE OFFRE (11/10, constat Channing : « les
 * prix de l'offre initiale sont en TTC et ADA affiche "notre HT" »).
 *
 * - Prix du FICHIER : lus tels que le parseur les a reconnus (auto), ou forcés
 *   TTC / HT ; TVA du fournisseur (19 % Allemagne, 20 % France, 21 % Pays-Bas
 *   et Belgique, 22 % Italie, 25 % Danemark et Suède…).
 * - Affichage de NOS prix : HT ou TTC avec notre TVA. Le prix MC Export reste
 *   stocké en HT (la règle « fournisseur HT + marge » aussi) ; l'écran,
 *   l'analyse (verdict comparé dans cette base) et l'export suivent ce choix.
 * - Langue de l'export (français / anglais) et pied de page de l'offre.
 */
import type { OfferVehicle } from './parseSupplierFile';

export type PriceBasis = 'ht' | 'ttc';
export type ExportLang = 'fr' | 'en';

export interface OfferSettings {
  supplierBasis?: 'auto' | PriceBasis;
  /** TVA du prix TTC fournisseur ; null = celle lue dans le fichier (0,20 par défaut). */
  supplierVat?: number | null;
  display?: PriceBasis;
  /** Notre TVA pour l'affichage TTC. */
  saleVat?: number;
  lang?: ExportLang;
  /** Pied de page de l'offre exportée ; null = texte par défaut de la langue. */
  footer?: string | null;
}

export interface ResolvedSettings {
  supplierBasis: 'auto' | PriceBasis; supplierVat: number | null; display: PriceBasis; saleVat: number; lang: ExportLang; footer: string | null;
}

export const VAT_CHOICES: Array<{ rate: number; label: string }> = [
  { rate: 0.19, label: '19 % (Allemagne)' },
  { rate: 0.2, label: '20 % (France)' },
  { rate: 0.21, label: '21 % (Pays-Bas, Belgique, Espagne)' },
  { rate: 0.22, label: '22 % (Italie)' },
  { rate: 0.25, label: '25 % (Danemark, Suède)' },
];

export function resolveSettings(s: OfferSettings | null | undefined): ResolvedSettings {
  return {
    supplierBasis: s?.supplierBasis ?? 'auto',
    supplierVat: s?.supplierVat ?? null,
    display: s?.display ?? 'ht',
    saleVat: s?.saleVat ?? 0.2,
    lang: s?.lang ?? 'fr',
    footer: s?.footer?.trim() ? s.footer : null,
  };
}

/** Taux de TVA appliqué au prix TTC d'un véhicule du fichier. */
export const supplierVatOf = (v: OfferVehicle, s: ResolvedSettings) => s.supplierVat ?? v.vat_rate ?? 0.2;

/**
 * Prix fournisseur HT d'un véhicule selon les paramètres.
 * - auto : comme lu (HT si présent, sinon TTC ÷ (1 + TVA) quand la TVA est récupérable) ;
 * - TTC  : le prix du fichier est un TTC ; régime de la marge (TVA non récupérable) = le prix tel quel ;
 * - HT   : le prix du fichier est déjà un HT.
 */
export function supplierHtWith(v: OfferVehicle, s: ResolvedSettings): number | null {
  const rate = supplierVatOf(v, s);
  if (s.supplierBasis === 'ht') {
    const x = v.price_ht ?? v.price_ttc;
    return x == null ? null : Math.round(x);
  }
  if (s.supplierBasis === 'ttc') {
    const x = v.price_ttc ?? v.price_ht;
    if (x == null) return null;
    return Math.round(v.vat_recoverable === false ? x : x / (1 + rate));
  }
  if (v.price_ht != null) return Math.round(v.price_ht);
  if (v.price_ttc != null && v.vat_recoverable !== false) return Math.round(v.price_ttc / (1 + rate));
  return null;
}

/** Prix fournisseur dans la base d'affichage (TTC : avec la TVA du fournisseur). */
export function supplierShown(v: OfferVehicle, s: ResolvedSettings): number | null {
  const ht = supplierHtWith(v, s);
  if (ht == null || s.display === 'ht') return ht;
  if (v.vat_recoverable === false) return ht; // régime de la marge : pas de TVA à ajouter
  return Math.round(ht * (1 + supplierVatOf(v, s)));
}

/** Notre prix (stocké HT) → base d'affichage. */
export const toShown = (ht: number | null | undefined, s: ResolvedSettings): number | null =>
  ht == null ? null : s.display === 'ttc' ? Math.round(ht * (1 + s.saleVat)) : ht;
/** Saisie dans la base d'affichage → HT stocké. */
export const fromShown = (x: number | null, s: ResolvedSettings): number | null =>
  x == null ? null : s.display === 'ttc' ? Math.round(x / (1 + s.saleVat)) : x;
export const basisLabel = (s: Pick<ResolvedSettings, 'display'>) => (s.display === 'ttc' ? 'TTC' : 'HT');

/** Textes de l'offre exportée, par langue. */
export const EXPORT_TEXT = {
  fr: {
    units: (n: number) => `${n} véhicule${n > 1 ? 's' : ''}`,
    noPrice: 'sans prix, offre à nous proposer',
    prices: (b: PriceBasis) => (b === 'ttc' ? 'prix TTC' : 'prix HT'),
    terms: "transport à la charge de l'acheteur · vendus en l'état",
    footer: 'MC EXPORT — offre valable sous réserve de disponibilité. Dommages : chiffrages du fournisseur, conservés à l’identique.',
    date: (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    offerOf: (date: string) => `Offre du ${date}`,
    pdfPrices: (b: PriceBasis) => (b === 'ttc' ? 'PRIX TTC' : 'PRIX HORS TAXES'),
    sheet: 'Offre MC Export', sheet2: 'Caractéristiques', report: 'Voir le rapport', defaultTitle: 'OFFRE MC EXPORT',
    sheet2Head: ['Châssis (VIN)', 'Marque', 'Modèle', 'Motorisation', 'Énergie', 'Boîte', 'Lieu de stockage', 'TVA récupérable', 'Import', 'Autres colonnes du fournisseur'],
    yes: 'oui', no: 'non',
  },
  en: {
    units: (n: number) => `${n} vehicle${n > 1 ? 's' : ''}`,
    noPrice: 'no prices, offers welcome',
    prices: (b: PriceBasis) => (b === 'ttc' ? 'prices incl. VAT' : 'prices excl. VAT'),
    terms: 'transport at buyer’s expense · sold as is',
    footer: 'MC EXPORT — offer subject to availability. Damages: supplier estimates, kept unchanged.',
    date: (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    offerOf: (date: string) => `Offer dated ${date}`,
    pdfPrices: (b: PriceBasis) => (b === 'ttc' ? 'PRICES INCL. VAT' : 'PRICES EXCL. VAT'),
    sheet: 'MC Export offer', sheet2: 'Specifications', report: 'See report', defaultTitle: 'MC EXPORT OFFER',
    sheet2Head: ['Chassis (VIN)', 'Make', 'Model', 'Engine', 'Fuel', 'Gearbox', 'Storage location', 'VAT deductible', 'Import', 'Other supplier columns'],
    yes: 'yes', no: 'no',
  },
} as const;

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
  /** Doutes sur les prix validés par un humain (empreinte PriceDetection.signature). */
  priceCheckAck?: string | null;
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

/**
 * CONTRÔLE DES PRIX À L'IMPORT (11/10, Channing : « vérifier que les paramètres
 * s'activent en fonction de la liste qu'on ajoute, il faut qu'on le sache s'il
 * y a un doute »). Ce que le fichier DIT (faits) et ce qu'ADA a dû SUPPOSER
 * (doutes) sur les prix : HT ou TTC, taux de TVA, TVA récupérable, prix absents
 * ou improbables. Recalculé à chaque affichage ; les doutes restent signalés
 * tant qu'un humain ne les a pas validés (settings.priceCheckAck).
 */
export interface PriceDetection {
  basis: PriceBasis | null;        // ce que le fichier indique (null : aucune colonne de prix)
  vat: number | null;              // taux lu dans le fichier (PDF allemand : 19 %), null = non indiqué
  facts: string[];
  doubts: string[];
  signature: string;               // empreinte des doutes (un doute nouveau rouvre l'alerte)
}

const HT_MARK = /\b(ht|hors ?taxes?|h\.t|net|netto|nett|excl|exkl|export|imponibile|sans tva)\b/;
const TTC_MARK = /\b(ttc|t\.t\.c|toutes ?taxes|brut|brutto|gross|incl|inkl|lordo|ivato|avec tva)\b/;
const normH = (h: string) => h.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function detectPriceSetup(
  o: { layout: string; mappings: Array<{ header: string; field: string }>; vehicles: OfferVehicle[] },
  s: ResolvedSettings,
): PriceDetection {
  const facts: string[] = [];
  const doubts: string[] = [];
  const pct = (r: number) => `${Math.round(r * 100)} %`;
  let basis: PriceBasis | null = null;
  let vat: number | null = null;

  if (o.layout === 'pdf') {
    basis = 'ttc';
    vat = o.vehicles.find((v) => v.vat_rate != null)?.vat_rate ?? null;
    facts.push(`Extrait de stock PDF : prix TTC${vat != null ? `, TVA ${pct(vat)} (Allemagne)` : ''}.`);
  } else {
    const htCols = o.mappings.filter((m) => m.field === 'price_ht');
    const ttcCols = o.mappings.filter((m) => m.field === 'price_ttc');
    if (htCols.length && ttcCols.length) {
      basis = 'ht';
      facts.push(`Deux colonnes de prix : « ${htCols[0].header} » (HT, utilisée) et « ${ttcCols[0].header} » (TTC).`);
    } else if (htCols.length || ttcCols.length) {
      const col = (htCols[0] ?? ttcCols[0]).header;
      basis = htCols.length ? 'ht' : 'ttc';
      const h = normH(col);
      const explicit = basis === 'ht' ? HT_MARK.test(h) : TTC_MARK.test(h);
      const contradicts = basis === 'ht' ? TTC_MARK.test(h) : HT_MARK.test(h);
      if (explicit && !contradicts) facts.push(`Prix lus en ${basis.toUpperCase()} : la colonne « ${col} » le dit.`);
      else doubts.push(`La colonne de prix « ${col} » ne dit pas clairement HT ou TTC : ADA l'a lue en ${basis.toUpperCase()}${basis === 'ttc' ? ' (elle retire la TVA)' : ' (prix pris tels quels)'}.`);
    } else {
      doubts.push('Aucune colonne de prix reconnue : les prix MC Export resteront vides.');
    }
  }

  const priced = o.vehicles.filter((v) => v.price_ht != null || v.price_ttc != null);
  const missing = o.vehicles.length - priced.length;
  if (missing > 0 && priced.length > 0) doubts.push(`${missing} véhicule${missing > 1 ? 's' : ''} sans prix dans le fichier.`);
  const tiny = priced.filter((v) => (v.price_ht ?? v.price_ttc ?? 0) < 1000).length;
  if (tiny > 0) doubts.push(`${tiny} prix inférieur${tiny > 1 ? 's' : ''} à 1 000 € : unité ou séparateur à vérifier (milliers ?).`);

  const usesTtc = (s.supplierBasis === 'ttc') || (s.supplierBasis === 'auto' && basis === 'ttc');
  if (usesTtc) {
    if (s.supplierVat != null) facts.push(`TVA du fournisseur réglée à ${pct(s.supplierVat)}.`);
    else if (vat == null) doubts.push('Le fichier ne donne pas le taux de TVA : 20 % supposé (France). Fournisseur étranger ? Règle la TVA dans Paramètres (Allemagne 19 %, Pays-Bas 21 %…).');
    const unknownVat = priced.filter((v) => v.vat_recoverable == null).length;
    const margin = priced.filter((v) => v.vat_recoverable === false).length;
    if (unknownVat > 0) doubts.push(`TVA récupérable non indiquée pour ${unknownVat} véhicule${unknownVat > 1 ? 's' : ''} : ${unknownVat > 1 ? 'considérés' : 'considéré'} récupérable${unknownVat > 1 ? 's' : ''} (TVA retirée du prix).`);
    else if (priced.length) facts.push('TVA récupérable indiquée pour chaque véhicule.');
    if (margin > 0) facts.push(`${margin} véhicule${margin > 1 ? 's' : ''} en régime de la marge : prix pris tel quel (pas de TVA à retirer).`);
  }
  if (s.supplierBasis !== 'auto' && basis != null && s.supplierBasis !== basis) {
    doubts.push(`Réglage manuel : prix traités en ${s.supplierBasis.toUpperCase()} alors que le fichier indique ${basis.toUpperCase()}.`);
  }
  return { basis, vat, facts, doubts, signature: doubts.join('|') };
}

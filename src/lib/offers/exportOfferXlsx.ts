/**
 * OFFRES FOURNISSEUR — réédition à la charte MC Export : Excel (deux
 * feuilles, comme le livrable validé du 14/09), formats et téléchargement.
 * Le PDF (jsPDF) vit dans exportOfferPdf.ts. Tout est généré depuis les
 * données normalisées : aucun texte n'est rédigé par un modèle.
 */
import * as XLSX from 'xlsx';
import type { OfferVehicle } from './parseSupplierFile';

export interface OfferDocument {
  title: string;              // « OPEL ASTRA — SÉLECTION PROFESSIONNELLE »
  subtitle: string;           // « 6 véhicules · prix HT · transport à la charge de l'acheteur »
  date: string;               // « 14 septembre 2026 »
  vehicles: OfferVehicle[];   // déjà filtrés (sélectionnés) et ordonnés
  showDamages: boolean;
  showSupplierPrice: boolean; // jamais pour un client — utile en interne
  footer: string;
}


export const fmtEur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);
export const fmtKm = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} km`);
export const fmtDate = (iso: string | null | undefined) => (!iso ? '—' : new Date(iso).toLocaleDateString('fr-FR'));
export const bodyOf = (v: OfferVehicle) => /tourer|break|sw|estate|touring|kombi|combi/i.test(v.version) ? 'Break' : /fgn|fourgon|van|cargo/i.test(v.version) ? 'Utilitaire' : '';
export const labelOf = (v: OfferVehicle) => `${v.brand[0]}${v.brand.slice(1).toLowerCase()} ${v.model}`.trim();
/** Motorisation telle que le fournisseur l'écrit (colonne Engine), sinon la ligne version d'origine. */
export const engineOf = (v: OfferVehicle) => (v.engine ?? '').trim() || (v.version ?? '').trim() || '—';
const FUEL_LABEL: Record<string, string> = {
  ESSENCE: 'Essence', DIESEL: 'Diesel', ELECTRIQUE: 'Électrique', HYBRIDE: 'Hybride', PLUG_IN_HYBRID: 'Hybride rechargeable',
  'HYBRIDE RECHARGEABLE': 'Hybride rechargeable', MILD_HYBRID: 'Micro-hybride', GPL: 'GPL', CNG: 'GNV',
};
export const fuelLabel = (fuel: string | null | undefined) => (fuel ? FUEL_LABEL[fuel.trim().toUpperCase()] ?? fuel : '—');

export function buildOfferWorkbook(doc: OfferDocument): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  // COLONNES SELON LES DONNÉES PRÉSENTES (décision Channing 22/09, liste
  // Sorento « trop de vide ») : une colonne vide pour tous les véhicules
  // n'est pas exportée ; véhicule et prix restent toujours.
  type Cell = string | number | null;
  const allCols: Array<{ label: string; w: number; get: (v: OfferVehicle) => Cell; always?: boolean }> = [
    { label: 'Châssis (VIN)', w: 18, get: (v) => v.vin ?? '' },
    { label: 'Véhicule', w: 22, get: (v) => labelOf(v), always: true },
    { label: 'Motorisation', w: 30, get: (v) => ((v.engine ?? '').trim() || (v.version ?? '').trim() ? engineOf(v) : '') },
    { label: 'Version', w: 40, get: (v) => v.version ?? '' },
    { label: 'Carrosserie', w: 12, get: (v) => bodyOf(v) },
    { label: '1re immatriculation', w: 16, get: (v) => v.reg_date ?? '' },
    { label: 'Kilométrage', w: 12, get: (v) => v.km ?? null },
    { label: 'Couleur', w: 12, get: (v) => v.color ?? '' },
    { label: 'Énergie', w: 20, get: (v) => (v.fuel ? fuelLabel(v.fuel) : '') },
    { label: 'Puissance (ch)', w: 12, get: (v) => v.power_ch ?? null },
    { label: 'Boîte', w: 12, get: (v) => v.gearbox ?? '' },
    { label: 'CO₂ (g/km)', w: 10, get: (v) => v.co2 ?? null },
    ...(doc.showDamages ? [{ label: 'Dommages chiffrés (€)', w: 16, get: (v: OfferVehicle) => v.damages ?? null }] : []),
    { label: 'Prix de vente HT (€)', w: 18, get: (v) => v.sale_price ?? null, always: true },
    ...(doc.showSupplierPrice ? [{ label: 'Prix fournisseur HT (€)', w: 18, get: (v: OfferVehicle) => v.price_ht ?? null }] : []),
    { label: 'Rapport', w: 40, get: (v) => v.report_url ?? '' },
  ];
  const cols = allCols.filter((c) => c.always || doc.vehicles.some((v) => { const x = c.get(v); return x !== '' && x != null; }));
  const head: Cell[][] = [
    [doc.title], [doc.subtitle], [`Offre du ${doc.date} — ${doc.footer}`], [],
    cols.map((c) => c.label),
  ];
  const rows = doc.vehicles.map((v) => cols.map((c) => c.get(v)));
  const ws1 = XLSX.utils.aoa_to_sheet([...head, ...rows]);
  ws1['!cols'] = cols.map((c) => ({ wch: c.w }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Offre MC Export');
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Châssis (VIN)', 'Marque', 'Modèle', 'Motorisation', 'Énergie', 'Boîte', 'Lieu de stockage', 'TVA récupérable', 'Import', 'Autres colonnes du fournisseur'],
    ...doc.vehicles.map((v) => [v.vin ?? '', v.brand, v.model, v.engine ?? '', v.fuel ?? '', v.gearbox ?? '', v.location ?? '',
      v.vat_recoverable == null ? '' : v.vat_recoverable ? 'oui' : 'non', v.imported == null ? '' : v.imported ? 'oui' : 'non',
      Object.entries(v.extras).map(([k, val]) => `${k}: ${val}`).join(' · ')]),
  ]);
  ws2['!cols'] = [18, 12, 14, 28, 20, 12, 22, 12, 8, 60].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Caractéristiques');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadBlob(data: ArrayBuffer | Blob, filename: string, mime: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export const slugFile = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'offre';

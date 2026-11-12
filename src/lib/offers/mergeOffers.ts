/**
 * FUSION D'OFFRES (12/11, Channing : « la fusion de plusieurs listes, afin de regrouper les offres — on clique le bouton
 * de fusion, on sélectionne, et ça fusionne (on renomme à ce moment-là) », puis « attention de normaliser les options si
 * les critères et paramètres sont différents de l'une à l'autre »).
 *
 * L'offre de BASE garde ses réglages (prix du fichier HT/TTC, TVA, devise, affichage, langue, règle de prix, colonnes).
 * Les véhicules des autres offres sont RAMENÉS à ces réglages : leur prix fournisseur est d'abord calculé en euros HT
 * avec les réglages de LEUR offre (`supplierHtWith`), puis réécrit dans la devise et la base (HT ou TTC) de l'offre de
 * base — le prix MC Export (sale_price, en euros HT) et la marge propre sont gardés tels quels. Les colonnes libres sont
 * rapprochées par libellé (« Rapport fournisseur » des deux offres = une seule colonne), les lots et critères des
 * autres offres s'ajoutent sans écraser ceux de la base. Module pur, testable sous tsx.
 */
import type { OfferVehicle } from './parseSupplierFile';
import type { SupplierOffer } from '../../services/offers';
import type { ExportColumn } from './exportColumns';
import { defaultExportColumns } from './exportColumns';
import { resolveSettings, supplierHtWith, damagesEur, supplierVatOf, type ResolvedSettings } from './offerSettings';

export interface MergeNote { offer: string; text: string }

const normLabel = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Montant en euros → montant tel que l'offre de base l'écrit (sa devise, au taux qu'elle utilise). */
const eurToFile = (eur: number | null, s: ResolvedSettings): number | null =>
  eur == null ? null : s.supplierCurrency === 'EUR' ? eur : s.supplierFxRate && s.supplierFxRate > 0 ? Math.round(eur * s.supplierFxRate) : null;

/** Un véhicule d'une autre offre, réécrit dans les réglages de l'offre de base. */
export function normalizeVehicle(v: OfferVehicle, from: ResolvedSettings, to: ResolvedSettings): { vehicle: OfferVehicle; lost: boolean } {
  const ht = supplierHtWith(v, from);
  const dmg = damagesEur(v, from);
  const htFile = eurToFile(ht, to);
  const out: OfferVehicle = { ...v, damages: eurToFile(dmg, to) };
  if (to.supplierBasis === 'ttc') {
    // L'offre de base lit des prix TTC : on écrit un TTC à sa TVA, récupérable (le HT en est déduit à l'identique).
    out.price_ttc = htFile == null ? null : Math.round(htFile * (1 + supplierVatOf({ ...v, vat_rate: undefined }, to)));
    out.price_ht = null; out.vat_recoverable = htFile == null ? v.vat_recoverable : true;
  } else {
    out.price_ht = htFile; out.price_ttc = null; out.vat_recoverable = htFile == null ? v.vat_recoverable : true;
  }
  delete out.vat_rate;
  // Une correction à la main sur un prix ne doit pas rejouer l'ancienne base par-dessus la conversion.
  if (out.manual) { const m = { ...out.manual }; delete m.price_ht; delete m.price_ttc; delete m.damages; delete m.vat_recoverable; out.manual = m; }
  return { vehicle: out, lost: (v.price_ht != null || v.price_ttc != null) && htFile == null };
}

export function mergeOffers(base: SupplierOffer, others: SupplierOffer[], title: string): { merged: Partial<SupplierOffer> & { id: string }; notes: MergeNote[] } {
  const notes: MergeNote[] = [];
  const to = resolveSettings(base.settings);
  // Colonnes : celles de la base (par défaut si non réglées), puis les colonnes libres des autres, rapprochées par libellé.
  const columns: ExportColumn[] = (base.export_columns ?? defaultExportColumns()).map((c) => ({ ...c }));
  const vehicles: OfferVehicle[] = base.vehicles.map((v) => ({ ...v }));
  const ids = new Set(vehicles.map((v) => v.id));
  const lot_criteria = { ...(base.lot_criteria ?? {}) };
  const market = { ...(base.market ?? {}) } as NonNullable<SupplierOffer['market']>;
  const countries = [...base.countries];
  const source_files = [...(base.source_files ?? [])];
  const notesText: string[] = base.notes ? [base.notes] : [];

  for (const o of others) {
    const from = resolveSettings(o.settings);
    const sameMoney = from.supplierBasis === to.supplierBasis && from.supplierCurrency === to.supplierCurrency && (from.supplierVat ?? null) === (to.supplierVat ?? null);
    // Colonnes libres de l'autre offre → id de la colonne de même libellé dans la base, ou colonne ajoutée.
    const remap = new Map<string, string>();
    for (const c of (o.export_columns ?? [])) {
      if (c.builtin) continue;
      const same = columns.find((k) => !k.builtin && normLabel(k.label) === normLabel(c.label));
      if (same) remap.set(c.id, same.id);
      else { const id = columns.some((k) => k.id === c.id) ? `${c.id}_${o.id.slice(0, 4)}` : c.id; columns.push({ id, label: c.label }); remap.set(c.id, id); }
    }
    let lost = 0;
    for (const v0 of o.vehicles) {
      const { vehicle: v1, lost: l } = sameMoney ? { vehicle: { ...v0 }, lost: false } : normalizeVehicle(v0, from, to);
      if (l) lost++;
      const v: OfferVehicle = { ...v1 };
      if (v.custom) { const c: Record<string, string> = {}; for (const [k, val] of Object.entries(v.custom)) c[remap.get(k) ?? k] = val; v.custom = c; }
      // Même identifiant (rang de fichier, VIN déjà présent) : suffixe, la ligne n'écrase rien.
      if (ids.has(v.id)) { let k = 2; while (ids.has(`${v.id}~${k}`)) k++; v.id = `${v.id}~${k}`; }
      ids.add(v.id); vehicles.push(v);
    }
    for (const [k, c] of Object.entries(o.lot_criteria ?? {})) if (!(k in lot_criteria)) lot_criteria[k] = c;
    for (const [k, m] of Object.entries(o.market ?? {})) if (!(k in market)) (market as Record<string, unknown>)[k] = m;
    for (const c of o.countries) if (!countries.includes(c)) countries.push(c);
    for (const f of o.source_files ?? []) if (!source_files.some((s) => s.path === f.path)) source_files.push(f);
    if (o.notes?.trim()) notesText.push(`[${o.title || 'offre'}] ${o.notes.trim()}`);
    if (!sameMoney) notes.push({ offer: o.title || o.id, text: `prix ramenés aux réglages de « ${base.title || 'offre de base'} » (${from.supplierBasis === 'ttc' ? 'TTC' : from.supplierBasis === 'ht' ? 'HT' : 'auto'} ${from.supplierCurrency} → ${to.supplierBasis === 'ttc' ? 'TTC' : to.supplierBasis === 'ht' ? 'HT' : 'auto'} ${to.supplierCurrency})${lost ? ` — ${lost} prix non convertible${lost > 1 ? 's' : ''} (taux de change absent)` : ''}` });
    if ((o.export_columns ?? []).some((c) => !c.builtin)) notes.push({ offer: o.title || o.id, text: 'colonnes libres rapprochées par libellé' });
  }
  const supplier = [base.supplier, ...others.map((o) => o.supplier)].filter((s) => s && s.trim()).filter((s, i, a) => a.indexOf(s) === i).join(' + ');
  const merged: Partial<SupplierOffer> & { id: string } = {
    id: base.id, title, supplier: supplier || base.supplier, source_filename: [base.source_filename, ...others.map((o) => o.source_filename)].filter(Boolean).join(' + '),
    layout: base.layout, mappings: base.mappings, vehicles, price_rule: base.price_rule, countries, notes: notesText.join('\n'),
    status: base.status, settings: base.settings ?? null, export_columns: columns, lot_criteria, market, source_files,
    // La grille brute ne vaut que pour l'offre de base : une relecture du fichier ne concernerait qu'elle.
    source_grid: base.source_grid ?? null,
  };
  return { merged, notes };
}

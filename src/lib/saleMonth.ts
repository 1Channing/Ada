/**
 * MOIS D'UNE VENTE (13/10, Channing : « dans l'historique des ventes, plein de
 * ventes ne sont pas organisées par mois, il faut les réorganiser en fonction
 * du sheet »). Constat en base : 198 ventes clôturées sur 250 n'ont pas de
 * closed_at (le tableur n'a pas de date de livraison) et tombaient donc dans
 * le mois de leur IMPORT (créées le 02/10 → « Octobre 2026 · 146 ventes ») ;
 * 40 autres portent un closed_at hors du mois de leur onglet.
 *
 * Le tableur est la vérité : la synchro écrit l'onglet du dossier dans ses
 * notes (« [Tableur JUILLET 2026] », corrigé si la REF change d'onglet). Le
 * mois d'une vente est donc, dans l'ordre : l'onglet du tableur, sinon la
 * date de clôture, sinon la date de transaction, sinon la création.
 */
const MONTHS: Record<string, number> = {
  JANVIER: 1, FEVRIER: 2, FÉVRIER: 2, MARS: 3, AVRIL: 4, MAI: 5, JUIN: 6, JUILLET: 7,
  AOUT: 8, AOÛT: 8, SEPTEMBRE: 9, OCTOBRE: 10, NOVEMBRE: 11, DECEMBRE: 12, DÉCEMBRE: 12,
};

/** « AAAA-MM » de l'onglet du tableur lu dans les notes, ou null. */
export function sheetMonthOf(notes: string | null | undefined): string | null {
  const m = (notes ?? '').match(/\[Tableur ([A-ZÉÛ]+) (\d{4})\]/);
  if (!m) return null;
  const mm = MONTHS[m[1].toUpperCase()];
  return mm ? `${m[2]}-${String(mm).padStart(2, '0')}` : null;
}

const monthKeyOf = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Mois (« AAAA-MM ») auquel une vente appartient. */
export function saleMonthKey(row: { notes?: string | null; closed_at?: string | null; transaction_date?: string | null; created_at: string }): string {
  return sheetMonthOf(row.notes) ?? monthKeyOf(row.closed_at) ?? monthKeyOf(row.transaction_date) ?? monthKeyOf(row.created_at) ?? row.created_at.slice(0, 7);
}

export const currentMonthKey = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

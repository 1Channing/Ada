/**
 * TVA DÉCLARÉE ET POINT DE DÉPART (03/10, plan validé par Channing : « tracer
 * l'argent », « c'est la TVA que le gouvernement me doit qui crée ce fossé »).
 *
 * - vat_returns : un mois déclaré = TVA collectée, déductible, nette due,
 *   crédit demandé en remboursement, crédit reporté. Saisi à la main ou
 *   pré-rempli depuis un PDF déposé (lecture au mieux : les libellés du
 *   formulaire 3310-CA3 et des relevés de demande de remboursement).
 * - app_config 'treasury_opening' : le bilan au 31/12/2025 comme point zéro.
 *
 * Créance de TVA à une date = crédit au 31/12 + Σ (déductible − collectée)
 * des mois déclarés − remboursements reçus (lignes bancaires DGFiP / SIE
 * entrantes) + TVA payée (lignes sortantes), pour les mois ≤ cette date.
 */
import { supabase } from '../lib/supabase';
import { pdfToLinesEx } from '../lib/pdfText';
import type { TextLine } from '../lib/bankStatements';

export interface VatReturn {
  id?: string; period_month: string; declared_on: string | null; collected: number | null; deductible: number | null; net_due: number | null;
  credit_requested: number | null; credit_carried: number | null; source: string | null; notes: string | null;
}
export interface TreasuryOpening {
  as_of: string; fiscal_year?: string; cash: number; vat_credit: number; corporate_tax_due: number; stock: number; advances_paid: number;
  receivables_clients: number; payables_suppliers: number; advances_received: number; revenue?: number; result?: number; other_debts?: number;
}
const untyped = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const missing = (m: string) => /does not exist|relation|schema cache/i.test(m);
export const VAT_MISSING_MSG = 'SQL du 03/10 (vat_returns, point de départ) à coller.';
const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

export async function listVatReturns(): Promise<{ rows: VatReturn[]; error: string | null }> {
  const { data, error } = await untyped.from('vat_returns').select('*').order('period_month');
  if (error) return { rows: [], error: missing(error.message) ? VAT_MISSING_MSG : error.message };
  return { rows: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ ...r, collected: numOrNull(r.collected), deductible: numOrNull(r.deductible), net_due: numOrNull(r.net_due), credit_requested: numOrNull(r.credit_requested), credit_carried: numOrNull(r.credit_carried) })) as VatReturn[], error: null };
}
export async function upsertVatReturn(r: VatReturn): Promise<string | null> {
  const { id: _id, ...rest } = r; void _id;
  const { error } = await untyped.from('vat_returns').upsert({ ...rest, updated_at: new Date().toISOString() }, { onConflict: 'period_month' });
  return error ? (missing(error.message) ? VAT_MISSING_MSG : error.message) : null;
}
export async function deleteVatReturn(periodMonth: string): Promise<string | null> {
  const { error } = await untyped.from('vat_returns').delete().eq('period_month', periodMonth);
  return error ? error.message : null;
}
export async function loadOpening(): Promise<TreasuryOpening | null> {
  const { data, error } = await untyped.from('app_config').select('value').eq('key', 'treasury_opening').maybeSingle();
  if (error || !data?.value) return null;
  return data.value as TreasuryOpening;
}

/**
 * Lecture AU MIEUX d'un PDF de TVA : chaque mois trouvé (« 01/2026 »,
 * « janvier 2026 », « période du 01/01/2026 au 31/01/2026 ») avec les montants
 * placés à côté des libellés connus. Tout est relu et corrigé à la main dans
 * le tableau ; `raw` garde les lignes pour voir ce que le PDF dit vraiment.
 */
export async function parseVatPdf(file: File): Promise<{ returns: VatReturn[]; raw: string[]; ocr: boolean }> {
  const { lines, ocr } = await pdfToLinesEx(file);
  return { returns: extractVatReturns(lines, file.name), raw: lines.map((l) => l.text), ocr };
}
const FR_MONTHS: Record<string, number> = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const amountIn = (t: string): number | null => {
  const m = [...t.matchAll(/(-?\d{1,3}(?:[\s .]\d{3})*(?:,\d{1,2})?|-?\d+(?:,\d{1,2})?)\s*€?/g)].map((x) => x[1]).filter((x) => /\d/.test(x));
  if (!m.length) return null;
  const v = Number(m[m.length - 1].replace(/[\s .]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
export function extractVatReturns(lines: TextLine[], source: string): VatReturn[] {
  const out = new Map<string, VatReturn>();
  let cur: VatReturn | null = null;
  const get = (month: string) => { let r = out.get(month); if (!r) { r = { period_month: month, declared_on: null, collected: null, deductible: null, net_due: null, credit_requested: null, credit_carried: null, source, notes: null }; out.set(month, r); } return r; };
  for (const l of lines) {
    const t = l.text, n = norm(t);
    const p1 = n.match(/periode\s+du\s+(\d{2})\/(\d{2})\/(\d{4})/) ?? n.match(/du\s+(\d{2})\/(\d{2})\/(\d{4})\s+au/);
    const p2 = n.match(/\b(0[1-9]|1[0-2])\/(20\d{2})\b/);
    const p3 = n.match(/\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(20\d{2})\b/);
    if (p1) cur = get(`${p1[3]}-${p1[2]}`);
    else if (p3) cur = get(`${p3[2]}-${String(FR_MONTHS[p3[1]]).padStart(2, '0')}`);
    else if (p2 && /periode|mois|declaration|tva/.test(n)) cur = get(`${p2[2]}-${p2[1]}`);
    if (!cur) continue;
    const a = amountIn(t);
    if (a == null) continue;
    if (/tva brute|total de la tva brute|tva collectee|taxe brute/.test(n) && cur.collected == null) cur.collected = a;
    else if (/total tva deductible|tva deductible|deductible/.test(n) && cur.deductible == null) cur.deductible = a;
    else if (/tva nette due|net a payer|total a payer|tva a payer/.test(n) && cur.net_due == null) cur.net_due = a;
    else if (/remboursement demande|demande de remboursement|credit demande|montant demande|rembourse/.test(n) && cur.credit_requested == null) cur.credit_requested = a;
    else if (/credit a reporter|credit de tva a reporter|report de credit|credit reporte/.test(n) && cur.credit_carried == null) cur.credit_carried = a;
    const d = t.match(/(?:d[ée]pos[ée]e?|d[ée]clar[ée]e?|le)\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (d && !cur.declared_on) cur.declared_on = `${d[3]}-${d[2]}-${d[1]}`;
  }
  return [...out.values()].filter((r) => r.collected != null || r.deductible != null || r.net_due != null || r.credit_requested != null || r.credit_carried != null);
}

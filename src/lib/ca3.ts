/**
 * FORMULAIRE 3310-CA3 (impots.gouv) → une déclaration de TVA par mois.
 * Module pur (pas de Supabase) : testable hors navigateur.
 */
import type { TextLine } from './bankStatements';

export interface VatReturn {
  id?: string; period_month: string; declared_on: string | null; collected: number | null; deductible: number | null; net_due: number | null;
  credit_requested: number | null; credit_carried: number | null; source: string | null; notes: string | null;
  /** Lignes du 3310-CA3 (SQL du 03/10 bis) : A1 ventes taxées HT, F2 livraisons intracom B2B (ventes HT), E1 exportations, B2 acquisitions intracom, 22 report du crédit précédent, 25 crédit de TVA. */
  sales_taxed?: number | null; sales_intracom?: number | null; sales_export?: number | null; purchases_intracom?: number | null; credit_in?: number | null; credit?: number | null;
}
/**
 * FORMULAIRE 3310-CA3 tel qu'impots.gouv l'exporte (preuve 03/10, TVA
 * janvier 2026, 11 pages) : « Période déclarée : 01/01/2026 au 31/01/2026 »,
 * « Date de dépôt : 18/02/2026 », puis une ligne par case avec son code en
 * tête (x < 40 : « 16 », « 23 », « 25 », « 26 », « F2 »…) et le montant
 * tout à droite (x ≥ 440). La ligne 27 porte son code et son montant sur
 * une ligne à part sous le libellé. Ligne 08 : base puis taxe, la taxe est
 * la dernière. Plusieurs déclarations dans un même PDF = plusieurs mois.
 */
const CA3_MAP: Record<string, keyof VatReturn> = {
  '16': 'collected', '23': 'deductible', '22': 'credit_in', '25': 'credit', '26': 'credit_requested', '27': 'credit_carried', '28': 'net_due',
  'A1': 'sales_taxed', 'F2': 'sales_intracom', 'E1': 'sales_export', 'B2': 'purchases_intracom',
};
export function extractCa3(lines: TextLine[], source: string): VatReturn[] {
  const out: VatReturn[] = [];
  let cur: VatReturn | null = null;
  const num = (t: string) => { const v = Number(t.replace(/[\s\u00a0]/g, '').replace(',', '.')); return Number.isFinite(v) ? v : null; };
  for (const l of lines) {
    const per = l.text.match(/Période déclarée\s*:\s*(\d{2})\/(\d{2})\/(\d{4}) au (\d{2})\/(\d{2})\/(\d{4})/);
    if (per) { cur = { period_month: `${per[3]}-${per[2]}`, declared_on: null, collected: null, deductible: null, net_due: null, credit_requested: null, credit_carried: null, source, notes: null, sales_taxed: null, sales_intracom: null, sales_export: null, purchases_intracom: null, credit_in: null, credit: null }; out.push(cur); continue; }
    if (!cur) continue;
    const dep = l.text.match(/Date de dépôt\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (dep) { cur.declared_on = `${dep[3]}-${dep[2]}-${dep[1]}`; continue; }
    const code = l.frags[0];
    if (!code || code.x >= 40 || !/^(\d{2}|[A-Z]\d|[A-Z]{2}|\d[A-Z])$/.test(code.s)) continue;
    const field = CA3_MAP[code.s];
    if (!field) continue;
    const amounts = l.frags.filter((f) => f.x >= 440 && /^-?[\d\s\u00a0]+(?:,\d{1,2})?$/.test(f.s)).map((f) => num(f.s)).filter((v): v is number => v != null);
    if (!amounts.length) continue;
    if (cur[field] == null) (cur as unknown as Record<string, unknown>)[field] = amounts[amounts.length - 1];
  }
  const filled = out.filter((r) => r.collected != null || r.deductible != null || r.credit_requested != null || r.credit_carried != null);
  // Un même mois présent plusieurs fois (déclaration initiale puis rectificative) : la dernière déposée fait foi.
  const byMonth = new Map<string, VatReturn>();
  for (const r of filled) { const prev = byMonth.get(r.period_month); if (!prev || (r.declared_on ?? '') >= (prev.declared_on ?? '')) byMonth.set(r.period_month, r); }
  return [...byMonth.values()];
}

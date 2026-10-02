import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Loader2, Trash2, Plus, Save } from 'lucide-react';
import type { BankLineRow, DealLite, BankStatementRow } from '../services/treasury';
import { dealMonth } from '../services/treasury';
import { listVatReturns, upsertVatReturn, deleteVatReturn, loadOpening, parseVatPdf, type VatReturn, type TreasuryOpening } from '../services/vat';

/**
 * TVA & POINT DE DÉPART (03/10, plan validé par Channing). Le bilan au
 * 31/12/2025 est le point zéro ; la créance de TVA se suit mois par mois :
 * crédit de départ + (déductible − collectée) déclarées − remboursements reçus
 * + TVA payée (lignes bancaires impôts). Les véhicules « * » du tableur
 * (TVA récupérable : achetés TTC avec TVA déductible, vendus HT) donnent une
 * estimation de la TVA déductible attendue = achat / 6.
 */
const eur = (n: number | null | undefined, dec = 0) => (n == null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`);
const monthLabel = (m: string) => { const [y, mo] = m.split('-'); return new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' }).format(new Date(Number(y), Number(mo) - 1, 1)); };
const EMPTY = (m: string): VatReturn => ({ period_month: m, declared_on: null, collected: null, deductible: null, net_due: null, credit_requested: null, credit_carried: null, source: null, notes: null });

export function TreasuryVat({ lines, deals, statements }: { lines: BankLineRow[]; deals: DealLite[]; statements: BankStatementRow[] }) {
  const [returns, setReturns] = useState<VatReturn[]>([]);
  const [opening, setOpening] = useState<TreasuryOpening | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [raw, setRaw] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<VatReturn | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => { const [r, o] = await Promise.all([listVatReturns(), loadOpening()]); setReturns(r.rows); setOpening(o); setError(r.error); };
  useEffect(() => { void reload(); }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setBusy(`Lecture de ${f.name}…`);
      try {
        const p = await parseVatPdf(f);
        setRaw(p.raw);
        if (p.returns.length === 0) { setError(`${f.name} : aucun mois avec montants reconnu — les lignes du PDF sont affichées dessous, saisis les chiffres dans le tableau.`); continue; }
        for (const r of p.returns) { const e = await upsertVatReturn(r); if (e) { setError(e); break; } }
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }
    setBusy(null); if (fileRef.current) fileRef.current.value = '';
    await reload();
  };
  const save = async (r: VatReturn) => { const e = await upsertVatReturn(r); if (e) setError(e); else { setDraft(null); await reload(); } };
  const remove = async (m: string) => { if (!window.confirm(`Supprimer la déclaration de ${monthLabel(m)} ?`)) return; const e = await deleteVatReturn(m); if (e) setError(e); else await reload(); };

  // Lignes bancaires impôts : remboursements reçus (DGFiP / SIE) et TVA / IS payés.
  const taxLines = useMemo(() => lines.filter((l) => l.category === 'impots_tva').sort((a, b) => a.booked_on.localeCompare(b.booked_on)), [lines]);
  const months = useMemo(() => {
    const s = new Set<string>(returns.map((r) => r.period_month));
    for (const l of taxLines) s.add(l.booked_on.slice(0, 7));
    for (const d of deals) { const m = dealMonth(d); if (m && m >= '2026-01') s.add(m); }
    return [...s].filter((m) => m >= '2026-01').sort();
  }, [returns, taxLines, deals]);
  const byMonth = useMemo(() => new Map(returns.map((r) => [r.period_month, r])), [returns]);
  // Véhicules « * » : TVA déductible attendue = achat / 6 (prix TTC à 20 %), par mois de facturation du tableur.
  const starByMonth = useMemo(() => {
    const m = new Map<string, { n: number; vat: number; sales: number }>();
    for (const d of deals) {
      const mo = dealMonth(d); if (!mo) continue;
      const star = /\*\s*$/.test(d.vehicle_label ?? '');
      if (!star || d.purchase_price == null) continue;
      const cur = m.get(mo) ?? { n: 0, vat: 0, sales: 0 };
      cur.n++; cur.vat += d.purchase_price / 6; cur.sales += d.sale_price ?? 0; m.set(mo, cur);
    }
    return m;
  }, [deals]);
  // Créance de TVA mois par mois.
  const rows = useMemo(() => {
    let credit = opening?.vat_credit ?? 0;
    return months.map((m) => {
      const r = byMonth.get(m);
      const refunds = taxLines.filter((l) => l.booked_on.startsWith(m) && l.amount_in).reduce((s, l) => s + (l.amount_in ?? 0), 0);
      const paid = taxLines.filter((l) => l.booked_on.startsWith(m) && l.amount_out).reduce((s, l) => s + (l.amount_out ?? 0), 0);
      const delta = (r?.deductible ?? 0) - (r?.collected ?? 0);
      credit = credit + delta - refunds + paid;
      return { m, r, refunds, paid, delta, credit, star: starByMonth.get(m) };
    });
  }, [months, byMonth, taxLines, opening, starByMonth]);
  // Point de départ : soldes d'ouverture de janvier 2026 par compte vs disponibilités du bilan.
  const janOpenings = useMemo(() => statements.filter((s) => s.period_month.slice(0, 7) === '2026-01').map((s) => ({ s, v: s.opening_balance ?? 0 })), [statements]);
  const janSum = janOpenings.reduce((s, x) => s + x.v, 0);

  const num = (v: number | null) => (v == null ? '' : String(v));
  const field = (r: VatReturn, k: keyof VatReturn, placeholder: string) => (
    <input value={num(r[k] as number | null)} placeholder={placeholder} onChange={(e) => setDraft({ ...r, [k]: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })} className="w-24 px-1.5 py-1 rounded border border-slate-300 text-xs text-right" />
  );

  return (
    <div className="space-y-6">
      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      {/* Point de départ */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-medium text-slate-900">Point de départ : bilan au {opening ? opening.as_of.split('-').reverse().join('/') : '31/12/2025'}{opening?.fiscal_year && <span className="text-xs text-slate-500 font-normal"> · exercice {opening.fiscal_year}</span>}</h3>
        {!opening ? <p className="text-sm text-slate-500 mt-1">SQL du 03/10 à coller pour charger le bilan.</p> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 mt-2 text-sm">
            {[['Disponibilités', opening.cash], ['TVA due par l\'État', opening.vat_credit], ['IS à payer', opening.corporate_tax_due], ['Stock de véhicules', opening.stock], ['Acomptes versés', opening.advances_paid], ['Clients à encaisser', opening.receivables_clients], ['Fournisseurs à payer', opening.payables_suppliers], ['Acomptes reçus', opening.advances_received]].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-2"><span className="text-slate-600">{k}</span><span className="tabular-nums font-medium text-slate-900">{eur(v as number)}</span></div>
            ))}
          </div>
        )}
        {opening && (
          <p className={`text-xs mt-3 ${Math.abs(janSum - opening.cash) <= 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
            Contrôle : soldes d'ouverture de janvier 2026 déposés = {eur(janSum, 2)} ({janOpenings.map((x) => `${x.s.account_name ?? x.s.account} ${eur(x.v)}`).join(', ') || 'aucun relevé de janvier'}) contre {eur(opening.cash)} au bilan
            {Math.abs(janSum - opening.cash) > 1 && <> — écart {eur(janSum - opening.cash)} : il manque des relevés de janvier (Finom ?) ou un compte.</>}
          </p>
        )}
      </div>

      {/* Déclarations */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-slate-900">TVA déclarée, mois par mois</h3>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Déposer un relevé de TVA (PDF)</button>
          <button onClick={() => setDraft(EMPTY(new Date().toISOString().slice(0, 7)))} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"><Plus size={14} /> Saisir un mois</button>
        </div>
      </div>
      {busy && <div className="text-sm text-slate-600 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {busy}</div>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3">Mois</th><th className="py-2 pr-3 text-right">Collectée</th><th className="py-2 pr-3 text-right">Déductible</th><th className="py-2 pr-3 text-right">Nette due</th><th className="py-2 pr-3 text-right">Rembours. demandé</th><th className="py-2 pr-3 text-right">Crédit reporté</th>
            <th className="py-2 pr-3 text-right" title="Lignes bancaires DGFiP / SIE entrantes">Reçu de l'État</th><th className="py-2 pr-3 text-right" title="Lignes bancaires impôts sortantes (TVA, IS)">Payé à l'État</th>
            <th className="py-2 pr-3 text-right" title="Véhicules « * » du tableur : achat / 6">TVA attendue sur achats *</th><th className="py-2 pr-3 text-right">Créance de TVA fin de mois</th><th className="py-2"></th>
          </tr></thead>
          <tbody>
            {rows.map(({ m, r, refunds, paid, star, credit }) => {
              const editing = draft && draft.period_month === m ? draft : null;
              const row = editing ?? r ?? null;
              return (
                <tr key={m} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 whitespace-nowrap font-medium">{monthLabel(m)}{row?.declared_on && <span className="text-[10px] text-slate-400 ml-1">déclarée le {row.declared_on.split('-').reverse().join('/')}</span>}</td>
                  {editing ? (
                    <>
                      <td className="py-1 pr-3 text-right">{field(editing, 'collected', 'collectée')}</td><td className="py-1 pr-3 text-right">{field(editing, 'deductible', 'déductible')}</td>
                      <td className="py-1 pr-3 text-right">{field(editing, 'net_due', 'nette')}</td><td className="py-1 pr-3 text-right">{field(editing, 'credit_requested', 'demandé')}</td><td className="py-1 pr-3 text-right">{field(editing, 'credit_carried', 'reporté')}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.collected, 2)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.deductible, 2)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.net_due, 2)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.credit_requested, 2)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.credit_carried, 2)}</td>
                    </>
                  )}
                  <td className="py-1.5 pr-3 text-right tabular-nums text-emerald-700">{refunds ? eur(refunds, 2) : ''}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{paid ? eur(paid, 2) : ''}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600" title={star ? `${star.n} véhicule(s) *` : ''}>{star ? eur(star.vat) : ''}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${credit >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>{eur(credit)}</td>
                  <td className="py-1 whitespace-nowrap">
                    {editing ? <button onClick={() => void save(editing)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-900 text-white"><Save size={12} /> Enregistrer</button>
                      : <><button onClick={() => setDraft(r ?? EMPTY(m))} className="text-xs text-sky-700 hover:underline">{r ? 'modifier' : 'saisir'}</button>{r && <button onClick={() => void remove(m)} className="ml-2 text-slate-400 hover:text-red-600" title="Supprimer"><Trash2 size={12} /></button>}</>}
                  </td>
                </tr>
              );
            })}
            {draft && !months.includes(draft.period_month) && (
              <tr className="border-b border-slate-100 bg-sky-50/40">
                <td className="py-1 pr-3"><input value={draft.period_month} onChange={(e) => setDraft({ ...draft, period_month: e.target.value })} placeholder="2026-01" className="w-24 px-1.5 py-1 rounded border border-slate-300 text-xs font-mono" /></td>
                <td className="py-1 pr-3 text-right">{field(draft, 'collected', 'collectée')}</td><td className="py-1 pr-3 text-right">{field(draft, 'deductible', 'déductible')}</td>
                <td className="py-1 pr-3 text-right">{field(draft, 'net_due', 'nette')}</td><td className="py-1 pr-3 text-right">{field(draft, 'credit_requested', 'demandé')}</td><td className="py-1 pr-3 text-right">{field(draft, 'credit_carried', 'reporté')}</td>
                <td colSpan={4}></td>
                <td className="py-1"><button onClick={() => void save(draft)} disabled={!/^\d{4}-\d{2}$/.test(draft.period_month)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-900 text-white disabled:opacity-50"><Save size={12} /> Enregistrer</button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Créance = crédit au 31/12/2025 + (déductible − collectée) déclarées − reçu de l'État + payé à l'État, cumulé. « TVA attendue sur achats * » = prix d'achat / 6 des véhicules marqués * dans le tableur, à comparer à la TVA déductible déclarée du mois de facturation.</p>

      {taxLines.length > 0 && (
        <div>
          <h3 className="font-medium text-slate-900 mb-2">Mouvements bancaires avec l'État ({taxLines.length})</h3>
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Compte</th><th className="py-2 pr-3">Tiers</th><th className="py-2 pr-3">Libellé</th><th className="py-2 pr-3 text-right">Payé</th><th className="py-2 pr-3 text-right">Reçu</th></tr></thead>
            <tbody>{taxLines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100"><td className="py-1 pr-3 whitespace-nowrap">{l.booked_on}</td><td className="py-1 pr-3 text-xs">{l.account}</td><td className="py-1 pr-3">{l.counterparty}</td><td className="py-1 pr-3 max-w-[22rem] truncate" title={l.description}>{l.description}</td><td className="py-1 pr-3 text-right tabular-nums">{l.amount_out != null ? eur(l.amount_out, 2) : ''}</td><td className="py-1 pr-3 text-right tabular-nums text-emerald-700">{l.amount_in != null ? eur(l.amount_in, 2) : ''}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {raw && (
        <details className="text-xs text-slate-600"><summary className="cursor-pointer">Lignes lues dans le dernier PDF déposé ({raw.length})</summary>
          <pre className="mt-2 p-2 bg-slate-50 rounded max-h-80 overflow-auto whitespace-pre-wrap">{raw.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

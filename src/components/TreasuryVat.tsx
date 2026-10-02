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
  // Seule la TVA entre dans la créance : remboursements DGFiP / SIE entrants, paiements mentionnant la TVA.
  // IS, RCM, URSSAF, retraite sont des impôts, pas de la TVA (constat 03/10 : « RCM1 » 30 000 €, IS 8 445 €).
  const isVat = (l: BankLineRow) => { const t = `${l.counterparty} ${l.description}`.toLowerCase(); return (l.amount_in != null && /dgfip|sie\b|impot|tresor/.test(t) && !/urssaf|retraite/.test(t)) || /\btva\b|remb\. dgfip/.test(t); };
  const vatLines = useMemo(() => taxLines.filter(isVat), [taxLines]);
  const months = useMemo(() => {
    const s = new Set<string>(returns.map((r) => r.period_month));
    for (const l of taxLines) s.add(l.booked_on.slice(0, 7));
    for (const d of deals) { const m = dealMonth(d); if (m && m >= '2026-01') s.add(m); }
    return [...s].filter((m) => m >= '2026-01').sort();
  }, [returns, taxLines, deals]);
  const byMonth = useMemo(() => new Map(returns.map((r) => [r.period_month, r])), [returns]);
  // Véhicules « * » : TVA déductible attendue = achat / 6 (prix TTC à 20 %), par mois de facturation du tableur.
  // Règle Channing 03/10 : tout le tableur est en TTC. Véhicule « * » = TVA
  // récupérable : déductible attendue = achat / 6, vendu HT (collectée 0).
  // Véhicule sans * = TVA sur la marge : collectée attendue = (vente − achat) / 6.
  const starByMonth = useMemo(() => {
    const m = new Map<string, { n: number; vat: number; sales: number; collected: number; nMargin: number }>();
    for (const d of deals) {
      const mo = dealMonth(d); if (!mo || d.purchase_price == null) continue;
      const star = /\*\s*$/.test(d.vehicle_label ?? '');
      const cur = m.get(mo) ?? { n: 0, vat: 0, sales: 0, collected: 0, nMargin: 0 };
      if (star) { cur.n++; cur.vat += d.purchase_price / 6; cur.sales += (d.sale_price ?? 0) / 1.2; }
      else if (d.sale_price != null && d.sale_price > d.purchase_price) { cur.nMargin++; cur.collected += (d.sale_price - d.purchase_price) / 6; }
      m.set(mo, cur);
    }
    return m;
  }, [deals]);
  // DEMANDES DE REMBOURSEMENT ↔ VIREMENTS REÇUS (03/10, « la TVA remboursée ne
  // matche pas avec ce qu'on a réellement reçu ») : chaque demande (ligne 26)
  // est rapprochée d'un virement DGFiP / SIE du même montant, reçu après le
  // mois déclaré. Le crédit au 31/12/2025 (demandé sur la CA3 de décembre,
  // absente d'ADA) prend le premier virement sans demande qui ne le dépasse pas.
  const refundMatch = useMemo(() => {
    const refunds = vatLines.filter((l) => l.amount_in).map((l) => ({ l, used: false }));
    const received = new Map<string, BankLineRow>();
    for (const r of returns.filter((r) => r.credit_requested).sort((a, b) => a.period_month.localeCompare(b.period_month))) {
      const hit = refunds.find((x) => !x.used && x.l.booked_on >= r.period_month && Math.abs((x.l.amount_in ?? 0) - (r.credit_requested ?? 0)) <= 1);
      if (hit) { hit.used = true; received.set(r.period_month, hit.l); }
    }
    const openCredit = opening?.vat_credit ?? 0;
    const openHit = openCredit > 0 ? refunds.find((x) => !x.used && (x.l.amount_in ?? 0) <= openCredit + 1) : undefined;
    if (openHit) openHit.used = true;
    const unmatched = refunds.filter((x) => !x.used).map((x) => x.l);
    return { received, openingReceived: openHit?.l ?? null, unmatched };
  }, [returns, vatLines, opening]);
  // UNE SEULE TABLE (03/10, Channing : « je veux voir ici ce que je ne vois
  // pas sur les comptes, ce qu'il me manque »). Par mois : déclaré (CA3),
  // demandé ↔ reçu, reporté, payé, attendu d'après le tableur, écart
  // tableur − CA3, et ce que l'État doit fin de mois = demandes pas encore
  // reçues à cette date + crédit reporté de la dernière déclaration.
  const firstCreditIn = returns.length ? returns[0].credit_in ?? null : null;
  const openingDemand = opening ? Math.max(0, (refundMatch.openingReceived?.amount_in ?? (opening.vat_credit - (firstCreditIn ?? 0)))) : 0;
  const rows = useMemo(() => {
    const demands = returns.filter((r) => r.credit_requested).map((r) => ({ month: r.period_month, amount: r.credit_requested ?? 0, received: refundMatch.received.get(r.period_month) ?? null }));
    if (openingDemand > 0) demands.unshift({ month: '2025-12', amount: openingDemand, received: refundMatch.openingReceived });
    let carried: number | null = firstCreditIn;
    return months.map((m) => {
      const r = byMonth.get(m);
      const end = `${m}-31`;
      const paid = vatLines.filter((l) => l.booked_on.startsWith(m) && l.amount_out).reduce((s, l) => s + (l.amount_out ?? 0), 0);
      const received = refundMatch.received.get(m) ?? null;
      if (r) carried = r.credit_carried ?? carried;
      const pendingAt = demands.filter((d) => d.month <= m && (!d.received || d.received.booked_on > end)).reduce((s, d) => s + d.amount, 0);
      const credit = (carried ?? 0) + pendingAt;
      const star = starByMonth.get(m);
      const sheetCredit = star ? star.vat - star.collected : 0;
      const declaredCredit = r ? (r.deductible ?? 0) - (r.collected ?? 0) : null;
      const gap = declaredCredit == null ? sheetCredit : sheetCredit - declaredCredit;
      return { m, r, paid, received, star, credit, carried, pendingAt, sheetCredit, declaredCredit, gap };
    });
  }, [months, byMonth, vatLines, starByMonth, refundMatch, firstCreditIn, openingDemand]);
  const totals = useMemo(() => ({
    requested: rows.reduce((s, x) => s + (x.r?.credit_requested ?? 0), 0),
    received: rows.reduce((s, x) => s + (x.received?.amount_in ?? 0), 0),
    pending: rows.reduce((s, x) => s + ((x.r?.credit_requested ?? 0) > 0 && !x.received ? (x.r?.credit_requested ?? 0) : 0), 0),
    paid: rows.reduce((s, x) => s + x.paid, 0),
    expectedDed: rows.reduce((s, x) => s + (x.star?.vat ?? 0), 0), expectedCol: rows.reduce((s, x) => s + (x.star?.collected ?? 0), 0),
    declaredGap: rows.filter((x) => x.r).reduce((s, x) => s + x.gap, 0), undeclared: rows.filter((x) => !x.r).reduce((s, x) => s + x.sheetCredit, 0),
  }), [rows]);
  const last = rows.length ? rows[rows.length - 1] : null;
  // Point de départ : soldes d'ouverture de janvier 2026 par compte vs disponibilités du bilan.
  const janOpenings = useMemo(() => statements.filter((s) => s.period_month.slice(0, 7) === '2026-01').map((s) => ({ s, v: s.opening_balance ?? 0 })), [statements]);
  const janSum = janOpenings.reduce((s, x) => s + x.v, 0);

  const num = (v: number | null) => (v == null ? '' : String(v));
  const fmtDate = (d: string) => d.split('-').reverse().join('/');
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
        {opening?.cash_by_account && (
          <p className={`text-xs mt-3 ${Math.abs(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0) - opening.cash) <= 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
            Disponibilités au 31/12/2025 par compte (relevés) : {Object.entries(opening.cash_by_account).map(([k, v]) => `${k} ${eur(v, 2)}`).join(' + ')} = {eur(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0), 2)} contre {eur(opening.cash)} au bilan
            {Math.abs(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0) - opening.cash) <= 1 ? ' ✓ le point de départ est prouvé au centime.' : ` — écart ${eur(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0) - opening.cash, 2)}.`}
          </p>
        )}
        {opening && !opening.cash_by_account && (
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
            <th className="py-2 pr-3">Mois</th><th className="py-2 pr-3 text-right" title="CA3 lignes F2 (livraisons intracommunautaires B2B) + E1 (exportations hors UE) : ventes HT">Ventes HT (intracom + export)</th><th className="py-2 pr-3 text-right" title="Ligne 16 : total de la TVA brute due">Collectée</th><th className="py-2 pr-3 text-right" title="Ligne 23">Déductible</th><th className="py-2 pr-3 text-right" title="Ligne 28">Nette due</th>
            <th className="py-2 pr-3 text-right" title="Ligne 26 : remboursement demandé sur cette déclaration">Rembours. demandé</th><th className="py-2 pr-3" title="Virement DGFiP / SIE du même montant, reçu après le mois déclaré">Reçu pour cette demande</th><th className="py-2 pr-3 text-right" title="Ligne 27 : crédit déclaré mais pas (encore) demandé en remboursement">Crédit reporté (déclaré, pas demandé)</th><th className="py-2 pr-3 text-right" title="TVA payée (hors IS, RCM, URSSAF)">TVA payée</th>
            <th className="py-2 pr-3 text-right" title="Tableur, véhicules sans * (TVA sur la marge) : (vente − achat) / 6">Collectée attendue (marge)</th><th className="py-2 pr-3 text-right" title="Tableur, véhicules « * » : achat / 6">Déductible attendue (achats *)</th><th className="py-2 pr-3 text-right" title="(déductible attendue − collectée attendue) du tableur − (déductible − collectée) déclarées. Positif : de la TVA du tableur n'est pas dans la CA3 du mois (décalage de mois ou oubli). Mois sans déclaration : tout reste à déclarer.">Tableur − CA3</th><th className="py-2 pr-3 text-right" title="Demandes pas encore reçues à la fin du mois + crédit reporté de la dernière déclaration">Créance de TVA fin de mois</th><th className="py-2"></th>
          </tr></thead>
          <tbody>
            {opening && (
              <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-600">
                <td className="py-1.5 pr-3 whitespace-nowrap font-medium">31/12/2025 <span className="text-[10px] text-slate-400 ml-1">bilan</span></td>
                <td colSpan={4} className="py-1.5 pr-3 text-right tabular-nums text-xs">crédit de TVA au bilan {eur(opening.vat_credit)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums" title="CA3 de décembre 2025 (absente d'ADA) : déduit du virement reçu, sinon crédit du bilan − report de janvier">{openingDemand ? eur(openingDemand) : '—'}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{refundMatch.openingReceived ? <span className="text-emerald-700">reçu le {fmtDate(refundMatch.openingReceived.booked_on)} · {eur(refundMatch.openingReceived.amount_in, 2)} <span className="text-[10px] text-slate-400">{refundMatch.openingReceived.account}</span></span> : openingDemand ? <span className="text-amber-700">en attente</span> : ''}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums" title="Ligne 22 de la déclaration de janvier">{firstCreditIn != null ? eur(firstCreditIn, 2) : '—'}</td>
                <td colSpan={4}></td>
                <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-emerald-800">{eur(opening.vat_credit)}</td><td></td>
              </tr>
            )}
            {rows.map(({ m, r, paid, received, star, credit, gap, sheetCredit }) => {
              const editing = draft && draft.period_month === m ? draft : null;
              const row = editing ?? r ?? null;
              const requested = r?.credit_requested ?? 0;
              return (
                <tr key={m} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 whitespace-nowrap font-medium">{monthLabel(m)}{row?.declared_on && <span className="text-[10px] text-slate-400 ml-1">déclarée le {fmtDate(row.declared_on)}</span>}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600" title={r ? `F2 livraisons intracom ${eur(r.sales_intracom)} + E1 exportations hors UE ${eur(r.sales_export)}` : ''}>{r && (r.sales_intracom != null || r.sales_export != null) ? eur((r.sales_intracom ?? 0) + (r.sales_export ?? 0)) : '—'}{r?.sales_export ? <span className="ml-1 text-[10px] text-slate-400">dont export {eur(r.sales_export)}</span> : null}</td>
                  {editing ? (
                    <>
                      <td className="py-1 pr-3 text-right">{field(editing, 'collected', 'collectée')}</td><td className="py-1 pr-3 text-right">{field(editing, 'deductible', 'déductible')}</td>
                      <td className="py-1 pr-3 text-right">{field(editing, 'net_due', 'nette')}</td><td className="py-1 pr-3 text-right">{field(editing, 'credit_requested', 'demandé')}</td><td></td><td className="py-1 pr-3 text-right">{field(editing, 'credit_carried', 'reporté')}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.collected, 2)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.deductible, 2)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.net_due, 2)}</td><td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.credit_requested, 2)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{received ? <span className="text-emerald-700">reçu le {fmtDate(received.booked_on)} · {eur(received.amount_in, 2)} <span className="text-[10px] text-slate-400">{received.account}</span></span> : requested > 0 ? <span className="text-amber-700 font-medium">en attente</span> : ''}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{eur(r?.credit_carried, 2)}</td>
                    </>
                  )}
                  <td className="py-1.5 pr-3 text-right tabular-nums">{paid ? eur(paid, 2) : ''}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600" title={star ? `${star.nMargin} véhicule(s) en TVA sur la marge` : ''}>{star?.collected ? eur(star.collected) : ''}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600" title={star ? `${star.n} véhicule(s) *` : ''}>{star?.vat ? eur(star.vat) : ''}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${!r ? 'text-amber-700' : Math.abs(gap) <= 50 ? 'text-slate-400' : gap > 0 ? 'text-amber-700' : 'text-sky-700'}`} title={!r ? 'Mois pas encore déclaré : TVA du tableur à déclarer' : `tableur ${eur(sheetCredit)} − déclaré ${eur((r.deductible ?? 0) - (r.collected ?? 0))}`}>{!r ? (sheetCredit ? <>{eur(sheetCredit)} <span className="text-[10px]">à déclarer</span></> : '') : eur(gap)}</td>
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
                <td className="py-1 pr-3"><input value={draft.period_month} onChange={(e) => setDraft({ ...draft, period_month: e.target.value })} placeholder="2026-01" className="w-24 px-1.5 py-1 rounded border border-slate-300 text-xs font-mono" /></td><td></td>
                <td className="py-1 pr-3 text-right">{field(draft, 'collected', 'collectée')}</td><td className="py-1 pr-3 text-right">{field(draft, 'deductible', 'déductible')}</td>
                <td className="py-1 pr-3 text-right">{field(draft, 'net_due', 'nette')}</td><td className="py-1 pr-3 text-right">{field(draft, 'credit_requested', 'demandé')}</td><td></td><td className="py-1 pr-3 text-right">{field(draft, 'credit_carried', 'reporté')}</td>
                <td colSpan={5}></td>
                <td className="py-1"><button onClick={() => void save(draft)} disabled={!/^\d{4}-\d{2}$/.test(draft.period_month)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-900 text-white disabled:opacity-50"><Save size={12} /> Enregistrer</button></td>
              </tr>
            )}
            {refundMatch.unmatched.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 text-slate-500 text-xs"><td className="py-1 pr-3" colSpan={6}>virement de l'État sans demande connue</td><td className="py-1 pr-3 whitespace-nowrap text-emerald-700">reçu le {fmtDate(l.booked_on)} · {eur(l.amount_in, 2)} <span className="text-slate-400">{l.account}</span></td><td colSpan={7}></td></tr>
            ))}
            <tr className="border-t border-slate-300 font-medium text-slate-800">
              <td className="py-2 pr-3">Total</td><td></td><td className="py-2 pr-3 text-right tabular-nums">{eur(rows.reduce((s, x) => s + (x.r?.collected ?? 0), 0))}</td><td className="py-2 pr-3 text-right tabular-nums">{eur(rows.reduce((s, x) => s + (x.r?.deductible ?? 0), 0))}</td><td></td>
              <td className="py-2 pr-3 text-right tabular-nums">{eur(totals.requested)}</td><td className="py-2 pr-3 whitespace-nowrap">reçu {eur(totals.received)}{totals.pending > 0 && <span className="text-amber-700"> · en attente {eur(totals.pending)}</span>}</td><td className="py-2 pr-3 text-right tabular-nums">{last ? eur(last.carried ?? 0) : ''}</td><td className="py-2 pr-3 text-right tabular-nums">{eur(totals.paid)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{eur(totals.expectedCol)}</td><td className="py-2 pr-3 text-right tabular-nums">{eur(totals.expectedDed)}</td><td className="py-2 pr-3 text-right tabular-nums" title={`écart cumulé sur les mois déclarés ${eur(totals.declaredGap)} ; mois pas encore déclarés ${eur(totals.undeclared)}`}>{eur(totals.declaredGap + totals.undeclared)}</td><td className="py-2 pr-3 text-right tabular-nums text-emerald-800">{last ? eur(last.credit) : ''}</td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
      {last && (
        <p className="text-sm text-slate-800">
          Fin {monthLabel(last.m)}, l'État doit <strong>{eur(last.credit)}</strong> : {eur(last.pendingAt)} demandés et pas encore reçus, {eur(last.carried ?? 0)} déclarés mais pas demandés.
          {totals.undeclared > 50 && <> D'après le tableur, <strong>{eur(totals.undeclared)}</strong> de TVA restent à déclarer sur les mois sans CA3.</>}
          {Math.abs(totals.declaredGap) > 50 && <> Sur les mois déclarés, le tableur donne {eur(totals.declaredGap)} de plus que les CA3 ({totals.declaredGap > 0 ? 'de la TVA du tableur n\'est pas déclarée, ou pas encore ce mois-là' : 'les CA3 déclarent plus que le tableur'}).</>}
        </p>
      )}
      <p className="text-xs text-slate-500">Créance fin de mois = demandes de remboursement pas encore reçues à cette date + crédit reporté de la dernière déclaration. « Reçu » = virement DGFiP / SIE du montant exact de la demande, sur un relevé déposé ; un relevé manquant laisse une demande « en attente » à tort. Le tableur est tout en TTC : « Déductible attendue » = achat / 6 des véhicules marqués * (TVA récupérable, vendus HT), « Collectée attendue » = (vente − achat) / 6 des véhicules sans * (TVA sur la marge), par mois de facturation ; « Tableur − CA3 » compare les deux, mois par mois.</p>

      {taxLines.length > 0 && (
        <div>
          <h3 className="font-medium text-slate-900 mb-2">Mouvements bancaires avec l'État ({taxLines.length}) <span className="text-xs font-normal text-slate-500">— seules les lignes TVA (en gras) entrent dans la créance ; IS, RCM, URSSAF, retraite sont à part</span></h3>
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Compte</th><th className="py-2 pr-3">Tiers</th><th className="py-2 pr-3">Libellé</th><th className="py-2 pr-3 text-right">Payé</th><th className="py-2 pr-3 text-right">Reçu</th></tr></thead>
            <tbody>{taxLines.map((l) => (
              <tr key={l.id} className={`border-b border-slate-100 ${isVat(l) ? 'font-medium' : 'text-slate-500'}`}><td className="py-1 pr-3 whitespace-nowrap">{l.booked_on}</td><td className="py-1 pr-3 text-xs">{l.account}</td><td className="py-1 pr-3">{l.counterparty}</td><td className="py-1 pr-3 max-w-[22rem] truncate" title={l.description}>{l.description}</td><td className="py-1 pr-3 text-right tabular-nums">{l.amount_out != null ? eur(l.amount_out, 2) : ''}</td><td className="py-1 pr-3 text-right tabular-nums text-emerald-700">{l.amount_in != null ? eur(l.amount_in, 2) : ''}</td></tr>
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

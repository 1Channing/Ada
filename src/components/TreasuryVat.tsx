import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Loader2, Trash2, Plus, Save } from 'lucide-react';
import type { BankLineRow, DealLite, BankStatementRow } from '../services/treasury';
import { dealMonth } from '../services/treasury';
import { isStarDeal, isImportDeal } from '../lib/bankStatements';
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
      const mo = dealMonth(d); if (!mo || d.purchase_price == null || d.sheet_missing) continue;
      const star = isStarDeal(d);
      const cur = m.get(mo) ?? { n: 0, vat: 0, sales: 0, collected: 0, nMargin: 0 };
      if (star) { cur.n++; cur.vat += d.purchase_price / 6; cur.sales += (d.sale_price ?? 0) / 1.2; }
      // Import « ** » acheté HT : rien à déduire ; revendu en France au régime général → TVA collectée sur tout le prix.
      else if (isImportDeal(d)) { if (d.sale_price != null) { cur.nMargin++; cur.collected += d.sale_price / 6; } }
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
      const pendingDemands = demands.filter((d) => d.month <= m && (!d.received || d.received.booked_on > end));
      const pendingAt = pendingDemands.reduce((s, d) => s + d.amount, 0);
      const credit = (carried ?? 0) + pendingAt;
      // Composition du solde (04/10, Channing : « où sont partis les 204 605 manquants ? ») : affichée au survol.
      const pendingList = [...pendingDemands.map((d) => `${d.month === '2025-12' ? 'déc. 2025' : monthLabel(d.month)} : ${eur(d.amount)}${d.received ? ` (reçu le ${d.received.booked_on.split('-').reverse().join('/')})` : ''}`), `reporté : ${eur(carried ?? 0)}`];
      const star = starByMonth.get(m);
      const sheetCredit = star ? star.vat - star.collected : 0;
      const declaredCredit = r ? (r.deductible ?? 0) - (r.collected ?? 0) : null;
      const gap = declaredCredit == null ? sheetCredit : sheetCredit - declaredCredit;
      return { m, r, paid, received, star, credit, carried, pendingAt, pendingList, sheetCredit, declaredCredit, gap };
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
    <input value={num(r[k] as number | null)} placeholder={placeholder} onChange={(e) => setDraft({ ...r, [k]: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })} className="w-20 px-1.5 py-1 rounded border border-slate-300 text-xs text-right" />
  );
  // Colonnes vides sur tous les mois : cachées (nette due, TVA payée) — « imbuvable » sinon (Channing 03/10).
  const showNetDue = rows.some((x) => (x.r?.net_due ?? 0) > 0);
  const showPaid = rows.some((x) => x.paid > 0);
  const n = 'py-2 px-2 text-right tabular-nums whitespace-nowrap';
  const declaredCount = rows.filter((x) => x.r).length;

  return (
    <div className="space-y-5">
      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-slate-900">TVA : déclaré, demandé, reçu, attendu <span className="text-xs text-slate-500 font-normal">— {declaredCount} mois déclarés</span></h3>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Déposer une CA3 (PDF)</button>
          <button onClick={() => setDraft(EMPTY(new Date().toISOString().slice(0, 7)))} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"><Plus size={14} /> Saisir un mois</button>
        </div>
      </div>
      {busy && <div className="text-sm text-slate-600 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {busy}</div>}

      {/* L'essentiel en quatre chiffres */}
      {last && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { k: `L'État doit fin ${monthLabel(last.m)}`, v: last.credit, c: 'text-emerald-800', t: 'Demandes de remboursement pas encore reçues + crédit reporté de la dernière déclaration' },
            { k: 'Demandé, pas encore reçu', v: totals.pending, c: totals.pending > 0 ? 'text-amber-700' : 'text-slate-700', t: 'Lignes 26 des CA3 sans virement DGFiP / SIE du même montant sur un relevé déposé' },
            { k: 'Déclaré, pas demandé', v: last.carried ?? 0, c: 'text-slate-700', t: 'Ligne 27 (crédit reporté) de la dernière déclaration' },
            { k: 'À déclarer d\'après le tableur', v: totals.undeclared, c: totals.undeclared > 50 ? 'text-amber-700' : 'text-slate-700', t: 'Mois sans CA3 : déductible attendue (achats *) − collectée attendue (marge)' },
          ].map((x) => (
            <div key={x.k} className="rounded-xl border border-slate-200 bg-white px-4 py-3" title={x.t}>
              <div className="text-xs text-slate-500">{x.k}</div>
              <div className={`text-xl font-semibold tabular-nums ${x.c}`}>{eur(x.v)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Une seule table, trois blocs : déclaré (CA3) · remboursement · tableur */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-2 px-3 text-left sticky left-0 bg-white"></th>
              <th colSpan={4 + (showNetDue ? 1 : 0)} className="py-2 px-2 text-center bg-slate-50 border-x border-slate-200">Déclaré sur la CA3</th>
              <th colSpan={3 + (showPaid ? 1 : 0)} className="py-2 px-2 text-center bg-emerald-50/60 border-r border-slate-200">Remboursement</th>
              <th colSpan={3} className="py-2 px-2 text-center bg-amber-50/60 border-r border-slate-200">D'après le tableur</th>
              <th className="py-2 px-2 text-center">Bilan</th><th></th>
            </tr>
            <tr className="text-xs text-slate-600 border-b border-slate-200">
              <th className="py-2 px-3 text-left sticky left-0 bg-white">Mois</th>
              <th className={n} title="Lignes F2 (livraisons intracom B2B) + E1 (exportations hors UE)">Ventes HT</th><th className={n} title="Ligne 16">Collectée</th><th className={n} title="Ligne 23">Déductible</th>{showNetDue && <th className={n} title="Ligne 28">Nette due</th>}<th className={n} title="Déductible − collectée">Crédit du mois</th>
              <th className={n} title="Ligne 26">Demandé</th><th className="py-2 px-2 text-left whitespace-nowrap" title="Virement DGFiP / SIE du même montant, reçu après le mois déclaré">Reçu</th><th className={n} title="Ligne 27 : déclaré mais pas demandé">Reporté</th>{showPaid && <th className={n} title="TVA payée (hors IS, RCM, URSSAF)">Payée</th>}
              <th className={n} title="Véhicules * : achat / 6">Déductible (achats *)</th><th className={n} title="Véhicules sans * : (vente − achat) / 6">Collectée (marge)</th><th className={n} title="(déductible − collectée) du tableur − (déductible − collectée) de la CA3. Ambre : de la TVA du tableur n'est pas dans la CA3 du mois. Mois sans CA3 : tout reste à déclarer.">Tableur − CA3</th>
              <th className={n} title="Demandes pas encore reçues à la fin du mois + crédit reporté de la dernière déclaration">L'État doit</th><th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {opening && (
              <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-600 text-xs">
                <td className="py-2 px-3 whitespace-nowrap font-medium sticky left-0 bg-slate-50">31/12/2025 <span className="text-[10px] text-slate-400">bilan</span></td>
                <td colSpan={4 + (showNetDue ? 1 : 0)} className="py-2 px-2 text-right">crédit de TVA au bilan {eur(opening.vat_credit)}</td>
                <td className={n} title="CA3 de décembre 2025 (absente d'ADA) : déduit du virement reçu, sinon crédit du bilan − report de janvier">{openingDemand ? eur(openingDemand) : '—'}</td>
                <td className="py-2 px-2 whitespace-nowrap">{refundMatch.openingReceived ? <span className="text-emerald-700">{fmtDate(refundMatch.openingReceived.booked_on)} · {eur(refundMatch.openingReceived.amount_in)}</span> : openingDemand ? <span className="text-amber-700">en attente</span> : ''}</td>
                <td className={n} title="Ligne 22 de la déclaration de janvier">{firstCreditIn != null ? eur(firstCreditIn) : '—'}</td>{showPaid && <td></td>}
                <td colSpan={3}></td>
                <td className={`${n} font-semibold text-emerald-800`}>{eur(opening.vat_credit)}</td><td></td>
              </tr>
            )}
            {rows.map(({ m, r, paid, received, star, credit, gap, sheetCredit, declaredCredit, pendingList }) => {
              const editing = draft && draft.period_month === m ? draft : null;
              const row = editing ?? r ?? null;
              const requested = r?.credit_requested ?? 0;
              return (
                <tr key={m} className="border-b border-slate-100 odd:bg-slate-50/40">
                  <td className="py-2 px-3 whitespace-nowrap sticky left-0 bg-white"><span className="font-medium text-slate-900">{monthLabel(m)}</span>{row?.declared_on && <span className="block text-[10px] text-slate-400">déposée le {fmtDate(row.declared_on)}</span>}{!r && !editing && <span className="block text-[10px] text-amber-600">pas de CA3</span>}</td>
                  <td className={`${n} text-slate-600`} title={r ? `F2 intracom ${eur(r.sales_intracom)} · E1 export ${eur(r.sales_export)} · A1 ventes taxées ${eur(r.sales_taxed)}` : ''}>{r && (r.sales_intracom != null || r.sales_export != null) ? eur((r.sales_intracom ?? 0) + (r.sales_export ?? 0)) : r ? <span className="text-amber-600" title="Ni F2 ni E1 sur cette CA3">0 €</span> : ''}{r?.sales_export ? <span className="block text-[10px] text-slate-400">export</span> : null}</td>
                  {editing ? (
                    <>
                      <td className={n}>{field(editing, 'collected', 'collectée')}</td><td className={n}>{field(editing, 'deductible', 'déductible')}</td>{showNetDue && <td className={n}>{field(editing, 'net_due', 'nette')}</td>}<td></td>
                      <td className={n}>{field(editing, 'credit_requested', 'demandé')}</td><td></td><td className={n}>{field(editing, 'credit_carried', 'reporté')}</td>
                    </>
                  ) : (
                    <>
                      <td className={n}>{r ? eur(r.collected) : ''}</td><td className={n}>{r ? eur(r.deductible) : ''}</td>{showNetDue && <td className={n}>{r ? eur(r.net_due) : ''}</td>}<td className={`${n} font-medium`}>{declaredCredit != null ? eur(declaredCredit) : ''}</td>
                      <td className={`${n} font-medium`}>{requested ? eur(requested) : r ? '—' : ''}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{received ? <span className="text-emerald-700">{fmtDate(received.booked_on)} · {eur(received.amount_in)}</span> : requested > 0 ? <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-medium">en attente</span> : ''}</td>
                      <td className={n}>{r ? eur(r.credit_carried ?? 0) : ''}</td>
                    </>
                  )}
                  {showPaid && <td className={n}>{paid ? eur(paid) : ''}</td>}
                  <td className={`${n} text-slate-600`} title={star ? `${star.n} véhicule(s) *` : ''}>{star?.vat ? eur(star.vat) : ''}</td>
                  <td className={`${n} text-slate-600`} title={star ? `${star.nMargin} véhicule(s) en TVA sur la marge` : ''}>{star?.collected ? eur(star.collected) : ''}</td>
                  <td className={`${n} ${!r ? 'text-amber-700' : Math.abs(gap) <= 50 ? 'text-slate-400' : gap > 0 ? 'text-amber-700' : 'text-sky-700'}`} title={!r ? 'Mois pas encore déclaré : TVA du tableur à déclarer' : `tableur ${eur(sheetCredit)} − CA3 ${eur(declaredCredit)}`}>{!r ? (sheetCredit ? <>{eur(sheetCredit)}<span className="block text-[10px]">à déclarer</span></> : '') : eur(gap)}</td>
                  <td className={`${n} font-semibold ${credit >= 0 ? 'text-emerald-800' : 'text-rose-700'}`} title={`Fin ${monthLabel(m)}, encore dehors :\n${pendingList.join('\n')}`}>{eur(credit)}</td>
                  <td className="py-1 px-2 whitespace-nowrap text-xs">
                    {editing ? <button onClick={() => void save(editing)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-900 text-white"><Save size={12} /> OK</button>
                      : <><button onClick={() => setDraft(r ?? EMPTY(m))} className="text-sky-700 hover:underline">{r ? 'modifier' : 'saisir'}</button>{r && <button onClick={() => void remove(m)} className="ml-2 text-slate-400 hover:text-red-600" title="Supprimer"><Trash2 size={12} /></button>}</>}
                  </td>
                </tr>
              );
            })}
            {draft && !months.includes(draft.period_month) && (
              <tr className="border-b border-slate-100 bg-sky-50/40">
                <td className="py-1 px-3 sticky left-0 bg-sky-50"><input value={draft.period_month} onChange={(e) => setDraft({ ...draft, period_month: e.target.value })} placeholder="2026-01" className="w-20 px-1.5 py-1 rounded border border-slate-300 text-xs font-mono" /></td><td></td>
                <td className={n}>{field(draft, 'collected', 'collectée')}</td><td className={n}>{field(draft, 'deductible', 'déductible')}</td>{showNetDue && <td className={n}>{field(draft, 'net_due', 'nette')}</td>}<td></td>
                <td className={n}>{field(draft, 'credit_requested', 'demandé')}</td><td></td><td className={n}>{field(draft, 'credit_carried', 'reporté')}</td>
                <td colSpan={4 + (showPaid ? 1 : 0)}></td>
                <td className="py-1 px-2"><button onClick={() => void save(draft)} disabled={!/^\d{4}-\d{2}$/.test(draft.period_month)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-900 text-white disabled:opacity-50"><Save size={12} /> OK</button></td>
              </tr>
            )}
            {refundMatch.unmatched.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 text-slate-500 text-xs"><td className="py-1.5 px-3 sticky left-0 bg-white" colSpan={1}>virement de l'État sans demande connue</td><td colSpan={5 + (showNetDue ? 1 : 0)}></td><td className="py-1.5 px-2 whitespace-nowrap text-emerald-700">{fmtDate(l.booked_on)} · {eur(l.amount_in)} <span className="text-slate-400">{l.account}</span></td><td colSpan={6 + (showPaid ? 1 : 0)}></td></tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-semibold text-slate-900 bg-slate-50">
              <td className="py-2 px-3 sticky left-0 bg-slate-50">Total</td><td></td><td className={n}>{eur(rows.reduce((s, x) => s + (x.r?.collected ?? 0), 0))}</td><td className={n}>{eur(rows.reduce((s, x) => s + (x.r?.deductible ?? 0), 0))}</td>{showNetDue && <td></td>}<td className={n}>{eur(rows.reduce((s, x) => s + (x.declaredCredit ?? 0), 0))}</td>
              <td className={n}>{eur(totals.requested)}</td><td className="py-2 px-2 whitespace-nowrap text-xs">reçu {eur(totals.received)}{totals.pending > 0 && <span className="block text-amber-700">en attente {eur(totals.pending)}</span>}</td><td className={n}>{last ? eur(last.carried ?? 0) : ''}</td>{showPaid && <td className={n}>{eur(totals.paid)}</td>}
              <td className={n}>{eur(totals.expectedDed)}</td><td className={n}>{eur(totals.expectedCol)}</td><td className={n} title={`mois déclarés ${eur(totals.declaredGap)} · à déclarer ${eur(totals.undeclared)}`}>{eur(totals.declaredGap + totals.undeclared)}</td><td className={`${n} text-emerald-800`}>{last ? eur(last.credit) : ''}</td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        « L'État doit » est un solde à la fin de chaque mois : demandes de remboursement pas encore reçues à cette date + crédit reporté. « Reçu » = virement DGFiP / SIE du montant exact de la demande, sur un relevé déposé.
        Tableur (tout en TTC) : déductible attendue = achat / 6 des véhicules « * » ; « ** » = import acheté HT (paiement = prix / 1,2, rien à déduire, TVA collectée sur le prix de revente) ; collectée attendue = (vente − achat) / 6 des véhicules sans « * » (TVA sur la marge), par onglet de facturation. « Tableur − CA3 » = TVA du tableur − TVA de la CA3 du même mois.
      </p>

      {/* Point de départ */}
      <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm" open={!opening}>
        <summary className="cursor-pointer font-medium text-slate-900">Point de départ : bilan au {opening ? fmtDate(opening.as_of) : '31/12/2025'}{opening?.fiscal_year && <span className="text-xs text-slate-500 font-normal"> · exercice {opening.fiscal_year}</span>}
          {opening?.cash_by_account && Math.abs(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0) - opening.cash) <= 1 && <span className="ml-2 text-xs text-emerald-700 font-normal">disponibilités prouvées au centime par les relevés</span>}
        </summary>
        {!opening ? <p className="text-slate-500 mt-1">SQL du 03/10 à coller pour charger le bilan.</p> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 mt-2">
            {[['Disponibilités', opening.cash], ['TVA due par l\'État', opening.vat_credit], ['IS à payer', opening.corporate_tax_due], ['Stock de véhicules', opening.stock], ['Acomptes versés', opening.advances_paid], ['Clients à encaisser', opening.receivables_clients], ['Fournisseurs à payer', opening.payables_suppliers], ['Acomptes reçus', opening.advances_received]].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-2"><span className="text-slate-600">{k}</span><span className="tabular-nums font-medium text-slate-900">{eur(v as number)}</span></div>
            ))}
          </div>
        )}
        {opening?.cash_by_account && (
          <p className={`text-xs mt-3 ${Math.abs(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0) - opening.cash) <= 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
            Disponibilités au 31/12/2025 par compte (relevés) : {Object.entries(opening.cash_by_account).map(([k, v]) => `${k} ${eur(v, 2)}`).join(' + ')} = {eur(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0), 2)} contre {eur(opening.cash)} au bilan
            {Math.abs(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0) - opening.cash) <= 1 ? ' ✓' : ` — écart ${eur(Object.values(opening.cash_by_account).reduce((a, b) => a + b, 0) - opening.cash, 2)}.`}
          </p>
        )}
        {opening && !opening.cash_by_account && (
          <p className={`text-xs mt-3 ${Math.abs(janSum - opening.cash) <= 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
            Contrôle : soldes d'ouverture de janvier 2026 déposés = {eur(janSum, 2)} ({janOpenings.map((x) => `${x.s.account_name ?? x.s.account} ${eur(x.v)}`).join(', ') || 'aucun relevé de janvier'}) contre {eur(opening.cash)} au bilan
            {Math.abs(janSum - opening.cash) > 1 && <> — écart {eur(janSum - opening.cash)} : il manque des relevés de janvier ou un compte.</>}
          </p>
        )}
      </details>

      {taxLines.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-slate-900">Mouvements bancaires avec l'État ({taxLines.length}) <span className="text-xs font-normal text-slate-500">— seules les lignes TVA (en gras) entrent dans le calcul ; IS, RCM, URSSAF, retraite sont à part</span></summary>
          <table className="min-w-full text-sm mt-2">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Compte</th><th className="py-2 pr-3">Tiers</th><th className="py-2 pr-3">Libellé</th><th className="py-2 pr-3 text-right">Payé</th><th className="py-2 pr-3 text-right">Reçu</th></tr></thead>
            <tbody>{taxLines.map((l) => (
              <tr key={l.id} className={`border-b border-slate-100 ${isVat(l) ? 'font-medium' : 'text-slate-500'}`}><td className="py-1 pr-3 whitespace-nowrap">{l.booked_on}</td><td className="py-1 pr-3 text-xs">{l.account}</td><td className="py-1 pr-3">{l.counterparty}</td><td className="py-1 pr-3 max-w-[22rem] truncate" title={l.description}>{l.description}</td><td className="py-1 pr-3 text-right tabular-nums">{l.amount_out != null ? eur(l.amount_out, 2) : ''}</td><td className="py-1 pr-3 text-right tabular-nums text-emerald-700">{l.amount_in != null ? eur(l.amount_in, 2) : ''}</td></tr>
            ))}</tbody>
          </table>
        </details>
      )}

      {raw && (
        <details className="text-xs text-slate-600"><summary className="cursor-pointer">Lignes lues dans le dernier PDF déposé ({raw.length})</summary>
          <pre className="mt-2 p-2 bg-slate-50 rounded max-h-80 overflow-auto whitespace-pre-wrap">{raw.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

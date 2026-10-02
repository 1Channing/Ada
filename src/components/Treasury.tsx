import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Loader2, Trash2, RefreshCw, AlertTriangle, Link2 } from 'lucide-react';
import { BANK_CATEGORIES, CATEGORY_LABEL, NON_EXPENSE, ACCOUNT_LABEL, expectedCash, isStarDeal, type BankCategory, type BankAccount } from '../lib/bankStatements';
import { TreasuryVat } from './TreasuryVat';
import {
  listStatements, listLines, deleteStatement, setLineCategory, setLineMatch, loadDeals, uploadStatement, rematchAll, dealMonth,
  type BankStatementRow, type BankLineRow, type DealLite, type UploadResult,
} from '../services/treasury';

/**
 * TRÉSORERIE (02/10, demande Channing, admin seulement) : relevés de compte
 * déposés en PDF (Revolut, Airwallex), lignes classées, tableau de frais
 * mensuel, achats de véhicules rapprochés du tableau de ventes (plaque ↔
 * REF), marge recalculée avec les frais réels. « Voir où il y a une fuite. »
 */
const eur = (n: number | null | undefined, dec = 0) => (n == null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`);
const monthLabel = (m: string) => { const [ym, part] = m.split('~'); const [y, mo] = ym.split('-'); return new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' }).format(new Date(Number(y), Number(mo) - 1, 1)) + (part ? ` (${part.replace('-', '→')})` : ''); };
type View = 'releves' | 'frais' | 'vehicules' | 'lignes' | 'tva';

export function Treasury() {
  const [statements, setStatements] = useState<BankStatementRow[]>([]);
  const [lines, setLines] = useState<BankLineRow[]>([]);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [view, setView] = useState<View>('frais');
  const [account, setAccount] = useState<string>('all');
  const [month, setMonth] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [query, setQuery] = useState('');
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setLoading(true);
    const [s, l, d] = await Promise.all([listStatements(), listLines(), loadDeals()]);
    setStatements(s.rows); setLines(l.rows); setDeals(d); setError(s.error ?? l.error);
    setLoading(false);
  };
  useEffect(() => { void reload(); }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const out: UploadResult[] = [];
    const ds = deals.length ? deals : await loadDeals();
    for (const f of Array.from(files)) {
      setBusy(`Lecture de ${f.name}…`);
      out.push(await uploadStatement(f, ds));
      setResults([...out]);
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
    await reload();
  };
  const onDelete = async (s: BankStatementRow) => {
    if (!window.confirm(`Supprimer le relevé ${ACCOUNT_LABEL[s.account]}${s.account_ref ? ` …${s.account_ref}` : ''} ${monthLabel(s.period_month)} (${s.line_count} lignes) ?`)) return;
    setBusy('Suppression…'); const e = await deleteStatement(s.id); setBusy(null);
    if (e) setError(e); else await reload();
  };
  const onRematch = async () => {
    setBusy('Rapprochement…');
    const ds = await loadDeals(); setDeals(ds);
    const r = await rematchAll(lines, ds);
    setBusy(null);
    if (r.error) setError(r.error);
    setResults([{ file: 'Rapprochement', lines: lines.length, matched: lines.filter((l) => l.transaction_id).length + r.changed }]);
    await reload();
  };
  const onCategory = async (l: BankLineRow, c: BankCategory) => {
    setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, category: c } : x)));
    const e = await setLineCategory(l.id, c);
    if (e) setError(e);
  };

  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const scoped = useMemo(() => lines.filter((l) => account === 'all' || l.account === account), [lines, account]);
  const months = useMemo(() => [...new Set(scoped.map((l) => l.booked_on.slice(0, 7)))].sort(), [scoped]);

  // ── Grille des relevés : banques × mois depuis janvier 2026 jusqu'au mois
  //    courant (demande Channing 02/10 : « voir ce qu'il manque »).
  const gridMonths = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    const first = statements.reduce((m, s) => (s.period_month.slice(0, 7) < m ? s.period_month.slice(0, 7) : m), '2026-01');
    for (let d = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1); d <= now; d.setMonth(d.getMonth() + 1)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    return out;
  }, [statements]);
  // Une ligne de grille = (banque, numéro de compte) : Shine principal et
  // Shine secondaire sont deux lignes (02/10 soir).
  type GridRow = { account: BankAccount; ref: string; label: string };
  const rowLabel = (s: { account: BankAccount; account_ref?: string | null; account_name?: string | null }) =>
    `${ACCOUNT_LABEL[s.account]}${s.account_name ? ` · ${s.account_name}` : ''}${s.account_ref ? ` · …${s.account_ref}` : ''}`;
  const gridRows = useMemo<GridRow[]>(() => {
    const rows = new Map<string, GridRow>();
    for (const s of statements) { const k = `${s.account}|${s.account_ref ?? ''}`; if (!rows.has(k)) rows.set(k, { account: s.account, ref: s.account_ref ?? '', label: rowLabel(s) }); }
    const order = Object.keys(ACCOUNT_LABEL) as BankAccount[];
    const out = [...rows.values()].sort((a, b) => order.indexOf(a.account) - order.indexOf(b.account) || a.label.localeCompare(b.label));
    for (const a of order) if (!out.some((r) => r.account === a)) out.push({ account: a, ref: '', label: ACCOUNT_LABEL[a] });
    return out;
  }, [statements]);
  const stmtsOf = (r: GridRow) => statements.filter((s) => s.account === r.account && (s.account_ref ?? '') === r.ref);
  // Compte clôturé : le dernier relevé se termine à (presque) zéro → rien n'est attendu après (Finom, Pennylane).
  const closedAfter = (sts: BankStatementRow[]) => { const last = [...sts].sort((a, b) => b.period_month.localeCompare(a.period_month))[0]; return !!last && last.closing_balance != null && Math.abs(last.closing_balance) < 50; };
  const cell = (r: GridRow, m: string) => stmtsOf(r).filter((s) => s.period_month.slice(0, 7) === m);
  const stmtById = useMemo(() => new Map(statements.map((s) => [s.id, s])), [statements]);
  // Un mois manque quand un compte déjà déposé n'a rien entre son premier relevé et le mois précédent.
  const missingCount = useMemo(() => {
    let n = 0;
    const prevMonth = gridMonths[gridMonths.length - 2];
    for (const r of gridRows) {
      const sts = stmtsOf(r); const mine = sts.map((s) => s.period_month.slice(0, 7));
      if (mine.length === 0) continue;
      const last = mine.reduce((x, y) => (y > x ? y : x));
      const lo = mine.reduce((x, y) => (y < x ? y : x)), hi = !closedAfter(sts) && prevMonth && prevMonth > last ? prevMonth : last;
      for (const m of gridMonths) if (m >= lo && m <= hi && !mine.includes(m)) n++;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statements, gridMonths, gridRows]);
  // Lien posé à la main (REF) sur une ou plusieurs lignes.
  const onLink = async (lineIds: string[], ref: string) => {
    const ds = deals.length ? deals : await loadDeals();
    for (const id of lineIds) {
      const r = await setLineMatch(id, ref, ds);
      if (r.error) { setError(r.error); return; }
      setLines((prev) => prev.map((x) => (x.id === id ? { ...x, transaction_id: r.deal?.id ?? null, match_how: r.deal ? 'manuel' : null } : x)));
    }
  };

  // ── Frais mensuels par catégorie ──
  const matrix = useMemo(() => {
    const m = new Map<BankCategory, Map<string, number>>();
    for (const l of scoped) {
      const mo = l.booked_on.slice(0, 7);
      const row = m.get(l.category) ?? new Map<string, number>();
      row.set(mo, (row.get(mo) ?? 0) + (l.amount_out ?? 0) - (l.amount_in ?? 0));
      m.set(l.category, row);
    }
    const total = (row: Map<string, number>) => [...row.values()].reduce((s, v) => s + v, 0);
    return [...m.entries()].sort((a, b) => total(b[1]) - total(a[1]));
  }, [scoped]);
  const expensesByMonth = useMemo(() => {
    const r = new Map<string, number>();
    for (const [cat, row] of matrix) if (!NON_EXPENSE.has(cat)) for (const [mo, v] of row) r.set(mo, (r.get(mo) ?? 0) + v);
    return r;
  }, [matrix]);
  const marginByMonth = useMemo(() => {
    const r = new Map<string, { n: number; brute: number; comm: number; fees: number }>();
    for (const d of deals) {
      const mo = dealMonth(d); if (!mo) continue;
      const cur = r.get(mo) ?? { n: 0, brute: 0, comm: 0, fees: 0 };
      cur.n++;
      if (d.sale_price != null && d.purchase_price != null) cur.brute += (d.sale_price - d.purchase_price) / 1.2;
      cur.comm += d.commission_ht ?? 0; cur.fees += d.fees ?? 0;
      r.set(mo, cur);
    }
    return r;
  }, [deals]);

  // ── Véhicules : achats payés vs tableau, encaissements vs prix de vente ──
  type Group = { key: string; deal: DealLite | null; plate: string | null; label: string; paid: number; received: number; lines: BankLineRow[]; first: string };
  const groups = useMemo(() => {
    const g = new Map<string, Group>();
    for (const l of scoped) {
      if (!['achat_vehicule', 'acompte_vehicule', 'vente_encaissee'].includes(l.category)) continue;
      const key = l.transaction_id ?? (l.plate ? `plaque:${l.plate}` : l.vin ? `vin:${l.vin}` : `ligne:${l.id}`);
      const cur = g.get(key) ?? { key, deal: l.transaction_id ? dealById.get(l.transaction_id) ?? null : null, plate: l.plate, label: `${l.counterparty} — ${l.description}`.slice(0, 80), paid: 0, received: 0, lines: [], first: l.booked_on };
      cur.paid += l.amount_out ?? 0; cur.received += l.amount_in ?? 0; cur.lines.push(l);
      if (l.booked_on < cur.first) cur.first = l.booked_on;
      if (!cur.plate && l.plate) cur.plate = l.plate;
      g.set(key, cur);
    }
    return [...g.values()].sort((a, b) => b.first.localeCompare(a.first));
  }, [scoped, dealById]);
  const purchases = groups.filter((g) => g.paid > 0);
  const receipts = groups.filter((g) => g.received > 0);
  const sum = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((s, x) => s + (f(x) || 0), 0);

  // ── Lignes ──
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter((l) => (!month || l.booked_on.startsWith(month)) && (!category || l.category === category) && (!onlyUnmatched || (!l.transaction_id && ['achat_vehicule', 'acompte_vehicule', 'vente_encaissee'].includes(l.category)))
      && (!q || `${l.counterparty} ${l.description} ${l.plate ?? ''} ${l.kind}`.toLowerCase().includes(q)));
  }, [scoped, month, category, query, onlyUnmatched]);

  const tabBtn = (id: View, label: string) => (
    <button onClick={() => setView(id)} className={`px-3 py-1.5 rounded-lg text-sm ${view === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{label}</button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Trésorerie <span className="text-xs font-normal text-slate-500 align-middle">admin</span></h2>
          <p className="text-sm text-slate-600 mt-1">Dépose les relevés PDF (Revolut, Airwallex, Shine, Pennylane, CIC, Caisse d'Épargne) : chaque ligne est classée, les achats de véhicules sont rapprochés du tableau de ventes par la plaque, et la marge est recalculée avec les frais réels.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800 disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Déposer des relevés
          </button>
          <button onClick={() => void onRematch()} disabled={!!busy || lines.length === 0} title="Relier à nouveau chaque achat / encaissement aux dossiers (après avoir complété des plaques ou importé le tableur)" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Link2 size={16} /> Re-rapprocher
          </button>
        </div>
      </div>
      {busy && <div className="text-sm text-slate-600 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {busy}</div>}
      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      {results.length > 0 && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm space-y-1">
          {results.map((r, i) => (
            <div key={i} className={r.error ? 'text-red-700' : 'text-slate-700'}>
              <span className="font-medium">{r.file}</span>{' '}
              {r.error ? `: ${r.error}` : `→ ${r.account ? ACCOUNT_LABEL[r.account] : ''} ${r.month ? monthLabel(r.month) : ''} : ${r.lines ?? 0} lignes, ${r.matched ?? 0} reliées à un dossier${r.replaced ? ' (relevé remplacé)' : ''}`}
              {r.warnings?.map((w, j) => <div key={j} className="text-amber-700 text-xs pl-4">⚠ {w}</div>)}
            </div>
          ))}
        </div>
      )}

      {/* Relevés déposés : résumé ici, grille complète dans la vue « Relevés » */}
      <div className="text-sm text-slate-600 flex items-center gap-2">
        {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
        {!loading && (statements.length === 0 ? 'Aucun relevé déposé.' : `${statements.length} relevé${statements.length > 1 ? 's' : ''} déposé${statements.length > 1 ? 's' : ''} · ${[...new Set(statements.map((s) => s.account))].map((a) => ACCOUNT_LABEL[a]).join(', ')}`)}
        {!loading && missingCount > 0 && <span className="text-amber-700">· {missingCount} mois manquant{missingCount > 1 ? 's' : ''} (voir « Relevés »)</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabBtn('releves', `Relevés (${statements.length})`)}{tabBtn('frais', 'Frais mensuels')}{tabBtn('vehicules', 'Véhicules : payé vs tableau')}{tabBtn('tva', 'TVA & point de départ')}{tabBtn('lignes', `Lignes (${scoped.length})`)}
        <span className="mx-2 text-slate-300">|</span>
        <select value={account} onChange={(e) => setAccount(e.target.value as typeof account)} className="px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white">
          <option value="all">Tous les comptes</option>
          {[...new Set(statements.map((s) => s.account))].map((a) => <option key={a} value={a}>{ACCOUNT_LABEL[a]}</option>)}
        </select>
      </div>

      {view === 'releves' && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4">Banque</th>
                  {gridMonths.map((m) => <th key={m} className="py-2 px-2 text-center whitespace-nowrap">{monthLabel(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                {gridRows.map((row) => {
                  const mine = stmtsOf(row).map((s) => s.period_month.slice(0, 7));
                  const lo = mine.length ? mine.reduce((x, y) => (y < x ? y : x)) : null;
                  return (
                    <tr key={`${row.account}|${row.ref}`} className="border-b border-slate-100">
                      <td className="py-2 pr-4 whitespace-nowrap font-medium text-slate-800">{row.label}{mine.length === 0 && <span className="ml-1 text-xs font-normal text-slate-400">(aucun relevé)</span>}</td>
                      {gridMonths.map((m) => {
                        const sts = cell(row, m);
                        const isLast = m === gridMonths[gridMonths.length - 1];
                        const last = mine.length ? mine.reduce((x, y) => (y > x ? y : x)) : null;
                        const expected = lo != null && m >= lo && !isLast && !(closedAfter(stmtsOf(row)) && last != null && m > last);
                        return (
                          <td key={m} className="py-1.5 px-2 text-center align-top">
                            {sts.length > 0 ? sts.map((st) => (
                              <div key={st.id} className="inline-flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 m-0.5" title={`${st.file_name ?? ''}\n${st.line_count} lignes · ${eur(st.opening_balance, 2)} → ${eur(st.closing_balance, 2)}${st.warnings?.length ? '\n⚠ ' + st.warnings.join('\n⚠ ') : ''}`}>
                                <span className="font-medium">{st.period_month.includes('~') ? st.period_month.split('~')[1].replace('-', '→') : '✓'} · {st.line_count} l.</span>
                                <span className="text-[10px] text-emerald-700 whitespace-nowrap">{eur(st.opening_balance)} → {eur(st.closing_balance)}</span>
                                <span className="flex items-center gap-1">
                                  {st.warnings && st.warnings.length > 0 && <AlertTriangle size={11} className="text-amber-600" />}
                                  <button onClick={() => void onDelete(st)} className="text-emerald-600/60 hover:text-red-600" title="Supprimer ce relevé"><Trash2 size={11} /></button>
                                </span>
                              </div>
                            )) : expected ? <span className="inline-block px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700" title="Aucun relevé déposé pour ce mois">manque</span>
                              : <span className="text-slate-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">« manque » : la banque a des relevés avant et rien pour ce mois (le mois en cours n'est jamais compté ; un compte dont le dernier relevé finit à zéro est tenu pour clôturé). Un relevé en plusieurs parties montre ses jours (01→15). Survole une case pour le fichier, les soldes et les avertissements.</p>
        </div>
      )}
      {view === 'tva' && <TreasuryVat lines={lines} deals={deals} statements={statements} />}
      {view === 'frais' && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4">Catégorie</th>
                {months.map((m) => <th key={m} className="py-2 px-2 text-right whitespace-nowrap">{monthLabel(m)}</th>)}
                <th className="py-2 pl-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map(([cat, row]) => {
                const tot = [...row.values()].reduce((s, v) => s + v, 0);
                const capital = NON_EXPENSE.has(cat);
                return (
                  <tr key={cat} className={`border-b border-slate-100 ${capital ? 'text-slate-500' : 'text-slate-800'}`}>
                    <td className="py-1.5 pr-4 whitespace-nowrap">{CATEGORY_LABEL[cat]}{capital && <span className="ml-1 text-[10px] text-slate-400">(hors frais)</span>}</td>
                    {months.map((m) => <td key={m} className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{row.get(m) ? eur(row.get(m)) : ''}</td>)}
                    <td className="py-1.5 pl-2 text-right tabular-nums font-medium whitespace-nowrap">{eur(tot)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
                <td className="py-2 pr-4">Frais réels des relevés</td>
                {months.map((m) => <td key={m} className="py-2 px-2 text-right tabular-nums">{eur(expensesByMonth.get(m) ?? 0)}</td>)}
                <td className="py-2 pl-2 text-right tabular-nums">{eur([...expensesByMonth.values()].reduce((s, v) => s + v, 0))}</td>
              </tr>
              <tr className="text-slate-700">
                <td className="py-1.5 pr-4">Ventes du tableur (dossiers du mois)</td>
                {months.map((m) => <td key={m} className="py-1.5 px-2 text-right tabular-nums">{marginByMonth.get(m)?.n ?? 0}</td>)}
                <td className="py-1.5 pl-2 text-right tabular-nums">{sum(months, (m) => marginByMonth.get(m)?.n ?? 0)}</td>
              </tr>
              <tr className="text-slate-700">
                <td className="py-1.5 pr-4" title="Σ (vente − achat) / 1,2 sur les dossiers du mois (onglet du tableur)">Marge brute HT (vente − achat) / 1,2</td>
                {months.map((m) => <td key={m} className="py-1.5 px-2 text-right tabular-nums">{eur(marginByMonth.get(m)?.brute ?? 0)}</td>)}
                <td className="py-1.5 pl-2 text-right tabular-nums">{eur(sum(months, (m) => marginByMonth.get(m)?.brute ?? 0))}</td>
              </tr>
              <tr className="text-slate-700">
                <td className="py-1.5 pr-4" title="Commission HT écrite dans le tableur (marge brute − frais HT du tableur)">Commission HT du tableur</td>
                {months.map((m) => <td key={m} className="py-1.5 px-2 text-right tabular-nums">{eur(marginByMonth.get(m)?.comm ?? 0)}</td>)}
                <td className="py-1.5 pl-2 text-right tabular-nums">{eur(sum(months, (m) => marginByMonth.get(m)?.comm ?? 0))}</td>
              </tr>
              <tr className="font-semibold text-emerald-800 bg-emerald-50">
                <td className="py-2 pr-4" title="Marge brute HT − frais réels des relevés (hors achats de véhicules, transferts internes, encaissements)">Marge nette réelle = brute − frais des relevés</td>
                {months.map((m) => <td key={m} className="py-2 px-2 text-right tabular-nums">{eur((marginByMonth.get(m)?.brute ?? 0) - (expensesByMonth.get(m) ?? 0))}</td>)}
                <td className="py-2 pl-2 text-right tabular-nums">{eur(sum(months, (m) => (marginByMonth.get(m)?.brute ?? 0) - (expensesByMonth.get(m) ?? 0)))}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-2">Les frais ne couvrent que les comptes déposés : tant que le compte principal manque, la marge nette est surestimée. Les montants entrants (encaissements, transferts) apparaissent en négatif dans leur catégorie.</p>
        </div>
      )}

      {view === 'vehicules' && (
        <div className="space-y-6">
          <div>
            <h3 className="font-medium text-slate-900 mb-2">Achats payés depuis les comptes <span className="text-xs text-slate-500">({purchases.length} véhicules · payé {eur(sum(purchases, (g) => g.paid))} · tableur {eur(sum(purchases, (g) => g.deal?.purchase_price ?? 0))} · écart {eur(sum(purchases, (g) => g.paid - (g.deal?.purchase_price ?? 0)))})</span></h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Plaque</th><th className="py-2 pr-3">Payé à</th><th className="py-2 pr-3 text-right">Payé</th>
                  <th className="py-2 pr-3">Dossier</th><th className="py-2 pr-3 text-right">Achat tableur</th><th className="py-2 pr-3 text-right">Écart</th><th className="py-2 pr-3 text-right">Vente</th><th className="py-2 pr-3 text-right">Commission HT</th>
                </tr></thead>
                <tbody>
                  {purchases.map((g) => {
                    const d = g.deal; const ecart = d?.purchase_price != null ? g.paid - d.purchase_price : null;
                    return (
                      <tr key={g.key} className={`border-b border-slate-100 ${!d ? 'bg-amber-50' : ecart != null && ecart > 1 ? 'bg-rose-50' : ecart != null && ecart < -1 ? 'bg-amber-50/60' : ''}`}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{g.first}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">{g.plate ?? '—'}</td>
                        <td className="py-1.5 pr-3 max-w-[22rem] truncate" title={g.lines.map((l) => `${l.booked_on} ${l.counterparty} — ${l.description} : ${eur(l.amount_out, 2)}`).join('\n')}>{g.lines[0]?.counterparty}{g.lines.length > 1 && <span className="text-xs text-slate-500"> (+{g.lines.length - 1})</span>}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{eur(g.paid)}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{d ? <span title={g.lines.map((l) => l.match_how).filter(Boolean).join(', ')}>{d.reference} · {d.vehicle_label ?? `${d.brand ?? ''} ${d.model ?? ''}`.trim()}</span> : <RefInput onSubmit={(ref) => void onLink(g.lines.map((l) => l.id), ref)} />}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{eur(d?.purchase_price)}</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${ecart == null ? '' : ecart > 1 ? 'text-rose-700' : ecart < -1 ? 'text-amber-700' : 'text-slate-400'}`} title={ecart != null && ecart < -1 ? 'Payé moins que le tableur : acompte ou complément sur un relevé pas encore déposé, ou prix du tableur à vérifier' : ecart != null && ecart > 1 ? 'Payé plus que le tableur' : ''}>{ecart == null ? '—' : eur(ecart)}{ecart != null && ecart < -1 && <span className="ml-1 text-[10px] font-normal">à compléter</span>}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{eur(d?.sale_price)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{eur(d?.commission_ht, 2)}</td>
                      </tr>
                    );
                  })}
                  {purchases.length === 0 && <tr><td colSpan={9} className="py-3 text-slate-500">Aucun achat de véhicule dans les relevés déposés.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-1">Écart = payé (acomptes compris) − prix d'achat du tableur. Rouge : payé plus que le tableur. Ambre « à compléter » : payé moins, le reste est sans doute un acompte sur un relevé pas encore déposé ; l'écart se referme seul quand il arrive. Jaune : aucun dossier trouvé — tape la REF du dossier pour poser le lien à la main.</p>
          </div>
          <div>
            <h3 className="font-medium text-slate-900 mb-2">Encaissements de ventes <span className="text-xs text-slate-500">({receipts.length} · reçu {eur(sum(receipts, (g) => g.received))} · attendu {eur(sum(receipts, (g) => (g.deal?.sale_price != null ? expectedCash(g.deal, 'sale_price') : 0)))} — un véhicule * est vendu HT : prix du tableur / 1,2)</span></h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">De</th><th className="py-2 pr-3">Libellé</th><th className="py-2 pr-3 text-right">Reçu</th><th className="py-2 pr-3">Dossier</th><th className="py-2 pr-3 text-right">Encaissement attendu</th><th className="py-2 pr-3 text-right">Écart</th>
                </tr></thead>
                <tbody>
                  {receipts.map((g) => {
                    const d = g.deal; const expected = d?.sale_price != null ? expectedCash(d, 'sale_price') : null; const ecart = expected != null ? g.received - expected : null;
                    return (
                      <tr key={g.key} className={`border-b border-slate-100 ${!d ? 'bg-amber-50' : ''}`}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{g.first}</td>
                        <td className="py-1.5 pr-3">{g.lines[0]?.counterparty}</td>
                        <td className="py-1.5 pr-3 max-w-[22rem] truncate" title={g.lines.map((l) => l.description).join('\n')}>{g.lines[0]?.description}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{eur(g.received)}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{d ? `${d.reference} · ${d.vehicle_label ?? ''}` : <RefInput onSubmit={(ref) => void onLink(g.lines.map((l) => l.id), ref)} />}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums" title={d && isStarDeal(d) ? `tableur ${eur(d.sale_price)} TTC → vendu HT ${eur(expected)}` : ''}>{eur(expected)}{d && isStarDeal(d) && <span className="ml-1 text-[10px] text-sky-700">HT</span>}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{ecart == null ? '—' : eur(ecart)}</td>
                      </tr>
                    );
                  })}
                  {receipts.length === 0 && <tr><td colSpan={7} className="py-3 text-slate-500">Aucun encaissement de vente dans les relevés déposés (les ventes arrivent sans doute sur le compte principal).</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {view === 'lignes' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"><option value="">Tous les mois</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"><option value="">Toutes les catégories</option>{BANK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer : libellé, plaque…" className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
            <label className="text-sm text-slate-700 inline-flex items-center gap-1"><input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} /> véhicules sans dossier</label>
            <span className="text-xs text-slate-500">{filtered.length} ligne{filtered.length > 1 ? 's' : ''} · sorties {eur(sum(filtered, (l) => l.amount_out ?? 0), 2)} · entrées {eur(sum(filtered, (l) => l.amount_in ?? 0), 2)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Compte</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Tiers</th><th className="py-2 pr-3">Libellé</th><th className="py-2 pr-3 text-right">Sortie</th><th className="py-2 pr-3 text-right">Entrée</th><th className="py-2 pr-3">Catégorie</th><th className="py-2 pr-3">Dossier</th>
              </tr></thead>
              <tbody>
                {filtered.map((l) => {
                  const d = l.transaction_id ? dealById.get(l.transaction_id) : null;
                  return (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="py-1 pr-3 whitespace-nowrap">{l.booked_on}</td>
                      <td className="py-1 pr-3 text-xs whitespace-nowrap" title={stmtById.get(l.statement_id) ? rowLabel(stmtById.get(l.statement_id)!) : ''}>{ACCOUNT_LABEL[l.account]}{stmtById.get(l.statement_id)?.account_ref ? <span className="text-slate-400"> …{stmtById.get(l.statement_id)!.account_ref}</span> : null}</td>
                      <td className="py-1 pr-3 text-xs font-mono">{l.kind}</td>
                      <td className="py-1 pr-3 max-w-[14rem] truncate" title={l.counterparty}>{l.counterparty}</td>
                      <td className="py-1 pr-3 max-w-[22rem] truncate" title={l.description}>{l.description}{l.plate && <span className="ml-1 font-mono text-[10px] text-slate-500">{l.plate}</span>}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{l.amount_out != null ? eur(l.amount_out, 2) : ''}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-emerald-700">{l.amount_in != null ? eur(l.amount_in, 2) : ''}</td>
                      <td className="py-1 pr-3">
                        <select value={l.category} onChange={(e) => void onCategory(l, e.target.value as BankCategory)} className={`px-1.5 py-1 rounded border text-xs bg-white ${l.category !== (l.category_auto ?? l.category) ? 'border-sky-400' : 'border-slate-200'}`} title={l.category_auto ? `classement automatique : ${CATEGORY_LABEL[l.category_auto]}` : ''}>
                          {BANK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-3 whitespace-nowrap text-xs">
                        {d ? <span title={l.match_how ?? ''} className={l.match_how === 'manuel' ? 'text-sky-700' : ''}>{d.reference}{l.match_how === 'manuel' && <button onClick={() => void onLink([l.id], '')} className="ml-1 text-slate-400 hover:text-red-600" title="Retirer le lien">×</button>}</span>
                          : ['achat_vehicule', 'acompte_vehicule', 'vente_encaissee'].includes(l.category) ? <RefInput onSubmit={(ref) => void onLink([l.id], ref)} /> : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {lines.length > 0 && <button onClick={() => void reload()} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><RefreshCw size={12} /> Recharger</button>}
        </div>
      )}
    </div>
  );
}

/** Saisie d'une REF de dossier pour poser un lien à la main (Entrée pour valider). */
function RefInput({ onSubmit }: { onSubmit: (ref: string) => void }) {
  const [v, setV] = useState('');
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-amber-700 text-xs">sans dossier</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onSubmit(v); setV(''); } }} placeholder="REF ↵" className="w-20 px-1.5 py-0.5 rounded border border-amber-300 bg-white text-xs font-mono" title="REF du dossier (ex. RV667), Entrée pour relier" />
    </span>
  );
}

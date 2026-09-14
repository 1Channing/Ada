import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Check, Zap } from 'lucide-react';
import {
  BenchRow, BenchCriteria, isoWeek, listBenchWeek, drawBenchWeek, refreshAdaCounts, saveHumanCount, listBenchHistory, scoreWeeks,
  loadBenchCriteria, forceRescrape,
} from '../services/truthBenchmark';

/**
 * ÉTALON HUMAIN HEBDOMADAIRE (Truth Center, 14/09). Cinq études tirées au
 * sort, une ligne par site : ADA dit combien il a vu, l'humain refait la
 * recherche à la main et dit combien il voit. Le rappel par site, semaine
 * après semaine, remplace l'impression par une courbe.
 */
export function TruthBenchmark() {
  const week = isoWeek();
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [history, setHistory] = useState<BenchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Critères COMPLETS des études (toute l'équipe) pour vérifier avec les bons.
  const [criteria, setCriteria] = useState<Map<string, BenchCriteria>>(new Map());
  // Rescrape en cours : l'heure de la demande, les études déjà revenues.
  const [rescrape, setRescrape] = useState<{ since: string; total: number; done: string[] } | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    const w = await listBenchWeek(week);
    setError(w.error);
    setRows(w.rows);
    setHistory(await listBenchHistory());
    setLoading(false);
  };
  useEffect(() => { void load(); void loadBenchCriteria().then(setCriteria); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  /**
   * Rescrape automatique (demande 14/09) : les études tirées repartent tout de
   * suite (le worker sonde le drapeau toutes les 30 s), puis on guette leurs
   * relevés frais toutes les 15 s pendant 8 min et on met les comptes à jour
   * au fur et à mesure. Le compte ADA est ainsi du même moment que le tien.
   */
  const launchRescrape = async () => {
    const r = await forceRescrape(week);
    if (r.error) setError(r.error);
    if (!r.studies.length) return;
    setRescrape({ since: r.requestedAt, total: r.studies.length, done: [] });
    if (pollRef.current) window.clearInterval(pollRef.current);
    const started = Date.now();
    pollRef.current = window.setInterval(async () => {
      const res = await refreshAdaCounts(week, r.requestedAt);
      const w = await listBenchWeek(week);
      if (!w.error) setRows(w.rows);
      setRescrape((prev) => (prev ? { ...prev, done: res.fresh } : prev));
      if (res.fresh.length >= r.studies.length || Date.now() - started > 8 * 60_000) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setRescrape((prev) => (prev ? { ...prev, done: res.fresh, total: prev.total } : prev));
        window.setTimeout(() => setRescrape(null), 60_000);
      }
    }, 15_000);
  };

  const draw = async () => {
    setBusy(true);
    const r = await drawBenchWeek(week);
    if (r.error) setError(r.error);
    await load();
    setBusy(false);
    if (!r.error) await launchRescrape();
  };
  const refresh = async () => {
    setBusy(true);
    await launchRescrape();
    setBusy(false);
  };

  const byStudy = useMemo(() => {
    const m = new Map<string, BenchRow[]>();
    for (const r of rows) m.set(r.search_id, [...(m.get(r.search_id) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  const scores = useMemo(() => scoreWeeks(history), [history]);
  const thisWeek = scores.find((s) => s.week === week);
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)} %`);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Étalon humain — semaine {week}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cinq études tirées au sort. Pour chaque site, refais la recherche à la main sur le site (mêmes critères), note le nombre d'annonces affiché et colle l'URL.
            ADA note le sien depuis sa dernière vague. Rappel = ce qu'ADA a vu / ce que tu as vu.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button onClick={refresh} disabled={busy || !!rescrape} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 hover:border-brand-ocean text-slate-700 disabled:opacity-50" title="Relance les 5 études maintenant et met les comptes ADA à jour dès que leurs relevés arrivent">
              {busy || rescrape ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} Rescraper les 5 études maintenant
            </button>
          )}
          {rows.length === 0 && !loading && !error && (
            <button onClick={draw} disabled={busy} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Tirer les 5 études de la semaine
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {rescrape && (
        <p className={`text-xs rounded-lg px-3 py-2 border ${rescrape.done.length >= rescrape.total ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
          {rescrape.done.length >= rescrape.total
            ? `Rescrape terminé : ${rescrape.total} étude(s) avec des relevés frais — les comptes ADA sont de maintenant, tu peux comparer.`
            : `Rescrape en cours — ${rescrape.done.length}/${rescrape.total} étude(s) revenue(s) (le worker part dans les 30 s, chaque étude prend 1 à 3 min). Les comptes se mettent à jour tout seuls.`}
        </p>
      )}

      {thisWeek && (
        <div className="grid sm:grid-cols-3 gap-3">
          <Tile label="Rappel de la semaine" value={pct(thisWeek.recall)} tone={thisWeek.recall == null ? 'idle' : thisWeek.recall >= 0.95 ? 'good' : thisWeek.recall >= 0.8 ? 'warn' : 'bad'} sub={`${thisWeek.filled}/${thisWeek.total} lignes remplies`} />
          <Tile label="ADA voit PLUS que toi" value={String(thisWeek.overcount)} tone={thisWeek.overcount === 0 ? 'good' : 'warn'} sub="mapping trop large ou critère non exprimé" />
          <Tile label="Sites mesurés" value={String(Object.keys(thisWeek.bySite).length)} tone="idle" sub={Object.entries(thisWeek.bySite).map(([s, b]) => `${s} ${pct(b.recall)}`).join(' · ') || '—'} />
        </div>
      )}

      {loading ? <p className="text-sm text-slate-400 py-6 text-center">Chargement…</p>
        : rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Aucune étude tirée cette semaine. Clique sur « Tirer les 5 études de la semaine » : le tirage est le même pour toute l'équipe.
          </div>
        ) : (
          <div className="space-y-3">
            {byStudy.map(([searchId, list]) => (
              <div key={searchId} className="bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="px-4 py-2.5 border-b border-slate-100 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 text-sm">{list[0].search_label}</span>
                    <span className="text-xs text-slate-400">{list.filter((r) => r.human_count != null).length}/{list.length} sites remplis</span>
                    {rescrape && <span className={`text-[11px] ${rescrape.done.includes(searchId) ? 'text-emerald-700' : 'text-amber-700'}`}>{rescrape.done.includes(searchId) ? '· relevé frais' : '· rescrape…'}</span>}
                  </div>
                  {/* TOUS les critères, pour refaire la même recherche (demande 14/09). */}
                  {(() => {
                    const c = criteria.get(searchId);
                    if (!c) return <p className="text-[11px] text-slate-400">Critères indisponibles (SQL du 14/09 : truth_active_studies avec id).</p>;
                    return (
                      <div className="flex flex-wrap gap-1">
                        {criteriaChips(c).map((chip) => <span key={chip} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">{chip}</span>)}
                      </div>
                    );
                  })()}
                </div>
                <div className="divide-y divide-slate-100">
                  {list.map((r) => <BenchLine key={r.id} row={r} onSaved={load} />)}
                </div>
              </div>
            ))}
          </div>
        )}

      {scores.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-700 mb-2">Semaine après semaine</p>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead><tr className="text-left text-slate-400"><th className="py-1 pr-3">Semaine</th><th className="py-1 pr-3 text-right">Remplies</th><th className="py-1 pr-3 text-right">Rappel</th><th className="py-1 pr-3 text-right">ADA &gt; humain</th><th className="py-1">Par site</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {scores.map((s) => (
                  <tr key={s.week}>
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{s.week}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{s.filled}/{s.total}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${s.recall == null ? 'text-slate-400' : s.recall >= 0.95 ? 'text-emerald-700' : s.recall >= 0.8 ? 'text-amber-700' : 'text-rose-700'}`}>{pct(s.recall)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{s.overcount}</td>
                    <td className="py-1.5 text-slate-500">{Object.entries(s.bySite).map(([site, b]) => `${site} ${pct(b.recall)}${b.over ? ` (+${b.over})` : ''}`).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Chaque critère de l'étude, tel que le worker l'applique — rien d'omis. */
function criteriaChips(c: BenchCriteria): string[] {
  const out: string[] = [];
  out.push(`${c.source_country} → ${c.target_country}`);
  out.push(`Marque ${c.brand}`);
  if (c.model) out.push(`Modèle ${c.model}`);
  out.push(c.fuel ? `Carburant ${c.fuel}` : 'Carburant : tous');
  out.push(c.year_min || c.year_max ? `Années ${c.year_min ?? '…'} – ${c.year_max ?? '…'}` : 'Années : toutes');
  out.push(c.mileage_max != null ? `≤ ${c.mileage_max.toLocaleString('fr-FR')} km` : 'Km : sans limite');
  out.push(c.power_min != null ? `≥ ${c.power_min} ch` : 'Puissance : toutes');
  out.push(c.gearbox ? `Boîte ${c.gearbox}` : 'Boîte : toutes');
  out.push(c.trim ? `Finition source « ${c.trim} »` : 'Finition source : aucune');
  out.push(c.trim_target ? `Finition cible « ${c.trim_target} »` : c.trim ? `Finition cible : comme la source` : 'Finition cible : aucune');
  return out;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'good' | 'warn' | 'bad' | 'idle' }) {
  const cls = tone === 'good' ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : tone === 'warn' ? 'border-amber-300 bg-amber-50/60 text-amber-800' : tone === 'bad' ? 'border-rose-300 bg-rose-50/60 text-rose-800' : 'border-slate-200 bg-white text-slate-700';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] opacity-80 truncate" title={sub}>{sub}</p>
    </div>
  );
}

const ageLabel = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return min < 60 ? `il y a ${min} min` : min < 48 * 60 ? `il y a ${Math.round(min / 60)} h` : `il y a ${Math.round(min / 1440)} j`;
};

function BenchLine({ row, onSaved }: { row: BenchRow; onSaved: () => Promise<void> }) {
  const [count, setCount] = useState(row.human_count == null ? '' : String(row.human_count));
  const [url, setUrl] = useState(row.human_url ?? '');
  const [note, setNote] = useState(row.note ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = count !== (row.human_count == null ? '' : String(row.human_count)) || url !== (row.human_url ?? '') || note !== (row.note ?? '');
  const human = count.trim() === '' ? null : Number(count);
  const recall = human != null && human > 0 && row.ada_count != null ? Math.min(row.ada_count, human) / human : null;
  const save = async () => {
    setSaving(true);
    const err = await saveHumanCount(row.id, human != null && Number.isFinite(human) ? human : null, url, note);
    if (err) alert(err);
    await onSaved();
    setSaving(false);
  };
  return (
    <div className="px-4 py-2 grid md:grid-cols-[1fr_auto_auto_1fr_1fr_auto] gap-2 items-center text-xs">
      <div className="min-w-0">
        <span className="font-medium text-slate-800">{row.site}</span>
        <span className="text-slate-400"> · {row.side} {row.country}</span>
      </div>
      <div className="text-right whitespace-nowrap">
        <span className="text-slate-400">ADA </span>
        <span className="font-semibold tabular-nums text-slate-800">{row.ada_count ?? '—'}</span>
        {row.ada_url && <a href={row.ada_url} target="_blank" rel="noreferrer" title={`Relevé ${row.ada_at ? new Date(row.ada_at).toLocaleString('fr-FR') : ''}`} className="inline-flex ml-1 text-brand-ocean align-middle"><ExternalLink className="w-3 h-3" /></a>}
        {row.ada_at && <span className="ml-1 text-[10px] text-slate-400" title={new Date(row.ada_at).toLocaleString('fr-FR')}>{ageLabel(row.ada_at)}</span>}
      </div>
      <div className="flex items-center gap-1 whitespace-nowrap">
        <span className="text-slate-400">Toi</span>
        <input type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} placeholder="—" className="w-16 px-2 py-1 rounded border border-slate-300 text-right tabular-nums" />
        {recall != null && <span className={`font-semibold tabular-nums ${recall >= 0.95 ? 'text-emerald-700' : recall >= 0.8 ? 'text-amber-700' : 'text-rose-700'}`}>{Math.round(recall * 100)} %{row.ada_count! > human! ? ' ↑' : ''}</span>}
      </div>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL de ta recherche (précieuse)" className="min-w-0 px-2 py-1 rounded border border-slate-300" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Remarque" className="min-w-0 px-2 py-1 rounded border border-slate-300" />
      <button onClick={save} disabled={!dirty || saving} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-white disabled:opacity-30">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} OK
      </button>
    </div>
  );
}

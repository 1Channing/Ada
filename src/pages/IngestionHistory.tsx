import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Trophy, RefreshCw, CheckCircle2, XCircle, Radio } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  loadIngestionEvents,
  loadGlobalStats,
  loadMappingTree,
  countMappings,
} from '../services/ingestionHistory';
import type { IngestionEventRow, Contributor, TreeNode, GlobalIngestionStats } from '../services/ingestionHistory';
import { MappingRadialTree } from '../components/MappingRadialTree';

const SITE_FLAG: Record<string, string> = { LEBONCOIN: '🇫🇷', MARKTPLAATS: '🇳🇱', BILBASEN: '🇩🇰' };

const ACTION_BADGE: Record<string, { text: string; cls: string }> = {
  inserted: { text: 'Nouveau', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  reinforced: { text: 'Renforcé', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  upgraded_from_csv: { text: 'Promu CSV', cls: 'bg-sky-50 text-sky-700 border-sky-300' },
  conflict_kept_existing: { text: 'Conflit', cls: 'bg-amber-50 text-amber-700 border-amber-300' },
  none: { text: '—', cls: 'bg-slate-200 text-slate-500 border-slate-300' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function vehicleOf(e: IngestionEventRow): string {
  const c = e.declared_criteria ?? {};
  const brand = String((c as Record<string, unknown>).brand ?? '').trim();
  const model = String((c as Record<string, unknown>).model ?? '').trim();
  return [brand, model].filter(Boolean).join(' ') || '—';
}

export function IngestionHistory() {
  const [events, setEvents] = useState<IngestionEventRow[]>([]);
  const [stats, setStats] = useState<GlobalIngestionStats | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [siteFilter, setSiteFilter] = useState<string>('');
  const [contributorFilter, setContributorFilter] = useState<string>('');
  // Journal pagination — 10 rows per page, the page was endless otherwise.
  const [page, setPage] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const treeReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = async () => {
    setLoading(true);
    // Journal = the latest 500 events; KPIs + leaderboard = whole-table stats,
    // so campaign floods can never shrink a colleague's score.
    const [evs, t, st] = await Promise.all([loadIngestionEvents(), loadMappingTree(), loadGlobalStats()]);
    setEvents(evs);
    setTree(t);
    setStats(st);
    setLoading(false);
  };

  useEffect(() => {
    refresh();

    // Realtime: new ingestion rows appear live.
    const channel = supabase
      .channel('ingestion_history_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'linkgen_ingestion_events' },
        (payload) => {
          const row = payload.new as unknown as IngestionEventRow;
          setEvents((prev) => [row, ...prev].slice(0, 500));
          // Keep the global stats live without a full recount.
          setStats((prev) => {
            if (!prev) return prev;
            const wrote = Boolean(row.memory_action && ['inserted', 'reinforced', 'upgraded_from_csv'].includes(row.memory_action));
            const name = (row.submitted_by ?? '').trim();
            const contributors = prev.contributors.map((c) => ({ ...c }));
            if (name) {
              const c = contributors.find((x) => x.name === name);
              if (c) { c.total += 1; if (wrote) c.written += 1; }
              else contributors.push({ name, total: 1, written: wrote ? 1 : 0 });
              contributors.sort((a, b) => b.written - a.written || b.total - a.total);
            }
            return {
              totalEvents: prev.totalEvents + 1,
              totalWritten: prev.totalWritten + (wrote ? 1 : 0),
              contributors,
            };
          });
          setFlashId(row.id);
          setTimeout(() => setFlashId((id) => (id === row.id ? null : id)), 2500);
          // A new event may have created a mapping — refresh the tree (throttled).
          if (treeReloadTimer.current) clearTimeout(treeReloadTimer.current);
          treeReloadTimer.current = setTimeout(() => { loadMappingTree().then(setTree); }, 1500);
        }
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => {
      if (treeReloadTimer.current) clearTimeout(treeReloadTimer.current);
      supabase.removeChannel(channel);
    };
  }, []);

  const contributors = useMemo(() => stats?.contributors ?? [], [stats]);
  const treeStats = useMemo(() => (tree ? countMappings(tree) : { models: 0, variants: 0, valid: 0 }), [tree]);

  const filtered = useMemo(() => events.filter((e) =>
    (!siteFilter || e.site === siteFilter) &&
    (!contributorFilter || (e.submitted_by ?? '') === contributorFilter)
  ), [events, siteFilter, contributorFilter]);

  const PAGE_SIZE = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filtered, safePage]
  );
  useEffect(() => { setPage(0); }, [siteFilter, contributorFilter]);

  const totalEvents = stats?.totalEvents ?? events.length;
  const totalWritten = stats?.totalWritten ?? 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <History className="w-6 h-6 text-blue-500" />
            Historique d'ingestion
          </h1>
          <p className="text-slate-600 mt-1 text-sm">
            Suivi en temps réel des liens ajoutés, des mappings enregistrés et des contributeurs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${live ? 'text-emerald-700 border-emerald-300 bg-emerald-50' : 'text-slate-500 border-slate-300 bg-white'}`}>
            <Radio className={`w-3.5 h-3.5 ${live ? 'animate-pulse' : ''}`} />
            {live ? 'Live' : 'Hors ligne'}
          </span>
          <button onClick={refresh} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Rafraîchir
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Liens ingérés" value={totalEvents} />
        <Kpi label="Mappings écrits / renforcés" value={totalWritten} />
        <Kpi label="Modèles couverts" value={treeStats.models} />
        <Kpi label="Contributeurs" value={contributors.length} />
      </div>

      {/* Leaderboard */}
      {contributors.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-amber-600" /> Classement des contributeurs
          </h2>
          <div className="space-y-1.5">
            {contributors.slice(0, 10).map((c, i) => (
              <ContributorRow key={c.name} rank={i} c={c} max={contributors[0].written || contributors[0].total || 1} />
            ))}
          </div>
        </div>
      )}

      {/* Radial mapping graph */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold text-slate-800 mb-1">Cartographie des mappings</h2>
        <p className="text-xs text-slate-500 mb-4">
          Site → marque → modèle → déclinaisons (carburant / finition) et facettes apprises.
          {tree ? ` ${treeStats.models} modèles, ${treeStats.variants} déclinaisons, ${treeStats.valid} certifiées.` : ''}
        </p>
        {tree && tree.children.length > 0
          ? <MappingRadialTree root={tree} />
          : <p className="text-sm text-slate-500">Aucun mapping enregistré pour l'instant — les premières ingestions confirmées apparaîtront ici.</p>}
      </div>

      {/* Journal */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-slate-800">Journal d'ingestion</h2>
          <div className="flex items-center gap-2 text-sm">
            <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs">
              <option value="">Tous les sites</option>
              {[...new Set(events.map((e) => e.site))].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={contributorFilter} onChange={(e) => setContributorFilter(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs">
              <option value="">Tous les contributeurs</option>
              {contributors.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Contributeur</th>
                <th className="py-2 pr-3">Site</th>
                <th className="py-2 pr-3">Véhicule</th>
                <th className="py-2 pr-3">Retenu</th>
                <th className="py-2 pr-3">Jeté</th>
                <th className="py-2 pr-3">Mémoire</th>
                <th className="py-2">Lien</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e) => {
                const badge = ACTION_BADGE[e.memory_action ?? 'none'] ?? ACTION_BADGE.none;
                return (
                  <tr key={e.id} className={`border-b border-slate-200 transition-colors ${flashId === e.id ? 'bg-emerald-50' : ''}`}>
                    <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{fmtDate(e.created_at)}</td>
                    <td className="py-2 pr-3 text-slate-800">{e.submitted_by || <span className="text-slate-400">anonyme</span>}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{SITE_FLAG[e.site] ?? ''} <span className="text-slate-600 text-xs">{e.site}</span></td>
                    <td className="py-2 pr-3 text-slate-700 whitespace-nowrap">{vehicleOf(e)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(e.retained ?? []).map((r, i) => (
                          <span key={i} className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />{r.field}
                          </span>
                        ))}
                        {(!e.retained || e.retained.length === 0) && <span className="text-slate-400 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(e.discarded ?? []).map((d, i) => (
                          <span key={i} title={d.reason} className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-700/90 border border-red-300 cursor-help">
                            <XCircle className="w-3 h-3" />{d.field}
                          </span>
                        ))}
                        {e.scrape_error && <span title={e.scrape_error} className="text-[11px] text-red-600 cursor-help">scrape ✗</span>}
                        {(!e.discarded || e.discarded.length === 0) && !e.scrape_error && <span className="text-slate-400 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.text}</span>
                    </td>
                    <td className="py-2 max-w-[220px]">
                      <a href={e.submitted_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs truncate block">
                        {e.submitted_url.replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-slate-500">Aucune ingestion pour ces filtres.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — 10 lignes / page */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>{filtered.length} ingestion(s) · page {safePage + 1}/{pageCount}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 disabled:opacity-40"
              >
                ← Précédent
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 disabled:opacity-40"
              >
                Suivant →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

function ContributorRow({ rank, c, max }: { rank: number; c: Contributor; max: number }) {
  const pct = Math.round((c.written / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-6 text-center text-sm">{MEDALS[rank] ?? <span className="text-slate-400">{rank + 1}</span>}</span>
      <span className="w-32 truncate text-slate-800 text-sm">{c.name}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <span className="text-xs text-slate-600 w-28 text-right">{c.written} mappings · {c.total} liens</span>
    </div>
  );
}

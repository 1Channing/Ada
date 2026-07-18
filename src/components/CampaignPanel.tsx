/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAMPAIGN PANEL — mass-ingestion campaigns (bottom of the Link Gen page)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Config → launch → live progress → gap report ("ce qu'on ne sait pas").
 * The engine itself is a module singleton (campaignRunner) so navigating
 * around ADA never interrupts a run; this panel is just a window onto it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Rocket, Square, Loader2, CheckCircle2, XCircle, AlertTriangle, ExternalLink, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { allSiteAdapters } from '../lib/study-core/marketplaces';
import { startCampaign, stopCampaign } from '../services/campaignRunner';
import { useCampaignStore, EMPTY_COUNTS } from '../store/campaignStore';
import type { CampaignItemResult, CampaignOutcome } from '../store/campaignStore';

const OUTCOME_LABELS: Record<CampaignOutcome, string> = {
  confirmed: 'confirmé',
  taxonomy_gap: 'lacune taxonomie',
  enum_gap: 'lacune critère',
  no_url: 'URL impossible',
  insufficient: 'échantillon insuffisant',
  technical: 'technique',
};

const OUTCOME_STYLE: Record<CampaignOutcome, string> = {
  confirmed: 'bg-emerald-900/40 text-emerald-400',
  taxonomy_gap: 'bg-red-900/40 text-red-400',
  enum_gap: 'bg-amber-900/40 text-amber-400',
  no_url: 'bg-zinc-800 text-zinc-400',
  insufficient: 'bg-zinc-800 text-zinc-500',
  technical: 'bg-blue-900/30 text-blue-400',
};

const SECONDS_PER_ITEM = 18; // scrape + persist + pause, empirically

export function CampaignPanel() {
  const state = useCampaignStore();
  const [total, setTotal] = useState(200);
  const [sites, setSites] = useState<string[]>(() => allSiteAdapters().map((a) => a.key));
  const [reinforcePct, setReinforcePct] = useState(15);
  const [variantPct, setVariantPct] = useState(40);
  const [startError, setStartError] = useState<string | null>(null);

  const running = state.status === 'running' || state.status === 'planning' || state.status === 'stopping';

  // When idle with no in-memory items, surface the LAST campaign's report from DB.
  useEffect(() => {
    if (running || state.items.length > 0) return;
    (async () => {
      const { data: last } = await supabase
        .from('linkgen_campaigns')
        .select('id, status, total, done_count')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last) return;
      const { data: items } = await supabase
        .from('linkgen_campaign_items')
        .select('seq, site, brand, model, criteria, url, kind, outcome, confirmed_fields, rejected, detail, sample_size')
        .eq('campaign_id', last.id)
        .order('seq');
      if (!items || items.length === 0) return;
      const mapped: CampaignItemResult[] = items.map((r) => ({
        seq: r.seq, site: r.site, brand: r.brand, model: r.model,
        fuel: (r.criteria as { fuel?: string } | null)?.fuel ?? undefined,
        trim: (r.criteria as { trim?: string } | null)?.trim ?? undefined,
        kind: (r.kind as CampaignItemResult['kind']) ?? 'exploration',
        url: r.url, outcome: (r.outcome ?? 'technical') as CampaignOutcome,
        confirmedFields: r.confirmed_fields ?? [],
        rejected: (r.rejected as CampaignItemResult['rejected']) ?? [],
        detail: r.detail ?? '', sampleSize: r.sample_size,
      }));
      const counts = { ...EMPTY_COUNTS };
      for (const m of mapped) counts[m.outcome]++;
      useCampaignStore.setState({
        campaignId: last.id,
        status: last.status === 'running' ? 'idle' : (last.status as 'stopped' | 'done'),
        total: last.total, done: mapped.length, counts, items: mapped,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gaps = useMemo(
    () => state.items.filter((i) => i.outcome === 'taxonomy_gap' || i.outcome === 'enum_gap'),
    [state.items]
  );
  const gapsBySite = useMemo(() => {
    const g: Record<string, CampaignItemResult[]> = {};
    for (const item of gaps) (g[item.site] ??= []).push(item);
    return g;
  }, [gaps]);

  const estMinutes = Math.round((total * SECONDS_PER_ITEM) / 60);

  const toggleSite = (key: string) =>
    setSites((prev) => prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]);

  const handleStart = async () => {
    setStartError(null);
    const res = await startCampaign({
      sites, total,
      reinforceShare: reinforcePct / 100,
      variantShare: variantPct / 100,
    });
    if (!res.started) setStartError(res.reason ?? 'Lancement impossible');
  };

  const openInIngestion = (url: string) => {
    window.history.pushState({}, '', `/ingestion?url=${encodeURIComponent(url)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const feed = state.items.slice(-12).reverse();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Rocket className="w-4 h-4 text-violet-400" />
          Campagnes de mapping — exploration de masse
        </h2>
        {running && (
          <span className="flex items-center gap-1.5 text-xs text-violet-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {state.status === 'stopping' ? 'arrêt en cours…' : `${state.done}/${state.total}`}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        Projette les critères déjà validés (marques, modèles, carburants, finitions — liés à leur marque)
        sur les sites où ils ne le sont pas encore. Chaque étude passe par le pipeline d'ingestion normal :
        ce qui se confirme enrichit la mémoire (réutilisable immédiatement), ce qui échoue devient la liste
        de ce qu'il faut aller chercher à la main. La campagne continue si vous changez de page.
      </p>

      {/* Config */}
      {!running && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-zinc-400">Nombre d'études : <span className="text-zinc-200 font-semibold">{total}</span> (~{estMinutes} min, {total} appels Zyte)</span>
              <input
                type="range" min={10} max={500} step={10} value={total}
                onChange={(e) => setTotal(Number(e.target.value))}
                className="w-full mt-1 accent-violet-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-400">Renforcement (re-test de combos déjà validés) : {reinforcePct}%</span>
              <input
                type="range" min={0} max={50} step={5} value={reinforcePct}
                onChange={(e) => setReinforcePct(Number(e.target.value))}
                className="w-full mt-1 accent-violet-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-400">Variantes carburant / finition (liées à leur marque+modèle) : {variantPct}%</span>
              <input
                type="range" min={0} max={100} step={10} value={variantPct}
                onChange={(e) => setVariantPct(Number(e.target.value))}
                className="w-full mt-1 accent-violet-500"
              />
            </label>
          </div>
          <div>
            <span className="text-xs text-zinc-400 block mb-1.5">Sites cibles</span>
            <div className="flex flex-wrap gap-1.5">
              {allSiteAdapters().map((a) => (
                <button
                  key={a.key}
                  onClick={() => toggleSite(a.key)}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${
                    sites.includes(a.key)
                      ? 'bg-violet-900/40 border-violet-700 text-violet-300'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {a.displayName}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {!running ? (
          <button
            onClick={handleStart}
            disabled={sites.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            <Rocket className="w-4 h-4" />
            Lancer la campagne ({total})
          </button>
        ) : (
          <button
            onClick={stopCampaign}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
          >
            <Square className="w-4 h-4" />
            Arrêt immédiat
          </button>
        )}
        {startError && <span className="text-xs text-red-400">{startError}</span>}
        {state.error && <span className="text-xs text-red-400">{state.error}</span>}
      </div>

      {/* Live progress */}
      {(running || state.items.length > 0) && (
        <div className="space-y-3">
          <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-violet-500 h-2 transition-all"
              style={{ width: `${state.total ? Math.round((state.done / state.total) * 100) : 0}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-400">
              <CheckCircle2 className="w-3 h-3 inline mr-1" />{state.counts.confirmed} confirmés
            </span>
            <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-400">
              <XCircle className="w-3 h-3 inline mr-1" />{state.counts.taxonomy_gap} lacunes taxonomie
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-900/40 text-amber-400">
              <AlertTriangle className="w-3 h-3 inline mr-1" />{state.counts.enum_gap} lacunes critère
            </span>
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{state.counts.no_url} URL impossibles</span>
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-500">{state.counts.insufficient} insuffisants</span>
            <span className="px-2 py-0.5 rounded bg-blue-900/30 text-blue-400">{state.counts.technical} techniques</span>
          </div>
          {state.current && (
            <div className="text-xs text-zinc-400 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
              #{state.current.seq} — {state.current.site} · {state.current.brand} {state.current.model}
              <span className="text-zinc-600">({state.current.reason})</span>
            </div>
          )}
          {feed.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {feed.map((item) => (
                <div key={item.seq} className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-600 font-mono w-8 shrink-0">#{item.seq}</span>
                  <span className={`shrink-0 px-1.5 rounded text-[10px] font-medium ${OUTCOME_STYLE[item.outcome]}`}>
                    {OUTCOME_LABELS[item.outcome]}
                  </span>
                  <span className="text-zinc-400 truncate">
                    {item.site} · {item.brand} {item.model}
                    {item.fuel ? ` · ${item.fuel}` : ''}{item.trim ? ` · ${item.trim}` : ''}
                  </span>
                  <span className="text-zinc-600 truncate hidden md:inline">{item.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gap report — "ce qu'on ne sait pas" */}
      {gaps.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-zinc-800">
          <h3 className="text-xs font-semibold text-zinc-300">
            Rapport d'inconnues — {gaps.length} élément(s) à traiter manuellement
          </h3>
          {Object.entries(gapsBySite).map(([site, items]) => (
            <div key={site}>
              <div className="text-xs font-medium text-zinc-400 mb-1">{site} ({items.length})</div>
              <div className="space-y-1">
                {items.map((item) => (
                  <div key={item.seq} className="flex items-center gap-2 text-xs bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5">
                    <span className={`shrink-0 px-1.5 rounded text-[10px] font-medium ${OUTCOME_STYLE[item.outcome]}`}>
                      {OUTCOME_LABELS[item.outcome]}
                    </span>
                    <span className="text-zinc-300 shrink-0">{item.brand} {item.model}</span>
                    <span className="text-zinc-500 truncate flex-1">{item.detail}</span>
                    {item.url && (
                      <>
                        <a
                          href={item.url} target="_blank" rel="noreferrer"
                          className="text-zinc-500 hover:text-zinc-300 shrink-0" title="Ouvrir l'URL testée"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => openInIngestion(item.url!)}
                          className="flex items-center gap-1 text-violet-400 hover:text-violet-300 shrink-0"
                          title="Corriger en Ingestion (URL pré-remplie)"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          Corriger
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
